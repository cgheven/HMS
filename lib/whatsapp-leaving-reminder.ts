import { getCountryConfig } from "@/lib/country-config";

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
  country?: string | null;
}

export function buildLeavingReminderMessage(args: BuildLeavingReminderArgs): string {
  const cfg = getCountryConfig(args.country);
  const dateStr = new Date(args.checkoutDate + "T00:00:00")
    .toLocaleDateString(cfg.locale, { day: "numeric", month: "long", year: "numeric" });
  // PK keeps "Assalam o Alaikum," (byte-identical); other countries greet "Hi,".
  const tpl = cfg.currency === "PKR"
    ? DEFAULT_LEAVING_REMINDER_TEMPLATE
    : DEFAULT_LEAVING_REMINDER_TEMPLATE.replace(/^Assalam o Alaikum,/, "Hi,");
  return tpl
    .replace(/\{name\}/g,   args.tenantName)
    .replace(/\{room\}/g,   args.room?.trim() || "unassigned")
    .replace(/\{date\}/g,   dateStr)
    .replace(/\{hostel\}/g, args.hostelName);
}
