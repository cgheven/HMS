import type { MonthSlot } from "@/lib/report-math";

/** Tiers whose price includes meals. `space_only` is the only one that doesn't. */
const FOOD_TIERS = new Set(["space_food", "space_3meals", "space_food_ac", "space_meals_cooler"]);

/**
 * A tenant on a custom package is stored as `package_tier = 'space_only'` with a
 * `custom_package_id`, so the tier says nothing about whether they eat — the
 * package does. `includes_food` is set per package in Settings and seeded once
 * by migration 205; nothing infers it at read time, so renaming a package can
 * never move the meal numbers.
 */
export interface CustomPackage {
  id: string;
  name: string;
  /** Absent only on rows written before migration 205, which treats absent as
   *  not-food rather than guessing — an unset flag is a question for the owner,
   *  not something to answer on their behalf. */
  includes_food?: boolean;
  ac?: unknown;
  no_ac?: unknown;
}

export type PackagePrices = Record<string, unknown> & { _custom?: CustomPackage[] };

export interface UnitCostTenant {
  id: string;
  full_name: string;
  check_in: string;
  check_out: string | null;
  is_active: boolean;
  package_tier: string | null;
  custom_package_id: string | null;
  room_has_ac: boolean;
}

/** Custom packages the owner has marked as including meals. */
export function mealCustomPackages(prices: PackagePrices | null | undefined): CustomPackage[] {
  const custom = Array.isArray(prices?._custom) ? (prices._custom as CustomPackage[]) : [];
  return custom.filter((p) => p?.includes_food === true);
}

/** Custom packages with no `includes_food` either way — they predate migration
 *  205 or were written by an older client, and are being counted as not-food
 *  until someone says otherwise. Surfaced so that choice is visible. */
export function unclassifiedCustomPackages(prices: PackagePrices | null | undefined): CustomPackage[] {
  const custom = Array.isArray(prices?._custom) ? (prices._custom as CustomPackage[]) : [];
  return custom.filter((p) => typeof p?.includes_food !== "boolean");
}

export function isMealSubscriber(t: UnitCostTenant, mealCustomIds: Set<string>): boolean {
  if (t.custom_package_id) return mealCustomIds.has(t.custom_package_id);
  return FOOD_TIERS.has(t.package_tier ?? "");
}

/**
 * How much of `slot` this tenant was resident for, 0..1.
 *
 * Head count is measured in tenant-months, not people, because check-ins and
 * check-outs cluster at month boundaries — exactly where a head count lies
 * hardest. A branch that turns over half its beds mid-month has a real cost
 * base well below its end-of-month roster.
 */
export function residentFraction(t: UnitCostTenant, slot: MonthSlot): number {
  const start = t.check_in > slot.start ? t.check_in : slot.start;
  const end = t.check_out && t.check_out < slot.end ? t.check_out : slot.end;
  if (start > end) return 0;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  const slotDays =
    (Date.parse(`${slot.end}T00:00:00Z`) - Date.parse(`${slot.start}T00:00:00Z`)) / 86_400_000 + 1;
  if (!Number.isFinite(days) || !Number.isFinite(slotDays) || slotDays <= 0) return 0;
  return Math.min(1, Math.max(0, days / slotDays));
}

export interface PayrollEmployee {
  role: string;
  monthly_salary: unknown;
  join_date: string;
  status: string;
}

/**
 * What the payroll COSTS for a period, taken from the roster rather than from
 * recorded salary payments.
 *
 * A branch with seven staff on the books costs their salaries whether or not
 * anyone has clicked "paid" yet — making the cost depend on that click meant
 * seven of fifteen production branches reported a staff cost of zero while
 * carrying a real payroll. Recorded payments still drive the cash-out figures
 * on the Expenses tab; this answers the other question.
 *
 * Prorated by join date so a hire on the 25th costs six days, not a month, and
 * so a future-dated joiner costs nothing yet.
 */
export function payrollAccrued(
  employees: PayrollEmployee[],
  months: MonthSlot[],
  predicate?: (e: PayrollEmployee) => boolean
): number {
  let total = 0;
  for (const e of employees) {
    if (e.status !== "active") continue;
    if (predicate && !predicate(e)) continue;
    const salary = Number(e.monthly_salary ?? 0) || 0;
    if (salary <= 0) continue;
    for (const slot of months) {
      const start = e.join_date > slot.start ? e.join_date : slot.start;
      if (start > slot.end) continue;
      const days = (Date.parse(`${slot.end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
      const slotDays =
        (Date.parse(`${slot.end}T00:00:00Z`) - Date.parse(`${slot.start}T00:00:00Z`)) / 86_400_000 + 1;
      if (!Number.isFinite(days) || slotDays <= 0) continue;
      total += salary * Math.min(1, Math.max(0, days / slotDays));
    }
  }
  return total;
}

export function sumTenantMonths(
  tenants: UnitCostTenant[],
  months: MonthSlot[],
  predicate?: (t: UnitCostTenant) => boolean
): number {
  let total = 0;
  for (const t of tenants) {
    if (predicate && !predicate(t)) continue;
    for (const slot of months) total += residentFraction(t, slot);
  }
  return total;
}

function priceOf(prices: PackagePrices | null | undefined, tier: string, ac: boolean): number {
  const block = prices?.[tier] as { ac?: unknown; no_ac?: unknown } | undefined;
  if (!block || typeof block !== "object") return 0;
  return Number((ac ? block.ac : block.no_ac) ?? 0) || 0;
}

export type FoodPriceBasis = "billed" | "configured" | "derived" | "unknown";

/**
 * What one subscriber's meals are worth per month, and how confident that is.
 *
 * Four branches in descending order of trust, because the answer is only as
 * good as its source and the UI has to be able to say which one it used:
 *   billed     — a real `food_charge` on this tenant's payments. Rajput only.
 *   configured — `hms_package_configs.food_monthly_rate`, what the trigger uses.
 *   derived    — tier price minus space_only price at the same AC/no-AC slot.
 *   unknown    — Ms National: food bundled into rent, `package_prices` all zero.
 */
export function foodPricePerMonth(
  t: UnitCostTenant,
  prices: PackagePrices | null | undefined,
  foodMonthlyRate: number,
  /** Already averaged per month by the caller, so every branch here returns the
   *  same unit and the caller never has to special-case one of them. */
  billedPerMonth: number | null
): { amount: number; basis: FoodPriceBasis } {
  if (billedPerMonth !== null && billedPerMonth > 0) {
    return { amount: billedPerMonth, basis: "billed" };
  }
  if (foodMonthlyRate > 0) return { amount: foodMonthlyRate, basis: "configured" };

  const ac = t.room_has_ac;
  const baseline = priceOf(prices, "space_only", ac) || priceOf(prices, "space_only", !ac);
  let full = 0;
  if (t.custom_package_id) {
    const pkg = (Array.isArray(prices?._custom) ? (prices._custom as CustomPackage[]) : []).find(
      (p) => p.id === t.custom_package_id
    );
    full = Number((ac ? pkg?.ac : pkg?.no_ac) ?? 0) || Number((ac ? pkg?.no_ac : pkg?.ac) ?? 0) || 0;
  } else {
    const tier = t.package_tier ?? "";
    full = priceOf(prices, tier, ac) || priceOf(prices, tier, !ac);
  }
  const premium = full - baseline;
  if (full > 0 && baseline > 0 && premium > 0) return { amount: premium, basis: "derived" };
  return { amount: 0, basis: "unknown" };
}

export interface KitchenGroupBranch {
  hostelId: string;
  name: string;
  isHost: boolean;
  isCurrent: boolean;
  subscriberMonths: number;
  /** Cooks on the payroll here. A branch with subscribers and no cook is being
   *  fed from somewhere else — the tell that a kitchen group is missing. */
  cooks: number;
  groceries: number;
  cookSalaries: number;
}

export interface MealCostResult {
  mode: "self" | "shared";
  branches: KitchenGroupBranch[];
  groceries: number;
  cookSalaries: number;
  kitchenCost: number;
  groupSubscriberMonths: number;
  subscriberMonths: number;
  /** This branch's share of the group pot. 1 when self-catered. */
  sharePercent: number;
  allocatedCost: number;
  costPerSubscriber: number;
  foodRevenue: number;
  revenuePerSubscriber: number;
  marginPerSubscriber: number;
  /** Subscriber-months whose food price could not be established at all. The
   *  revenue figure is a floor while this is above zero, never a total. */
  unpricedSubscriberMonths: number;
  priceBasis: FoodPriceBasis;
}

/**
 * Allocate the group's kitchen cost across its branches by subscriber-months.
 *
 * This is an ALLOCATION, not a measurement. Nobody weighs the food leaving the
 * kitchen, so no arithmetic here can be exact; subscriber-days is simply the
 * least-arbitrary driver available from data the app already holds. Anything
 * built on top of it must be labelled as an estimate.
 */
export function allocateMealCost(
  branches: KitchenGroupBranch[],
  currentHostelId: string,
  foodRevenue: number,
  unpricedSubscriberMonths: number,
  priceBasis: FoodPriceBasis
): MealCostResult {
  const groceries = branches.reduce((s, b) => s + b.groceries, 0);
  const cookSalaries = branches.reduce((s, b) => s + b.cookSalaries, 0);
  const kitchenCost = groceries + cookSalaries;
  const groupSubscriberMonths = branches.reduce((s, b) => s + b.subscriberMonths, 0);
  const mine = branches.find((b) => b.hostelId === currentHostelId)?.subscriberMonths ?? 0;

  // A group with no subscribers anywhere allocates nothing rather than dividing
  // by zero and reporting Infinity as a cost.
  const sharePercent = groupSubscriberMonths > 0 ? mine / groupSubscriberMonths : 0;
  const allocatedCost = kitchenCost * sharePercent;
  const costPerSubscriber = mine > 0 ? allocatedCost / mine : 0;
  const revenuePerSubscriber = mine > 0 ? foodRevenue / mine : 0;

  return {
    mode: branches.length > 1 ? "shared" : "self",
    branches,
    groceries,
    cookSalaries,
    kitchenCost,
    groupSubscriberMonths,
    subscriberMonths: mine,
    sharePercent,
    allocatedCost,
    costPerSubscriber,
    foodRevenue,
    revenuePerSubscriber,
    marginPerSubscriber: revenuePerSubscriber - costPerSubscriber,
    unpricedSubscriberMonths,
    priceBasis,
  };
}
