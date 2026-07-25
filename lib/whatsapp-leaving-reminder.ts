export const DEFAULT_LEAVING_REMINDER_TEMPLATE = `Assalam o Alaikum,

This is a reminder that {name} (Room {room}) has given notice and is scheduled to check out on {date} — 7 days from today.

Please arrange to:
• Prepare the room for the next tenant
• Review and process their security deposit refund

— {hostel}`;

interface BuildLeavingReminderArgs {
  tenantName: string;
  room?: string | null;
  checkoutDate: string;
  hostelName: string;
}

export function buildLeavingReminderMessage(args: BuildLeavingReminderArgs): string {
  const dateStr = new Date(args.checkoutDate + "T00:00:00")
    .toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
  return DEFAULT_LEAVING_REMINDER_TEMPLATE
    .replace(/\{name\}/g,   args.tenantName)
    .replace(/\{room\}/g,   args.room?.trim() || "unassigned")
    .replace(/\{date\}/g,   dateStr)
    .replace(/\{hostel\}/g, args.hostelName);
}
