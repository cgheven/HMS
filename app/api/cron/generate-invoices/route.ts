import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInvoiceForOwner } from "@/lib/invoice-generation";
import { sendInvoiceMail } from "@/lib/client-invoice-mailer";
import { sendInvoiceWhatsApp } from "@/lib/client-invoice-whatsapp";
import { pktTodayDateString } from "@/lib/pkt-time";

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as
// /api/cron/lead-followups. Generates the next invoice for any client whose
// next_invoice_date has arrived, then SENDS it on both channels — does NOT mark
// anything paid (that stays manual).
//
// Sending here is what arms the whole chase: /api/cron/client-invoice-reminders
// only chases invoices with first_sent_at set, and nothing sets that except an
// actual send. Before this, a generated invoice sat silent and unchased until
// someone remembered to press "Send invoice" in Super Admin — one click per
// client per cycle, and a missed click meant a client was never asked at all.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = pktTodayDateString();

  const { data: due, error } = await admin
    .from("hms_client_billing")
    .select("owner_id")
    .not("monthly_rate", "is", null)
    .not("next_invoice_date", "is", null)
    .lte("next_invoice_date", today);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let generated = 0;
  let skipped = 0;
  let emailed = 0;
  let whatsapped = 0;
  const sendFailures: string[] = [];

  for (const row of due ?? []) {
    try {
      const result = await generateInvoiceForOwner(admin, row.owner_id);
      if (!result.generated || !result.invoiceId) {
        skipped++;
        continue;
      }
      generated++;

      // Email first: it sets first_sent_at, which is what makes the invoice
      // eligible for the 4-day reminder chase. If it fails, the invoice exists
      // but will never be chased — so that failure is surfaced in the response
      // rather than swallowed, and the "Send invoice" button remains the manual
      // recovery for it.
      const mail = await sendInvoiceMail(admin, result.invoiceId, "invoice");
      if (mail.sent) emailed++;
      else sendFailures.push(`email ${result.invoiceId}: ${mail.reason ?? "unknown"}`);

      // Independent of the email — a client with no phone on file must still
      // get their invoice, and a Meta outage must not stop the email's clock.
      const wa = await sendInvoiceWhatsApp(admin, result.invoiceId);
      if (wa.sent) whatsapped++;
      else sendFailures.push(`whatsapp ${result.invoiceId}: ${wa.reason ?? "unknown"}`);
    } catch (err) {
      skipped++;
      sendFailures.push(`owner ${row.owner_id}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return NextResponse.json({
    checked: due?.length ?? 0,
    generated,
    emailed,
    whatsapped,
    skipped,
    // Named, not counted: an invoice that generated but did not send is money
    // nobody will ever be asked for, and it needs to be actionable from the log.
    sendFailures,
  });
}
