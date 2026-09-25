import "server-only";
import { yearMonthInZone, DEFAULT_TIMEZONE } from "@/lib/pkt-time";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VALID_TIERS, calcBaseRentServer, daySnapshotFor, computeDepositCharge,
  computeRegistrationFeeCharge, computeAcMaintenanceCharge,
  resolveMonthlyBaseRent, mergedJoinMonthSkipped, billingAnchorOf,
  type BillingAnchor,
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
  // Non-null ONLY for a monthly tenant's prorated/merged first bill under a
  // billing anchor (migration 272) — the trigger ignores app `amount` for
  // monthly rent, so a non-full-month figure must reach base_rent_override.
  baseRentOverride: number | null;
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
    // Owner-entered premium per-day rate for the partial first month (anchor
    // branches only). Null => fall back to monthly_rent/30.
    first_month_day_rate?: number | null;
  },
  month: string,
  ctx: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any | null;
    roomAcMap: Map<string, boolean>;
    // Null on legacy (unanchored) branches — every result is then identical to
    // the previous behaviour.
    anchor?: BillingAnchor;
  }
): ExpectedCharges {
  const tier = (t.package_tier ?? "space_only") as PackageTier;
  if (!VALID_TIERS.has(tier)) throw new Error(`Invalid package_tier in DB: ${tier}`);

  const foodRate = Number(ctx.config?.food_monthly_rate ?? 0);
  const acMaintenanceRate = Number(ctx.config?.ac_maintenance_rate ?? 0);
  const tierFoodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0;
  const addonFoodCharge = ctx.config ? calcFoodAddonCharge(t, ctx.config) : 0;
  const roomHasAc = t.room_id ? (ctx.roomAcMap.get(t.room_id) ?? false) : false;
  const anchor = ctx.anchor ?? null;

  // Daily tenants are untouched by the anchor: calcBaseRentServer already
  // prorates them by nights and the trigger trusts their `amount`. Only monthly
  // tenants get an anchor-driven proration/merge via base_rent_override.
  const { baseRent, baseRentOverride } =
    t.billing_type === "daily"
      ? { baseRent: calcBaseRentServer(t as never, month), baseRentOverride: null as number | null }
      : resolveMonthlyBaseRent(t, month, anchor);

  return {
    tier,
    baseRent,
    baseRentOverride,
    foodCharge: tierFoodCharge + addonFoodCharge,
    depositCharge: computeDepositCharge(t, month, anchor),
    registrationFeeCharge: computeRegistrationFeeCharge(t, month, anchor),
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
export function syncableCheckoutMonth(month: string, timeZone: string = DEFAULT_TIMEZONE): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  // Bounds are the hostel's own calendar months (its timezone), not a fixed PKT
  // — at a month boundary Karachi (UTC+5) and London disagree for a few hours,
  // which would wrongly reject a legitimate current-month checkout for a UK
  // branch. Falls open to Karachi (byte-identical for PK).
  const { year, month: m } = yearMonthInZone(timeZone);
  const current = `${year}-${String(m).padStart(2, "0")}`;
  const ahead = new Date();
  ahead.setDate(ahead.getDate() + 7);
  const { year: aY, month: aM } = yearMonthInZone(timeZone, ahead);
  const latest = `${aY}-${String(aM).padStart(2, "0")}`;
  return month >= current && month <= latest ? month : null;
}

export async function ensureMonthlyPaymentRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  hostelId: string,
  month: string
): Promise<{ created: number; updated: number }> {
  const [{ data: tenants, error: tenantsErr }, { data: configData }, { data: rooms }, { data: hostelRow }] = await Promise.all([
    admin
      .from("hms_tenants")
      .select("id, monthly_rent, daily_rate, billing_type, package_tier, check_in, check_out, security_deposit, deposit_collected_amount, registration_fee, room_id, food_breakfast, food_lunch, food_dinner, ac_maintenance, first_month_day_rate")
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
    admin
      .from("hms_hostels")
      .select("billing_anchor_day, bill_leftover_days_separately")
      .eq("id", hostelId)
      .maybeSingle(),
  ]);

  if (tenantsErr) throw new Error(tenantsErr.message);

  const activeTenants = tenants ?? [];
  if (activeTenants.length === 0) return { created: 0, updated: 0 };

  // Null on branches that never enabled a billing date => every charge below is
  // byte-identical to the legacy behaviour.
  const anchor: BillingAnchor = billingAnchorOf(hostelRow);
  const foodRate = Number(configData?.food_monthly_rate ?? 0);
  const acMaintenanceRate = Number(configData?.ac_maintenance_rate ?? 0);
  const roomAcMap = new Map<string, boolean>((rooms ?? []).map((r) => [r.id, !!r.has_ac]));

  const { data: existingRows } = await admin
    .from("hms_payments")
    .select("tenant_id, status, ac_charge, ac_units_consumed, amount_paid, base_rent_override")
    .eq("hostel_id", hostelId)
    .eq("for_month", month);

  type ExistingRow = { tenant_id: string; status: string; ac_charge: number | null; ac_units_consumed: number | null; amount_paid: number | null; base_rent_override: number | string | null };
  const existingMap = new Map<string, ExistingRow>((existingRows ?? []).map((r) => [r.tenant_id, r]));

  const newRows: object[] = [];
  const pendingUpdates: object[] = [];
  // Merged-mode join months that must NOT carry a bill but still have a stale
  // pending row (e.g. the anchor was enabled after the join-month bill was
  // auto-created) — deleted below so the leftover is not billed twice (once here,
  // once folded into the next month). Only ever pending + nothing collected.
  const deleteJoinMonthIds: string[] = [];

  for (const t of activeTenants) {
    // Merged anchor mode folds the join-month partial into the NEXT calendar
    // month's first full bill, so the join month itself gets no row. Skipping
    // here is what makes the "one bill" behaviour real; the leftover nights are
    // still recovered on that next bill via resolveMonthlyBaseRent. If a stale
    // pending join-month row already exists (anchor enabled after it was created),
    // delete it — but only when nothing was collected, so paid history is safe.
    if (mergedJoinMonthSkipped(t, anchor) && month === t.check_in.slice(0, 7)) {
      const existingJoin = existingMap.get(t.id);
      if (existingJoin && existingJoin.status === "pending" && Number(existingJoin.amount_paid ?? 0) <= 0.009) {
        deleteJoinMonthIds.push(t.id);
      }
      continue;
    }

    const { tier, baseRent, baseRentOverride, foodCharge, depositCharge, registrationFeeCharge, acMaintenanceCharge } =
      expectedChargesFor(t, month, { config: configData, roomAcMap, anchor });
    // Anchor-aware: a monthly separate-partial join month gets a "N days x rate"
    // snapshot so its receipt reads like a daily bill; daily tenants unchanged.
    const daySnapshot = daySnapshotFor(t, month, anchor);

    const existing = existingMap.get(t.id);

    if (!existing) {
      newRows.push({
        hostel_id: hostelId,
        tenant_id: t.id,
        // Room the bill belongs to, snapshotted at creation (member-ledger history).
        room_id: t.room_id,
        for_month: month,
        amount: baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge,
        // The trigger bills full monthly_rent for a monthly tenant UNLESS this
        // override is present; null for daily and for plain full months.
        base_rent_override: baseRentOverride,
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
      const pendingUpdate: Record<string, unknown> = {
        hostel_id: hostelId,
        tenant_id: t.id,
        // A still-pending bill tracks the current room (frozen once paid/waived).
        room_id: t.room_id,
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
      };
      // base_rent_override must be present on EVERY object in the batch. PostgREST
      // bulk-upsert takes the UNION of keys across the batch and fills a missing
      // key with the column DEFAULT (NULL) in DO UPDATE SET — so merely omitting it
      // on some rows would let a NULL clobber an existing override once ANY row in
      // the same for_month batch does carry one. Send the anchor proration value
      // when there is one, otherwise write the row's EXISTING value straight back
      // (a no-op that preserves it). Production has active tenants whose bill
      // legitimately carries an override (e.g. re-activated after checkout).
      const preservedOverride =
        existing.base_rent_override != null ? Number(existing.base_rent_override) : null;
      pendingUpdate.base_rent_override = baseRentOverride !== null ? baseRentOverride : preservedOverride;
      pendingUpdates.push(pendingUpdate);
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

  if (deleteJoinMonthIds.length > 0) {
    // Guarded again on status + amount_paid at the DB level so a row that was
    // collected between the read and here is never deleted.
    const { error: deleteErr } = await admin
      .from("hms_payments")
      .delete()
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .in("tenant_id", deleteJoinMonthIds)
      .eq("status", "pending")
      .lte("amount_paid", 0.009);
    if (deleteErr) throw new Error(deleteErr.message);
  }

  return { created: newRows.length, updated: pendingUpdates.length };
}
