import type { PaymentMethodAccount } from "@/types";
import { getCountryConfig, terms } from "@/lib/country-config";

// Currency prefix for the reminder text. PK stays "Rs " (space, no period) exactly
// as before; a glyph currency ($, £, €, ₹) hugs the number, an alphabetic code
// (AED, BDT, …) gets a trailing space so it reads "AED 15,000".
function curPrefix(country?: string | null): string {
  const cfg = getCountryConfig(country);
  if (cfg.currency === "PKR") return "Rs ";
  return /[A-Za-z]$/.test(cfg.currencySymbol) ? `${cfg.currencySymbol} ` : cfg.currencySymbol;
}

// A rounded, grouped amount with its currency prefix, e.g. "Rs 15,000" / "AED 15,000".
// PK uses en-PK grouping (byte-identical to the previous hardcoded formatter).
function money(amount: number, country?: string | null): string {
  const cfg = getCountryConfig(country);
  return `${curPrefix(country)}${new Intl.NumberFormat(cfg.locale).format(Math.round(amount))}`;
}

export const DEFAULT_REMINDER_TEMPLATE = `Assalam o Alaikum {name},

Friendly reminder - your rent of {amount} for {month} is still pending.{ac}{ac_maintenance}{registration_fee}{referral_discount}{deposit}

{accounts}

Please pay at your earliest convenience.

- {hostel}`;

// PK keeps the incumbent "Assalam o Alaikum" greeting (returns the exact same
// constant, byte-identical); every other country greets "Hi".
export function defaultReminderTemplate(country?: string | null): string {
  return (country ?? "PK").toUpperCase() === "PK"
    ? DEFAULT_REMINDER_TEMPLATE
    : DEFAULT_REMINDER_TEMPLATE.replace(/^Assalam o Alaikum /, "Hi ");
}

export function formatAccounts(methods: PaymentMethodAccount[]): string {
  if (!methods || methods.length === 0) return "";
  const blocks: string[] = [];
  for (const m of methods) {
    const lines: string[] = [];
    if (m.label)          lines.push(`*Bank:* ${m.label}`);
    if (m.account_title)  lines.push(`*Title:* ${m.account_title}`);
    if (m.account_number) lines.push(`*Account:* ${m.account_number}`);
    if (m.iban)           lines.push(`*IBAN:* ${m.iban}`);
    if (lines.length) blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

function formatACLine(units?: number, charge?: number, rate?: number, country?: string | null): string {
  if (!charge || charge <= 0) return "";
  const parts: string[] = [];
  if (units && rate) parts.push(`${units} units x ${curPrefix(country)}${rate}/unit`);
  parts.push(`*${money(charge, country)}*`);
  return `⚡ ${terms(country).acShort}: ` + parts.join(" = ");
}

function formatAcMaintenanceLine(charge?: number, country?: string | null): string {
  if (!charge || charge <= 0) return "";
  return `🔧 ${terms(country).acMaintenance}: *${money(charge, country)}*`;
}

// Shown so a tenant whose bill dropped can see WHY. Deliberately does not name
// the person who referred them — this message can be forwarded to anyone.
function formatReferralDiscountLine(charge?: number, country?: string | null): string {
  if (!charge || charge <= 0) return "";
  return `\u{1F381} Referral Discount: *-${money(charge, country)}* (already applied)`;
}

function formatRegistrationFeeLine(charge?: number, country?: string | null): string {
  if (!charge || charge <= 0) return "";
  return `📝 Registration Fee: *${money(charge, country)}* (one-time)`;
}

interface BuildArgs {
  template?: string | null;
  tenantName: string;
  amount: number;
  month: string;
  hostelName: string;
  accounts: PaymentMethodAccount[];
  ac_units?: number;
  ac_charge?: number;
  ac_rate?: number;
  security_deposit?: number;
  ac_maintenance_charge?: number;
  registration_fee_charge?: number;
  referral_discount?: number;
  country?: string | null;
}

export function buildReminderMessage(args: BuildArgs): string {
  const tpl = args.template?.trim() || defaultReminderTemplate(args.country);
  const firstName = args.tenantName.split(" ")[0];
  const amountStr = `*${money(args.amount, args.country)}*`;
  const accountsBlock = formatAccounts(args.accounts);
  const acLine = formatACLine(args.ac_units, args.ac_charge, args.ac_rate, args.country);
  const acBlock = acLine ? "\n" + acLine : "";
  const acMaintenanceLine = formatAcMaintenanceLine(args.ac_maintenance_charge, args.country);
  const acMaintenanceBlock = acMaintenanceLine ? "\n" + acMaintenanceLine : "";
  const registrationFeeLine = formatRegistrationFeeLine(args.registration_fee_charge, args.country);
  const registrationFeeBlock = registrationFeeLine ? "\n" + registrationFeeLine : "";
  const referralDiscountLine = formatReferralDiscountLine(args.referral_discount, args.country);
  const referralDiscountBlock = referralDiscountLine ? "\n" + referralDiscountLine : "";
  const depositBlock = (args.security_deposit && args.security_deposit > 0)
    ? `\n🔒 Security Deposit: *${money(args.security_deposit, args.country)}* (held)`
    : "";
  return tpl
    .replace(/\{name\}/g,     firstName)
    .replace(/\{amount\}/g,   amountStr)
    .replace(/\{month\}/g,    args.month)
    .replace(/\{hostel\}/g,   args.hostelName)
    .replace(/\{accounts\}/g, accountsBlock)
    .replace(/\{referral_discount\}/g, referralDiscountBlock)
    .replace(/\{ac\}/g,       acBlock)
    .replace(/\{ac_maintenance\}/g,   acMaintenanceBlock)
    .replace(/\{registration_fee\}/g, registrationFeeBlock)
    .replace(/\{deposit\}/g,  depositBlock);
}
