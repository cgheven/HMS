import type { WifiNetwork, MealTimes } from "@/types";

export const DEFAULT_WELCOME_TEMPLATE = `Assalam o Alaikum {name},

welcome to {hostel}!

You have been allotted {room}.{wifi}{menu}{meal_times}

For any queries contact hostel management.

We hope you enjoy your stay.`;

function formatMealTimesBlock(mealTimes?: MealTimes | null): string {
  const rows: [string, MealTimes["breakfast"]][] = [
    ["Breakfast", mealTimes?.breakfast],
    ["Lunch", mealTimes?.lunch],
    ["Dinner", mealTimes?.dinner],
  ];
  const lines = rows
    .filter(([, r]) => r?.from?.trim() && r?.to?.trim())
    .map(([label, r]) => `*${label}:* ${r!.from.trim()} - ${r!.to.trim()}`);
  return lines.length ? "\n\n" + lines.join("\n") : "";
}

function formatWifiBlock(networks: WifiNetwork[]): string {
  const named = (networks ?? []).filter((n) => n.name?.trim());
  if (!named.length) return "";
  const blocks = named.map((n) => {
    const lines = [`Name: ${n.name}`];
    if (n.password?.trim()) lines.push(`Password: ${n.password}`);
    return lines.join("\n");
  });
  const header = blocks.length > 1 ? "*Internet Connections:*" : "*Internet Connection:*";
  return "\n\n" + header + "\n" + blocks.join("\n\n");
}

interface BuildWelcomeArgs {
  template?: string | null;
  tenantName: string;
  hostelName: string;
  room?: string | null;
  wifiNetworks: WifiNetwork[];
  menuUrl?: string | null;
  mealTimes?: MealTimes | null;
}

export function buildWelcomeMessage(args: BuildWelcomeArgs): string {
  const tpl = args.template?.trim() || DEFAULT_WELCOME_TEMPLATE;
  const firstName = args.tenantName.split(" ")[0];
  return tpl
    .replace(/\{name\}/g,       firstName)
    .replace(/\{hostel\}/g,     args.hostelName)
    .replace(/\{room\}/g,       args.room?.trim() ? `Room ${args.room.trim()}` : "a room")
    .replace(/\{wifi\}/g,       formatWifiBlock(args.wifiNetworks))
    .replace(/\{menu\}/g,       args.menuUrl ? `\n\n*Monthly food menu:* ${args.menuUrl}` : "")
    .replace(/\{meal_times\}/g, formatMealTimesBlock(args.mealTimes));
}
