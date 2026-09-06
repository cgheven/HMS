import "server-only";
import { pktYearMonth } from "@/lib/pkt-time";
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
// The charge set a pending row for `month` SHOULD hold, given the tenant's
// current rates. Exported so the Payments page can tell whether an existing row
// has fallen behind without re-deriving any of this itself — the writer below and
// that check must agree, or the page either syncs forever or never syncs at all.
export type ExpectedCharges = {
  tier: PackageTier;
  baseRent: number;
  foodCharge: number;
  depositCharge: number;
  registrationFeeCharge: number;
  acMaintenanceCharge: number;
};

export function expectedChargesFor(
  t: {
    billing_type: string; monthly_rent: number; daily_rate: number;
    check_in: string; check_out: string | null;
    // Required, not optional: a caller whose SELECT omits one of these would
    // otherwise read undefined, quietly compute a 0 charge, and mark every
    // affected row permanently stale — re-syncing on every page load forever.
    package_tier: string | null; security_deposit: number | null;
    deposit_collected_amount: number | null;
    registration_fee: number | null; room_id: string | null;
    food_breakfast: boolean; food_lunch: boolean; food_dinner: boolean;
    // Per-tenant AC maintenance override. Null = use the branch rate.
    ac_maintenance: number | null;
  },
  month: string,
  ctx: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any | null;
    roomAcMap: Map<string, boolean>;
  }
): ExpectedCharges {
  const tier = (t.package_tier ?? "space_only") as PackageTier;
  if (!VALID_TIERS.has(tier)) throw new Error(`Invalid package_tier in DB: ${tier}`);

  const foodRate = Number(ctx.config?.food_monthly_rate ?? 0);
  const acMaintenanceRate = Number(ctx.config?.ac_maintenance_rate ?? 0);
  const tierFoodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;
  const addonFoodCharge = ctx.config ? calcFoodAddonCharge(t, ctx.config) : 0;
  const roomHasAc = t.room_id ? (ctx.roomAcMap.get(t.room_id) ?? false) : false;

  return {
    tier,
    baseRent: calcBaseRentServer(t as never, month),
    foodCharge: tierFoodCharge + addonFoodCharge,
    depositCharge: computeDepositCharge(t, month),
    registrationFeeCharge: computeRegistrationFeeCharge(t, month),
    acMaintenanceCharge: computeAcMaintenanceCharge(roomHasAc, acMaintenanceRate, t.ac_maintenance),
  };
}

/**
 * The month the checkout path may safely re-price.
 *
 * ensureMonthlyPaymentRows CREATES rows for every active member of the branch,
 * with no check_in bound, so syncing a PAST month invents bills for people who
 * had not joined yet — and the checkout dialog re-runs on every keystroke in the
 * date field, so a back-dated departure would fire it silently from an unrelated
 * screen. Only the current month or later is worth healing: a departure
 * back-dated further needs the departing member's own row read, not the whole
 * branch re-priced.
 *
 * Bounded in BOTH directions. Below, because a past month invents history; above,
 * because this action re-runs on every change of the date input — arrow the year
 * segment up once, or type 2036 for 2026, and an unbounded sync would create a
 * pending rent row for every member of the branch in a month nobody has reached.
 * Nothing cleans those up, and the Member Ledger has no month bound, so they
 * would show as real debts. The upper limit mirrors performTenantCheckout's own
 * "no more than 7 days ahead" rule, which is the furthest a real departure can
 * land.
 *
 * Returns null when the month is out of range or malformed (a scrubbed year in a
 * date input produces things like "0202-08"), and the caller then simply skips
 * the sync.
 */
export function syncableCheckoutMonth(month: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const { year, month: m } = pktYearMonth();
  const current = `${year}-${String(m).padStart(2, "0")}`;
  const ahead = new Date();
  ahead.setDate(ahead.getDate() + 7);
  const { year: aY, month: aM } = pktYearMonth(ahead);
  const latest = `${aY}-${String(aM).padStart(2, "0")}`;
  return month >= current && month <= latest ? month : null;
}

export async function ensureMonthlyPaymentRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  hostelId: string,
  month: string
): Promise<{ created: number; updated: number }> {
  const [{ data: tenants, error: tenantsErr }, { data: configData }, { data: rooms }] = await Promise.all([
    admin
      .from("hms_tenants")
      .select("id, monthly_rent, daily_rate, billing_type, package_tier, check_in, check_out, security_deposit, deposit_collected_amount, registration_fee, room_id, food_breakfast, food_lunch, food_dinner, ac_maintenance")
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
    const { tier, baseRent, foodCharge, depositCharge, registrationFeeCharge, acMaintenanceCharge } =
      expectedChargesFor(t, month, { config: configData, roomAcMap });
    const daySnapshot = dailySnapshot(t, month);

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
        // LOAD-BEARING, not decorative. `amount` above is GROSS, and the trigger
        // stores it net, so this declares "no discount is baked into that number".
        // It matters most on the upsert below: PostgreSQL reflects the effects of
        // per-row BEFORE INSERT triggers in EXCLUDED, so without this marker the
        // conflict pass would read back the first pass's already-discounted
        // output, subtract the discount a second time, and compound it on every
        // sync — and hasStaleDailyRow compares only billed_days, so nothing would
        // ever heal it.
        referral_discount: 0,
        ...daySnapshot,
      });
    } else if (existing.status === "pending") {
      const preservedAC = Number(existing.ac_charge ?? 0);
      pendingUpdates.push({
        hostel_id: hostelId,
        tenant_id: t.id,
        for_month: month,
        // preservedAC is INSIDE the total, not merely carried alongside it. A
        // MONTHLY row never noticed the difference — the trigger rebuilds its
        // amount from monthly_rent and ignores whatever the app sends. A DAILY
        // row keeps this number and derives base rent by SUBTRACTING the charges
        // from it, so an amount that excluded the AC made the trigger read the AC
        // as coming out of the rent: the bill did not move, the rent quietly
        // dropped by the charge, and once the AC exceeded the bill the sync raised
        // "payment amount is less than the sum of add-on charges" — on a function
        // that runs on every Payments page load.
        amount: baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge + preservedAC,
        payment_package_tier: tier,
        food_charge: foodCharge,
        ac_charge: preservedAC,
        ac_units_consumed: existing.ac_units_consumed ?? 0,
        security_deposit_charge: depositCharge,
        registration_fee_charge: registrationFeeCharge,
        ac_maintenance_charge: acMaintenanceCharge,
        // Same reason as the newRows branch above: `amount` is gross here too.
        referral_discount: 0,
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
