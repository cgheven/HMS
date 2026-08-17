/**
 * Narrow thermal-style receipt PDF — 250pt wide, dynamic height.
 * No external dependency; pure PDF 1.4 text stream, no jsPDF.
 */

import { splitPaymentCharges } from "@/lib/payment-calc";

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
}

interface ReceiptTenant {
  full_name: string;
  phone?: string | null;
  // F-008: CNIC is sensitive PII; must NOT appear in public-facing receipts.
  room_id?: string | null;
  joining_meter_reading?: number | null;
  food_breakfast?: boolean;
  food_lunch?: boolean;
  food_dinner?: boolean;
}

interface ReceiptHostel {
  name: string;
  address?: string | null;
  phone?: string | null;
  /** Renames the metered AC line for branches that bill it as one electricity
   *  charge covering the whole room. Null/blank prints "AC Charges", so a branch
   *  that never sets it produces a byte-identical receipt to before. */
  acChargeLabel?: string | null;
}

function encodePdfString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function pk(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

function methodLabel(m: string | null | undefined): string {
  if (!m) return "—";
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function amountInWords(n: number): string {
  const rounded = Math.round(n);
  if (rounded === 0) return "Zero Rupees Only";
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
  return words(rounded) + " Rupees Only";
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
    addKv("Issued", fmtDate(new Date().toISOString().slice(0, 10))); nl(12);
  } else {
    addKv("Receipt #", payment.receipt_number ?? "N/A"); nl(12);
    addKv(isReservation ? "Collected On" : "Date", fmtDate(payment.payment_date)); nl(12);
    if (isReservation) {
      if (payment.reservation_from) { addKv("Seat Held From", fmtDate(payment.reservation_from)); nl(12); }
    } else {
      addKv("Period", fmtMonth(payment.for_month)); nl(12);
    }
    addKv("Method", (payment.payment_method ?? "—").toUpperCase()); nl(12);
  }
  addDash(); nl(10);

  add(ML, "Tenant:", 8, true); nl(12);
  add(ML, tenant.full_name, 8, false); nl(12);
  if (tenant.phone) { add(ML, `Phone: ${tenant.phone}`, 8, false); nl(12); }
  // Printed on every receipt (not just the first month) — it's a permanent
  // reference the tenant can always point back to if AC billing is disputed.
  if (tenant.joining_meter_reading != null) {
    add(ML, `AC Meter Reading at Move-in: ${tenant.joining_meter_reading}`, 7, false); nl(11);
  }
  nl(2); addDash(); nl(10);

  add(ML, isReservation ? "Details:" : "Breakdown:", 8, true); nl(12);
  // Food-inclusive package tiers bundle food into monthly_rent with no separate
  // food_charge (0), so this only itemizes food when it was billed as an add-on.
  const { rent: baseRent, referralDiscount } = splitPaymentCharges(payment);
  // The rent line above is GROSS while `payment.amount` is stored net, so this
  // negative line is exactly what makes the itemisation add back up to the total.
  // Deliberately anonymous: this PDF is served from a public token URL, and the
  // reader does not need to know who they referred.
  function addReferralDiscount(): void {
    if (referralDiscount <= 0) return;
    const pct = Number(payment.referral_percent ?? 0);
    addKv(pct > 0 ? `Referral Discount (${pct}%)` : "Referral Discount", `-${pk(referralDiscount)}`); nl(12);
  }
  if (isReservation) {
    addKv("Seat Reservation Deposit", pk(payment.security_deposit_charge ?? payment.amount)); nl(12);
    add(ML, "(refundable, held against your booking)", 6, false); nl(10);
    if ((payment.registration_fee_charge ?? 0) > 0) {
      addKv("Registration Fee", pk(payment.registration_fee_charge!)); nl(12);
      add(ML, "(one-time, non-refundable)", 6, false); nl(10);
    }
    addReferralDiscount();
    add(ML, "This is not a monthly bill. Rent begins", 6, false); nl(8);
    add(ML, "from the date of joining.", 6, false); nl(10);
  }
  if (!isReservation) {
    // A daily tenant is not on a monthly rent, and printing that label on their
    // receipt is simply wrong. Use the snapshot taken when the row was billed
    // rather than recomputing from the tenant's dates — those keep moving after
    // the receipt is issued, and a receipt must say what was actually charged.
    const isDailyRow = (payment.billed_days ?? 0) > 0 && (payment.daily_rate_billed ?? 0) > 0;
    const rentLabel = isDailyRow
      ? `${payment.billed_days} ${payment.billed_days === 1 ? "day" : "days"} x ${pk(payment.daily_rate_billed!)}`
      : "Monthly Rent";
    addKv(rentLabel, pk(Math.max(0, baseRent))); nl(12);
    if ((payment.food_charge ?? 0) > 0) {
      addKv("Food Charges", pk(payment.food_charge!)); nl(11);
      const mealsLabel = [tenant.food_breakfast && "Breakfast", tenant.food_lunch && "Lunch", tenant.food_dinner && "Dinner"]
        .filter(Boolean).join(" + ");
      if (mealsLabel) { add(ML + 4, mealsLabel, 6, false); nl(9); }
      nl(2);
    }
    if ((payment.ac_charge ?? 0) > 0) {
      addKv(hostel.acChargeLabel?.trim() || "AC Charges", pk(payment.ac_charge!)); nl(11);
      const realRate = payment.ac_per_unit_rate && payment.ac_per_unit_rate > 0 ? payment.ac_per_unit_rate : 0;
      const storedUnits = Number(payment.ac_units_consumed ?? 0);
      if (realRate > 0) {
        // Derive units from charge ÷ real rate so the sub-line is always consistent
        // with the actual rate, regardless of what was stored in ac_units_consumed.
        // Rounded to 2dp (ac_units_consumed's DB precision), not a whole unit —
        // otherwise an even split like 72.5 would display as "73".
        const displayUnits = Math.round((payment.ac_charge! / realRate) * 100) / 100;
        add(ML + 4, `${displayUnits} units x Rs. ${realRate}/unit`, 6, false); nl(9);
      } else if (storedUnits > 0) {
        // Fallback: back-calculate rate from stored units (regular monthly pay path)
        const rate = Math.round(payment.ac_charge! / storedUnits);
        add(ML + 4, `${storedUnits} units x Rs. ${rate}/unit`, 6, false); nl(9);
      } else {
        nl(1);
      }
      nl(2);
    }
    if ((payment.late_fee ?? 0) > 0)       { addKv("Late Fee", pk(payment.late_fee!)); nl(12); }
    if ((payment.ac_maintenance_charge ?? 0) > 0) {
      addKv("AC Maintenance", pk(payment.ac_maintenance_charge!)); nl(12);
    }
    if ((payment.security_deposit_charge ?? 0) > 0) {
      // Actually charged as part of THIS bill (first month) — already included
      // in `payment.amount`, so it's itemized here, not added again below.
      addKv("Security Deposit", pk(payment.security_deposit_charge!)); nl(12);
      add(ML, "(refundable on checkout)", 6, false); nl(10);
    }
    if ((payment.registration_fee_charge ?? 0) > 0) {
      addKv("Registration Fee", pk(payment.registration_fee_charge!)); nl(12);
      add(ML, "(one-time, non-refundable)", 6, false); nl(10);
    }
    if (payment.is_checkout && (payment.security_deposit ?? 0) > 0) {
      // Informational only — the deposit was already collected at move-in, not
      // part of this checkout payment's amount.
      addKv("Security Deposit Refund", pk(payment.security_deposit!)); nl(12);
      add(ML, "(to be returned to tenant)", 6, false); nl(10);
    }
    // LAST, immediately above the total. Everything above it is added; this is
    // the only line that is taken off, so putting it anywhere in the middle
    // makes the column impossible to add down — the reader hits a subtraction,
    // then more additions, and has to backtrack to check the total.
    addReferralDiscount();
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

  if (isInvoice) {
    addCenter("This is a bill, not a receipt.", 7, false); nl(9);
    addCenter("Please clear the amount due.", 7, false); nl(10);
  } else {
    addCenter("Thank you for your payment.", 7, false); nl(9);
    addCenter("Keep this receipt for your records.", 7, false); nl(10);
  }
  addDash(); nl(8);

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
  const streamBytes = new TextEncoder().encode(streamContent);
  const streamLen = streamBytes.length;

  const objects: string[] = [];
  objects[0] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj";
  objects[1] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj";
  objects[2] =
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${PAGE_H}] ` +
    `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`;
  objects[3] =
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`;
  objects[4] = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj";
  objects[5] = "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj";

  // Build PDF using byte arrays so xref offsets are byte-accurate (handles non-ASCII safely).
  const enc = new TextEncoder();
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
