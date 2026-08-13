import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Meta WhatsApp Business Cloud API — replaces the WasenderAPI relay
// (formerly lib/wasender.ts). All 4 real callers already compute phone
// digits in the format Meta wants (e.g. "923313454321", country code first,
// no plus sign) before calling this, so `to` is used verbatim — no JID
// transform needed like the old Wasender code required.
const META_API_VERSION = "v25.0";

export interface SendWhatsAppResult {
  ok: boolean;
  error?: string;
  /** Meta's message id. The delivery webhook arrives keyed on this and nothing
   *  else, so a caller that wants to correlate its own record with a later
   *  delivered/read status must keep it. */
  wamid?: string | null;
}

export interface WhatsAppSendContext {
  hostelId: string | null;
  tenantId: string | null;
  /** The CLIENT (hostel owner) a message was addressed to, when it wasn't a
   *  tenant — invoice reminders, provisioning, the owner's daily summary.
   *  Never set alongside tenantId; see migration 163. */
  ownerId?: string | null;
  /** A CRM prospect, not a customer — marketing campaigns only. Mutually
   *  exclusive with tenantId and ownerId, and the reason the monitoring page
   *  can separate outreach from service messages. See migration 169. */
  leadId?: string | null;
  messageType: "reminder" | "announcement" | "welcome" | "leaving_reminder" | "test" | "receipt" | "marketing";
}

/**
 * One row per attempt in hms_whatsapp_messages, whatever the outcome.
 *
 * hms_whatsapp_failures is left untouched and still written on failure — it is
 * referenced elsewhere and removing it would be a behaviour change bundled into
 * a monitoring feature. This is the log that can answer "was it sent?", which
 * a failures-only table structurally cannot.
 *
 * `status` starts at 'queued' on success, not 'sent': a 200 from Meta means it
 * was accepted for delivery, nothing more. The webhook advances it from there.
 */
async function logAttempt(args: {
  phone: string;
  context: WhatsAppSendContext;
  template: string | null;
  wamid: string | null;
  status: "queued" | "failed";
  error?: string;
  errorCode?: number | null;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("hms_whatsapp_messages").insert({
      hostel_id: args.context.hostelId,
      tenant_id: args.context.tenantId,
      owner_id: args.context.ownerId ?? null,
      lead_id: args.context.leadId ?? null,
      phone: args.phone,
      message_type: args.context.messageType,
      template: args.template,
      wamid: args.wamid,
      status: args.status,
      error: args.error ?? null,
      error_code: args.errorCode ?? null,
    });
  } catch {
    // Logging must never mask or fail the send it is describing.
  }
}

async function logFailure(phone: string, error: string, context: WhatsAppSendContext) {
  try {
    const admin = createAdminClient();
    await admin.from("hms_whatsapp_failures").insert({
      hostel_id: context.hostelId,
      tenant_id: context.tenantId,
      owner_id: context.ownerId ?? null,
      phone,
      message_type: context.messageType,
      error,
    });
  } catch {
    // Logging failures must never mask the original send failure.
  }
}

// Shared by both send functions below — one place that talks to Meta, parses
// its response, and logs failures, so sendWhatsAppMessage and
// sendWhatsAppTemplateMessage can never drift on error-handling behavior.
async function postToMeta(
  payload: Record<string, unknown>,
  phoneDigits: string,
  context: WhatsAppSendContext
): Promise<SendWhatsAppResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  // WABA_ID intentionally unused here — it scopes template/business-profile
  // management APIs, not this messages endpoint.
  const templateName =
    (payload.template as { name?: string } | undefined)?.name ?? null;

  if (!token || !phoneNumberId) {
    const error = "WHATSAPP_TOKEN or PHONE_NUMBER_ID not configured";
    await logFailure(phoneDigits, error, context);
    await logAttempt({ phone: phoneDigits, context, template: templateName, wamid: null, status: "failed", error });
    return { ok: false, error };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let error = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.error?.message) {
          error = `[${parsed.error.code ?? res.status}] ${parsed.error.message}${parsed.error.fbtrace_id ? ` (fbtrace: ${parsed.error.fbtrace_id})` : ""}`;
        }
      } catch {
        // Not JSON — keep the raw text fallback.
      }
      let code: number | null = null;
      try { code = JSON.parse(raw)?.error?.code ?? null; } catch { /* keep null */ }
      await logFailure(phoneDigits, error, context);
      await logAttempt({ phone: phoneDigits, context, template: templateName, wamid: null, status: "failed", error, errorCode: code });
      return { ok: false, error };
    }

    // The wamid is the ONLY key the delivery webhook arrives with, so a row
    // without it can never be advanced past 'queued'.
    let wamid: string | null = null;
    try {
      wamid = (await res.clone().json())?.messages?.[0]?.id ?? null;
    } catch {
      // Accepted but unparseable — still worth logging the attempt.
    }
    await logAttempt({ phone: phoneDigits, context, template: templateName, wamid, status: "queued" });
    return { ok: true, wamid };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    await logFailure(phoneDigits, error, context);
    return { ok: false, error };
  }
}

// context is REQUIRED (not optional) — hms_whatsapp_failures.message_type is
// not-null, so an omitted context would make the failure-logging insert
// itself throw inside the swallowed try/catch, silently defeating the one
// guarantee this table exists for. Every call site must supply it.
//
// Free-form text — only deliverable within 24 hours of the recipient's last
// message to this business number ("session window"). Outside that window
// Meta rejects it; use sendWhatsAppTemplateMessage below instead for any
// business-initiated message (reminders, welcome, announcements) where no
// such open session can be assumed.
export async function sendWhatsAppMessage(
  phoneDigits: string,
  text: string,
  context: WhatsAppSendContext
): Promise<SendWhatsAppResult> {
  return postToMeta(
    { messaging_product: "whatsapp", to: phoneDigits, type: "text", text: { body: text } },
    phoneDigits,
    context
  );
}

// Sends a pre-approved WhatsApp template message — the only reliable way to
// reach a tenant who hasn't messaged the business number recently (i.e. every
// automated reminder/welcome/announcement send). `templateName` must exactly
// match an APPROVED template name in Meta's WhatsApp Manager; `languageCode`
// must match the language it was approved in (e.g. "en_US" — check the exact
// code shown next to the template name in WhatsApp Manager, don't assume).
// `bodyVariables` are the {{1}}, {{2}}, ... values in order — Meta fills them
// into the approved body positionally, it does not accept named substitution.
export interface TemplateSendOptions {
  /**
   * Public HTTPS URL of the header image, for a template approved with an
   * IMAGE header.
   *
   * REQUIRED for such a template — Meta does not fall back to the sample image
   * uploaded at approval time, it rejects the send outright. The URL must be
   * reachable without auth: Meta fetches it itself, carrying none of our
   * cookies. Anything under public/ qualifies, because middleware.ts's matcher
   * excludes image extensions.
   */
  headerImageUrl?: string;
}

export async function sendWhatsAppTemplateMessage(
  phoneDigits: string,
  templateName: string,
  languageCode: string,
  bodyVariables: string[],
  context: WhatsAppSendContext,
  options: TemplateSendOptions = {}
): Promise<SendWhatsAppResult> {
  // Order matters to Meta: header before body.
  const components: Record<string, unknown>[] = [];
  if (options.headerImageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: options.headerImageUrl } }],
    });
  }
  if (bodyVariables.length > 0) {
    components.push({
      type: "body",
      parameters: bodyVariables.map((text) => ({ type: "text", text })),
    });
  }

  return postToMeta(
    {
      messaging_product: "whatsapp",
      to: phoneDigits,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    },
    phoneDigits,
    context
  );
}
