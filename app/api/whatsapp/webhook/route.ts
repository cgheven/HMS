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
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp-webhook] failed to process payload:", err);
  }

  return NextResponse.json({ received: true });
}
