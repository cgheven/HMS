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
export function computeDepositCharge(
  t: { check_in: string; security_deposit?: number | null },
  forMonth: string
): number {
  const isFirstBillingMonth = t.check_in && t.check_in.slice(0, 7) === forMonth;
  return isFirstBillingMonth ? Number(t.security_deposit ?? 0) : 0;
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
  rate: number | null | undefined
): number {
  return roomHasAc ? Number(rate ?? 0) : 0;
}

// A tenant's personal "rent due" day-of-month is just the day they checked
// in — 20 tenants in one hostel can each have a different one, so the
// auto-reminder cron anchors off this instead of a single hostel-wide day.
// Capped to the target month's actual last day, so a tenant who joined on the
// 31st still gets reminded once in a 30/28-day month instead of never.
export function tenantDueDay(checkIn: string, forMonth: string): number {
  const checkInDay = Number(checkIn.slice(8, 10));
  const [y, m] = forMonth.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Math.min(checkInDay, daysInMonth);
}

// A single monthly nudge isn't enough collections pressure — once a tenant is
// actually overdue, remind every 3 days instead of waiting for next month's
// anniversary to roll around. Day 0 (the due day itself) always fires; after
// that, every 3rd day past due fires again (3, 6, 9, ...) for as long as
// still unpaid. Before the due day arrives, this stays silent.
export function shouldRemindToday(dueDay: number, todayDayOfMonth: number): boolean {
  const daysPastDue = todayDayOfMonth - dueDay;
  if (daysPastDue < 0) return false;
  return daysPastDue % 3 === 0;
}
