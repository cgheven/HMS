import type { PaymentMethodAccount } from "@/types";

export const DEFAULT_REMINDER_TEMPLATE = `Assalam o Alaikum {name},

Friendly reminder - your rent of {amount} for {month} is still pending.{ac}{ac_maintenance}{registration_fee}{referral_discount}{deposit}

{accounts}

Please pay at your earliest convenience.

- {hostel}`;

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

function formatACLine(units?: number, charge?: number, rate?: number): string {
  if (!charge || charge <= 0) return "";
  const parts: string[] = [];
  if (units && rate) parts.push(`${units} units x Rs ${rate}/unit`);
  parts.push(`*Rs ${new Intl.NumberFormat("en-PK").format(Math.round(charge))}*`);
  return "⚡ AC: " + parts.join(" = ");
}

function formatAcMaintenanceLine(charge?: number): string {
  if (!charge || charge <= 0) return "";
  return `🔧 AC Maintenance: *Rs ${new Intl.NumberFormat("en-PK").format(Math.round(charge))}*`;
}

// Shown so a tenant whose bill dropped can see WHY. Deliberately does not name
// the person who referred them — this message can be forwarded to anyone.
function formatReferralDiscountLine(charge?: number): string {
  if (!charge || charge <= 0) return "";
  return `\u{1F381} Referral Discount: *-Rs ${new Intl.NumberFormat("en-PK").format(Math.round(charge))}* (already applied)`;
}

function formatRegistrationFeeLine(charge?: number): string {
  if (!charge || charge <= 0) return "";
  return `📝 Registration Fee: *Rs ${new Intl.NumberFormat("en-PK").format(Math.round(charge))}* (one-time)`;
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
}

export function buildReminderMessage(args: BuildArgs): string {
  const tpl = args.template?.trim() || DEFAULT_REMINDER_TEMPLATE;
  const firstName = args.tenantName.split(" ")[0];
  const amountStr = `*Rs ${new Intl.NumberFormat("en-PK").format(Math.round(args.amount))}*`;
  const accountsBlock = formatAccounts(args.accounts);
  const acLine = formatACLine(args.ac_units, args.ac_charge, args.ac_rate);
  const acBlock = acLine ? "\n" + acLine : "";
  const acMaintenanceLine = formatAcMaintenanceLine(args.ac_maintenance_charge);
  const acMaintenanceBlock = acMaintenanceLine ? "\n" + acMaintenanceLine : "";
  const registrationFeeLine = formatRegistrationFeeLine(args.registration_fee_charge);
  const registrationFeeBlock = registrationFeeLine ? "\n" + registrationFeeLine : "";
  const referralDiscountLine = formatReferralDiscountLine(args.referral_discount);
  const referralDiscountBlock = referralDiscountLine ? "\n" + referralDiscountLine : "";
  const depositBlock = (args.security_deposit && args.security_deposit > 0)
    ? `\n🔒 Security Deposit: *Rs ${new Intl.NumberFormat("en-PK").format(Math.round(args.security_deposit))}* (held)`
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
