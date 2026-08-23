import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Meta delivery-status webhook.
 *
 * The send API only ever says "accepted" — it cannot tell you a message reached
 * the phone, was read, or bounced because the number is not a WhatsApp user.
 * All of that arrives here afterwards, keyed on the wamid captured at send time
 * (lib/whatsapp.ts), which is why hms_whatsapp_messages stores it.
 *
 * PUBLIC by necessity: Meta calls it server-to-server with no session and no
 * bearer token of ours. It is protected instead by (a) the GET verification
 * handshake below, which requires WHATSAPP_VERIFY_TOKEN, and (b) the fact that
 * a forged POST can only ever move a status on a row whose wamid the caller
 * already knows — it cannot create rows, read data, or reach any other table.
 *
 * Must be added to the public allowlist in lib/supabase/middleware.ts, or the
 * auth gate redirects Meta to /login and every status update is silently lost.
 */

// Meta's one-time subscription handshake: echo hub.challenge if the token matches.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "WHATSAPP_VERIFY_TOKEN not configured" }, { status: 500 });
  }
  if (mode === "subscribe" && token === expected && challenge) {
    // Must be the bare challenge string, not JSON — Meta rejects anything else.
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/**
 * Hands a marketing lead back its one shot at a campaign when the message died
 * after Meta accepted it.
 *
 * sendLeadCampaign claims the lead in hms_lead_campaign_sends BEFORE calling
 * Meta, and hms_lead_campaign_sends_once — UNIQUE (lead_id, campaign_key) WHERE
 * status <> 'failed' — is what stops a second send. That is correct for a
 * message that arrived, and wrong for one that did not: Meta returns 200 with a
 * message id and only reports the failure here, seconds later. 131049 ("not
 * delivered to maintain healthy ecosystem engagement" — the per-recipient
 * marketing cap) does exactly that, and on a 74-lead blast it is not an edge
 * case. Without this, every lead it hits is marked 'sent', never receives
 * anything, and can never be sent the campaign again.
 *
 * Scoped by wamid, which the ledger only carries for a campaign send, so this
 * cannot touch a rent reminder, a referral invite or any other message type —
 * they have no row here to match.
 *
 * Two guards make a retried webhook harmless: eq('status', 'sent') means an
 * already-released row is a no-op, and a released row simply leaves the partial
 * index, so a later send inserts a fresh row rather than colliding.
 *
 * A failure webhook that somehow beat the ledger's own wamid write matches
 * nothing and is skipped — that is the behaviour this page had before, so the
 * race can only fail back to the status quo, never past it.
 */
async function releaseCampaignClaim(
  admin: ReturnType<typeof createAdminClient>,
  wamid: string,
  err: { code?: number; title?: string; message?: string } | undefined
): Promise<void> {
  // Swallowed on purpose. Meta batches many statuses into one POST, and this
  // call sits inside that loop: a network blip here would abort the whole
  // batch, silently dropping delivery updates for messages that have nothing
  // to do with marketing — a client's rent reminders, sitting behind a
  // campaign row in the same payload. Losing a ledger release costs one lead a
  // retry; losing the batch costs sixteen clients their delivery status.
  try {
    const reason = err?.title ?? err?.message ?? "Undelivered";
    await admin
      .from("hms_lead_campaign_sends")
      .update({
        status: "failed",
        error: err?.code ? `[${err.code}] ${reason}` : reason,
      })
      .eq("wamid", wamid)
      .eq("status", "sent");
  } catch (e) {
    console.error("[whatsapp-webhook] could not release campaign claim:", e);
  }
}

/** Meta's status vocabulary, mapped to ours. */
const STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "undelivered",
};

export async function POST(request: NextRequest) {
  // Always answer 200, even on a payload we cannot parse. A non-200 makes Meta
  // retry with backoff and, after enough failures, disable the subscription —
  // losing every future status update to protect against one bad message.
  try {
    const body = await request.json();
    const admin = createAdminClient();

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const st of change?.value?.statuses ?? []) {
          const mapped = STATUS_MAP[st?.status];
          if (!mapped || !st?.id) continue;

          // errors[] is present on a failed status — this is where "not a
          // WhatsApp user" (131026) actually surfaces. It never appears in the
          // send response.
          const err = st.errors?.[0];

          await admin
            .from("hms_whatsapp_messages")
            .update({
              status: mapped,
              error: err?.title ?? err?.message ?? null,
              error_code: err?.code ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("wamid", st.id);

          if (mapped === "undelivered") await releaseCampaignClaim(admin, st.id, err);
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp-webhook] failed to process payload:", err);
  }

  return NextResponse.json({ received: true });
}
