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
}

export interface WhatsAppSendContext {
  hostelId: string | null;
  tenantId: string | null;
  messageType: "reminder" | "announcement" | "welcome" | "leaving_reminder" | "test" | "receipt";
}

async function logFailure(phone: string, error: string, context: WhatsAppSendContext) {
  try {
    const admin = createAdminClient();
    await admin.from("hms_whatsapp_failures").insert({
      hostel_id: context.hostelId,
      tenant_id: context.tenantId,
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
  if (!token || !phoneNumberId) {
    const error = "WHATSAPP_TOKEN or PHONE_NUMBER_ID not configured";
    await logFailure(phoneDigits, error, context);
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
      await logFailure(phoneDigits, error, context);
      return { ok: false, error };
    }
    return { ok: true };
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
export async function sendWhatsAppTemplateMessage(
  phoneDigits: string,
  templateName: string,
  languageCode: string,
  bodyVariables: string[],
  context: WhatsAppSendContext
): Promise<SendWhatsAppResult> {
  return postToMeta(
    {
      messaging_product: "whatsapp",
      to: phoneDigits,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(bodyVariables.length > 0
          ? { components: [{ type: "body", parameters: bodyVariables.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    },
    phoneDigits,
    context
  );
}
