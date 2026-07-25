import { type NextRequest, NextResponse } from "next/server";
import { requireOwnerOrAbove } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

// Manual verification endpoint for the Meta WhatsApp API migration —
// session-gated (requireOwnerOrAbove), NOT the CRON_SECRET bearer pattern
// used by /api/cron/* routes. This endpoint accepts an arbitrary
// caller-supplied phone number and fires a real, billable Meta API call with
// no rate limit — the cron secret's threat model (trusted server-to-server
// caller, fixed non-attacker-controlled behavior) doesn't fit that. Not
// listed in lib/supabase/middleware.ts's public allowlist, so an
// unauthenticated request is bounced by the middleware before this handler
// ever runs; an authenticated owner session passes through and hits the role
// check below.
export async function POST(req: NextRequest) {
  try {
    await requireOwnerOrAbove();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const phone = body?.phone;
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }

  const digits = phone.replace(/\D/g, "").replace(/^0/, "92");
  const result = await sendWhatsAppMessage(
    digits,
    "This is a test message from Pulse HMS — Meta WhatsApp API is working.",
    { hostelId: null, tenantId: null, messageType: "test" }
  );

  return NextResponse.json(result);
}
