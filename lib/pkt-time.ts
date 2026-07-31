export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// Pakistan is a fixed UTC+5 offset (no DST) — returns "today" in PKT as a
// YYYY-MM-DD string, safe to compare directly against DATE columns like
// hms_platform_leads.next_follow_up_date.
export function pktTodayDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

// Same fixed-offset technique as pktTodayDateString, but returns the
// calendar year/month (month 1-indexed, e.g. 7 = July) instead of a full
// date string — for any server-side code that needs to know "what month is
// it, in Pakistan" without caring which OS timezone the process itself
// happens to be running in (Vercel's serverless functions default to UTC;
// a developer's own machine is whatever it's set to — both must agree with
// what a Pakistan-based hostel owner considers "this month").
export function pktYearMonth(now: Date = new Date()): { year: number; month: number } {
  const [year, month] = pktTodayDateString(now).slice(0, 7).split("-").map(Number);
  return { year, month };
}
