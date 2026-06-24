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

import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/data";
import type { Payment, PaymentMethod, PaymentStatus, PackageTier } from "@/types";

// ---------------------------------------------------------------------------
// Constants / validation helpers
// ---------------------------------------------------------------------------

const VALID_TIERS = new Set<string>(["space_only", "space_food", "space_3meals", "space_food_ac", "space_meals_cooler"]);
const VALID_METHODS = new Set<string>(["cash", "bank_transfer", "jazzcash", "easypaisa", "sadapay", "other"]);
const VALID_STATUSES = new Set<string>(["paid", "pending", "overdue", "waived"]);
const MAX_AC_UNITS = 10_000;
const MAX_LATE_FEE = 9_999_999.99;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
// Internal helper: resolve the authenticated user's hostel_id from the DB.
// Never trusts a client-supplied hostel_id.
// ---------------------------------------------------------------------------

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

// ---------------------------------------------------------------------------
// Internal helper: fetch tenant data from DB (base rent, billing type, tier)
// ---------------------------------------------------------------------------

async function fetchTenantData(tenantId: string, hostelId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hms_tenants")
    .select("id, monthly_rent, daily_rate, billing_type, package_tier, check_in, check_out")
    .eq("id", tenantId)
    .eq("hostel_id", hostelId) // ensures the tenant belongs to the owner's hostel
    .single();

  if (error || !data) throw new Error("Tenant not found or access denied");
  return data as {
    id: string;
    monthly_rent: number;
    daily_rate: number;
    billing_type: "monthly" | "daily";
    package_tier: PackageTier;
    check_in: string;
    check_out: string | null;
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
    if (!MONTH_RE.test(month)) throw new Error(`Invalid month format: "${month}"`);

    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    // Fetch active tenants and package config server-side
    const [{ data: tenants, error: tenantsErr }, { data: configData }] = await Promise.all([
      supabase
        .from("hms_tenants")
        .select("id, monthly_rent, daily_rate, billing_type, package_tier, check_in, check_out")
        .eq("hostel_id", hostelId)
        .eq("is_active", true),
      supabase
        .from("hms_package_configs")
        .select("food_monthly_rate, ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle(),
    ]);

    if (tenantsErr) throw new Error(tenantsErr.message);

    const activeTenants = tenants ?? [];
    const foodRate = Number(configData?.food_monthly_rate ?? 0);

    if (activeTenants.length > 0) {
      const rows = activeTenants.map((t) => {
        const tier = (t.package_tier ?? "space_only") as PackageTier;
        // Validate tier from DB (should always be valid, belt-and-suspenders)
        if (!VALID_TIERS.has(tier)) throw new Error(`Invalid package_tier in DB for tenant ${t.id}`);

        const baseRent = calcBaseRentServer(t, month);
        const foodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;
        // AC charge defaults to 0 on sync; entered per-payment when marking paid
        const acCharge = 0;
        const totalAmount = baseRent + foodCharge + acCharge;

        return {
          hostel_id: hostelId,
          tenant_id: t.id,
          for_month: month,
          amount: totalAmount,
          status: "pending" as PaymentStatus,
          payment_package_tier: tier,
          food_charge: foodCharge,
          ac_units_consumed: 0,
          ac_charge: acCharge,
        };
      });

      const { error: upsertErr } = await supabase
        .from("hms_payments")
        .upsert(rows, { onConflict: "tenant_id,for_month", ignoreDuplicates: true });

      if (upsertErr) throw new Error(upsertErr.message);
    }

    const { data: payments, error: fetchErr } = await supabase
      .from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .order("created_at", { ascending: false });

    if (fetchErr) throw new Error(fetchErr.message);

    return { payments: (payments ?? []) as Payment[] };
  } catch (err: unknown) {
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
}

export async function markPaymentPaidAction(
  input: MarkPaidInput
): Promise<{ payment?: Payment; error?: string }> {
  try {
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
      .select("id, tenant_id, for_month, amount, food_charge, ac_charge, payment_package_tier, hostel_id")
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
      // Use parseInt — AC units must be a whole number (F-004)
      const parsed = parseInt(input.acUnitsConsumed, 10);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_AC_UNITS) {
        throw new Error(
          `AC units consumed must be a non-negative integer <= ${MAX_AC_UNITS}, got "${input.acUnitsConsumed}"`
        );
      }
      acUnitsConsumed = parsed;

      // Re-fetch the canonical AC rate from DB (never trust the client-supplied rate)
      const { data: configData } = await supabase
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle();

      const acUnitRate = Number(configData?.ac_per_unit_rate ?? 0);
      newAcCharge = acUnitsConsumed * acUnitRate;

      // Guard against overflow (F-003)
      assertNonNegativeFinite(newAcCharge, "computed ac_charge", 9_999_999.99);
    }

    // --- Re-derive base_rent and total from DB-canonical values (F-001) ---
    const tenantData = await fetchTenantData(existingPayment.tenant_id, hostelId);
    const forMonth = existingPayment.for_month;

    let baseRent: number;
    if (tenantData.billing_type === "monthly") {
      baseRent = Number(tenantData.monthly_rent);
    } else {
      // daily: re-compute pro-rated base rent
      baseRent = calcBaseRentServer(tenantData, forMonth);
    }

    // Re-fetch food_charge from the canonical package config rate (never trust
    // the stored row value, which could have been corrupted via direct API PATCH).
    let foodCharge = 0;
    if (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") {
      const { data: foodConfigData } = await supabase
        .from("hms_package_configs")
        .select("food_monthly_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle();
      foodCharge = Number(foodConfigData?.food_monthly_rate ?? 0);
    }

    const newTotalAmount = baseRent + foodCharge + newAcCharge;

    // Final sanity: total must be non-negative
    if (newTotalAmount < 0) {
      throw new Error(`Computed total amount is negative: ${newTotalAmount}`);
    }

    // --- Build update payload ---
    const updatePayload: Record<string, unknown> = {
      status: "paid" as PaymentStatus,
      payment_method: input.method as PaymentMethod,
      payment_date: input.date,
      late_fee: lateFee,
      notes: input.notes || null,
      receipt_number: input.receiptNumber,
      // Always write the recalculated total (trigger will re-verify)
      amount: newTotalAmount,
      // Write back canonical food_charge so any previously corrupted row is corrected
      food_charge: foodCharge,
    };

    if (isAcTier) {
      updatePayload.ac_units_consumed = acUnitsConsumed;
      updatePayload.ac_charge = newAcCharge;
    }

    const { data, error } = await supabase
      .from("hms_payments")
      .update(updatePayload)
      .eq("id", input.paymentId)
      .eq("hostel_id", hostelId) // double-check ownership
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .single();

    if (error) throw new Error(error.message);

    return { payment: data as Payment };
  } catch (err: unknown) {
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
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    const { error } = await supabase
      .from("hms_payments")
      .update({ status: "waived" as PaymentStatus })
      .eq("id", paymentId)
      .eq("hostel_id", hostelId);

    if (error) throw new Error(error.message);
    return {};
  } catch (err: unknown) {
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
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    const { error } = await supabase
      .from("hms_payments")
      .update({ status: "overdue" as PaymentStatus })
      .eq("id", paymentId)
      .eq("hostel_id", hostelId);

    if (error) throw new Error(error.message);
    return {};
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// loadHistoryAction
// ---------------------------------------------------------------------------

export async function loadHistoryAction(): Promise<{ payments?: Payment[]; error?: string }> {
  try {
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .eq("hostel_id", hostelId)
      .order("for_month", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return { payments: (data ?? []) as Payment[] };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// calcBaseRentServer — mirrors the client-side calcBaseRent logic but runs
// entirely on the server with DB-sourced data.
// ---------------------------------------------------------------------------

function calcBaseRentServer(
  t: {
    billing_type: string;
    monthly_rent: number;
    daily_rate: number;
    check_in: string;
    check_out: string | null;
  },
  month: string
): number {
  if (t.billing_type !== "daily") return Number(t.monthly_rent);

  const [y, m] = month.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const checkIn = new Date(t.check_in);
  const checkOut = t.check_out ? new Date(t.check_out) : null;
  const start = checkIn > monthStart ? checkIn : monthStart;
  const end = checkOut && checkOut < monthEnd ? checkOut : monthEnd;
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return days * Number(t.daily_rate);
}
