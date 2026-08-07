import { formatMonthLong } from "@/lib/utils";
import type { PaymentMethodAccount } from "@/types";

/**
 * Approved Meta message templates and the parameters they take.
 *
 * Automated sends MUST use a template. Free-form text only reaches a number
 * that messaged the business in the last 24 hours, which is never true of a
 * tenant being chased for rent — Meta rejects those with error 131047. The
 * per-hostel `reminder_template` wording therefore cannot apply to automated
 * sends: Meta approves one fixed body and only the values vary. That wording
 * still drives the manual wa.me button, which is free-form.
 *
 * Names and language codes must match WhatsApp Manager exactly. Verified live
 * against the WABA: both are APPROVED in "en" (not en_US — they differ).
 */
export const TEMPLATES = {
  reminderFull: { name: "hms_payment_reminder_full", language: "en" },
  reminderPartial: { name: "hms_payment_reminder_partial", language: "en" },
  paymentConfirmed: { name: "hms_payment_confirmed", language: "en" },
} as const;

const pkr = (n: number) => new Intl.NumberFormat("en-PK").format(Math.round(n));

/** First name only — the templates greet informally, and a full legal name
 *  reads like a bank letter rather than a message from your hostel. */
function firstName(full: string | null | undefined): string {
  const n = (full ?? "").trim().split(/\s+/)[0];
  return n || "there";
}

/**
 * Bank details on ONE line. Meta rejects a parameter containing a line break,
 * so the multi-line block used elsewhere cannot be reused here.
 *
 * Only the first account: a tenant needs one place to send money, and every
 * client has one configured except Chohan Executive, which has two.
 */
export function primaryAccountLine(methods: PaymentMethodAccount[] | null | undefined): string {
  const m = (methods ?? [])[0];
  if (!m) return "";
  const parts = [m.label, m.account_title, m.account_number || m.iban].filter(
    (p): p is string => !!p && p.trim() !== ""
  );
  return parts.join(" - ").replace(/\s+/g, " ").trim();
}

/** Every parameter must be a non-empty single-line string or Meta rejects the
 *  send outright — so this is the last gate before the API call. */
function clean(value: string, fallback: string): string {
  const v = value.replace(/\s+/g, " ").trim();
  return v === "" ? fallback : v;
}

export interface ReminderParamArgs {
  tenantName: string | null | undefined;
  /** Outstanding balance, not the original bill. */
  amountDue: number;
  /** "2026-07" as stored on hms_payments. */
  forMonth: string;
  hostelName: string | null | undefined;
  accounts: PaymentMethodAccount[] | null | undefined;
}

/**
 * hms_payment_reminder_full — {{1}}..{{5}} in order:
 *   1 name · 2 amount · 3 month · 4 hostel · 5 bank account
 * The template supplies "Rs." itself, so the amount is the bare number.
 */
export function reminderFullParams(a: ReminderParamArgs): string[] {
  return [
    clean(firstName(a.tenantName), "there"),
    clean(pkr(a.amountDue), "0"),
    clean(formatMonthLong(a.forMonth), a.forMonth),
    clean(a.hostelName ?? "", "your hostel"),
    // No accounts configured would otherwise send an empty parameter and fail
    // the whole message; telling the tenant to ask is better than not arriving.
    clean(primaryAccountLine(a.accounts), "Please contact hostel management for account details"),
  ];
}

export interface PartialReminderParamArgs extends ReminderParamArgs {
  /** Already handed over — the whole reason this template exists. */
  amountPaid: number;
}

/**
 * hms_payment_reminder_partial — {{1}}..{{6}} in order:
 *   1 name · 2 amount ALREADY PAID · 3 month · 4 hostel · 5 remaining · 6 bank
 *
 * Note {{2}} and {{5}} are different figures and easy to transpose: {{2}} is
 * what the tenant has already sent, {{5}} is what is left. Swapping them tells
 * someone who paid Rs 20,000 of Rs 33,000 that they still owe Rs 20,000.
 */
export function reminderPartialParams(a: PartialReminderParamArgs): string[] {
  return [
    clean(firstName(a.tenantName), "there"),
    clean(pkr(a.amountPaid), "0"),
    clean(formatMonthLong(a.forMonth), a.forMonth),
    clean(a.hostelName ?? "", "your hostel"),
    clean(pkr(a.amountDue), "0"),
    clean(primaryAccountLine(a.accounts), "Please contact hostel management for account details"),
  ];
}

export interface ConfirmedParamArgs {
  tenantName: string | null | undefined;
  amountPaid: number;
  forMonth: string;
  /** Absolute URL — the template renders it as visible text, not a button. */
  receiptUrl: string;
  hostelName: string | null | undefined;
}

/**
 * hms_payment_confirmed — {{1}}..{{5}} in order:
 *   1 name · 2 amount · 3 month · 4 receipt URL · 5 hostel
 */
export function paymentConfirmedParams(a: ConfirmedParamArgs): string[] {
  return [
    clean(firstName(a.tenantName), "there"),
    clean(pkr(a.amountPaid), "0"),
    clean(formatMonthLong(a.forMonth), a.forMonth),
    clean(a.receiptUrl, "Please contact hostel management for your receipt"),
    clean(a.hostelName ?? "", "Your hostel"),
  ];
}
