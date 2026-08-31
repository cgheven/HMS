// Shared billing-calculation primitives for hms_payments rows — used by the
// payment Server Actions (app/actions/payments.ts) AND the monthly payment
// row sync (lib/monthly-payment-sync.ts) so both paths compute rent/deposit
// identically instead of drifting apart.

import { calcDailyRent, countBillableNights } from "@/lib/daily-billing";

export const VALID_TIERS = new Set<string>([
  "space_only", "space_food", "space_3meals", "space_food_ac", "space_meals_cooler",
]);

export type BaseRentTenant = {
  billing_type: string;
  monthly_rent: number;
  daily_rate: number;
  check_in: string;
  check_out: string | null;
};

// The only place base rent is derived on the server. Monthly tenants bill the
// flat monthly_rent, untouched. Daily tenants defer entirely to
// lib/daily-billing.ts, which owns the nights convention (the check-out day
// is not billed; a stay continuing past month-end bills the month inclusive)
// and parses dates as local midnight rather than UTC.
export function calcBaseRentServer(t: BaseRentTenant, month: string): number {
  if (t.billing_type !== "daily") return Number(t.monthly_rent);
  return calcDailyRent({
    checkIn: t.check_in,
    checkOut: t.check_out,
    month,
    dailyRate: Number(t.daily_rate),
  });
}

// Day snapshot for hms_payments (migration 099). Daily rows record the nights
// billed and the rate at the time; monthly rows explicitly record null/null so
// nothing downstream mistakes a monthly row for a daily one.
export function dailySnapshot(t: BaseRentTenant, month: string): {
  billed_days: number | null;
  daily_rate_billed: number | null;
} {
  if (t.billing_type !== "daily") return { billed_days: null, daily_rate_billed: null };
  return {
    billed_days: countBillableNights({ checkIn: t.check_in, checkOut: t.check_out, month }),
    daily_rate_billed: Number(t.daily_rate),
  };
}

// The security deposit is billed once, on the tenant's first billing month
// only — every later month is rent + food + AC as before.
//
// What the first month bills is the REMAINDER. A tenant whose agreed deposit is
// Rs 10,000 who put Rs 5,000 down to reserve the bed is billed the other
// Rs 5,000 on that first bill, alongside rent. Treating the collection as a
// boolean ("deposit done") wrote the shortfall off entirely while checkout still
// refunded the full Rs 10,000 from hms_tenants.security_deposit.
//
// deposit_collected_amount is REQUIRED, not optional: a caller whose SELECT
// omits it reads undefined, computes NaN, and poisons the whole bill. Making it
// a required key turns that into a compile error. It is 0 for every tenant who
// has never reserved, which reduces this to exactly the previous expression.
export function computeDepositCharge(
  t: { check_in: string; security_deposit?: number | null; deposit_collected_amount: number | null },
  forMonth: string
): number {
  const isFirstBillingMonth = t.check_in && t.check_in.slice(0, 7) === forMonth;
  if (!isFirstBillingMonth) return 0;
  return Math.max(0, Number(t.security_deposit ?? 0) - Number(t.deposit_collected_amount ?? 0));
}

// One-time, non-refundable — billed only in the tenant's check-in month, same
// timing rule as computeDepositCharge. Trusted as-is by the DB recalculation
// trigger (hms_recalculate_payment_amount), which does NOT re-derive it.
export function computeRegistrationFeeCharge(
  t: { check_in: string; registration_fee?: number | null },
  forMonth: string
): number {
  const isFirstBillingMonth = t.check_in && t.check_in.slice(0, 7) === forMonth;
  return isFirstBillingMonth ? Number(t.registration_fee ?? 0) : 0;
}

// Recurring monthly flat charge, independent of package tier — applies for as
// long as the tenant occupies a room with has_ac = true. Unlike the deposit/
// registration fee, this is a pure function of current state (no timing
// decision), so the DB trigger re-derives it fresh on every write — this
// helper exists purely so the app layer's own amount previews/sums agree with
// the trigger's outcome ahead of the round trip.
export function computeAcMaintenanceCharge(
  roomHasAc: boolean | null | undefined,
  rate: number | null | undefined,
  /** hms_tenants.ac_maintenance. NULL = no override, use the branch rate; a
   *  number = this tenant's own rate; 0 = opted out. Must mirror the CASE in
   *  hms_recalculate_payment_amount exactly — for daily-billed tenants the
   *  trigger derives base rent by SUBTRACTING this from the app's amount, so a
   *  disagreement between the two would silently mis-price the rent. */
  tenantOverride?: number | null
): number {
  if (!roomHasAc) return 0;
  return tenantOverride !== null && tenantOverride !== undefined
    ? Number(tenantOverride)
    : Number(rate ?? 0);
}

// A tenant's personal "rent due" day-of-month is just the day they checked
// in — 20 tenants in one hostel can each have a different one, so the
// auto-reminder cron anchors off this instead of a single hostel-wide day.
// Capped to the target month's actual last day, so a tenant who joined on the
// 31st still gets reminded once in a 30/28-day month instead of never.
// A saved row's `amount` is the sum of every charge on it, so rent is what is
// left once the named charges are taken back out. Rent is never stored — the
// migration-133 trigger rebuilds `amount` from the parts on every write, and
// only the parts are columns.
//
// Shared because this subtraction was already written out twice (the Mark Paid
// dialog and the receipt PDF) and was about to be written a third time for the
// payments table. Three hand-kept copies of one formula is exactly how the AC
// segment math drifted into billing two different answers for the same room.
export function splitPaymentCharges(p: {
  amount: number;
  food_charge?: number | null;
  ac_charge?: number | null;
  security_deposit_charge?: number | null;
  registration_fee_charge?: number | null;
  ac_maintenance_charge?: number | null;
  referral_discount?: number | null;
  discount_amount?: number | null;
}): {
  /** GROSS rent — what the tenant's rent actually is, before the referral
   *  discount and before the standing/manual rent discount. Both are added back
   *  because `amount` is stored net of them;
   *  without that, every screen that itemises a discounted bill would show a
   *  rent lower than the agreed rent and the line items would not sum to the
   *  total. Every caller wants gross here: the receipt prints rent and the
   *  discount as separate lines, and reports attribute the reduction to the
   *  discount rather than silently shrinking rent revenue. */
  rent: number;
  food: number;
  ac: number;
  deposit: number;
  registrationFee: number;
  acMaintenance: number;
  referralDiscount: number;
  /** The manual/standing rent discount (migration 211) in rupees. Same posture
   *  as referralDiscount: `amount` is stored net of it, so it is added back into
   *  `rent` above and belongs on screen as its own negative line. */
  discount: number;
  /** Everything that is neither rent nor metered AC — food, deposit, reg fee, AC maintenance. */
  otherCharges: number;
} {
  const food = Math.max(0, Number(p.food_charge ?? 0));
  const ac = Math.max(0, Number(p.ac_charge ?? 0));
  const deposit = Math.max(0, Number(p.security_deposit_charge ?? 0));
  const registrationFee = Math.max(0, Number(p.registration_fee_charge ?? 0));
  const acMaintenance = Math.max(0, Number(p.ac_maintenance_charge ?? 0));
  const referralDiscount = Math.max(0, Number(p.referral_discount ?? 0));
  const discount = Math.max(0, Number(p.discount_amount ?? 0));
  const rent = Math.max(
    0,
    Number(p.amount ?? 0) + referralDiscount + discount
      - food - ac - deposit - registrationFee - acMaintenance
  );
  return {
    rent, food, ac, deposit, registrationFee, acMaintenance, referralDiscount, discount,
    otherCharges: food + deposit + registrationFee + acMaintenance,
  };
}

/** The row's gross total — what the bill would be with no discount of either
 *  kind. `amount` is stored net, so this is the only correct way to recover gross. */
export function grossAmountOf(p: {
  amount: number;
  referral_discount?: number | null;
  discount_amount?: number | null;
}): number {
  return Number(p.amount ?? 0) + Number(p.referral_discount ?? 0) + Number(p.discount_amount ?? 0);
}

// Mirrors the SQL in hms_recalculate_payment_amount exactly:
//   LEAST(round(v_base_rent * percent / 100.0), GREATEST(v_base_rent, 0))
// The two MUST agree — the app previews this number in the Mark Paid dialog and
// then compares what was collected against what the trigger independently
// computed, so a disagreement shows up as a bill the owner cannot settle.
//
// Clamped to RENT rather than to the bill total: the discount can never eat
// food, metered AC, the deposit, the registration fee or AC maintenance, which
// is what keeps the trigger's negative-amount guard unreachable.
export function computeReferralDiscount(baseRent: number, percent: number): number {
  const rent = Number(baseRent) || 0;
  const pct = Number(percent) || 0;
  if (pct <= 0) return 0;
  return Math.min(Math.round((rent * pct) / 100), Math.max(rent, 0));
}

// Mirrors the second discount block in hms_recalculate_payment_amount exactly:
//   LEAST(round(v_base_rent * pct / 100.0), GREATEST(v_base_rent - v_referral_discount, 0))
// Clamped to the rent the REFERRAL discount has not already taken, so the two
// together can never exceed the rent and never reach food, metered AC, the
// deposit, the registration fee or AC maintenance. The app previews this number
// in the Pay dialog and then settles against it, so a disagreement with the
// trigger shows up as a bill the operator cannot close.
export function computeRentDiscount(baseRent: number, percent: number, referralDiscount = 0): number {
  const rent = Number(baseRent) || 0;
  const pct = Number(percent) || 0;
  if (pct <= 0) return 0;
  return Math.min(
    Math.round((rent * pct) / 100),
    Math.max(rent - (Number(referralDiscount) || 0), 0)
  );
}

/** The tenant's standing discount plus the one-off typed on this bill, clamped
 *  the way the trigger clamps them: each into 0..100, the sum to 100. */
export function combinedDiscountPercent(standing?: number | null, manual?: number | null): number {
  const clamp = (v: unknown) => Math.min(Math.max(Number(v ?? 0) || 0, 0), 100);
  return Math.min(clamp(standing) + clamp(manual), 100);
}

/** What the tenant actually owes: gross components less the referral discount. */
export function netFromBaseRent(
  baseRent: number,
  extras: number,
  percent: number,
  discountPercent = 0
): number {
  const referral = computeReferralDiscount(baseRent, percent);
  // Mirrors the trigger exactly: the rent discount takes what the referral
  // discount left, never more. Defaulting to 0 keeps every existing caller
  // byte-identical.
  const rent = computeRentDiscount(baseRent, discountPercent, referral);
  return baseRent + extras - referral - rent;
}

/**
 * Checkout pro-rating must never re-price a bill BELOW what has already been
 * collected — a row whose amount drops under its amount_paid reads as overpaid,
 * and checkout has no refund path.
 *
 * The naive clamp `max(baseRent + extras, alreadyPaid)` compares a GROSS total
 * against a NET collected figure, so on a discounted bill it clears the
 * comparison while the stored net still lands under amount_paid. This solves in
 * net space instead: find the smallest gross whose net clears what was collected.
 *
 * Returns `clamped` so the caller can warn the operator, and `satisfiable: false`
 * for the degenerate 100%-discount case, where net is `extras` no matter how
 * large the rent is and no gross can ever clear a larger collected amount.
 */
export function clampGrossToCollected(
  baseRent: number,
  extras: number,
  percent: number,
  alreadyPaid: number,
  discountPercent = 0
): { gross: number; clamped: boolean; satisfiable: boolean } {
  const proposedGross = baseRent + extras;
  const net = (g: number) => netFromBaseRent(g - extras, extras, percent, discountPercent);
  if (net(proposedGross) >= alreadyPaid) {
    return { gross: proposedGross, clamped: false, satisfiable: true };
  }

  // Both discounts come off the rent, so together they shrink it by at most
  // their sum — and at 100% the net is `extras` however large the rent grows,
  // which is the one case no gross can ever satisfy.
  const combined = Math.min(percent + discountPercent, 100);
  const denom = 1 - combined / 100;
  if (denom <= 0) {
    return { gross: proposedGross, clamped: true, satisfiable: extras >= alreadyPaid };
  }

  // net() is monotonic non-decreasing in g, so step toward it from the
  // closed-form estimate. Each pass closes the remaining gap divided by the
  // slope; the bound is a guard, not an expectation — it converges in one or two.
  let gross = Math.max(proposedGross, Math.ceil((alreadyPaid - (extras * combined) / 100) / denom));
  for (let i = 0; i < 64 && net(gross) < alreadyPaid; i++) {
    gross += Math.max(1, Math.ceil((alreadyPaid - net(gross)) / denom));
  }
  return { gross, clamped: true, satisfiable: net(gross) >= alreadyPaid };
}

export function tenantDueDay(checkIn: string, forMonth: string): number {
  const checkInDay = Number(checkIn.slice(8, 10));
  const [y, m] = forMonth.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Math.min(checkInDay, daysInMonth);
}

/** Reminders per unpaid bill, per month. Beyond this a tenant reads it as spam,
 *  blocks the number, and every future reminder to them is lost — including the
 *  ones that would have worked. Each message is also billed by Meta. */
export const MAX_REMINDERS_PER_MONTH = 6;

// A single monthly nudge isn't enough collections pressure — once a tenant is
// actually overdue, remind every 3 days instead of waiting for next month's
// anniversary to roll around. Day 0 (the due day itself) always fires, then
// every 3rd day past due: 0, 3, 6, 9, 12, 15 — six in total, then silence for
// the rest of the month. Before the due day arrives, this stays silent too.
//
// The cap matters most for tenants due early in the month: uncapped, someone
// due on the 1st received eleven messages about one bill while someone due on
// the 29th received one, purely because of when they moved in.
export function shouldRemindToday(dueDay: number, todayDayOfMonth: number): boolean {
  const daysPastDue = todayDayOfMonth - dueDay;
  if (daysPastDue < 0) return false;
  if (daysPastDue % 3 !== 0) return false;
  return daysPastDue / 3 < MAX_REMINDERS_PER_MONTH;
}

/**
 * Has money actually been collected against this bill right now?
 *
 * An UNDONE payment leaves the row at status 'partially_paid' with
 * amount_paid = 0. That collected status is deliberate — a 'pending' row is
 * re-priced at today's rates by the pricing trigger and by
 * ensureMonthlyPaymentRows, which would rewrite a historical bill (a Rs 14,366
 * August bill became Rs 21,366 on stage after the tenant's rent rose). But it
 * means `status` is no longer a safe proxy for "money arrived", and every place
 * that treated it as one — receipts, WhatsApp messages, chip counts, the
 * reconciliation breakdown — read a reversed payment as a real one.
 *
 * Use this instead of comparing status wherever the question is about money.
 */
export function hasCollected(p: { amount_paid?: number | string | null }): boolean {
  return Number(p.amount_paid ?? 0) > 0.009;
}

/**
 * The status to SHOW and to COUNT BY, as opposed to the one stored.
 *
 * A partially_paid row holding nothing reads as unpaid to a human, so it is
 * reported as 'pending'. Everything else passes through untouched.
 */
export function effectivePaymentStatus<T extends string>(p: { status: T; amount_paid?: number | string | null }): T {
  return p.status === ("partially_paid" as T) && !hasCollected(p) ? ("pending" as T) : p.status;
}
