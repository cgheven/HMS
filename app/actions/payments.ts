"use server";

/**
 * Server Actions for payment mutations.
 *
 * All payment writes go through here — never directly from the browser Supabase
 * client — so the server always controls:
 *   1. Which hostel belongs to the authenticated user (no client-supplied hostel_id trusted)
 *   2. base_rent comes from the DB (hms_tenants.monthly_rent), not from the client
 *   3. Input validation happens before any DB write
 *   4. A PostgreSQL trigger (migration 022) recalculates amount server-side as a
 *      final safety net even if these actions are somehow bypassed.
 *
 * Fixes: F-001 (billing integrity), F-003 (overflow), F-004 (validation), F-006 (dead code)
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { sendPaymentConfirmation } from "@/lib/whatsapp-payment-confirmation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/data";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getManagerContext } from "@/lib/manager-auth";
import { calcFoodAddonCharge } from "@/lib/food-addon";
import { ensureMonthlyPaymentRows } from "@/lib/monthly-payment-sync";
import {
  VALID_TIERS, calcBaseRentServer, dailySnapshot, computeDepositCharge,
  computeRegistrationFeeCharge, computeAcMaintenanceCharge, computeReferralDiscount,
} from "@/lib/payment-calc";
import { runReminderPass, type ReminderSummary } from "@/lib/reminder-engine";
import { logActivity } from "@/lib/audit";
import { computeACSegmentBilling, deriveOpeningReading } from "@/lib/ac-billing";
import type { Payment, PaymentMethod, PaymentStatus, PackageTier } from "@/types";

// ---------------------------------------------------------------------------
// Constants / validation helpers
// ---------------------------------------------------------------------------

const VALID_METHODS = new Set<string>(["cash", "bank_transfer", "jazzcash", "easypaisa", "sadapay", "other"]);
const VALID_STATUSES = new Set<string>(["paid", "pending", "overdue", "waived"]);
const MAX_AC_UNITS = 10_000;
const MAX_LATE_FEE = 9_999_999.99;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidTier(v: unknown, field = "payment_package_tier"): asserts v is PackageTier {
  if (typeof v !== "string" || !VALID_TIERS.has(v)) {
    throw new Error(`Invalid ${field}: "${v}". Must be one of: space_only, space_food, space_3meals, space_food_ac, space_meals_cooler`);
  }
}

function assertNonNegativeInteger(v: number, field: string, max = MAX_AC_UNITS) {
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new Error(`${field} must be a non-negative integer <= ${max}, got ${v}`);
  }
}

function assertNonNegativeFinite(v: number, field: string, max = MAX_LATE_FEE) {
  if (!Number.isFinite(v) || v < 0 || v > max) {
    throw new Error(`${field} must be a non-negative number <= ${max}, got ${v}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helper: compute previous month string (e.g. "2026-06" → "2026-05")
// ---------------------------------------------------------------------------

// "2026-07" -> "2026-08-01". Exclusive upper bound for "moved in during or before
// this month", without needing to know how many days the month has.
function firstOfNextMonth(forMonth: string): string {
  const [y, m] = forMonth.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function getPrevMonth(forMonth: string): string {
  const [y, m] = forMonth.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Internal helper: resolve the authenticated user's hostel_id from the DB.
// Never trusts a client-supplied hostel_id.
// ---------------------------------------------------------------------------

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

// Read-scope resolution for the two payment READ actions (syncMonthAction and
// loadHistoryAction) that the manager portal reuses verbatim. Managers have no
// RLS grant and getAuthContext() gives them no hostelId, so they get their own
// branch — only with collect_payments, and only ever scoped to their own
// server-resolved active branch. Every non-manager falls through to the
// untouched owner/partner path. getManagerContext() is React-cached and returns
// null immediately for anyone without an hms_managers row.
async function resolvePaymentsReadScope(): Promise<{ hostelId: string; isManager: boolean }> {
  const mgr = await getManagerContext();
  if (mgr) {
    if (!mgr.permissions.has("collect_payments")) throw new Error("Access denied");
    if (!mgr.activeHostel) throw new Error("Unauthorized: no active hostel");
    return { hostelId: mgr.activeHostel.id, isManager: true };
  }
  await requireOwnerOrPartnerTier("read_only");
  return { hostelId: await resolveHostelId(), isManager: false };
}

// ---------------------------------------------------------------------------
// Internal helper: fetch tenant data from DB (base rent, billing type, tier)
// ---------------------------------------------------------------------------

async function fetchTenantData(tenantId: string, hostelId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hms_tenants")
    .select("id, monthly_rent, daily_rate, billing_type, package_tier, check_in, check_out, security_deposit, deposit_collected_amount, registration_fee, room_id, food_breakfast, food_lunch, food_dinner, ac_maintenance")
    .eq("id", tenantId)
    .eq("hostel_id", hostelId) // ensures the tenant belongs to the owner's hostel
    .single();

  // "Not found" and "the query itself failed" are opposite meanings, and
  // reporting the second as the first is how a missing column reads to an owner
  // as a tenant who has vanished. PGRST116 is the only code that genuinely means
  // no row matched; anything else is the database refusing to answer.
  if (error && error.code !== "PGRST116") {
    throw new Error(`Could not read the tenant record: ${error.message}`);
  }
  if (!data) throw new Error("Tenant not found or access denied");
  return data as {
    id: string;
    monthly_rent: number;
    daily_rate: number;
    billing_type: "monthly" | "daily";
    package_tier: PackageTier;
    check_in: string;
    check_out: string | null;
    security_deposit: number | null;
    deposit_collected_amount: number | null;
    registration_fee: number | null;
    room_id: string | null;
    food_breakfast: boolean;
    food_lunch: boolean;
    food_dinner: boolean;
    ac_maintenance: number | null;
  };
}

// ---------------------------------------------------------------------------
// syncMonthAction
// Called by the client instead of a direct Supabase upsert.
// Re-fetches all canonical rates from the DB before writing.
// ---------------------------------------------------------------------------

export async function syncMonthAction(
  month: string
): Promise<{ payments?: Payment[]; error?: string }> {
  try {
    // read_only, not just standard+: this only fills in missing pending rows
    // and refreshes pending amounts (paid/waived rows are never touched), so
    // it's safe for any partner tier — and it has to run for all of them,
    // since the Payments page is otherwise empty until someone with write
    // access happens to load it first for this branch/month.
    // Managers reuse this action through the same PaymentsClient; the helper
    // runs requireOwnerOrPartnerTier("read_only") + resolveHostelId() unchanged
    // for every non-manager caller.
    const { hostelId } = await resolvePaymentsReadScope();
    if (!MONTH_RE.test(month)) throw new Error(`Invalid month format: "${month}"`);

    // Admin client: partners have no write RLS grant on hms_payments (the
    // hybrid architecture keeps their writes on the service role instead of
    // opening new RLS policies), so this has to run as admin for everyone,
    // not just when the caller happens to be a partner.
    const supabase = createAdminClient();

    // Same row-creation/refresh logic the payment-reminders cron uses to
    // guarantee this month's rows exist before it scans for who to remind —
    // one shared implementation so a page visit and the cron can never compute
    // a tenant's rent differently.
    await ensureMonthlyPaymentRows(supabase, hostelId, month);

    const { data: payments, error: fetchErr } = await supabase
      .from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .order("created_at", { ascending: false });

    if (fetchErr) throw new Error(fetchErr.message);

    return { payments: (payments ?? []) as Payment[] };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// sendBulkRemindersAction
// Owner-facing "Send Reminders Now" button — an on-demand nudge, not a
// replacement for the scheduled cron. Reuses the exact same scan/send/mark
// logic as app/api/cron/payment-reminders/route.ts (lib/reminder-engine.ts),
// just with scheduleGate=false so it fires for every currently unpaid active
// tenant today instead of only those whose personal due-day cadence lands on
// today. The "already reminded today" guard inside runReminderPass still
// applies here, so this can't be mashed to spam a tenant more than once a day.
// ---------------------------------------------------------------------------

export async function sendBulkRemindersAction(
  month: string
): Promise<{ data?: ReminderSummary; error?: string }> {
  try {
    // Same tier as recording a payment — this sends a real WhatsApp message to
    // every unpaid tenant, so read-only partners stay excluded.
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    if (!MONTH_RE.test(month)) throw new Error(`Invalid month format: "${month}"`);

    const admin = createAdminClient();

    // Gated on the same Super-Admin-curated flag the cron uses — the manual
    // button is the same feature, not a way around the opt-in requirement.
    const { data: hostelRow } = await admin
      .from("hms_hostels")
      .select("whatsapp_enabled")
      .eq("id", hostelId)
      .single();

    if (!hostelRow?.whatsapp_enabled) {
      throw new Error("WhatsApp isn't enabled for this branch yet. Contact support to have this feature turned on.");
    }

    await ensureMonthlyPaymentRows(admin, hostelId, month);
    const summary = await runReminderPass(admin, hostelId, month, false);
    return { data: summary };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// sendDueTodayRemindersAction
// Same as sendBulkRemindersAction, except scheduleGate=true — only tenants
// whose own due-day cadence lands on today (the "Due Today" tab's list, not
// every unpaid tenant regardless of due date). Lets an owner target exactly
// who the automated cron would message today, on demand.
// ---------------------------------------------------------------------------

export async function sendDueTodayRemindersAction(
  month: string
): Promise<{ data?: ReminderSummary; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    if (!MONTH_RE.test(month)) throw new Error(`Invalid month format: "${month}"`);

    const admin = createAdminClient();

    const { data: hostelRow } = await admin
      .from("hms_hostels")
      .select("whatsapp_enabled")
      .eq("id", hostelId)
      .single();

    if (!hostelRow?.whatsapp_enabled) {
      throw new Error("WhatsApp isn't enabled for this branch yet. Contact support to have this feature turned on.");
    }

    await ensureMonthlyPaymentRows(admin, hostelId, month);
    const summary = await runReminderPass(admin, hostelId, month, true);
    return { data: summary };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// markPaymentPaidAction
// Validates all inputs and re-fetches canonical rates before writing.
// ---------------------------------------------------------------------------

export interface MarkPaidInput {
  paymentId: string;
  method: string;
  date: string;
  lateFee: string;
  notes: string;
  receiptNumber: string;
  acUnitsConsumed: string; // string from form input
  /** Amount actually received this time (string from form input). Omit/equal to
      the full due amount for a normal full payment; less than the due amount
      records a partial payment (status becomes "partially_paid" until the
      running total collected reaches the full amount). */
  amountReceived?: string;
}

export async function markPaymentPaidAction(
  input: MarkPaidInput
): Promise<{ payment?: Payment; installmentId?: string; error?: string }> {
  try {
    // Recording collection is day-to-day work. Partners reach this through
    // recordPaymentAsPartner instead, but the guard belongs here regardless —
    // this action is a directly-callable RPC endpoint like any other.
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    // --- Validate payment method ---
    if (!VALID_METHODS.has(input.method)) {
      throw new Error(`Invalid payment method: "${input.method}"`);
    }

    // --- Validate payment date (basic format check) ---
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new Error(`Invalid payment date: "${input.date}"`);
    }

    // --- Validate late_fee (F-005) ---
    const lateFee = parseFloat(input.lateFee);
    if (!Number.isFinite(lateFee) || lateFee < 0) {
      throw new Error("Late fee must be a non-negative number");
    }
    assertNonNegativeFinite(lateFee, "late_fee");

    // --- Fetch the existing payment row (ownership verified via hostel_id) ---
    const { data: existingPayment, error: fetchErr } = await supabase
      .from("hms_payments")
      .select("id, tenant_id, for_month, amount, amount_paid, food_charge, ac_charge, payment_package_tier, hostel_id, status, referral_discount, referral_percent")
      .eq("id", input.paymentId)
      .eq("hostel_id", hostelId) // RLS + explicit owner check
      .single();

    if (fetchErr || !existingPayment) {
      throw new Error("Payment not found or access denied");
    }

    const tier = existingPayment.payment_package_tier ?? undefined;

    // --- Validate tier (F-002) ---
    if (tier && !VALID_TIERS.has(tier)) {
      throw new Error(`Invalid payment_package_tier on record: "${tier}"`);
    }

    const isAcTier = (tier === "space_food_ac");

    // --- Validate AC units (F-003, F-004) ---
    let acUnitsConsumed: number | null = null;
    let newAcCharge = Number(existingPayment.ac_charge ?? 0);

    if (isAcTier) {
      // ac_units_consumed is numeric(10,2) — a room's units rarely split into
      // whole numbers per tenant, so allow up to 2 decimal places (F-004).
      const parsed = parseFloat(input.acUnitsConsumed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AC_UNITS) {
        throw new Error(
          `AC units consumed must be a non-negative number <= ${MAX_AC_UNITS}, got "${input.acUnitsConsumed}"`
        );
      }
      acUnitsConsumed = Math.round(parsed * 100) / 100;

      // Re-fetch the canonical AC rate from DB (never trust the client-supplied rate)
      const { data: configData } = await supabase
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle();

      const acUnitRate = Number(configData?.ac_per_unit_rate ?? 0);
      newAcCharge = Math.round(acUnitsConsumed * acUnitRate);

      // Guard against overflow (F-003)
      assertNonNegativeFinite(newAcCharge, "computed ac_charge", 9_999_999.99);
    }

    // --- Re-derive base_rent and total from DB-canonical values (F-001) ---
    // Fanned out — independent reads, no need to serialize.
    const [tenantData, { data: foodConfigData }, { data: rewardRow }] = await Promise.all([
      fetchTenantData(existingPayment.tenant_id, hostelId),
      supabase
        .from("hms_package_configs")
        .select("food_monthly_rate, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, ac_maintenance_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle(),
      // The ledger, not the stored column. On an uncollected bill the reward may
      // have been granted after the row was written, in which case the column is
      // still 0 and only hms_referral_rewards knows the truth. Reading the column
      // here would mis-price exactly the window the reconciler exists to close.
      //
      // MUST be the admin client. hms_referral_rewards has RLS on with zero
      // policies and no grant to `authenticated`, so the session-scoped client
      // returns an empty result rather than an error — the discount silently
      // reads as 0, the tenant is billed the gross amount, and paying in full
      // records them as partially_paid with a phantom balance.
      createAdminClient()
        .from("hms_referral_rewards")
        .select("percent")
        .eq("tenant_id", existingPayment.tenant_id)
        .eq("for_month", existingPayment.for_month)
        .in("status", ["scheduled", "applied"])
        .maybeSingle(),
    ]);
    const forMonth = existingPayment.for_month;

    let roomHasAc = false;
    if (tenantData.room_id) {
      const { data: roomData } = await supabase
        .from("hms_rooms")
        .select("has_ac")
        .eq("id", tenantData.room_id)
        .maybeSingle();
      roomHasAc = !!roomData?.has_ac;
    }

    let baseRent: number;
    if (tenantData.billing_type === "monthly") {
      baseRent = Number(tenantData.monthly_rent);
    } else {
      // daily: re-compute pro-rated base rent
      baseRent = calcBaseRentServer(tenantData, forMonth);
    }

    // Re-derive food_charge from the canonical package config rate (never trust
    // the stored row value, which could have been corrupted via direct API PATCH).
    // The add-on applies independently of package tier.
    const tierFoodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler")
      ? Number(foodConfigData?.food_monthly_rate ?? 0)
      : 0;
    const addonFoodCharge = foodConfigData ? calcFoodAddonCharge(tenantData, foodConfigData) : 0;
    const foodCharge = tierFoodCharge + addonFoodCharge;
    const depositCharge = computeDepositCharge(tenantData, forMonth);
    const registrationFeeCharge = computeRegistrationFeeCharge(tenantData, forMonth);
    const acMaintenanceCharge = computeAcMaintenanceCharge(roomHasAc, foodConfigData?.ac_maintenance_rate, tenantData.ac_maintenance);

    const newTotalAmount = baseRent + foodCharge + newAcCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge;

    // Final sanity: total must be non-negative
    if (newTotalAmount < 0) {
      throw new Error(`Computed total amount is negative: ${newTotalAmount}`);
    }

    // A COLLECTED BILL KEEPS THE PERCENT IT WAS BILLED AT. The trigger freezes a
    // paid/partially_paid row's discount, so recomputing from the live ledger
    // here would produce a total the database refuses to write — the bill would
    // read as short-paid forever and could never be settled. On an uncollected
    // bill the ledger is authoritative, for the reason given at the query above.
    const wasCollected =
      existingPayment.status === "paid" || existingPayment.status === "partially_paid";
    const referralPercent = wasCollected
      ? Number(existingPayment.referral_percent ?? 0)
      : Number(rewardRow?.percent ?? 0);
    const referralDiscount = computeReferralDiscount(baseRent, referralPercent);

    // --- Partial payment handling ---
    // amount_paid accumulates across however many installments it takes to settle
    // this month's bill. Omitting amountReceived (or entering the full remaining
    // balance) behaves exactly like before — a single full payment.
    const previousAmountPaid = Number(existingPayment.amount_paid ?? 0);
    // newTotalAmount is GROSS; what the tenant actually owes is net of the
    // discount. Without this subtraction every discounted bill would be recorded
    // as short-paid and sit at partially_paid forever.
    const fullAmountDue = newTotalAmount - referralDiscount + lateFee;
    const remainingBefore = Math.max(0, fullAmountDue - previousAmountPaid);

    let amountReceivedNow: number;
    if (input.amountReceived !== undefined && input.amountReceived.trim() !== "") {
      amountReceivedNow = parseFloat(input.amountReceived);
      if (!Number.isFinite(amountReceivedNow) || amountReceivedNow <= 0) {
        throw new Error("Amount received must be a positive number");
      }
      assertNonNegativeFinite(amountReceivedNow, "amount_received", 9_999_999.99);
      if (amountReceivedNow > remainingBefore + 0.01) {
        // A tenant handing over the pre-discount figure is the single most likely
        // way to trip this, and the generic message never mentions the referral —
        // leaving the person at the desk with a rejected payment and no
        // explanation. Name the discount and say what to do with the difference.
        if (referralDiscount > 0 && amountReceivedNow <= remainingBefore + referralDiscount + 0.01) {
          throw new Error(
            `A Rs. ${referralDiscount.toLocaleString()} referral discount was applied to this bill. Collect Rs. ${remainingBefore.toLocaleString()} and return Rs. ${(amountReceivedNow - remainingBefore).toLocaleString()} to the tenant.`
          );
        }
        throw new Error(
          `Amount received (Rs. ${amountReceivedNow.toLocaleString()}) exceeds the remaining balance (Rs. ${remainingBefore.toLocaleString()}). Enter the exact remaining amount instead.`
        );
      }
    } else {
      amountReceivedNow = remainingBefore;
    }

    const newAmountPaid = previousAmountPaid + amountReceivedNow;
    const isFullyPaid = newAmountPaid >= fullAmountDue - 0.01;

    // --- Build update payload ---
    const updatePayload: Record<string, unknown> = {
      status: (isFullyPaid ? "paid" : "partially_paid") as PaymentStatus,
      payment_method: input.method as PaymentMethod,
      payment_date: input.date,
      late_fee: lateFee,
      notes: input.notes || null,
      receipt_number: input.receiptNumber,
      // Always write the recalculated total (trigger will re-verify).
      // newTotalAmount is GROSS, and referral_discount: 0 is what declares that —
      // the trigger re-derives the discount and stores amount net of it.
      amount: newTotalAmount,
      referral_discount: 0,
      amount_paid: newAmountPaid,
      // Write back canonical food_charge/security_deposit_charge so any
      // previously corrupted row is corrected
      food_charge: foodCharge,
      security_deposit_charge: depositCharge,
      registration_fee_charge: registrationFeeCharge,
      ac_maintenance_charge: acMaintenanceCharge,
      // Freeze the day count as of settlement, so the receipt keeps saying
      // "11 days x Rs 500" even if the tenant's dates move afterwards.
      ...dailySnapshot(tenantData, forMonth),
    };

    if (isAcTier) {
      updatePayload.ac_units_consumed = acUnitsConsumed;
      updatePayload.ac_charge = newAcCharge;
    }

    // Optimistic concurrency on the discount. There are several round trips
    // between reading the row and writing it, and Phase 2 adds a BACKGROUND
    // writer — the reconciler runs on every payments-page load and can attach or
    // move a reward mid-dialog. Settling against a total that no longer exists
    // would leave the tenant recorded as short-paid or overpaid, so refuse and
    // let the operator re-read instead.
    const { data, error } = await supabase
      .from("hms_payments")
      .update(updatePayload)
      .eq("id", input.paymentId)
      .eq("hostel_id", hostelId) // double-check ownership
      .eq("referral_percent", existingPayment.referral_percent ?? 0)
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(
        "This bill was re-priced while you were recording the payment. Reopen the dialog and try again."
      );
    }

    // Record this specific transaction as its own immutable snapshot — amount_paid
    // on hms_payments is a running cumulative total, so without this, a second
    // installment would erase all trace of the first one (its own date/method/
    // amount, and any receipt generated for it would start showing the new
    // cumulative state instead of what was true when it was generated).
    const { data: installmentRow, error: installmentErr } = await supabase.from("hms_payment_installments").insert({
      hostel_id: hostelId,
      tenant_id: existingPayment.tenant_id,
      payment_id: input.paymentId,
      for_month: existingPayment.for_month,
      amount: amountReceivedNow,
      amount_before: previousAmountPaid,
      amount_after: newAmountPaid,
      total_due: fullAmountDue,
      late_fee: lateFee,
      payment_method: input.method,
      payment_date: input.date,
      notes: input.notes || null,
      receipt_number: input.receiptNumber,
    }).select("id").single();
    if (installmentErr) {
      // Non-fatal — the payment itself is already recorded correctly above.
      // Losing the per-installment snapshot only affects historical granularity.
      console.error("[markPaymentPaidAction] Failed to record payment installment:", installmentErr.message);
    }

    const ctx = await getAuthContext();
    if (ctx?.user) {
      await logActivity({
        hostel_id: hostelId,
        actor_id: ctx.user.id,
        action: "payment.paid",
        entity: "payment",
        entity_id: input.paymentId,
        meta: {
          tenant_name: (data as { tenant?: { full_name?: string } }).tenant?.full_name ?? null,
          amount: amountReceivedNow,
          for_month: existingPayment.for_month,
          method: input.method,
        },
      });
    }

    // Fire-and-forget: the collection is already committed, and a Meta outage
    // must never fail a payment that was actually received. Sends nothing
    // unless the branch has WhatsApp granted (off for every branch today).
    void sendPaymentConfirmation(input.paymentId);

    // The installment id lets the caller mint a receipt for THIS transaction
    // rather than the whole cumulative bill.
    return { payment: data as Payment, installmentId: installmentRow?.id as string | undefined };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// markPaymentWaivedAction
// ---------------------------------------------------------------------------

export async function markPaymentWaivedAction(
  paymentId: string
): Promise<{ error?: string }> {
  try {
    // Waiving is forgiving money owed, so it sits with the full-tier financial
    // operations. resolveHostelId() below is scope resolution, not authorization
    // — until now these actions had no authorization check at all and leaned
    // entirely on hms_payments having no partner write policy. That is a
    // coincidence of the current policy set, not a guard.
    await requireOwnerOrPartnerTier("full");
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    // .select() so an RLS-filtered zero-row update is distinguishable from a
    // real one — a bare update returns error === null when RLS blocks it.
    const { data, error } = await supabase
      .from("hms_payments")
      .update({ status: "waived" as PaymentStatus })
      .eq("id", paymentId)
      .eq("hostel_id", hostelId)
      .select("id");

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("Payment not found, or your access level does not allow this change.");
    return {};
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// markPaymentOverdueAction
// ---------------------------------------------------------------------------

export async function markPaymentOverdueAction(
  paymentId: string
): Promise<{ error?: string }> {
  try {
    // Flagging a bill overdue is day-to-day collections work.
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("hms_payments")
      .update({ status: "overdue" as PaymentStatus })
      .eq("id", paymentId)
      .eq("hostel_id", hostelId)
      .select("id");

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("Payment not found, or your access level does not allow this change.");
    return {};
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// loadHistoryAction
// ---------------------------------------------------------------------------

export async function loadHistoryAction(forMonth: string): Promise<{ payments?: Payment[]; error?: string }> {
  try {
    // Managers have no RLS grant at all, so their read must go through the
    // service role. Owners/partners keep the RLS client exactly as before.
    const { hostelId, isManager } = await resolvePaymentsReadScope();
    const supabase = isManager ? createAdminClient() : await createClient();

    const { data, error } = await supabase
      .from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return { payments: (data ?? []) as Payment[] };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// applyRoomACUnitsAction
// Splits total AC units across all eligible AC-tier tenants in a room and
// updates their payment records for the given month.
// ---------------------------------------------------------------------------

// All active tenants in an AC room share the electricity bill

export async function applyRoomACUnitsAction(
  roomId: string,
  forMonth: string,
  meterReading: number,
  openingReading?: number
): Promise<{
  success: boolean;
  error?: string;
  eligibleCount?: number;
  perUnitRate?: number;
  perTenantUnits?: number;
  perTenantCharge?: number;
  skippedFirstMonth?: number;
  proRatedCount?: number;
  unassignedUnits?: number;
  /** Stale AC charges wiped from tenants who left the room since the last apply. */
  clearedStaleCount?: number;
  /** Bills that were settled before this reading and are now short by the AC just
   *  applied — reopened as partially paid so the balance is visible and collectable. */
  reopenedCount?: number;
  /** Departed tenants whose stale AC charge could NOT be cleared because the
   *  bill is already settled — the operator has to refund or adjust manually. */
  lockedStale?: { name: string; units: number; charge: number }[];
  derivedUnits?: number;
  prevMonthReading?: number;
  currentReading?: number;
}> {
  try {
    // ── Auth & ownership guard ──────────────────────────────────
    // Standard tier: reading the meter and billing the month's units is routine
    // branch operations, the same class as recording a payment. read_only stays
    // out. This action writes via the admin client (bypasses RLS), so this guard
    // is the only thing standing between "any authenticated user with a
    // resolvable hostel" and a write here — no RLS backstop for this one. The
    // roomId is re-scoped to ctx.hostelId below, so a partner cannot bill a room
    // belonging to another branch.
    await requireOwnerOrPartnerTier("standard");
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
    const { hostelId } = ctx;

    // ── Input validation ──────────────────────────────────────
    if (!roomId || !UUID_RE.test(roomId)) throw new Error("Invalid room ID");
    if (!forMonth || !MONTH_RE.test(forMonth)) throw new Error("Invalid month format");
    const reading = Math.round(Number(meterReading));
    if (!Number.isFinite(reading) || reading < 0 || reading > 999_999)
      throw new Error("Meter reading must be between 0 and 999,999");
    if (openingReading !== undefined) {
      const or = Math.round(Number(openingReading));
      if (!Number.isFinite(or) || or < 0 || or > 999_999)
        throw new Error("Opening reading must be between 0 and 999,999");
    }

    // ── Scoped client for reads (RLS provides defense-in-depth) ──
    const supabase = await createClient();
    const adminDb = createAdminClient();

    // ── Verify room + fetch package config + prev month reading + tenants in parallel ──
    const prevMonthStr = getPrevMonth(forMonth);
    const [{ data: room }, { data: pkgConfig }, { data: prevRecord }, { data: allTenants, error: allTenantsErr }] = await Promise.all([
      supabase.from("hms_rooms").select("id, hostel_id, has_ac").eq("id", roomId).eq("hostel_id", hostelId).single(),
      supabase.from("hms_package_configs").select("ac_per_unit_rate, food_monthly_rate, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, ac_maintenance_rate").eq("hostel_id", hostelId).single(),
      supabase.from("hms_room_ac_readings").select("meter_reading").eq("room_id", roomId).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
      // `.lt("check_in", ...)` matters for any back-dated apply: without it the
      // eligible set is "whoever lives in this room now", so closing an earlier
      // month would split it across tenants who had not moved in yet. Applying
      // July for Room 5 billed two August arrivals Rs 3,239 each.
      supabase.from("hms_tenants")
        .select("id, check_in, package_tier, monthly_rent, daily_rate, billing_type, check_out, security_deposit, deposit_collected_amount, registration_fee, food_breakfast, food_lunch, food_dinner, joining_meter_reading, ac_maintenance")
        .eq("hostel_id", hostelId)
        .eq("room_id", roomId)
        .eq("is_active", true)
        .lt("check_in", firstOfNextMonth(forMonth)),
    ]);

    // A failed tenant query returns null, which falls through to "No active
    // tenants found in this room" below — an answer about the room, for a
    // question the database never actually answered.
    if (allTenantsErr) throw new Error(`Could not read this room's tenants: ${allTenantsErr.message}`);

    if (!room) throw new Error("Room not found or access denied");
    if (!room.has_ac) throw new Error("This room does not have AC");

    const perUnitRate = Number(pkgConfig?.ac_per_unit_rate ?? 0);
    if (perUnitRate <= 0) throw new Error("AC per-unit rate is not configured. Set it in Settings → Packages.");
    const foodRate = Number(pkgConfig?.food_monthly_rate ?? 0);
    // This function only ever runs against a room already verified has_ac = true
    // (line above), so the ROOM half of the test is settled for everyone here.
    // The AMOUNT is not: each tenant may carry their own ac_maintenance override,
    // so it is computed per tenant inside the loop below rather than hoisted.
    const acMaintenanceRate = Number(pkgConfig?.ac_maintenance_rate ?? 0);

    // ── Find all active tenants in this room ─────────────────────
    const eligible = allTenants ?? [];
    if (eligible.length === 0)
      throw new Error("No active tenants found in this room.");

    // ── Derive consumption from cumulative meter readings ─────────
    // No prev-month record and no explicit opening reading typed in? Fall back
    // to the earliest active tenant's move-in meter reading (captured once at
    // tenant creation) instead of assuming the meter started at 0 — the same
    // reading the operator would otherwise have to look up and retype here.
    const derivedOpening = deriveOpeningReading(eligible, forMonth);

    const prevReading = prevRecord?.meter_reading != null
      ? Math.round(Number(prevRecord.meter_reading))
      : (openingReading != null ? Math.round(Number(openingReading)) : (derivedOpening ?? 0));

    if (reading < prevReading)
      throw new Error(`Meter reading (${reading}) cannot be less than previous month's reading (${prevReading}). Previous month ended at ${prevReading}.`);

    const units = reading - prevReading;

    // ── Fetch join readings and checkout readings in parallel for segment billing ──
    const [{ data: joinReadingsRaw }, { data: checkoutReadingsRaw }] = await Promise.all([
      adminDb
        .from("hms_room_ac_join_readings")
        .select("tenant_id, units_at_join")
        .eq("room_id", roomId)
        .eq("for_month", forMonth)
        .eq("hostel_id", hostelId)
        .order("units_at_join", { ascending: true }),
      adminDb
        .from("hms_room_ac_checkout_readings")
        .select("meter_reading, tenant_count_at_checkout")
        .eq("room_id", roomId)
        .eq("for_month", forMonth)
        .eq("hostel_id", hostelId)
        .order("meter_reading", { ascending: true }),
    ]);

    // Shared with applyRoomACUnitsAsManager (lib/ac-billing.ts) so the owner and
    // manager tiers can never compute two different bills for the same room/month.
    const { tenantBilling, proRatedCount, unassignedUnits, departedCounted } = computeACSegmentBilling({
      eligible,
      prevReading,
      reading,
      units,
      perUnitRate,
      forMonth,
      joinReadingsRaw: (joinReadingsRaw ?? []).filter(r => eligible.some(t => t.id === r.tenant_id)),
      // Passed through unfiltered. A departure at exactly this reading has to
      // reach computeACSegmentBilling — it counts toward the divisor for the
      // month even though it opens no new segment, and dropping it here billed
      // the room's units twice over.
      checkoutReadingsRaw: checkoutReadingsRaw ?? [],
    });

    // ── Auto-create missing payment rows so Apply never requires a manual sync ──
    const { data: existingPayRows } = await adminDb
      .from("hms_payments")
      .select("tenant_id")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .in("tenant_id", eligible.map(t => t.id));

    const existingTenantIds = new Set((existingPayRows ?? []).map(r => r.tenant_id));
    const missingTenants = eligible.filter(t => !existingTenantIds.has(t.id));

    if (missingTenants.length > 0) {
      const newRows = missingTenants.map(t => {
        const tier = (t.package_tier ?? "space_only") as PackageTier;
        const billingInfo = {
          billing_type: (t as { billing_type: string }).billing_type ?? "monthly",
          monthly_rent: (t as { monthly_rent: number }).monthly_rent ?? 0,
          daily_rate: (t as { daily_rate: number }).daily_rate ?? 0,
          check_in: t.check_in,
          check_out: (t as { check_out: string | null }).check_out ?? null,
        };
        const baseRent = calcBaseRentServer(billingInfo, forMonth);
        const daySnapshot = dailySnapshot(billingInfo, forMonth);
        const tierFoodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;
        const addonFoodCharge = pkgConfig ? calcFoodAddonCharge(t, pkgConfig) : 0;
        const foodCharge = tierFoodCharge + addonFoodCharge;
        const depositCharge = computeDepositCharge(
          {
            check_in: t.check_in,
            security_deposit: (t as { security_deposit?: number | null }).security_deposit,
            deposit_collected_amount: (t as { deposit_collected_amount?: number | null }).deposit_collected_amount ?? 0,
          },
          forMonth
        );
        const registrationFeeCharge = computeRegistrationFeeCharge(
          { check_in: t.check_in, registration_fee: (t as { registration_fee?: number | null }).registration_fee },
          forMonth
        );
        const acMaintenanceCharge = computeAcMaintenanceCharge(
          true,
          acMaintenanceRate,
          (t as { ac_maintenance?: number | null }).ac_maintenance
        );
        return {
          hostel_id: hostelId,
          tenant_id: t.id,
          for_month: forMonth,
          amount: baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge,
          status: "pending" as PaymentStatus,
          payment_package_tier: tier,
          food_charge: foodCharge,
          ac_units_consumed: 0,
          ac_charge: 0,
          security_deposit_charge: depositCharge,
          registration_fee_charge: registrationFeeCharge,
          ac_maintenance_charge: acMaintenanceCharge,
          // `amount` above is GROSS. The update loop below deliberately does NOT
          // carry this marker: it is a passthrough writer that touches only the
          // AC columns, so the stored net amount must pass through untouched.
          referral_discount: 0,
          ...daySnapshot,
        };
      });
      await adminDb.from("hms_payments").insert(newRows);
    }

    // ── Update each eligible tenant's payment (admin client for writes) ──
    const updateResults = await Promise.all(
      tenantBilling.map(({ id, tenantUnits, charge }) =>
        adminDb
          .from("hms_payments")
          .update({
            ac_units_consumed: tenantUnits,
            ac_charge: charge,
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", id)
          .eq("for_month", forMonth)
          .eq("hostel_id", hostelId)
          .select("id")
      )
    );

    // ── Surface any DB error from the updates ──
    const firstError = updateResults.find(r => r.error)?.error;
    if (firstError) throw new Error(`AC billing DB error: ${firstError.message} (code: ${firstError.code})`);

    // ── A bill settled before the meter was read is now short by the AC ──
    // The recalculation trigger has just raised `amount` on these rows, but the
    // status still says paid. That combination is a state nothing downstream can
    // represent: the outstanding balance counts as neither collected (only
    // amount_paid was) nor pending (the status is paid), so Total Due stops
    // equalling Collected + Pending + AC on every screen that adds them up.
    // partially_paid is what the row already means, and it is the status the
    // "Collect Rest" button keys off.
    //
    // Only demoted, never promoted: a partially paid bill whose AC is later
    // reduced is the owner's call to close, not something to settle silently.
    const { data: touchedRows } = await adminDb
      .from("hms_payments")
      .select("id, status, amount, late_fee, amount_paid")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .in("tenant_id", tenantBilling.map(t => t.id));

    const nowUnderpaid = (touchedRows ?? []).filter(
      r => r.status === "paid" && r.amount_paid != null
        && Number(r.amount) + Number(r.late_fee ?? 0) - Number(r.amount_paid) > 0.01
    );
    if (nowUnderpaid.length > 0) {
      const { error: demoteErr } = await adminDb
        .from("hms_payments")
        .update({ status: "partially_paid" as PaymentStatus, updated_at: new Date().toISOString() })
        .in("id", nowUnderpaid.map(r => r.id))
        .eq("hostel_id", hostelId);
      if (demoteErr) throw new Error(`Failed to reopen underpaid bills: ${demoteErr.message}`);
    }

    // ── Clear stale AC charges left on tenants who are no longer eligible ──
    // The eligible set above is is_active = true, so a tenant who checked out
    // after a previous apply is invisible to it: their old ac_charge is never
    // recomputed AND the full room total is re-split among whoever remains, so
    // their units get billed twice. Rajput Room 103 showed exactly this — a
    // 120-unit meter billed as 168 because a departed tenant kept 48 units.
    //
    // A checkout that DID record a meter reading is different: it leaves a
    // breakpoint in hms_room_ac_checkout_readings, the segmentation above
    // accounts for it, and that charge is legitimately theirs — so those are
    // left alone.
    //
    // Settled money is never rewritten. A paid/waived row keeps its charge and
    // is reported back to the caller instead, for the operator to handle.
    const eligibleIds = new Set(eligible.map((t) => t.id));
    const { data: staleRows } = await adminDb
      .from("hms_payments")
      .select("id, tenant_id, status, ac_units_consumed, ac_charge, tenant:hms_tenants!inner(full_name, room_id)")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .eq("tenant.room_id", roomId)
      .gt("ac_charge", 0);

    const { data: breakpointRows } = await adminDb
      .from("hms_room_ac_checkout_readings")
      .select("tenant_id")
      .eq("hostel_id", hostelId)
      .eq("room_id", roomId)
      .eq("for_month", forMonth);
    const hasBreakpoint = new Set((breakpointRows ?? []).map((b) => b.tenant_id));

    const staleCandidates = (staleRows ?? []).filter(
      (r) => !eligibleIds.has(r.tenant_id) && !hasBreakpoint.has(r.tenant_id)
    );
    const clearable = staleCandidates.filter((r) => ["pending", "overdue", "partially_paid"].includes(r.status));
    const lockedStale = staleCandidates.filter((r) => !["pending", "overdue", "partially_paid"].includes(r.status));

    if (clearable.length > 0) {
      await adminDb
        .from("hms_payments")
        .update({ ac_units_consumed: 0, ac_charge: 0, updated_at: new Date().toISOString() })
        .in("id", clearable.map((r) => r.id))
        .eq("hostel_id", hostelId);
    }

    // ── Verify all rows were found ──
    const updatedCount = updateResults.reduce((sum, r) => sum + (r.data?.length ?? 0), 0);
    if (updatedCount < eligible.length) {
      throw new Error(
        `Only ${updatedCount} of ${eligible.length} payment rows were updated. ` +
        `Please sync payments for ${forMonth} first, then apply AC billing.`
      );
    }

    // ── Save reading record only after payments are confirmed updated ──
    const { error: readingError } = await adminDb
      .from("hms_room_ac_readings")
      .upsert(
        {
          hostel_id: hostelId,
          room_id: roomId,
          for_month: forMonth,
          total_units: units,
          meter_reading: reading,
          per_unit_rate: perUnitRate,
          // Everyone the meter was split across, not just whoever is still here.
          // Departed tenants paid their share at checkout; omitting them made the
          // panel read "4 tenants billed" for a month that was divided by five.
          tenant_count: eligible.length + departedCounted,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month" }
      );
    if (readingError) throw readingError;

    revalidatePath("/payments");
    revalidatePath("/dashboard");
    const first = tenantBilling[0];

    await logActivity({
      hostel_id: hostelId,
      actor_id: ctx.user.id,
      action: "ac_reading.submit",
      entity: "ac_reading",
      entity_id: roomId,
      meta: { for_month: forMonth, meter_reading: reading, total_units: units, tenant_count: eligible.length + departedCounted },
    });

    return {
      success: true,
      eligibleCount: eligible.length,
      perUnitRate,
      perTenantUnits: first?.tenantUnits ?? 0,
      perTenantCharge: first?.charge ?? 0,
      skippedFirstMonth: 0,
      proRatedCount,
      unassignedUnits,
      clearedStaleCount: clearable.length,
      reopenedCount: nowUnderpaid.length,
      lockedStale: lockedStale.map((r) => {
        const t = r.tenant as unknown as { full_name?: string } | { full_name?: string }[] | null;
        const name = Array.isArray(t) ? t[0]?.full_name : t?.full_name;
        return { name: name ?? "Unknown", units: Number(r.ac_units_consumed ?? 0), charge: Number(r.ac_charge ?? 0) };
      }),
      derivedUnits: units,
      prevMonthReading: prevReading,
      currentReading: reading,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// saveACJoinReadingAction
// Records the meter reading at the moment a mid-month AC-tier tenant joins,
// enabling segment-based billing when applyRoomACUnitsAction runs at month end.
// ---------------------------------------------------------------------------

export async function saveACJoinReadingAction(
  roomId: string,
  forMonth: string,
  tenantId: string,
  joinMeterReading: number,
  openingReading?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // Standard tier — same reasoning as applyRoomACUnitsAction: admin-client
    // write with no RLS backstop, roomId and tenantId both re-scoped to
    // ctx.hostelId below.
    await requireOwnerOrPartnerTier("standard");
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
    const { hostelId } = ctx;

    if (!roomId || !UUID_RE.test(roomId)) throw new Error("Invalid room ID");
    if (!forMonth || !MONTH_RE.test(forMonth)) throw new Error("Invalid month format");
    if (!tenantId || !UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID");

    const joinReading = Math.round(Number(joinMeterReading));
    if (!Number.isFinite(joinReading) || joinReading < 0 || joinReading > 999_999)
      throw new Error("Join meter reading must be between 0 and 999,999");
    if (openingReading !== undefined) {
      const or = Math.round(Number(openingReading));
      if (!Number.isFinite(or) || or < 0 || or > 999_999)
        throw new Error("Opening reading must be between 0 and 999,999");
    }

    const supabase = await createClient();
    const adminDb = createAdminClient();

    // Fetch room, tenant, prev month reading, and roommates' move-in readings in parallel
    const prevMonthStr = getPrevMonth(forMonth);
    const [{ data: room }, { data: tenant }, { data: prevRecord }, { data: roommates }] = await Promise.all([
      supabase.from("hms_rooms").select("id").eq("id", roomId).eq("hostel_id", hostelId).single(),
      supabase.from("hms_tenants").select("id, package_tier, room_id, is_active").eq("id", tenantId).eq("hostel_id", hostelId).single(),
      adminDb.from("hms_room_ac_readings").select("meter_reading").eq("room_id", roomId).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
      supabase.from("hms_tenants").select("check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", roomId).eq("is_active", true),
    ]);

    if (!room) throw new Error("Room not found or access denied");
    if (!tenant) throw new Error("Tenant not found or access denied");
    if (!tenant.is_active) throw new Error("Tenant is not active");
    if (tenant.room_id !== roomId) throw new Error("Tenant is not in this room");

    // Same fallback as applyRoomACUnitsAction: derive from the room's earliest
    // known move-in reading rather than assuming the meter started at 0.
    const derivedOpening = deriveOpeningReading(roommates ?? [], forMonth);

    // Derive relative units from cumulative meter readings
    const prevReading = prevRecord?.meter_reading != null
      ? Math.round(Number(prevRecord.meter_reading))
      : (openingReading != null ? Math.round(Number(openingReading)) : (derivedOpening ?? 0));

    if (joinReading < prevReading)
      throw new Error(`Join meter reading (${joinReading}) cannot be less than previous month's reading (${prevReading})`);

    const relativeUnitsAtJoin = joinReading - prevReading;

    const { error } = await adminDb
      .from("hms_room_ac_join_readings")
      .upsert(
        {
          hostel_id: hostelId,
          room_id: roomId,
          for_month: forMonth,
          tenant_id: tenantId,
          units_at_join: relativeUnitsAtJoin,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month,tenant_id" }
      );
    if (error) throw new Error(error.message);

    revalidatePath("/payments");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
