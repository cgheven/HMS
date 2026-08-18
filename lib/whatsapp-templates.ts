import { formatMonthLong, formatDayLong } from "@/lib/utils";
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
  /** v2 moves both links out of the body and into URL buttons.
   *
   *  v1 put them inline, which made the message 488 characters over ~24
   *  rendered lines — WhatsApp collapsed it behind "Read more" at the third
   *  line, so the offer itself was hidden — and a URL in the body also makes
   *  WhatsApp render a link-preview card. Buttons count toward neither.
   *
   *  Four body variables: first name, hostel name, referrer %, referred %.
   *  Two button suffixes: the referral code, then the status token. */
  referralInvitation: { name: "hms_referral_invitation_v2", language: "en" },
  reminderPartial: { name: "hms_payment_reminder_partial", language: "en" },
  paymentConfirmed: { name: "hms_payment_confirmed", language: "en" },
  seatReserved: { name: "hms_seat_reserved", language: "en" },
  ownerDailySummary: { name: "hms_owner_daily_summary", language: "en" },
  clientBillingDue: { name: "hms_client_billing_due", language: "en" },
  clientProvisioned: { name: "hms_client_provisioning_notification", language: "en" },
  tenantCheckout: { name: "hms_tenant_checkout", language: "en" },
  reminderFullV2: { name: "hms_payment_reminder_full_v2", language: "en" },
  clientPaymentReceived: { name: "hms_client_payment_received", language: "en" },
  clientFirstInvoice: { name: "hms_client_first_invoice", language: "en" },
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

/** The account whose fields feed the split bank block in v2 templates. Same
 *  "first account only" rule as primaryAccountLine — a tenant needs one place
 *  to send money, not a list. */
function firstUsableAccount(
  methods: PaymentMethodAccount[] | null | undefined
): PaymentMethodAccount | undefined {
  return (methods ?? [])[0];
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

export interface SeatReservedParamArgs {
  tenantName: string | null | undefined;
  /** What was actually collected, never the agreed figure — the message says
   *  "we have received", and claiming money that was not taken is worse than
   *  sending nothing. */
  depositCollected: number;
  hostelName: string | null | undefined;
  /** ISO date the tenant is expected to move in. */
  expectedJoining: string | null | undefined;
}

/**
 * hms_seat_reserved — {{1}}..{{4}} in order:
 *   1 name · 2 deposit received · 3 hostel · 4 expected joining date
 *
 * One-time by construction: recordReservationDepositAction refuses to run
 * twice against the same tenant (it throws once deposit_collected_on is set),
 * so sending from its success path can only ever happen once.
 */
export function seatReservedParams(a: SeatReservedParamArgs): string[] {
  return [
    clean(firstName(a.tenantName), "there"),
    clean(pkr(a.depositCollected), "0"),
    clean(a.hostelName ?? "", "your hostel"),
    clean(a.expectedJoining ? formatDayLong(a.expectedJoining) : "", "to be confirmed"),
  ];
}

export interface ReminderFullV2Args extends ReminderParamArgs {
  /** Absolute URL to the itemised bill. */
  billUrl: string;
}

/**
 * hms_payment_reminder_full_v2 — the same reminder plus {{5}} the itemised bill,
 * with the bank block split across {{6}}-{{8}}.
 *
 * Splitting the bank line is why this needs its own mapper: v1 joined bank,
 * title and number into one string, so one missing field just shortened the
 * line. Here each is its own parameter, and Meta rejects an EMPTY parameter
 * outright — 3 of 16 hostels have no payment account configured at all, so
 * without a per-field fallback every reminder for those hostels would fail
 * rather than merely look sparse.
 */
export function reminderFullV2Params(a: ReminderFullV2Args): string[] {
  const m = firstUsableAccount(a.accounts);
  return [
    clean(firstName(a.tenantName), "there"),
    clean(pkr(a.amountDue), "0"),
    clean(a.forMonth ? formatMonthLong(a.forMonth) : "", "this month"),
    clean(a.hostelName ?? "", "your hostel"),
    a.billUrl,
    clean(m?.label ?? "", "Contact hostel management"),
    clean(m?.account_title ?? "", "—"),
    clean(m?.account_number || m?.iban || "", "—"),
  ];
}

export interface TenantCheckoutArgs {
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
  /** ISO checkout date. */
  checkoutDate: string | null | undefined;
  /** Absolute URL to the checkout receipt. */
  receiptUrl: string;
  /** Absolute URL to the single-use feedback form. */
  feedbackUrl: string;
}

/**
 * hms_tenant_checkout — {{1}} name, {{2}} hostel, {{3}} date, {{4}} receipt,
 * {{5}} feedback link.
 *
 * Both URLs carry credentials, so neither gets a clean() fallback the way the
 * text fields do: a placeholder here would send the tenant a link that goes
 * nowhere. The caller must not invoke this without real URLs — Meta also
 * rejects an empty parameter outright, so a missing one fails the send rather
 * than delivering a broken message.
 */
export function tenantCheckoutParams(a: TenantCheckoutArgs): string[] {
  return [
    clean(firstName(a.tenantName), "there"),
    clean(a.hostelName ?? "", "your hostel"),
    clean(a.checkoutDate ? formatDayLong(a.checkoutDate) : "", "today"),
    a.receiptUrl,
    a.feedbackUrl,
  ];
}

export interface OwnerDailySummaryArgs {
  ownerName: string | null | undefined;
  branchName: string | null | undefined;
  /** ISO date the figures cover. */
  date: string;
  collection: number;
  kitchen: number;
  staff: number;
  bills: number;
  other: number;
}

/**
 * hms_owner_daily_summary — {{1}}..{{9}} in order:
 *   1 owner · 2 branch · 3 date · 4 collection
 *   5 kitchen · 6 staff · 7 bills · 8 other · 9 net
 *
 * {{9}} carries the whole phrase, not a bare number: a loss rendered as
 * "Rs. -4,100" reads like a typo, and the template's static text has no room
 * to say "loss" conditionally.
 */
export function ownerDailySummaryParams(a: OwnerDailySummaryArgs): string[] {
  const expenses = a.kitchen + a.staff + a.bills + a.other;
  const net = a.collection - expenses;
  const netPhrase =
    net === 0 ? "Rs. 0 — break even"
    : net > 0 ? `Rs. ${pkr(net)} profit`
    : `Rs. ${pkr(Math.abs(net))} loss`;

  return [
    clean(firstName(a.ownerName), "there"),
    clean(a.branchName ?? "", "your hostel"),
    clean(formatDayLong(a.date), a.date),
    clean(pkr(a.collection), "0"),
    clean(pkr(a.kitchen), "0"),
    clean(pkr(a.staff), "0"),
    clean(pkr(a.bills), "0"),
    clean(pkr(a.other), "0"),
    clean(netPhrase, "Rs. 0"),
  ];
}

export interface ClientBillingDueArgs {
  clientName: string | null | undefined;
  /** The client's business/branch name, not ours. */
  businessName: string | null | undefined;
  /** period_label as stored, e.g. "Jul 2026" — sent verbatim so the message
   *  and the invoice it links to cannot disagree. */
  periodLabel: string;
  amount: number;
  /** ISO due date. */
  dueDate: string;
  invoiceUrl: string;
}

/**
 * hms_client_billing_due — {{1}}..{{6}} in order:
 *   1 client · 2 business · 3 period · 4 amount · 5 due date · 6 invoice URL
 *
 * This one chases OUR money, not a tenant's rent. Pulse's own bank details are
 * static text inside the approved template, so they are not parameters here.
 */
export function clientBillingDueParams(a: ClientBillingDueArgs): string[] {
  return [
    clean(firstName(a.clientName), "there"),
    clean(a.businessName ?? "", "your hostel"),
    clean(a.periodLabel, "this period"),
    clean(pkr(a.amount), "0"),
    clean(a.dueDate ? formatDayLong(a.dueDate) : "", "as per invoice"),
    clean(a.invoiceUrl, "https://hostel.yourpulse.io"),
  ];
}

export interface ClientFirstInvoiceArgs {
  clientName: string | null | undefined;
  businessName: string | null | undefined;
  periodLabel: string;
  /** The one-time fee, itemised so it is not mistaken for the new monthly rate. */
  onboardingFee: number;
  /** Everything except onboarding — the recurring part of this invoice. */
  subscriptionAmount: number;
  total: number;
  invoiceUrl: string;
}

/**
 * hms_client_first_invoice — used ONCE per client, for the invoice that carries
 * the onboarding fee.
 *
 * Exists because clientBillingDue shows a single "Amount", so a first invoice of
 * 16,000 against a 6,000 monthly rate reads as a surprise with no explanation.
 * Splitting the line is the whole point; the template's closing sentence does
 * the rest by saying the fee will not recur.
 *
 * "Subscription charges" rather than "monthly": on an annual cycle that figure
 * is twelve months, and calling it monthly would understate the next invoice by
 * a factor of twelve.
 */
export function clientFirstInvoiceParams(a: ClientFirstInvoiceArgs): string[] {
  return [
    clean(firstName(a.clientName), "there"),
    clean(a.businessName ?? "", "your hostel"),
    clean(a.periodLabel, "this period"),
    clean(pkr(a.onboardingFee), "0"),
    clean(pkr(a.subscriptionAmount), "0"),
    clean(pkr(a.total), "0"),
    clean(a.invoiceUrl, "https://hostel.yourpulse.io"),
  ];
}

export interface ClientPaymentReceivedArgs {
  clientName: string | null | undefined;
  businessName: string | null | undefined;
  periodLabel: string;
  amount: number;
  /** ISO date the payment was recorded. */
  receivedOn: string | null | undefined;
  invoiceUrl: string;
}

/**
 * hms_client_payment_received — the receipt half of clientBillingDue.
 *
 * Same six slots in the same order as the reminder that preceded it, so a
 * client reading both sees one continuous thread rather than two unrelated
 * messages. Carries no bank details, unlike the reminder: they have already
 * paid, and printing an account number on a receipt invites a second payment.
 */
export function clientPaymentReceivedParams(a: ClientPaymentReceivedArgs): string[] {
  return [
    clean(firstName(a.clientName), "there"),
    clean(a.businessName ?? "", "your hostel"),
    clean(a.periodLabel, "this period"),
    clean(pkr(a.amount), "0"),
    clean(a.receivedOn ? formatDayLong(a.receivedOn) : "", "today"),
    clean(a.invoiceUrl, "https://hostel.yourpulse.io"),
  ];
}

export interface ClientProvisionedArgs {
  clientName: string | null | undefined;
  businessName: string | null | undefined;
  /** Where the credentials were actually sent. */
  email: string;
}

/**
 * hms_client_provisioning_notification — {{1}}..{{3}}:
 *   1 client · 2 business · 3 email the details went to
 *
 * Carries NO credentials. Meta rejects those as a utility template, and the
 * approved body only says the details were emailed — so this must never be
 * sent unless that email actually succeeded.
 */
export function clientProvisionedParams(a: ClientProvisionedArgs): string[] {
  return [
    clean(firstName(a.clientName), "there"),
    clean(a.businessName ?? "", "your hostel"),
    clean(a.email, "your email"),
  ];
}
