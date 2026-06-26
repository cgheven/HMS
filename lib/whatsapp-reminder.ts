import type { PaymentMethodAccount } from "@/types";

export const DEFAULT_REMINDER_TEMPLATE = `Assalam o Alaikum {name},

Friendly reminder — your rent of {amount} for {month} is still pending.{ac}

{accounts}

Please pay at your earliest convenience.

— {hostel}`;

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
  if (units && rate) parts.push(`${units} units × Rs ${rate}/unit`);
  parts.push(`*Rs ${new Intl.NumberFormat("en-PK").format(Math.round(charge))}*`);
  return "⚡ AC: " + parts.join(" = ");
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
}

export function buildReminderMessage(args: BuildArgs): string {
  const tpl = args.template?.trim() || DEFAULT_REMINDER_TEMPLATE;
  const firstName = args.tenantName.split(" ")[0];
  const amountStr = `*Rs ${new Intl.NumberFormat("en-PK").format(Math.round(args.amount))}*`;
  const accountsBlock = formatAccounts(args.accounts);
  const acLine = formatACLine(args.ac_units, args.ac_charge, args.ac_rate);
  const acBlock = acLine ? "\n" + acLine : "";
  return tpl
    .replace(/\{name\}/g,     firstName)
    .replace(/\{amount\}/g,   amountStr)
    .replace(/\{month\}/g,    args.month)
    .replace(/\{hostel\}/g,   args.hostelName)
    .replace(/\{accounts\}/g, accountsBlock)
    .replace(/\{ac\}/g,       acBlock);
}
