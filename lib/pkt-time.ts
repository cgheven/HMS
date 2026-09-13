// "Today" and "this month" resolved in a specific IANA time zone, as a
// YYYY-MM-DD string / calendar year+month — safe to compare directly against
// DATE columns and to decide billing months, due days, etc. regardless of the
// server's own OS timezone (Vercel serverless defaults to UTC).
//
// Multi-country: the anchor zone is the HOSTEL's, resolved via
// getCountryConfig(hostel.country).timezone. Zones with daylight saving (e.g.
// Europe/London) are handled correctly because the date parts are formatted by
// Intl in the target zone — NOT by adding a fixed millisecond offset, which is
// only valid for a no-DST zone like Asia/Karachi.
export const DEFAULT_TIMEZONE = "Asia/Karachi";

// Pakistan-only legacy constant: still used by app/actions/leads.ts (Pulse's own
// PK sales buckets). Do NOT reuse for another country — a fixed offset is wrong
// for any zone with DST. Kept for that single PK-platform call site.
export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// en-CA renders as YYYY-MM-DD; formatting in `timeZone` gives that zone's local
// calendar date. For Asia/Karachi (constant UTC+5, no DST) this is identical to
// the old fixed-offset technique — every existing PK call site is a no-op.
export function todayInZone(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function yearMonthInZone(
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): { year: number; month: number } {
  const [year, month] = todayInZone(timeZone, now).slice(0, 7).split("-").map(Number);
  return { year, month };
}

// Back-compat wrappers pinned to Pakistan. Existing callers keep working
// byte-for-byte; new multi-country code should call todayInZone/yearMonthInZone
// with the hostel's timezone (or pass Asia/Karachi explicitly for Pulse-platform
// logic that intentionally stays on PK time).
export function pktTodayDateString(now: Date = new Date()): string {
  return todayInZone(DEFAULT_TIMEZONE, now);
}

export function pktYearMonth(now: Date = new Date()): { year: number; month: number } {
  return yearMonthInZone(DEFAULT_TIMEZONE, now);
}
