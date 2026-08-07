import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pktTodayDateString } from "@/lib/pkt-time";
import { TEMPLATES, reminderFullParams, reminderPartialParams } from "@/lib/whatsapp-templates";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { tenantDueDay, shouldRemindToday } from "@/lib/payment-calc";
import { processInBatches } from "@/lib/batch";
import type { PaymentMethodAccount } from "@/types";

export interface ReminderPaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  amount_paid: number | null;
  /** Selected, not just filtered on — it decides which template is sent. */
  status: string;
  late_fee: number | null;
  for_month: string;
  ac_charge: number | null;
  ac_units_consumed: number | null;
  ac_maintenance_charge: number | null;
  registration_fee_charge: number | null;
  last_reminder_sent_at: string | null;
  tenant: { full_name: string; phone: string | null; security_deposit: number | null; check_in: string; is_active: boolean; is_waiting: boolean } | null;
  hostel: { name: string; payment_methods: PaymentMethodAccount[]; reminder_template: string | null; whatsapp_enabled: boolean } | null;
}

export interface ReminderSummary {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  markFailed: number;
}

// The Meta WhatsApp Business API is a single shared business number — a
// handful of tenants at once is fine, but sending to hundreds of
// simultaneously-due tenants with zero concurrency limit risks tripping the
// provider's own rate limit. Small batches keep this bounded without
// serializing everything one at a time.
const SEND_CONCURRENCY = 5;

// Shared by the daily cron (app/api/cron/payment-reminders/route.ts) and the
// owner-facing "Send Reminders Now" bulk action (sendBulkRemindersAction in
// app/actions/payments.ts) — one implementation so a manual click and the
// scheduled run can never disagree on who gets reminded or what the message
// says.
//
// scheduleGate=true (cron): only fires on a tenant's own due day / +3-day
// cadence. scheduleGate=false (manual button): fires for every currently
// pending/overdue/partially-paid active tenant regardless of their due day —
// the button is for on-demand collection pressure, not a schedule override.
// Both paths keep the "already reminded today" guard below, so the button
// can't be mashed to spam the same tenant more than once a day, and a manual
// send today doesn't cause the cron to double-send later today either.
export async function runReminderPass(
  admin: SupabaseClient,
  hostelId: string,
  forMonth: string,
  scheduleGate: boolean
): Promise<ReminderSummary> {
  const today = pktTodayDateString();
  const dayOfMonth = Number(today.slice(8, 10));

  const { data: payments, error } = await admin
    .from("hms_payments")
    .select(
      "id, tenant_id, amount, amount_paid, status, late_fee, for_month, ac_charge, ac_units_consumed, ac_maintenance_charge, registration_fee_charge, last_reminder_sent_at, " +
      "tenant:hms_tenants(full_name, phone, security_deposit, check_in, is_active, is_waiting), " +
      "hostel:hms_hostels(name, payment_methods, reminder_template, whatsapp_enabled)"
    )
    .eq("hostel_id", hostelId)
    .eq("for_month", forMonth)
    .in("status", ["pending", "overdue", "partially_paid"])
    .returns<ReminderPaymentRow[]>();

  if (error) throw new Error(error.message);

  const due: ReminderPaymentRow[] = [];
  let skipped = 0;

  for (const p of payments ?? []) {
    // Not granted by Super Admin.
    if (!p.hostel?.whatsapp_enabled) {
      skipped++;
      continue;
    }

    // Checked out — never remind, even if a balance is still outstanding.
    if (!p.tenant?.is_active) {
      skipped++;
      continue;
    }

    // Waiting-list — hasn't actually moved in (no room assigned yet, check_in
    // is often still in the future). A waiting-list row can carry is_active =
    // true alongside is_waiting = true, so this is checked independently of
    // the is_active guard above, not folded into it.
    if (p.tenant.is_waiting) {
      skipped++;
      continue;
    }

    // Not a reminder day for this tenant (due day itself, or a multiple of 3
    // days past it) — skipped only when the schedule gate applies.
    if (scheduleGate && (!p.tenant.check_in || !shouldRemindToday(tenantDueDay(p.tenant.check_in, p.for_month), dayOfMonth))) {
      skipped++;
      continue;
    }

    // Already reminded today (cron retry, or a manual click after the cron
    // already fired, or vice versa) — never double-send within the same day.
    if (p.last_reminder_sent_at && pktTodayDateString(new Date(p.last_reminder_sent_at)) === today) {
      skipped++;
      continue;
    }

    const rawPhone = p.tenant?.phone ?? "";
    const digits = rawPhone.replace(/\D/g, "").replace(/^0/, "92");
    if (!digits) {
      skipped++;
      continue;
    }

    due.push(p);
  }

  let sent = 0;
  let failed = 0;
  let markFailed = 0;

  await processInBatches(due, SEND_CONCURRENCY, async (p) => {
    const digits = (p.tenant?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    // Remaining balance, not the full bill — a partially_paid row already has
    // real money against it, and reminding for the original total would ask
    // the tenant to pay something they've already handed over.
    const total = Math.max(0, Number(p.amount) + Number(p.late_fee ?? 0) - Number(p.amount_paid ?? 0));
    // Which template depends on what the tenant has actually done. A partial
    // payer who is told "your rent of Rs 13,000 is still pending", with no
    // mention of the Rs 20,000 they already sent, replies "I already paid" —
    // exactly the exchange automating this was meant to remove. Their status
    // is already recorded, so there is nothing to infer.
    //
    // Both are approved Meta templates rather than free-form text: a tenant
    // being chased for rent has almost never messaged the business in the last
    // 24 hours, and free-form outside that window is rejected with 131047. The
    // hostel's own reminder_template wording cannot apply — Meta approves one
    // fixed body and only the parameters vary. It still drives the manual
    // wa.me button.
    const alreadyPaid = Number(p.amount_paid ?? 0);
    const isPartial = p.status === "partially_paid" && alreadyPaid > 0;

    const tpl = isPartial ? TEMPLATES.reminderPartial : TEMPLATES.reminderFull;
    const params = isPartial
      ? reminderPartialParams({
          tenantName: p.tenant?.full_name,
          amountDue: total,
          amountPaid: alreadyPaid,
          forMonth: p.for_month,
          hostelName: p.hostel?.name,
          accounts: p.hostel?.payment_methods,
        })
      : reminderFullParams({
          tenantName: p.tenant?.full_name,
          amountDue: total,
          forMonth: p.for_month,
          hostelName: p.hostel?.name,
          accounts: p.hostel?.payment_methods,
        });

    const result = await sendWhatsAppTemplateMessage(
      digits,
      tpl.name,
      tpl.language,
      params,
      { hostelId, tenantId: p.tenant_id, messageType: "reminder" }
    );
    if (!result.ok) {
      failed++;
      console.error(`[reminder-engine] Meta WhatsApp API rejected reminder for "${p.tenant?.full_name ?? "unknown"}" (payment ${p.id}, phone ${digits}):`, result.error);
      return;
    }

    // The message is already delivered at this point — if this write fails,
    // do NOT silently count it as a clean "sent": surface it separately so
    // it's visible (a retry today would otherwise re-send a real duplicate
    // message, since the "already reminded today" guard above would find
    // nothing to skip on).
    const { error: markErr } = await admin
      .from("hms_payments")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", p.id);

    if (markErr) {
      markFailed++;
      console.error(`[reminder-engine] sent to payment ${p.id} but failed to record last_reminder_sent_at:`, markErr.message);
    } else {
      sent++;
    }
  });

  return { checked: payments?.length ?? 0, sent, skipped, failed, markFailed };
}
