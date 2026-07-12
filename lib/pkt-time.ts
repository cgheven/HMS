export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// Pakistan is a fixed UTC+5 offset (no DST) — returns "today" in PKT as a
// YYYY-MM-DD string, safe to compare directly against DATE columns like
// hms_platform_leads.next_follow_up_date.
export function pktTodayDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}
