import { type NextRequest, NextResponse } from "next/server";
import { requireOwnerOrAbove } from "@/lib/auth";
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage } from "@/lib/whatsapp";

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

  // Template mode. Free-form text below only reaches a number that messaged the
  // business in the last 24 hours — every real reminder goes to someone who
  // hasn't, which is the whole reason approved templates exist. Testing the
  // free-form path therefore proves nothing about the path we actually ship.
  const template = typeof body?.template === "string" ? body.template.trim() : null;
  if (template) {
    const language = typeof body?.language === "string" ? body.language.trim() : "";
    if (!language) {
      return NextResponse.json(
        { error: "Missing language — use the exact code shown beside the template in WhatsApp Manager (e.g. en or en_US; they are not interchangeable)" },
        { status: 400 }
      );
    }
    const params: unknown = body?.params;
    if (!Array.isArray(params) || params.some((p) => typeof p !== "string" || p.trim() === "")) {
      return NextResponse.json(
        { error: "params must be an array of non-empty strings, in {{1}}..{{n}} order — Meta rejects an empty parameter" },
        { status: 400 }
      );
    }
    const result = await sendWhatsAppTemplateMessage(
      digits,
      template,
      language,
      params as string[],
      { hostelId: null, tenantId: null, messageType: "test" }
    );
    return NextResponse.json({ mode: "template", template, language, to: digits, ...result });
  }

  const result = await sendWhatsAppMessage(
    digits,
    "This is a test message from Pulse HMS — Meta WhatsApp API is working.",
    { hostelId: null, tenantId: null, messageType: "test" }
  );

  return NextResponse.json({ mode: "text", to: digits, ...result });
}
