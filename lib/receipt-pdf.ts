/**
 * Narrow thermal-style receipt PDF — 250pt wide, dynamic height.
 * No external dependency; pure PDF 1.4 text stream, no jsPDF.
 */

import { splitPaymentCharges } from "@/lib/payment-calc";
import { getCountryConfig, terms } from "@/lib/country-config";
import { todayInZone } from "@/lib/pkt-time";

interface ReceiptPayment {
  receipt_number?: string | null;
  for_month: string;
  amount: number;
  /** Set only for a partial payment — amount actually received so far (< amount + late_fee) */
  amount_paid?: number;
  late_fee?: number;
  food_charge?: number;
  ac_charge?: number;
  ac_units_consumed?: number | null;
  ac_per_unit_rate?: number;
  /** When the AC charge is a CARRIED TRANSFER charge (electricity from a room the
   *  member moved out of this month), the source for the receipt sub-line —
   *  scope 'room' (a room move within this branch) or 'branch' (a branch
   *  transfer), and a short label naming the source room (and branch, if cross). */
  carried_ac?: { scope: "room" | "branch"; source: string } | null;
  /** Deposit actually billed as part of THIS payment's amount (first month only) */
  security_deposit_charge?: number;
  /** Deposit to be refunded — shown only on a checkout receipt, unrelated to `amount` */
  security_deposit?: number;
  /** One-time, non-refundable — billed only in the check-in month. */
  registration_fee_charge?: number;
  /** Recurring monthly, applied automatically for tenants in an AC room. */
  ac_maintenance_charge?: number;
  /** Rent reduction earned by referring someone. `amount` is already net of it,
   *  so it is printed as a negative line against the GROSS rent above. The
   *  referred person is deliberately not identified — this document is served
   *  from a public token URL, and naming them would leak their tenancy. */
  referral_discount?: number;
  /** Percent the discount was computed at — label only, printed when known. */
  referral_percent?: number;
  /** Standing (admission) + one-off rent discount in rupees, migration 211.
   *  `amount` is stored net of it, so like referral_discount it prints as a
   *  negative line against the GROSS rent above. */
  discount_amount?: number | null;
  /** Combined percent the rupees were derived from — label only. */
  discount_percent?: number | null;
  is_checkout?: boolean;
  /** Seat-reservation deposit taken before move-in — no rent/food/AC on this receipt. */
  is_reservation?: boolean;
  /** The date the reserved bed is held from (the tenant's intended check-in). */
  reservation_from?: string | null;
  /** Nights billed for a daily-rate tenant — snapshot on the row (migration 099). */
  billed_days?: number | null;
  /** The daily rate in force when this row was billed. */
  daily_rate_billed?: number | null;
  payment_method?: string | null;
  payment_date?: string | null;
  payment_package_tier?: string | null;
  /** Which configured account the money was received into — printed under Method
   *  when present (owner reconciliation / tenant confirmation). */
  received_account?: string | null;
}

interface ReceiptTenant {
  full_name: string;
  phone?: string | null;
  // F-008: CNIC is sensitive PII; must NOT appear in public-facing receipts.
  room_id?: string | null;
  /** Human room number (hms_rooms.room_number), printed in the tenant block.
   *  room_id is a UUID and useless on a slip; this is the label a tenant reads. */
  room_number?: string | null;
  joining_meter_reading?: number | null;
  food_breakfast?: boolean;
  food_lunch?: boolean;
  food_dinner?: boolean;
}

interface ReceiptHostel {
  name: string;
  /** ISO country — drives the receipt's currency (Rs for PK, £ for GB) and date
   *  locale. Omitted → Pakistan (byte-identical to the pre-multi-country receipt). */
  country?: string | null;
  address?: string | null;
  phone?: string | null;
  /** Renames the metered AC line for branches that bill it as one electricity
   *  charge covering the whole room. Null/blank prints "AC Charges", so a branch
   *  that never sets it produces a byte-identical receipt to before. */
  acChargeLabel?: string | null;
}

// The receipt uses the base Helvetica fonts, which are single-byte (Latin-1)
// encoded, but the content stream is written as UTF-8. Any character outside
// ASCII — an em-dash, a curly quote, or an Urdu/accented tenant name — is emitted
// as multi-byte UTF-8 and rendered one garbled Latin-1 glyph per byte ("—" → "â").
// Normalise to ASCII-safe text first: map the punctuation these fonts can't show
// to plain equivalents, strip diacritics so "José" prints "Jose", and replace any
// remaining unsupported character with "?" rather than mojibake.
function sanitizeForPdf(str: string): string {
  return str
    .replace(/[‐-―]/g, "-")            // hyphens, en/em dashes
    .replace(/[‘’‚‛]/g, "'") // curly single quotes
    .replace(/[“”„‟]/g, '"') // curly double quotes
    // Bullet survives as a REAL bullet: the fonts declare /WinAnsiEncoding, where
    // U+2022 is byte 0x95. Mapping it to "-" would print the masked account as
    // "HBL ---- 4703", which reads as an empty field rather than a redaction.
    // Middle dot is Latin-1 (0xB7) and already passes through the keep-range.
    .replace(/•/g, "\u0095")
    .replace(/[·‧]/g, "\u00B7")
    .replace(/…/g, "...")                   // ellipsis
    .replace(/ /g, " ")                     // non-breaking space
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip diacritics
    // Keep printable Latin-1 (0xA0–0xFF) — the base Helvetica fonts render it via
    // WinAnsiEncoding, so currency symbols like "£" (0xA3) print correctly. Only
    // characters outside Latin-1 (Urdu names, ₹, €, …) fall back to "?".
    // Drop emoji / pictographs so a decorative "🎬 Sample Data" name reads
    // "Sample Data", not "?? Sample Data". Scoped to astral + symbol/dingbat ranges
    // ONLY — NOT all of \p{Extended_Pictographic}, which also matches Latin-1
    // © / ® that the base fonts render; stripping those would change PK receipts.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE00-\uFE0F\u200D]+\s*/gu, "")
    // \u0095 is the WinAnsi bullet mapped just above — kept deliberately.
    .replace(/[^\x20-\x7E\u0095\u00A0-\u00FF]/g, "?");
}

// Latin-1 (single-byte) encoder. The base-14 fonts are WinAnsi/Latin-1, so the
// content stream must be Latin-1 bytes, NOT UTF-8 — otherwise "£" (U+00A3) is
// emitted as the two UTF-8 bytes C2 A3 and renders as mojibake. sanitizeForPdf
// guarantees every character is ≤ 0xFF, so the low byte is the exact code point.
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function encodePdfString(str: string): string {
  return sanitizeForPdf(str)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

// numeric(5,2) arrives as 10 or 10.5 — print 10, not 10.00, and never a
// trailing ".50" on a whole percentage.
function fmtPct(pct: number): string {
  return String(Math.round(pct * 100) / 100);
}

// Currency + date formatters bound to a country. PKR keeps the exact legacy
// "Rs. 13,000.00" prefix (byte-identical for every existing PK receipt); other
// currencies use their own symbol ("£420.00"). Dates/months use the country locale.
function makeReceiptFormatters(country: string | null | undefined) {
  const cfg = getCountryConfig(country);
  const pk = (amount: number): string => {
    const n = amount.toLocaleString(cfg.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (cfg.currency === "PKR") return `Rs. ${n}`;
    // A glyph symbol ($, £, €, ₹) hugs the number; an alphabetic code (AED, BDT,
    // …) needs a space so it reads "AED 29,000", not "AED29,000".
    const sep = /[A-Za-z]$/.test(cfg.currencySymbol) ? " " : "";
    return `${cfg.currencySymbol}${sep}${n}`;
  };
  const fmtDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString(cfg.locale, { day: "2-digit", month: "short", year: "numeric" });
  };
  const fmtMonth = (yyyyMM: string): string => {
    const [y, m] = yyyyMM.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(cfg.locale, { month: "long", year: "numeric" });
  };
  // Symbol used inline in rate copy ("… x Rs. 25/unit" / "… x £0.30/unit").
  // Carries its own trailing space so a word-like symbol reads "AED 0.34" while a
  // glyph reads "£0.34", not "£ 0.34". PK keeps "Rs. " exactly as before.
  const rateSym = cfg.currency === "PKR"
    ? "Rs. "
    : (/[A-Za-z]$/.test(cfg.currencySymbol) ? `${cfg.currencySymbol} ` : cfg.currencySymbol);
  return { pk, fmtDate, fmtMonth, rateSym };
}


/**
 * Masks the account identifier in a "Received In" label for print.
 *
 * This document is served from a PUBLIC token URL to whoever holds the link, so
 * it must never carry a full account number — the same rule that keeps CNIC off
 * it. The label is kept and every digit but the last four is removed:
 *
 *   "HBL (15897920194703 )"       -> "HBL •••• 4703"
 *   "GB29 NWBK 6016 1331 9268 19" -> "GB29 NWBK •••• 6819"
 *   "HBL 158 / UBL 9988776655"    -> "HBL / UBL •••• 6655"
 *   "Cash Counter"                -> "Cash Counter"   (no digits at all)
 *
 * FAILS CLOSED. Digits are counted across the WHOLE value, not a single run, so
 * a number written in groups — which is how an IBAN is normally typed — cannot
 * slip through unmasked, and a second account in the same label cannot survive
 * inside the retained text. Non-ASCII digits count too (\p{Nd}), so Arabic-Indic
 * numerals are masked like any other. An unrecognised shape is masked, never
 * passed through.
 *
 * The owner still sees the full value everywhere behind auth; only the printed
 * receipt is reduced.
 */
export function maskReceivedAccount(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const DIGIT = /[0-9\p{Nd}]/gu;
  const digits = v.match(DIGIT) ?? [];
  if (digits.length === 0) return v;
  // Too short to have a meaningful "last four" — blank it rather than reveal it.
  if (digits.length < 4) return v.replace(DIGIT, "•").trim();
  // Strip every digit and the separators trailing them out of the label, so no
  // part of any account number survives in the text that is kept.
  const label = v
    .replace(/[0-9\p{Nd}][0-9\p{Nd}\s\-–—/.]*/gu, " ")
    // Owners store "HBL (15897920194703 )", so removing the digits leaves an
    // empty bracket pair behind; drop those and any punctuation left dangling.
    .replace(/[([{]\s*[)\]}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:/,.]+|[([{\s\-–—:/,.]+$/g, "")
    .trim();
  const last4 = digits.slice(-4).join("");
  return label ? `${label} •••• ${last4}` : `•••• ${last4}`;
}

function methodLabel(m: string | null | undefined): string {
  if (!m) return "-";
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function amountInWords(n: number, unit = "Rupees"): string {
  const rounded = Math.round(n);
  if (rounded === 0) return `Zero ${unit} Only`;
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tensArr = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function words(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return tensArr[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + words(num % 100) : "");
    if (num < 100000) return words(Math.floor(num / 1000)) + " Thousand" + (num % 1000 ? " " + words(num % 1000) : "");
    if (num < 10000000) return words(Math.floor(num / 100000)) + " Lakh" + (num % 100000 ? " " + words(num % 100000) : "");
    return words(Math.floor(num / 10000000)) + " Crore" + (num % 10000000 ? " " + words(num % 10000000) : "");
  }
  return words(rounded) + ` ${unit} Only`;
}

/**
 * `mode: "invoice"` prints the SAME itemised breakdown for a bill that has not
 * been collected yet. Only the framing differs — a receipt asserts money was
 * received, and printing that over an unpaid bill is a false document. An
 * invoice asserts the opposite: this is what you owe.
 *
 * One generator rather than two, because the breakdown is the entire value of
 * the document and a second copy of it would drift from this one the first time
 * a charge type is added.
 */
export function generateReceiptPDF(
  payment: ReceiptPayment,
  tenant: ReceiptTenant,
  hostel: ReceiptHostel,
  mode: "receipt" | "invoice" = "receipt"
): Uint8Array {
  const isInvoice = mode === "invoice";
  const W = 250;      // narrow thermal width in pts
  const ML = 12;      // left margin
  const MR = W - 12;  // right edge
  const CX = W / 2;

  // Security deposit is never added on top here — either it's already inside
  // `payment.amount` (security_deposit_charge, first month) or it's a checkout
  // refund note that isn't part of what's being collected in this payment.
  const total = payment.amount + (payment.late_fee ?? 0);
  // amount_paid being present is NOT the same as this payment being partial —
  // an installment-scoped receipt link always carries a defined amount_paid
  // (that installment's running total), even when the single transaction it
  // represents fully settled the bill. Only actually short of `total` counts
  // as partial; otherwise this mislabels a fully-paid receipt as partial.
  const isPartial = payment.amount_paid != null && payment.amount_paid < total - 0.01;
  // A reservation row carries only the deposit (a DB trigger zeroes rent/food/AC
  // on it). Printing a "Monthly Rent: Rs. 0" line and a "Period: July 2026"
  // header on it would read as a monthly bill the tenant does not owe.
  const isReservation = !!payment.is_reservation;
  // Currency + date formatters follow the hostel's country (Rs for PK, £ for GB).
  const { pk, fmtDate, fmtMonth, rateSym } = makeReceiptFormatters(hostel.country);
  // Terminology follows the hostel country: PK = "Tenant" (byte-identical),
  // non-PK = "Resident".
  const residentLabel = terms(hostel.country).tenant;
  const isPk = getCountryConfig(hostel.country).currency === "PKR";
  const meterWords = terms(hostel.country);

  // Collect commands top-down (y=0 at top), convert to PDF coords (y=0 at bottom) after.
  type Cmd =
    | { kind: "text"; x: number; y: number; content: string; size: number; bold: boolean }
    | { kind: "line"; y: number };
  const cmds: Cmd[] = [];
  let yTop = 14;

  function add(x: number, content: string, size: number, bold: boolean): void {
    cmds.push({ kind: "text", x, y: yTop, content, size, bold });
  }
  function addCenter(content: string, size: number, bold: boolean): void {
    const textW = tw(content, size);
    add(Math.max(ML, CX - textW / 2), content, size, bold);
  }
  // Helvetica AFM widths (units/1000) for accurate right-alignment without overflow.
  const HV: Record<string, number> = {
    ' ':278,'-':333,'.':278,',':278,':':278,'/':278,'(':333,')':333,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,
    'A':667,'B':667,'C':667,'D':722,'E':611,'F':611,'G':722,'H':722,'I':278,'J':500,'K':667,'L':556,'M':722,'N':722,'O':778,'P':611,'Q':778,'R':667,'S':556,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':611,'Z':611,
    'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,'p':556,'q':556,'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,'x':500,'y':500,'z':500,
  };
  function tw(str: string, size: number): number {
    return str.split("").reduce((s, c) => s + (HV[c] ?? 556), 0) / 1000 * size;
  }
  function addKv(key: string, val: string, bold = false): void {
    add(ML, key, 8, bold);
    add(Math.max(ML + 70, MR - tw(val, 8) - 2), val, 8, bold);
  }
  // Draws a thin solid rule from ML to MR — guaranteed to span the full content width.
  function addDash(): void {
    cmds.push({ kind: "line", y: yTop });
  }
  function nl(n = 11): void { yTop += n; }

  // ─── Content ────────────────────────────────────────────────────────
  // Hostel name: word-wrap if too wide for a single line at size 12
  {
    const maxNameW = MR - ML - 2;
    const nameWords = hostel.name.split(" ");
    const nameLines: string[] = [];
    let nameLine = "";
    for (const word of nameWords) {
      const candidate = nameLine ? `${nameLine} ${word}` : word;
      if (tw(candidate, 12) <= maxNameW) { nameLine = candidate; }
      else { if (nameLine) nameLines.push(nameLine); nameLine = word; }
    }
    if (nameLine) nameLines.push(nameLine);
    for (let i = 0; i < nameLines.length; i++) {
      addCenter(nameLines[i], 12, true);
      nl(i < nameLines.length - 1 ? 14 : 15);
    }
  }
  if (hostel.address) { addCenter(hostel.address, 7, false); nl(10); }
  if (hostel.phone) { addCenter(`Tel: ${hostel.phone}`, 7, false); nl(10); }
  nl(3); addDash(); nl(10);
  addCenter(
    isInvoice
      ? "INVOICE"
      : isReservation ? "SEAT RESERVATION RECEIPT" : isPartial ? "PARTIAL PAYMENT RECEIPT" : "PAYMENT RECEIPT",
    9, true
  ); nl(10);
  addDash(); nl(10);

  if (isInvoice) {
    // No receipt number, date or method: none of them exist yet, and printing
    // "Method: —" on a bill invites the reading that payment was attempted.
    addKv("Period", fmtMonth(payment.for_month)); nl(12);
    // "Issued" = the day this invoice is generated, in the HOSTEL's timezone.
    // toISOString() would give the UTC day, which rolls back one near midnight on a
    // positive-offset host (a bill generated on the 26th PKT printed "25th").
    addKv("Issued", fmtDate(todayInZone(getCountryConfig(hostel.country).timezone))); nl(12);
  } else {
    addKv("Receipt #", payment.receipt_number ?? "N/A"); nl(12);
    addKv(isReservation ? "Collected On" : "Date", fmtDate(payment.payment_date)); nl(12);
    if (isReservation) {
      if (payment.reservation_from) { addKv("Seat Held From", fmtDate(payment.reservation_from)); nl(12); }
    } else {
      addKv("Period", fmtMonth(payment.for_month)); nl(12);
    }
    addKv("Method", methodLabel(payment.payment_method)); nl(12);
    if (payment.received_account?.trim()) { addKv("Received In", maskReceivedAccount(payment.received_account)); nl(12); }
  }
  addDash(); nl(10);

  add(ML, `${residentLabel}:`, 8, true); nl(12);
  add(ML, tenant.full_name, 8, false); nl(12);
  if (tenant.phone) { add(ML, `Phone: ${tenant.phone}`, 8, false); nl(12); }
  // Room the tenant occupies — a reservation has no assigned room yet, so it's
  // only printed when present.
  if (tenant.room_number) { add(ML, `Room: ${tenant.room_number}`, 8, false); nl(12); }
  // Printed on every receipt (not just the first month) — it's a permanent
  // reference the tenant can always point back to if AC billing is disputed.
  if (tenant.joining_meter_reading != null) {
    add(ML, `${terms(hostel.country).acMeterReading} at Move-in: ${tenant.joining_meter_reading}`, 7, false); nl(11);
  }
  nl(2); addDash(); nl(10);

  add(ML, isReservation ? "Details:" : "Breakdown:", 8, true); nl(12);
  // Food-inclusive package tiers bundle food into monthly_rent with no separate
  // food_charge (0), so this only itemizes food when it was billed as an add-on.
  const { rent: baseRent, referralDiscount, discount: rentDiscount } = splitPaymentCharges(payment);
  // The rent line above is GROSS while `payment.amount` is stored net, so these
  // negative lines are exactly what makes the itemisation add back up to the
  // total. The referral one is deliberately anonymous: this PDF is served from a
  // public token URL, and the reader does not need to know who they referred.
  function addDiscountLines(): void {
    if (rentDiscount > 0) {
      // discount_percent is the STANDING (per-tenant) percent only (migration 255).
      // The combined rupees may also include a one-off (a rupee amount off the whole
      // bill, whose share is NOT a percent of rent) — so only label the percent when
      // the discount is purely the standing concession; otherwise show rupees alone,
      // never a percent that understates the amount.
      const pct = Number(payment.discount_percent ?? 0);
      const standingApprox = Math.round((baseRent * pct) / 100);
      const showPct = pct > 0 && rentDiscount <= standingApprox + 1;
      addKv(showPct ? `Discount (${fmtPct(pct)}%)` : "Discount", `-${pk(rentDiscount)}`); nl(12);
    }
    if (referralDiscount > 0) {
      const pct = Number(payment.referral_percent ?? 0);
      addKv(pct > 0 ? `Referral Discount (${fmtPct(pct)}%)` : "Referral Discount", `-${pk(referralDiscount)}`); nl(12);
    }
  }
  if (isReservation) {
    addKv("Seat Reservation Deposit", pk(payment.security_deposit_charge ?? payment.amount)); nl(12);
    add(ML, "(refundable, held against your booking)", 6, false); nl(10);
    if ((payment.registration_fee_charge ?? 0) > 0) {
      addKv("Registration Fee", pk(payment.registration_fee_charge!)); nl(12);
      add(ML, "(one-time, non-refundable)", 6, false); nl(10);
    }
    addDiscountLines();
    add(ML, "This is not a monthly bill. Rent begins", 6, false); nl(8);
    add(ML, "from the date of joining.", 6, false); nl(10);
  }
  if (!isReservation) {
    // A daily tenant is not on a monthly rent, and printing that label on their
    // receipt is simply wrong. Use the snapshot taken when the row was billed
    // rather than recomputing from the tenant's dates — those keep moving after
    // the receipt is issued, and a receipt must say what was actually charged.
    const hasDaySnapshot = (payment.billed_days ?? 0) > 0 && (payment.daily_rate_billed ?? 0) > 0;
    const leftoverDayCharge = hasDaySnapshot ? Math.round(payment.billed_days! * payment.daily_rate_billed!) : 0;
    // Merged first bill (migration 272): the rent is a FULL month PLUS the
    // join-month leftover days folded in. baseRent then exceeds the day charge, and
    // printing one "Monthly Rent" line for the combined figure reads as a wrong
    // monthly rate. Split it: the month on its own line, the partial days on their
    // own. A pure partial (separate mode) or a daily row has no month portion, so
    // it stays a single "N days x rate" line.
    const monthPortion = Math.round((Math.max(0, baseRent) - leftoverDayCharge) * 100) / 100;
    if (hasDaySnapshot) {
      const daysLabel = `${payment.billed_days} ${payment.billed_days === 1 ? "day" : "days"} x ${pk(payment.daily_rate_billed!)}`;
      if (monthPortion > 0.01) {
        // Merged: two lines that add up to the combined rent.
        addKv("Monthly Rent", pk(monthPortion)); nl(12);
        addKv(`Joining days (${daysLabel})`, pk(leftoverDayCharge)); nl(12);
      } else {
        // Pure partial (separate join month) or a daily tenant.
        addKv(daysLabel, pk(Math.max(0, baseRent))); nl(12);
      }
    } else {
      addKv("Monthly Rent", pk(Math.max(0, baseRent))); nl(12);
    }
    if ((payment.food_charge ?? 0) > 0) {
      addKv("Food Charges", pk(payment.food_charge!)); nl(11);
      const mealsLabel = [tenant.food_breakfast && "Breakfast", tenant.food_lunch && "Lunch", tenant.food_dinner && "Dinner"]
        .filter(Boolean).join(" + ");
      if (mealsLabel) { add(ML + 4, mealsLabel, 6, false); nl(9); }
      nl(2);
    }
    if ((payment.ac_charge ?? 0) > 0) {
      addKv(hostel.acChargeLabel?.trim() || terms(hostel.country).acCharges, pk(payment.ac_charge!)); nl(11);
      if (payment.carried_ac) {
        // Explains an AC line on a member who now sits in a non-AC room: the
        // charge is electricity from the room they left, up to the move.
        add(ML + 4, `incl. from previous ${payment.carried_ac.scope} - ${payment.carried_ac.source}`, 6, false); nl(9);
      }
      const realRate = payment.ac_per_unit_rate && payment.ac_per_unit_rate > 0 ? payment.ac_per_unit_rate : 0;
      const storedUnits = Number(payment.ac_units_consumed ?? 0);
      if (realRate > 0) {
        // Derive units from charge ÷ real rate so the sub-line is always consistent
        // with the actual rate, regardless of what was stored in ac_units_consumed.
        // Rounded to 2dp (ac_units_consumed's DB precision), not a whole unit —
        // otherwise an even split like 72.5 would display as "73".
        const displayUnits = Math.round((payment.ac_charge! / realRate) * 100) / 100;
        add(ML + 4, `${displayUnits} ${meterWords.meterUnits} x ${rateSym}${realRate}/${meterWords.meterUnit}`, 6, false); nl(9);
      } else if (storedUnits > 0) {
        // Fallback: back-calculate rate from stored units (regular monthly pay path)
        const rate = Math.round(payment.ac_charge! / storedUnits);
        add(ML + 4, `${storedUnits} ${meterWords.meterUnits} x ${rateSym}${rate}/${meterWords.meterUnit}`, 6, false); nl(9);
      } else {
        nl(1);
      }
      nl(2);
    }
    if ((payment.late_fee ?? 0) > 0)       { addKv("Late Fee", pk(payment.late_fee!)); nl(12); }
    if ((payment.ac_maintenance_charge ?? 0) > 0) {
      addKv(terms(hostel.country).acMaintenance, pk(payment.ac_maintenance_charge!)); nl(12);
    }
    if ((payment.security_deposit_charge ?? 0) > 0) {
      // Actually charged as part of THIS bill (first month) — already included
      // in `payment.amount`, so it's itemized here, not added again below.
      addKv("Security Deposit", pk(payment.security_deposit_charge!)); nl(12);
      add(ML, "(subject to applicable deductions/refund terms)", 6, false); nl(10);
    }
    if ((payment.registration_fee_charge ?? 0) > 0) {
      addKv("Registration Fee", pk(payment.registration_fee_charge!)); nl(12);
      add(ML, "(one-time, non-refundable)", 6, false); nl(10);
    }
    if (payment.is_checkout && (payment.security_deposit ?? 0) > 0) {
      // Informational only — the deposit was already collected at move-in, not
      // part of this checkout payment's amount.
      addKv("Security Deposit Refund", pk(payment.security_deposit!)); nl(12);
      add(ML, `(to be returned to ${residentLabel.toLowerCase()})`, 6, false); nl(10);
    }
    // LAST, immediately above the total. Everything above it is added; this is
    // the only line that is taken off, so putting it anywhere in the middle
    // makes the column impossible to add down — the reader hits a subtraction,
    // then more additions, and has to backtrack to check the total.
    addDiscountLines();
  }
  nl(2); addDash(); nl(10);

  if (isInvoice) {
    // All three lines when something has been paid. The middle number is the one
    // that ends the argument — a tenant disputing "why 8,500?" is really asking
    // what happened to the 10,000 they already handed over.
    const paid = Number(payment.amount_paid ?? 0);
    if (paid > 0) {
      addKv("Total Bill", pk(total)); nl(12);
      addKv("Already Paid", pk(paid)); nl(12);
      addKv("AMOUNT DUE", pk(Math.max(0, total - paid)), true); nl(15);
    } else {
      addKv("AMOUNT DUE", pk(total), true); nl(15);
    }
  } else if (isPartial) {
    // Partial payment — show what's owed, what's actually been received, and what's
    // left, so this receipt can't be mistaken for proof the full amount was paid.
    const remaining = Math.max(0, total - payment.amount_paid!);
    addKv("Total Due", pk(total)); nl(12);
    addKv("Amount Received", pk(payment.amount_paid!)); nl(12);
    addKv("REMAINING BALANCE", pk(remaining), true); nl(15);
  } else {
    addKv("TOTAL PAID", pk(total), true); nl(15);
  }
  addDash(); nl(10);

  // For a partial payment, spell out what was actually received — spelling out
  // the full amount due here would misrepresent it as fully paid.
  // "Amount in words" is a Pakistani receipt convention using lakh/crore
  // numbering — only rendered for PKR. Other currencies omit this line.
  if (getCountryConfig(hostel.country).currency === "PKR") {
  const wordsStr = amountInWords(
    isInvoice
      ? Math.max(0, total - Number(payment.amount_paid ?? 0))
      : isPartial ? payment.amount_paid! : total
  );
  // Render "In Words: <value>" on one line; wrap remainder if it overflows page width.
  // Use explicit gap rather than trailing space — PDF renderers often discard trailing
  // whitespace in text strings, making the space invisible despite correct positioning.
  const wordsLabel = "In Words:";
  const maxLineWidth = MR - ML - 2;
  const labelW = tw(wordsLabel, 7) + 4; // 4pt explicit gap after colon
  const wordTokens = wordsStr.split(" ");
  let firstLine = "";
  let rest: string[] = [];
  for (let i = 0; i < wordTokens.length; i++) {
    const candidate = firstLine ? `${firstLine} ${wordTokens[i]}` : wordTokens[i];
    if (tw(candidate, 7) <= maxLineWidth - labelW) { firstLine = candidate; }
    else { rest = wordTokens.slice(i); break; }
  }
  add(ML, wordsLabel, 7, true);
  add(ML + labelW, firstLine, 7, false); nl(9);
  for (const chunk of rest) {
    // wrap remaining words with same indent as value start
    let line = "";
    for (const w of chunk.split(" ")) {
      const c = line ? `${line} ${w}` : w;
      if (tw(c, 7) <= maxLineWidth - labelW) { line = c; }
      else { add(ML + labelW, line, 7, false); nl(9); line = w; }
    }
    if (line) { add(ML + labelW, line, 7, false); nl(9); }
  }
  nl(4); addDash(); nl(10);
  }

  if (isInvoice) {
    addCenter("This is a bill, not a receipt.", 7, false); nl(9);
    addCenter("Please clear the amount due.", 7, false); nl(10);
  } else {
    addCenter("Thank you for your payment.", 7, false); nl(9);
    addCenter("Keep this receipt for your records.", 7, false); nl(10);
  }
  addDash(); nl(8);

  // Attribution. This document leaves the hostel — a resident forwards it, a
  // parent files it, a bank sees it — so it carries where it came from. On both
  // the receipt and the invoice, and deliberately the smallest thing on the page:
  // it must never compete with the amount.
  addCenter("Powered by yourpulse.io", 6, false); nl(8);

  const PAGE_H = yTop + 10;

  // ─── Assemble PDF stream (convert top-down y → bottom-up PDF y) ─────
  const streamLines: string[] = [];
  for (const cmd of cmds) {
    const pdfY = PAGE_H - cmd.y;
    if (cmd.kind === "line") {
      // Thin solid rule spanning the full content width — perfectly centred by definition
      streamLines.push(`0.4 w ${ML} ${pdfY} m ${MR} ${pdfY} l S`);
    } else {
      const font = cmd.bold ? "/F2" : "/F1";
      streamLines.push(`BT ${font} ${cmd.size} Tf ${cmd.x} ${pdfY} Td (${encodePdfString(cmd.content)}) Tj ET`);
    }
  }

  const streamContent = streamLines.join("\n");
  const streamBytes = latin1Bytes(streamContent);
  const streamLen = streamBytes.length;

  const objects: string[] = [];
  objects[0] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj";
  objects[1] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj";
  objects[2] =
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${PAGE_H}] ` +
    `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`;
  objects[3] =
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`;
  objects[4] = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj";
  objects[5] = "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj";

  // Build PDF using byte arrays so xref offsets are byte-accurate (handles non-ASCII safely).
  const enc = { encode: latin1Bytes };
  const headerBytes = enc.encode("%PDF-1.4\n");
  const objBytes = objects.map((o) => enc.encode(o + "\n"));

  const offsets: number[] = [];
  let pos = headerBytes.length;
  for (const ob of objBytes) {
    offsets.push(pos);
    pos += ob.length;
  }
  const xrefOffset = pos;

  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `).join("\n") +
    "\n";
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const xrefBytes = enc.encode(xref + trailer);
  const pdfBytes = new Uint8Array(headerBytes.length + objBytes.reduce((s, b) => s + b.length, 0) + xrefBytes.length);
  let bytePos = 0;
  pdfBytes.set(headerBytes, bytePos); bytePos += headerBytes.length;
  for (const ob of objBytes) { pdfBytes.set(ob, bytePos); bytePos += ob.length; }
  pdfBytes.set(xrefBytes, bytePos);
  return pdfBytes;
}
