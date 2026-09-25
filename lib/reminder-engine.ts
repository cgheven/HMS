import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInZone } from "@/lib/pkt-time";
import { TEMPLATES, reminderFullParams, reminderFullV2Params, reminderPartialParams } from "@/lib/whatsapp-templates";
import { billLinkForPayment } from "@/lib/bill-link";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { sendPaymentReminderEmail } from "@/lib/email";
import { tenantDueDay, shouldRemindToday } from "@/lib/payment-calc";
import { processInBatches } from "@/lib/batch";
import { getCountryConfig, isSupportedCountry, isKnownCountry } from "@/lib/country-config";
import type { PaymentMethodAccount } from "@/types";

// Format an amount in the hostel country's currency (£ for GB, Rs. for PK, …) and
// a "YYYY-MM" as a human month — for the email reminder, whose recipient is a
// non-PK tenant. WhatsApp reminders keep their own approved-template formatting.
function formatMoneyFor(country: string | null | undefined, amount: number): string {
  const cfg = getCountryConfig(country);
  try {
    return new Intl.NumberFormat(cfg.locale, { style: "currency", currency: cfg.currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${cfg.currencySymbol} ${Math.round(amount).toLocaleString()}`;
  }
}
function monthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  if (!y || !m) return yyyyMM;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * hms_payment_reminder_full_v2 was approved by Meta on 2026-08-08 (verified
 * against the Graph API: status APPROVED, params 1-8), so full reminders now
 * carry a link to the itemised bill.
 *
 * A single switch rather than a per-hostel setting: the template is either
 * approved for the whole WhatsApp Business account or it is not. If a bill link
 * cannot be minted for a payment the code falls back to v1 on its own, so this
 * can only ever add the link, never break a send.
 */
const BILL_LINK_ENABLED = true;

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
  tenant: { full_name: string; phone: string | null; email: string | null; security_deposit: number | null; check_in: string; is_active: boolean; is_waiting: boolean } | null;
  hostel: { name: string; payment_methods: PaymentMethodAccount[]; reminder_template: string | null; whatsapp_enabled: boolean; country: string; billing_anchor_day: number | null } | null;
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
  const { data: payments, error } = await admin
    .from("hms_payments")
    .select(
      "id, tenant_id, amount, amount_paid, status, late_fee, for_month, ac_charge, ac_units_consumed, ac_maintenance_charge, registration_fee_charge, last_reminder_sent_at, " +
      "tenant:hms_tenants(full_name, phone, email, security_deposit, check_in, is_active, is_waiting), " +
      "hostel:hms_hostels(name, payment_methods, reminder_template, whatsapp_enabled, country, billing_anchor_day)"
    )
    .eq("hostel_id", hostelId)
    .eq("for_month", forMonth)
    .in("status", ["pending", "overdue", "partially_paid"])
    .returns<ReminderPaymentRow[]>();

  if (error) throw new Error(error.message);

  // "Today" and the tenant's due-day cadence are anchored to the HOSTEL's own
  // timezone, not a fixed PKT offset — a London due-day must roll over at
  // London midnight (with DST), not Karachi's. Single-hostel pass, so every row
  // shares this zone; falls open to Karachi when there are no rows.
  const tz = getCountryConfig(payments?.[0]?.hostel?.country).timezone;
  const today = todayInZone(tz);
  const dayOfMonth = Number(today.slice(8, 10));

  const due: ReminderPaymentRow[] = [];
  let skipped = 0;

  for (const p of payments ?? []) {
    // Channel per country: WhatsApp where the country has it AND Super Admin
    // granted it (Pakistan today — unchanged); email for any other REAL country
    // (its only channel — currency now formats for any known country via the
    // config keystone). Only a null/garbage country is skipped entirely.
    // A WhatsApp-country hostel without the grant is skipped exactly as before —
    // email is NOT a backfill for ungranted PK.
    const whatsappCountry = isSupportedCountry(p.hostel?.country) && getCountryConfig(p.hostel?.country).whatsapp;
    const emailCountry = isKnownCountry(p.hostel?.country) && !whatsappCountry;
    if (whatsappCountry) {
      if (!p.hostel?.whatsapp_enabled) { skipped++; continue; }
    } else if (!emailCountry) {
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
    if (scheduleGate && (!p.tenant.check_in || !shouldRemindToday(tenantDueDay(p.tenant.check_in, p.for_month, p.hostel?.billing_anchor_day), dayOfMonth))) {
      skipped++;
      continue;
    }

    // Already reminded today (cron retry, or a manual click after the cron
    // already fired, or vice versa) — never double-send within the same day.
    if (p.last_reminder_sent_at && todayInZone(tz, new Date(p.last_reminder_sent_at)) === today) {
      skipped++;
      continue;
    }

    // Recipient must exist on the channel this hostel uses: a phone for the
    // WhatsApp path, an email for the non-PK email path.
    if (whatsappCountry) {
      const digits = (p.tenant?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
      if (!digits) { skipped++; continue; }
    } else {
      if (!p.tenant?.email?.trim()) { skipped++; continue; }
    }

    due.push(p);
  }

  let sent = 0;
  let failed = 0;
  let markFailed = 0;

  await processInBatches(due, SEND_CONCURRENCY, async (p) => {
    const whatsappCountry = isSupportedCountry(p.hostel?.country) && getCountryConfig(p.hostel?.country).whatsapp;
    // Remaining balance, not the full bill — a partially_paid row already has
    // real money against it, and reminding for the original total would ask
    // the tenant to pay something they've already handed over.
    const total = Math.max(0, Number(p.amount) + Number(p.late_fee ?? 0) - Number(p.amount_paid ?? 0));
    const alreadyPaid = Number(p.amount_paid ?? 0);
    const isPartial = p.status === "partially_paid" && alreadyPaid > 0;

    // v2 carries a link to the itemised bill. The bill link is channel-agnostic —
    // the same public token URL rides the WhatsApp template or the email.
    // Only the FULL reminder has a v2; a partially-paid tenant keeps v1 (no link).
    const billUrl = BILL_LINK_ENABLED && !isPartial
      ? await billLinkForPayment(p.id, hostelId)
      : null;

    let ok = false;
    let errMsg = "";

    if (whatsappCountry) {
      // Pakistan path — unchanged. Which template depends on what the tenant has
      // actually done: a partial payer told "Rs 13,000 still pending" with no
      // mention of what they already sent replies "I already paid". Both are
      // approved Meta templates (free-form outside the 24h window is rejected 131047).
      const digits = (p.tenant?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
      const useV2 = !!billUrl;
      const tpl = isPartial
        ? TEMPLATES.reminderPartial
        : useV2 ? TEMPLATES.reminderFullV2 : TEMPLATES.reminderFull;

      const params = isPartial
        ? reminderPartialParams({
            tenantName: p.tenant?.full_name,
            amountDue: total,
            amountPaid: alreadyPaid,
            forMonth: p.for_month,
            hostelName: p.hostel?.name,
            accounts: p.hostel?.payment_methods,
          })
        : useV2
        ? reminderFullV2Params({
            tenantName: p.tenant?.full_name,
            amountDue: total,
            forMonth: p.for_month,
            hostelName: p.hostel?.name,
            accounts: p.hostel?.payment_methods,
            billUrl: billUrl!,
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
      ok = result.ok;
      errMsg = result.error ?? "";
    } else {
      // Non-PK path — email (the tenant's only channel). Amount in the hostel
      // country's currency; the bill link and pay-to accounts carry over.
      try {
        await sendPaymentReminderEmail({
          to: p.tenant!.email!.trim(),
          name: p.tenant?.full_name ?? null,
          hostelName: p.hostel?.name ?? null,
          amountLabel: formatMoneyFor(p.hostel?.country, total),
          periodLabel: monthLabel(p.for_month),
          billUrl,
          accounts: p.hostel?.payment_methods,
        });
        ok = true;
      } catch (e) {
        errMsg = e instanceof Error ? e.message : "email send failed";
      }
    }

    if (!ok) {
      failed++;
      console.error(`[reminder-engine] reminder send failed for "${p.tenant?.full_name ?? "unknown"}" (payment ${p.id}):`, errMsg);
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
