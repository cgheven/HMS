import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { yearMonthInZone } from "@/lib/pkt-time";
import { ensureMonthlyPaymentRows } from "@/lib/monthly-payment-sync";
import { settleReferralRewards } from "@/lib/referral-rewards";
import { runReminderPass, type ReminderSummary } from "@/lib/reminder-engine";
import { getCountryConfig, isSupportedCountry } from "@/lib/country-config";

// Vercel default (10s Hobby / 60s Pro) isn't enough once more branches are
// granted and a day's due-tenant count grows — request the platform's max;
// harmless if the plan caps it lower than this.
export const maxDuration = 300;

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as the
// other cron routes. Auto-sends a WhatsApp reminder — via the Meta WhatsApp
// Business API — to any tenant still pending/overdue/partially
// paid for the current month, on THEIR OWN due day (the day-of-month they
// checked in) — not a single fixed day for the whole hostel, since tenants in
// the same branch can each have joined on a different date. If still unpaid
// past that day, it repeats every 3 days (due day, +3, +6, ...) instead of
// waiting a full month for the next anniversary. A tenant who has checked out
// (is_active = false) is never reminded, even if a balance is still
// outstanding. This is a curated feature, not self-service: none of this runs
// for a branch unless Super Admin has explicitly granted it
// (hms_hostels.whatsapp_enabled — the same single WhatsApp gate that also
// covers announcement broadcasts, pinned against owner self-grant by a DB
// trigger, migration 110). The actual scan/send logic lives in
// lib/reminder-engine.ts, shared with the owner-facing manual "Send Reminders
// Now" button (sendBulkRemindersAction).

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: grantedHostels } = await admin
    .from("hms_hostels")
    .select("id, whatsapp_enabled, referral_enabled, country")
    // Candidates: WhatsApp-granted (PK), referral-enabled, or any non-PK hostel
    // (whose reminder channel is email — PK is the only WhatsApp country today).
    .or("whatsapp_enabled.eq.true,referral_enabled.eq.true,country.neq.PK");

  // The billing month is resolved PER HOSTEL in its own timezone: at a month
  // boundary Karachi (UTC+5) rolls into the new month hours before London, so a
  // single global forMonth would bill/remind a UK branch for the wrong month for
  // that window. Falls open to Karachi for an unknown country (byte-identical PK).
  const monthOf = (country: string | null): string => {
    const { year, month } = yearMonthInZone(getCountryConfig(country).timezone);
    return `${year}-${String(month).padStart(2, "0")}`;
  };
  const countryById = new Map((grantedHostels ?? []).map((h) => [h.id, h.country as string | null]));

  // Which hostels actually get a reminder pass this run: a WhatsApp-country hostel
  // needs the Super-Admin grant (unchanged); a non-WhatsApp country (non-PK) is
  // reminded by email, no grant concept. The pass itself picks the per-tenant
  // channel; this only decides which hostels to scan.
  const hostelIds = (grantedHostels ?? [])
    .filter((h) => {
      const supported = isSupportedCountry(h.country);
      const whatsappCountry = supported && getCountryConfig(h.country).whatsapp;
      // WhatsApp country → needs the grant; registered non-WhatsApp country →
      // email (no grant); unregistered country → not served, skip.
      return whatsappCountry ? h.whatsapp_enabled : supported;
    })
    .map((h) => h.id);

  // Reward reconciliation runs over the REFERRAL-enabled set, which is not the
  // WhatsApp-enabled set. Hanging it off hostelIds would strand rewards on any
  // branch that runs referrals without WhatsApp: nothing else re-prices a bill
  // once a reward is granted after the bill was written, so the discount would
  // simply never appear. Failures are swallowed inside settleReferralRewards —
  // reminders are the job here, rewards are the passenger.
  const referralHostelIds = (grantedHostels ?? []).filter((h) => h.referral_enabled).map((h) => h.id);
  await Promise.all(referralHostelIds.map((id) => settleReferralRewards(admin, id, monthOf(countryById.get(id) ?? null))));

  // A tenant's rent row for this month only exists once someone opens Monthly
  // View for it — guarantee it exists for every granted branch (only those;
  // every other branch is left exactly as before) so the scan below never
  // silently finds nothing just because no one has visited the Payments page
  // yet this month.
  await Promise.all(hostelIds.map((id) => ensureMonthlyPaymentRows(admin, id, monthOf(countryById.get(id) ?? null))));

  // Isolated per hostel — one branch's DB error shouldn't block every other
  // granted branch's reminders from going out.
  const results = await Promise.all(
    hostelIds.map(async (id): Promise<ReminderSummary & { error?: string }> => {
      try {
        return await runReminderPass(admin, id, monthOf(countryById.get(id) ?? null), true);
      } catch (err) {
        console.error(`[payment-reminders] hostel ${id} failed:`, err instanceof Error ? err.message : err);
        return { checked: 0, sent: 0, skipped: 0, failed: 0, markFailed: 0, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const total = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.checked,
      sent: acc.sent + r.sent,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
      markFailed: acc.markFailed + r.markFailed,
    }),
    { checked: 0, sent: 0, skipped: 0, failed: 0, markFailed: 0 }
  );

  const hostelErrors = results.filter((r) => r.error).map((r) => r.error);

  return NextResponse.json({ ...total, hostelsProcessed: hostelIds.length, ...(hostelErrors.length > 0 ? { hostelErrors } : {}) });
}
