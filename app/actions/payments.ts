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
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
      // Fetch existing payment rows so we can skip paid/waived and preserve ac_charge on pending rows
      const { data: existingRows } = await supabase
        .from("hms_payments")
        .select("tenant_id, status, ac_charge, ac_units_consumed")
        .eq("hostel_id", hostelId)
        .eq("for_month", month);

      type ExistingRow = { tenant_id: string; status: string; ac_charge: number | null; ac_units_consumed: number | null };
      const existingMap = new Map<string, ExistingRow>(
        (existingRows ?? []).map((r) => [r.tenant_id, r])
      );

      const newRows: object[] = [];      // tenants with no payment row yet
      const pendingUpdates: object[] = []; // pending rows that need tier/amount refresh

      for (const t of activeTenants) {
        const tier = (t.package_tier ?? "space_only") as PackageTier;
        if (!VALID_TIERS.has(tier)) throw new Error(`Invalid package_tier in DB for tenant ${t.id}`);

        const baseRent = calcBaseRentServer(t, month);
        const foodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;

        const existing = existingMap.get(t.id);

        if (!existing) {
          // New tenant — create fresh row
          newRows.push({
            hostel_id: hostelId,
            tenant_id: t.id,
            for_month: month,
            amount: baseRent + foodCharge,
            status: "pending" as PaymentStatus,
            payment_package_tier: tier,
            food_charge: foodCharge,
            ac_units_consumed: 0,
            ac_charge: 0,
          });
        } else if (existing.status === "pending") {
          // Pending row — refresh tier/amount but preserve any existing ac_charge
          const preservedAC = Number(existing.ac_charge ?? 0);
          pendingUpdates.push({
            hostel_id: hostelId,
            tenant_id: t.id,
            for_month: month,
            amount: baseRent + foodCharge,
            payment_package_tier: tier,
            food_charge: foodCharge,
            ac_charge: preservedAC,
            ac_units_consumed: existing.ac_units_consumed ?? 0,
          });
          // status stays "pending" — not included so it isn't overwritten
        }
        // paid/waived rows are skipped entirely
      }

      // Insert new rows
      if (newRows.length > 0) {
        const { error: insertErr } = await supabase.from("hms_payments").insert(newRows);
        if (insertErr) throw new Error(insertErr.message);
      }

      // Update pending rows (upsert so it handles any race between the two steps)
      if (pendingUpdates.length > 0) {
        const { error: updateErr } = await supabase
          .from("hms_payments")
          .upsert(pendingUpdates, { onConflict: "tenant_id,for_month", ignoreDuplicates: false });
        if (updateErr) throw new Error(updateErr.message);
      }
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

// ---------------------------------------------------------------------------
// applyRoomACUnitsAction
// Splits total AC units across all eligible AC-tier tenants in a room and
// updates their payment records for the given month.
// ---------------------------------------------------------------------------

// Only space_food_ac tenants are billed for room-level AC usage
const AC_TIERS = new Set<string>(["space_food_ac"]);

export async function applyRoomACUnitsAction(
  roomId: string,
  forMonth: string,
  totalUnits: number
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
}> {
  try {
    // ── Auth & ownership guard ──────────────────────────────────
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
    const { hostelId } = ctx;

    // ── Input validation — use canonical MONTH_RE (rejects 2024-00, 2024-13) ──
    if (!roomId || !UUID_RE.test(roomId)) throw new Error("Invalid room ID");
    if (!forMonth || !MONTH_RE.test(forMonth)) throw new Error("Invalid month format");
    const units = Number(totalUnits);
    if (!Number.isFinite(units) || units < 0 || units > 99_999)
      throw new Error("Total units must be between 0 and 99,999");

    // ── Scoped client for reads (RLS provides defense-in-depth) ──
    const supabase = await createClient();
    const adminDb = createAdminClient();

    // ── Verify room belongs to this hostel ──────────────────────
    const { data: room } = await supabase
      .from("hms_rooms")
      .select("id, hostel_id, has_ac")
      .eq("id", roomId)
      .eq("hostel_id", hostelId)
      .single();
    if (!room) throw new Error("Room not found or access denied");
    if (!room.has_ac) throw new Error("This room does not have AC");

    // ── Get package config for per-unit rate ────────────────────
    const { data: pkgConfig } = await supabase
      .from("hms_package_configs")
      .select("ac_per_unit_rate, food_monthly_rate")
      .eq("hostel_id", hostelId)
      .single();
    const perUnitRate = Number(pkgConfig?.ac_per_unit_rate ?? 0);
    if (perUnitRate <= 0) throw new Error("AC per-unit rate is not configured. Set it in Settings → Packages.");
    const foodRate = Number(pkgConfig?.food_monthly_rate ?? 0);

    // ── Find active AC-package tenants in this room ───────────────
    const { data: allTenants } = await supabase
      .from("hms_tenants")
      .select("id, check_in, package_tier, monthly_rent, daily_rate, billing_type, check_out")
      .eq("hostel_id", hostelId)
      .eq("room_id", roomId)
      .eq("is_active", true);

    const eligible = (allTenants ?? []).filter(t => AC_TIERS.has(t.package_tier ?? ""));
    if (eligible.length === 0)
      throw new Error("No tenants with AC package found in this room. Assign the Space + AC plan to a tenant first.");

    // ── Fetch join readings for segment billing ──────────────────
    const { data: joinReadingsRaw } = await adminDb
      .from("hms_room_ac_join_readings")
      .select("tenant_id, units_at_join")
      .eq("room_id", roomId)
      .eq("for_month", forMonth)
      .eq("hostel_id", hostelId)
      .order("units_at_join", { ascending: true });

    // Use join readings for ALL eligible tenants regardless of join date.
    // A tenant on the 1st with units_at_join=0 produces equal split (the duplicate 0 is deduplicated by
    // the Set, leaving one segment [0,total] where they are present for the full range).
    // A tenant on the 1st with units_at_join=10 correctly assigns those 10 units to whoever came first.
    const joinReadings = (joinReadingsRaw ?? []).filter(r =>
      eligible.some(t => t.id === r.tenant_id)
    ) as { tenant_id: string; units_at_join: number }[];
    const n = eligible.length;
    const totalCharge = Math.round(units * perUnitRate);
    let proRatedCount = 0;
    let unassignedUnits = 0;

    let tenantBilling: { id: string; tenantUnits: number; charge: number }[];

    if (joinReadings.length === 0) {
      // ── Equal split: units are integers, last tenant absorbs remainder ──
      const baseCharge = n > 1 ? Math.floor(totalCharge / n) : totalCharge;
      const lastCharge = totalCharge - baseCharge * (n - 1);
      const baseUnits = n > 1 ? Math.floor(units / n) : units;
      const lastUnits = units - baseUnits * (n - 1);
      tenantBilling = eligible.map((t, idx) => ({
        id: t.id,
        tenantUnits: idx === n - 1 ? lastUnits : baseUnits,
        charge: idx === n - 1 ? lastCharge : baseCharge,
      }));
    } else {
      // ── Segment billing ──────────────────────────────────────
      proRatedCount = joinReadings.length;
      const joinedIds = new Set(joinReadings.map(r => r.tenant_id));
      const fullMonth = eligible.filter(t => !joinedIds.has(t.id));
      const midMonth = eligible.filter(t => joinedIds.has(t.id));

      const eventPoints = Array.from(
        new Set([0, ...joinReadings.map(r => Math.min(Number(r.units_at_join), units)), units])
      ).sort((a, b) => a - b);

      const accumulated = new Map<string, number>(eligible.map(t => [t.id, 0]));

      for (let i = 0; i < eventPoints.length - 1; i++) {
        const from = eventPoints[i];
        const to = eventPoints[i + 1];
        const segUnits = to - from;
        if (segUnits <= 0) continue;
        const present = [
          ...fullMonth,
          ...midMonth.filter(t => {
            const r = joinReadings.find(jr => jr.tenant_id === t.id);
            return r ? Number(r.units_at_join) <= from : false;
          }),
        ];
        if (present.length === 0) continue;
        const share = segUnits / present.length;
        for (const t of present) accumulated.set(t.id, (accumulated.get(t.id) ?? 0) + share);
      }

      if (units === 0) {
        tenantBilling = eligible.map(t => ({ id: t.id, tenantUnits: 0, charge: 0 }));
      } else {
        const assignedUnits = [...accumulated.values()].reduce((s, v) => s + v, 0);
        unassignedUnits = Math.max(0, Math.round(units - assignedUnits));
        const assignedCharge = assignedUnits > 0 ? Math.round(assignedUnits * perUnitRate) : 0;
        if (assignedUnits === 0) {
          tenantBilling = eligible.map(t => ({ id: t.id, tenantUnits: 0, charge: 0 }));
        } else {
          const rows = eligible.map(t => {
            const tu = accumulated.get(t.id) ?? 0;
            return {
              id: t.id,
              tenantUnits: Math.round(tu),
              charge: Math.max(0, Math.round((tu / assignedUnits) * assignedCharge)),
            };
          });
          const sumExceptLast = rows.slice(0, -1).reduce((s, x) => s + x.charge, 0);
          if (rows.length > 0) rows[rows.length - 1].charge = Math.max(0, assignedCharge - sumExceptLast);
          const unitSumExceptLast = rows.slice(0, -1).reduce((s, x) => s + x.tenantUnits, 0);
          if (rows.length > 0) rows[rows.length - 1].tenantUnits = Math.max(0, Math.round(assignedUnits) - unitSumExceptLast);
          tenantBilling = rows;
        }
      }
    }

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
        const baseRent = calcBaseRentServer(
          {
            billing_type: (t as { billing_type: string }).billing_type ?? "monthly",
            monthly_rent: (t as { monthly_rent: number }).monthly_rent ?? 0,
            daily_rate: (t as { daily_rate: number }).daily_rate ?? 0,
            check_in: t.check_in,
            check_out: (t as { check_out: string | null }).check_out ?? null,
          },
          forMonth
        );
        const foodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;
        return {
          hostel_id: hostelId,
          tenant_id: t.id,
          for_month: forMonth,
          amount: baseRent + foodCharge,
          status: "pending" as PaymentStatus,
          payment_package_tier: tier,
          food_charge: foodCharge,
          ac_units_consumed: 0,
          ac_charge: 0,
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
          per_unit_rate: perUnitRate,
          tenant_count: eligible.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month" }
      );
    if (readingError) throw readingError;

    revalidatePath("/payments");
    revalidatePath("/dashboard");
    const first = tenantBilling[0];
    return {
      success: true,
      eligibleCount: eligible.length,
      perUnitRate,
      perTenantUnits: first?.tenantUnits ?? 0,
      perTenantCharge: first?.charge ?? 0,
      skippedFirstMonth: 0,
      proRatedCount,
      unassignedUnits,
    };
  } catch (err) {
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
  unitsAtJoin: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
    const { hostelId } = ctx;

    if (!roomId || !UUID_RE.test(roomId)) throw new Error("Invalid room ID");
    if (!forMonth || !MONTH_RE.test(forMonth)) throw new Error("Invalid month format");
    if (!tenantId || !UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID");
    assertNonNegativeFinite(unitsAtJoin, "units_at_join", 99_999);

    const supabase = await createClient();
    const adminDb = createAdminClient();

    const { data: room } = await supabase
      .from("hms_rooms")
      .select("id")
      .eq("id", roomId)
      .eq("hostel_id", hostelId)
      .single();
    if (!room) throw new Error("Room not found or access denied");

    const { data: tenant } = await supabase
      .from("hms_tenants")
      .select("id, package_tier, room_id, is_active")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();
    if (!tenant) throw new Error("Tenant not found or access denied");
    if (!tenant.is_active) throw new Error("Tenant is not active");
    if (tenant.room_id !== roomId) throw new Error("Tenant is not in this room");
    if (tenant.package_tier !== "space_food_ac") throw new Error("Tenant does not have the AC package");

    const { error } = await adminDb
      .from("hms_room_ac_join_readings")
      .upsert(
        {
          hostel_id: hostelId,
          room_id: roomId,
          for_month: forMonth,
          tenant_id: tenantId,
          units_at_join: unitsAtJoin,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month,tenant_id" }
      );
    if (error) throw new Error(error.message);

    revalidatePath("/payments");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
