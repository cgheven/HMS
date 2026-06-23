/**
 * Minimal PDF receipt generator — no external dependency required.
 *
 * NOTE: jsPDF is NOT in package.json. This module produces a hand-crafted
 * single-page PDF using only the built-in PDF 1.4 syntax so the route
 * /r/[token] can generate receipts without adding a dependency.
 *
 * The output is a valid Uint8Array that browsers download as a PDF.
 */

interface ReceiptPayment {
  receipt_number?: string | null;
  for_month: string;
  amount: number;
  late_fee?: number;
  food_charge?: number;
  ac_charge?: number;
  payment_method?: string | null;
  payment_date?: string | null;
  payment_package_tier?: string | null;
}

interface ReceiptTenant {
  full_name: string;
  phone?: string | null;
  // F-008: CNIC is sensitive PII; it must NOT appear in public-facing receipts.
  // The field is omitted from this interface so it cannot be passed in by callers.
  room_id?: string | null;
}

interface ReceiptHostel {
  name: string;
  address?: string | null;
  phone?: string | null;
}

// ---------------------------------------------------------------------------
// Tiny PDF builder — enough for a clean text receipt
// ---------------------------------------------------------------------------

function encodePdfString(str: string): string {
  // PDF literal string: parentheses and backslash must be escaped
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

export function generateReceiptPDF(
  payment: ReceiptPayment,
  tenant: ReceiptTenant,
  hostel: ReceiptHostel
): Uint8Array {
  const PAGE_W = 595; // A4 width in pts
  const PAGE_H = 842; // A4 height in pts

  const lines: string[] = [];

  function text(x: number, y: number, content: string, size = 11): void {
    lines.push(`BT /F1 ${size} Tf ${x} ${PAGE_H - y} Td (${encodePdfString(content)}) Tj ET`);
  }
  function boldText(x: number, y: number, content: string, size = 11): void {
    lines.push(`BT /F2 ${size} Tf ${x} ${PAGE_H - y} Td (${encodePdfString(content)}) Tj ET`);
  }
  function hrLine(y: number): void {
    lines.push(`${40} ${PAGE_H - y} m ${PAGE_W - 40} ${PAGE_H - y} l S`);
  }

  // ---- Content layout ----
  let y = 60;

  // Hostel name (large heading)
  boldText(40, y, hostel.name, 18);
  y += 24;
  if (hostel.address) { text(40, y, hostel.address, 9); y += 14; }
  if (hostel.phone) { text(40, y, `Phone: ${hostel.phone}`, 9); y += 14; }

  y += 6;
  hrLine(y);
  y += 16;

  boldText(40, y, "PAYMENT RECEIPT", 14);
  y += 20;
  hrLine(y);
  y += 16;

  // Receipt meta
  text(40, y, `Receipt No: ${payment.receipt_number ?? "N/A"}`);
  text(320, y, `Date: ${fmtDate(payment.payment_date)}`);
  y += 16;
  text(40, y, `Month: ${payment.for_month}`);
  text(320, y, `Method: ${methodLabel(payment.payment_method)}`);
  y += 20;
  hrLine(y);
  y += 16;

  // Tenant info
  boldText(40, y, "Tenant Information", 11);
  y += 16;
  text(40, y, `Name: ${tenant.full_name}`);
  if (tenant.phone) text(320, y, `Phone: ${tenant.phone}`);
  y += 14;
  // F-008: CNIC intentionally excluded — it is sensitive PII that must not
  // appear on publicly accessible (unauthenticated) receipt documents.
  y += 6;
  hrLine(y);
  y += 16;

  // Payment breakdown
  boldText(40, y, "Payment Breakdown", 11);
  y += 16;

  const baseRent = payment.amount - (payment.food_charge ?? 0) - (payment.ac_charge ?? 0);
  text(40, y, "Base Rent:");
  text(400, y, pk(Math.max(0, baseRent)));
  y += 14;

  if ((payment.food_charge ?? 0) > 0) {
    text(40, y, "Food Charge:");
    text(400, y, pk(payment.food_charge!));
    y += 14;
  }

  if ((payment.ac_charge ?? 0) > 0) {
    text(40, y, "AC Charge:");
    text(400, y, pk(payment.ac_charge!));
    y += 14;
  }

  if ((payment.late_fee ?? 0) > 0) {
    text(40, y, "Late Fee:");
    text(400, y, pk(payment.late_fee!));
    y += 14;
  }

  y += 6;
  hrLine(y);
  y += 14;

  const total = payment.amount + (payment.late_fee ?? 0);
  boldText(40, y, "TOTAL PAID:", 12);
  boldText(400, y, pk(total), 12);
  y += 24;
  hrLine(y);
  y += 24;

  // Footer
  text(40, y, "Thank you for your payment. Please keep this receipt for your records.", 9);
  y += 14;
  text(40, y, `Generated: ${new Date().toLocaleString("en-PK")}`, 8);

  // ---- Assemble PDF structure ----
  const streamContent = lines.join("\n");
  const streamBytes = new TextEncoder().encode(streamContent);
  const streamLen = streamBytes.length;

  const objects: string[] = [];
  const offsets: number[] = [];

  // Object 1: Catalog
  objects[0] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj";
  // Object 2: Pages
  objects[1] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj";
  // Object 3: Page
  objects[2] =
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`;
  // Object 4: Content stream
  objects[3] =
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`;
  // Object 5: Helvetica
  objects[4] =
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj";
  // Object 6: Helvetica-Bold
  objects[5] =
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj";

  const header = "%PDF-1.4\n";
  let body = header;

  for (let i = 0; i < objects.length; i++) {
    offsets[i] = body.length;
    body += objects[i] + "\n";
  }

  const xrefOffset = body.length;
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `).join("\n") +
    "\n";

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const full = body + xref + trailer;
  return new TextEncoder().encode(full);
}
