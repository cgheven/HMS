/**
 * Narrow thermal-style receipt PDF — 250pt wide, dynamic height.
 * No external dependency; pure PDF 1.4 text stream, no jsPDF.
 */

interface ReceiptPayment {
  receipt_number?: string | null;
  for_month: string;
  amount: number;
  late_fee?: number;
  food_charge?: number;
  ac_charge?: number;
  security_deposit?: number;
  payment_method?: string | null;
  payment_date?: string | null;
  payment_package_tier?: string | null;
}

interface ReceiptTenant {
  full_name: string;
  phone?: string | null;
  // F-008: CNIC is sensitive PII; must NOT appear in public-facing receipts.
  room_id?: string | null;
}

interface ReceiptHostel {
  name: string;
  address?: string | null;
  phone?: string | null;
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

export function generateReceiptPDF(
  payment: ReceiptPayment,
  tenant: ReceiptTenant,
  hostel: ReceiptHostel
): Uint8Array {
  const W = 250;      // narrow thermal width in pts
  const ML = 12;      // left margin
  const MR = W - 12;  // right edge
  const CX = W / 2;

  // Collect commands top-down (y=0 at top), convert to PDF coords (y=0 at bottom) after.
  type Cmd = { x: number; y: number; content: string; size: number; bold: boolean };
  const cmds: Cmd[] = [];
  let yTop = 14;

  function add(x: number, content: string, size: number, bold: boolean): void {
    cmds.push({ x, y: yTop, content, size, bold });
  }
  function addCenter(content: string, size: number, bold: boolean): void {
    const approxWidth = content.length * size * 0.46;
    add(Math.max(ML, CX - approxWidth / 2), content, size, bold);
  }
  function addKv(key: string, val: string, bold = false): void {
    add(ML, key, 8, bold);
    const approxWidth = val.length * 8 * 0.46;
    add(Math.max(ML + 60, MR - approxWidth), val, 8, bold);
  }
  function addDash(): void {
    add(ML, "- - - - - - - - - - - - - - - - - - - -", 7, false);
  }
  function nl(n = 11): void { yTop += n; }

  // ─── Content ────────────────────────────────────────────────────────
  addCenter(hostel.name, 12, true); nl(15);
  if (hostel.address) { addCenter(hostel.address, 7, false); nl(10); }
  if (hostel.phone) { addCenter(`Tel: ${hostel.phone}`, 7, false); nl(10); }
  nl(3); addDash(); nl(10);
  addCenter("PAYMENT RECEIPT", 9, true); nl(10);
  addDash(); nl(10);

  addKv("Receipt #", payment.receipt_number ?? "N/A"); nl(12);
  addKv("Date", fmtDate(payment.payment_date)); nl(12);
  addKv("Month", payment.for_month); nl(12);
  addKv("Method", methodLabel(payment.payment_method)); nl(12);
  addDash(); nl(10);

  add(ML, "Tenant:", 8, true); nl(12);
  add(ML, tenant.full_name, 8, false); nl(12);
  if (tenant.phone) { add(ML, `Phone: ${tenant.phone}`, 8, false); nl(12); }
  nl(2); addDash(); nl(10);

  add(ML, "Breakdown:", 8, true); nl(12);
  const baseRent = payment.amount - (payment.food_charge ?? 0) - (payment.ac_charge ?? 0);
  addKv("Base Rent", pk(Math.max(0, baseRent))); nl(12);
  if ((payment.food_charge ?? 0) > 0)    { addKv("Food", pk(payment.food_charge!)); nl(12); }
  if ((payment.ac_charge ?? 0) > 0)      { addKv("AC Charge", pk(payment.ac_charge!)); nl(12); }
  if ((payment.late_fee ?? 0) > 0)       { addKv("Late Fee", pk(payment.late_fee!)); nl(12); }
  if ((payment.security_deposit ?? 0) > 0) {
    addKv("Security Deposit", pk(payment.security_deposit!)); nl(12);
    add(ML, "(refundable on checkout)", 6, false); nl(10);
  }
  nl(2); addDash(); nl(10);

  const total = payment.amount + (payment.late_fee ?? 0) + (payment.security_deposit ?? 0);
  addKv("TOTAL PAID", pk(total), true); nl(15);
  addDash(); nl(10);

  add(ML, "In Words:", 7, true); nl(10);
  const wordsStr = amountInWords(total);
  for (let i = 0; i < wordsStr.length; i += 36) {
    add(ML, wordsStr.slice(i, i + 36), 7, false); nl(9);
  }
  nl(4); addDash(); nl(10);

  addCenter("Thank you for your payment.", 7, false); nl(9);
  addCenter("Keep this receipt for your records.", 7, false); nl(9);
  addCenter(`Printed: ${new Date().toLocaleDateString("en-PK")}`, 6, false); nl(8);

  const PAGE_H = yTop + 10;

  // ─── Assemble PDF stream (convert top-down y → bottom-up PDF y) ─────
  const streamLines: string[] = [];
  for (const cmd of cmds) {
    const font = cmd.bold ? "/F2" : "/F1";
    const pdfY = PAGE_H - cmd.y;
    streamLines.push(`BT ${font} ${cmd.size} Tf ${cmd.x} ${pdfY} Td (${encodePdfString(cmd.content)}) Tj ET`);
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
