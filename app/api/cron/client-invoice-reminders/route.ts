import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvoiceMail, REMINDER_INTERVAL_DAYS } from "@/lib/client-invoice-mailer";
import { sendInvoiceWhatsApp } from "@/lib/client-invoice-whatsapp";

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as the
// other jobs. Chases unpaid platform invoices every REMINDER_INTERVAL_DAYS.
//
// Deliberately only touches invoices with first_sent_at set — that column is
// written by the SuperAdmin "Send invoice" button. So generating an invoice
// never emails anyone by itself, and a client is only ever chased about an
// invoice a human decided to send them. Marking an invoice paid stops the
// chasing immediately, since the scan filters on status = 'unpaid'.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 86_400_000).toISOString();

  const { data: due, error } = await admin
    .from("hms_platform_invoices")
    .select("id, owner_id, last_reminder_at, first_sent_at")
    .eq("status", "unpaid")
    .not("first_sent_at", "is", null)
    .or(`last_reminder_at.is.null,last_reminder_at.lte.${cutoff}`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Never chase an owner on Paddle card billing — Paddle charges them and runs
  // its own card dunning; a manual reminder for the same account is double-dunning.
  const { data: paddleRows } = await admin
    .from("hms_paddle_subscriptions")
    .select("owner_id")
    .in("status", ["active", "trialing", "past_due", "paused"]);
  const paddleOwners = new Set((paddleRows ?? []).map((r: { owner_id: string }) => r.owner_id));

  let sent = 0;
  let whatsappSent = 0;
  const skipped: string[] = [];
  const whatsappSkipped: string[] = [];

  for (const inv of due ?? []) {
    if (paddleOwners.has(inv.owner_id)) { skipped.push(`on paddle: ${inv.id}`); continue; }
    // Email first — it carries the full breakdown and is what updates
    // last_reminder_at, so the 4-day clock is driven by one channel only.
    try {
      const result = await sendInvoiceMail(admin, inv.id, "reminder");
      if (result.sent) sent++;
      else skipped.push(result.reason ?? "unknown");
    } catch (err) {
      // One client's bad email address must not stop the rest of the run.
      skipped.push(err instanceof Error ? err.message : "send failed");
    }

    // WhatsApp second, and independently: an unread invoice email is the norm,
    // and these clients live on WhatsApp. A failure here must not mask a
    // successful email, so it is tracked separately rather than merged.
    try {
      const wa = await sendInvoiceWhatsApp(admin, inv.id);
      if (wa.sent) whatsappSent++;
      else whatsappSkipped.push(wa.reason ?? "unknown");
    } catch (err) {
      whatsappSkipped.push(err instanceof Error ? err.message : "whatsapp failed");
    }
  }

  return NextResponse.json({
    checked: due?.length ?? 0,
    intervalDays: REMINDER_INTERVAL_DAYS,
    sent,
    skipped,
    whatsappSent,
    whatsappSkipped,
  });
}
