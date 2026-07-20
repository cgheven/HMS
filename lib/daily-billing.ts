// Single source of truth for day counting on daily-billed tenants.
//
// CONVENTION: a billed day is a NIGHT SLEPT. The check-out day is not billed —
// the tenant vacates that morning. But a stay that continues past this month is
// billed to month-end INCLUSIVE, because they sleep every remaining night of it.
// So: clamp the stay to the month, then drop the final day ONLY when the real
// check_out lands inside (or on the last day of) the month being billed.
//
// Worked examples — July 2026 (31 days), daily_rate 500:
//   check_in 2026-07-20, check_out 2026-07-31  -> 11 days (20..30)  Rs 5,500
//   check_in 2026-07-20, check_out null        -> 12 days (20..31)  Rs 6,000
//   check_in 2026-07-20, check_out 2026-09-05  -> 12 days (20..31)  Rs 6,000
//   check_in 2026-06-15, check_out 2026-07-10  ->  9 days (1..9)    Rs 4,500
//   check_in 2026-06-15, check_out null        -> 31 days (all)     Rs 15,500
//   stay does not intersect the month          ->  0 days           Rs 0
//
// Dates are parsed as LOCAL midnight, never `new Date("YYYY-MM-DD")` — that is
// UTC midnight, i.e. 05:00 PKT, and shifts every boundary by five hours.

const MS_PER_DAY = 86_400_000;

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function countBillableNights(opts: {
  checkIn: string;
  checkOut: string | null;
  month: string;
}): number {
  const { checkIn, checkOut, month } = opts;
  if (!checkIn || !month) return 0;

  const [y, m] = month.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;

  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);

  const inDate = parseLocalDate(checkIn);
  const outDate = checkOut ? parseLocalDate(checkOut) : null;

  // No intersection at all.
  if (inDate > monthEnd) return 0;
  if (outDate && outDate <= monthStart) return 0;

  const start = inDate > monthStart ? inDate : monthStart;

  // The stay ends within this month: the check-out day itself is not billed,
  // so the span is exclusive of `outDate`.
  if (outDate && outDate <= monthEnd) {
    return Math.max(0, Math.round((outDate.getTime() - start.getTime()) / MS_PER_DAY));
  }

  // Still staying (or leaving in a later month): every night of the remaining
  // month is slept, so month-end is inclusive.
  return Math.max(0, Math.round((monthEnd.getTime() - start.getTime()) / MS_PER_DAY) + 1);
}

export function calcDailyRent(opts: {
  checkIn: string;
  checkOut: string | null;
  month: string;
  dailyRate: number;
}): number {
  const nights = countBillableNights(opts);
  return Math.round(nights * Number(opts.dailyRate || 0));
}

// RULE 2 — optional pro-rating of a MONTHLY tenant at checkout. Never applied
// automatically: the owner opts in from the checkout dialog. Base rent only —
// food, AC and deposit charges are not pro-rated.
export function proRateMonthlyRent(opts: {
  monthlyRent: number;
  checkIn: string;
  checkOut: string;
  month: string;
}): number {
  const { monthlyRent, checkIn, checkOut, month } = opts;
  const total = daysInMonth(month);
  if (!total) return 0;
  const nights = countBillableNights({ checkIn, checkOut, month });
  return Math.round((Number(monthlyRent || 0) / total) * nights);
}
