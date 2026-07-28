import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VALID_TIERS, calcBaseRentServer, dailySnapshot, computeDepositCharge,
  computeRegistrationFeeCharge, computeAcMaintenanceCharge,
} from "@/lib/payment-calc";
import { calcFoodAddonCharge } from "@/lib/food-addon";
import type { PackageTier } from "@/types";

// The exact row-creation/refresh logic syncMonthAction has always run when a
// staff member opens Monthly View — extracted so it can also run unattended
// (no browser session) from the payment-reminders cron, which needs this
// month's rows to already exist before it can find who to remind. Never
// touches paid/waived rows. Upsert (not plain insert) so a concurrent manual
// page-load can't collide into a duplicate-key error on (tenant_id, for_month).
export async function ensureMonthlyPaymentRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  hostelId: string,
  month: string
): Promise<{ created: number; updated: number }> {
  const [{ data: tenants, error: tenantsErr }, { data: configData }, { data: rooms }] = await Promise.all([
    admin
      .from("hms_tenants")
      .select("id, monthly_rent, daily_rate, billing_type, package_tier, check_in, check_out, security_deposit, registration_fee, room_id, food_breakfast, food_lunch, food_dinner")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .eq("is_waiting", false),
    admin
      .from("hms_package_configs")
      .select("food_monthly_rate, ac_per_unit_rate, ac_maintenance_rate, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate")
      .eq("hostel_id", hostelId)
      .maybeSingle(),
    admin
      .from("hms_rooms")
      .select("id, has_ac")
      .eq("hostel_id", hostelId),
  ]);

  if (tenantsErr) throw new Error(tenantsErr.message);

  const activeTenants = tenants ?? [];
  if (activeTenants.length === 0) return { created: 0, updated: 0 };

  const foodRate = Number(configData?.food_monthly_rate ?? 0);
  const acMaintenanceRate = Number(configData?.ac_maintenance_rate ?? 0);
  const roomAcMap = new Map<string, boolean>((rooms ?? []).map((r) => [r.id, !!r.has_ac]));

  const { data: existingRows } = await admin
    .from("hms_payments")
    .select("tenant_id, status, ac_charge, ac_units_consumed")
    .eq("hostel_id", hostelId)
    .eq("for_month", month);

  type ExistingRow = { tenant_id: string; status: string; ac_charge: number | null; ac_units_consumed: number | null };
  const existingMap = new Map<string, ExistingRow>((existingRows ?? []).map((r) => [r.tenant_id, r]));

  const newRows: object[] = [];
  const pendingUpdates: object[] = [];

  for (const t of activeTenants) {
    const tier = (t.package_tier ?? "space_only") as PackageTier;
    if (!VALID_TIERS.has(tier)) throw new Error(`Invalid package_tier in DB for tenant ${t.id}`);

    const baseRent = calcBaseRentServer(t, month);
    const daySnapshot = dailySnapshot(t, month);
    const tierFoodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;
    const addonFoodCharge = configData ? calcFoodAddonCharge(t, configData) : 0;
    const foodCharge = tierFoodCharge + addonFoodCharge;
    const depositCharge = computeDepositCharge(t, month);
    const registrationFeeCharge = computeRegistrationFeeCharge(t, month);
    const roomHasAc = t.room_id ? (roomAcMap.get(t.room_id) ?? false) : false;
    const acMaintenanceCharge = computeAcMaintenanceCharge(roomHasAc, acMaintenanceRate);

    const existing = existingMap.get(t.id);

    if (!existing) {
      newRows.push({
        hostel_id: hostelId,
        tenant_id: t.id,
        for_month: month,
        amount: baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge,
        status: "pending",
        payment_package_tier: tier,
        food_charge: foodCharge,
        ac_units_consumed: 0,
        ac_charge: 0,
        security_deposit_charge: depositCharge,
        registration_fee_charge: registrationFeeCharge,
        ac_maintenance_charge: acMaintenanceCharge,
        ...daySnapshot,
      });
    } else if (existing.status === "pending") {
      const preservedAC = Number(existing.ac_charge ?? 0);
      pendingUpdates.push({
        hostel_id: hostelId,
        tenant_id: t.id,
        for_month: month,
        amount: baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge,
        payment_package_tier: tier,
        food_charge: foodCharge,
        ac_charge: preservedAC,
        ac_units_consumed: existing.ac_units_consumed ?? 0,
        security_deposit_charge: depositCharge,
        registration_fee_charge: registrationFeeCharge,
        ac_maintenance_charge: acMaintenanceCharge,
        ...daySnapshot,
      });
    }
    // paid/waived rows are skipped entirely
  }

  if (newRows.length > 0) {
    const { error: insertErr } = await admin
      .from("hms_payments")
      .upsert(newRows, { onConflict: "tenant_id,for_month", ignoreDuplicates: true });
    if (insertErr) throw new Error(insertErr.message);
  }

  if (pendingUpdates.length > 0) {
    const { error: updateErr } = await admin
      .from("hms_payments")
      .upsert(pendingUpdates, { onConflict: "tenant_id,for_month", ignoreDuplicates: false });
    if (updateErr) throw new Error(updateErr.message);
  }

  return { created: newRows.length, updated: pendingUpdates.length };
}
