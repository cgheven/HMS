/**
 * Platform invoice PDF — Pulse billing a hostel-owner client (distinct from
 * lib/receipt-pdf.ts, which is tenant-payment receipts). Same dependency-free
 * raw PDF 1.4 approach, kept as a separate file rather than shared primitives
 * since receipt-pdf.ts is production-critical tenant billing code.
 *
 * Base Type1 Helvetica fonts only support single-byte WinAnsi/StandardEncoding —
 * every string here must stay plain ASCII (no em dashes, no curly quotes) or the
 * glyph renders as mojibake.
 */

interface InvoiceData {
  id: string;
  period_label: string;
  billing_cycle: "monthly" | "annual";
  amount: number;
  due_date: string;
  status: "unpaid" | "paid" | "cancelled";
  created_at: string;
  paid_at?: string | null;
  /** Branches this client is being charged for, at the time of this invoice */
  branch_count: number;
  /** List price (annual) for branch_count under the standard formula — used to show the discount, if any */
  standard_annual_price: number;
}

interface InvoiceClient {
  owner_name: string;
  owner_email?: string | null;
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
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

export function generatePlatformInvoicePDF(invoice: InvoiceData, client: InvoiceClient): Uint8Array {
  const W = 380;
  const ML = 24;
  const MR = W - 24;
  const CX = W / 2;

  type Cmd =
    | { kind: "text"; x: number; y: number; content: string; size: number; bold: boolean }
    | { kind: "line"; y: number };
  const cmds: Cmd[] = [];
  let yTop = 30;

  function add(x: number, content: string, size: number, bold: boolean): void {
    cmds.push({ kind: "text", x, y: yTop, content, size, bold });
  }
  function addCenter(content: string, size: number, bold: boolean): void {
    add(Math.max(ML, CX - tw(content, size) / 2), content, size, bold);
  }
  const HV: Record<string, number> = {
    ' ':278,'-':333,'.':278,',':278,':':278,'/':278,'(':333,')':333,'#':556,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,
    'A':667,'B':667,'C':667,'D':722,'E':611,'F':611,'G':722,'H':722,'I':278,'J':500,'K':667,'L':556,'M':722,'N':722,'O':778,'P':611,'Q':778,'R':667,'S':556,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':611,'Z':611,
    'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,'p':556,'q':556,'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,'x':500,'y':500,'z':500,
  };
  function tw(str: string, size: number): number {
    return str.split("").reduce((s, c) => s + (HV[c] ?? 556), 0) / 1000 * size;
  }
  function addKv(key: string, val: string, bold = false): void {
    add(ML, key, 9, bold);
    add(Math.max(ML + 140, MR - tw(val, 9)), val, 9, bold);
  }
  function addDash(): void {
    cmds.push({ kind: "line", y: yTop });
  }
  function nl(n = 14): void { yTop += n; }

  // ─── Content ────────────────────────────────────────────────────────
  addCenter("PULSE", 20, true); nl(18);
  addCenter("Hostel Management System", 8, false); nl(16);
  addDash(); nl(20);

  addCenter("INVOICE", 13, true); nl(15);
  addCenter(`#INV-${invoice.id.slice(0, 8).toUpperCase()}`, 8, false); nl(18);

  add(ML, "Billed To", 8, false); nl(12);
  add(ML, client.owner_name, 11, true); nl(12);
  if (client.owner_email) { add(ML, client.owner_email, 8, false); nl(14); }
  else { nl(6); }
  addDash(); nl(18);

  addKv("Billing Period", `${invoice.period_label} (${invoice.billing_cycle === "monthly" ? "Monthly" : "Annual"})`); nl(16);
  addKv("Issue Date", fmtDate(invoice.created_at)); nl(16);
  addKv("Due Date", fmtDate(invoice.due_date)); nl(16);
  addDash(); nl(20);

  // Amount shown is always in the client's OWN billing cycle — never force-converted
  // to the other unit, so a monthly client never sees an unfamiliar annual number.
  const standardForCycle = invoice.billing_cycle === "monthly"
    ? invoice.standard_annual_price / 12
    : invoice.standard_annual_price;
  const discount = Math.max(0, standardForCycle - invoice.amount);
  const discountPct = standardForCycle > 0 ? (discount / standardForCycle) * 100 : 0;
  const branchLabel = `${invoice.branch_count} Branch${invoice.branch_count !== 1 ? "es" : ""}`;

  if (discount > 0) {
    addKv(`Subscription Fee (${branchLabel})`, pk(standardForCycle)); nl(16);
    addKv(`Discount (${discountPct.toFixed(0)}%)`, `- ${pk(discount)}`); nl(16);
    addDash(); nl(20);
    addKv("TOTAL DUE", pk(invoice.amount), true); nl(20);
  } else {
    addKv(`Subscription Fee (${branchLabel})`, pk(invoice.amount)); nl(20);
    addKv("TOTAL DUE", pk(invoice.amount), true); nl(20);
  }

  if (invoice.branch_count > 1) {
    const perBranch = invoice.amount / invoice.branch_count;
    const unit = invoice.billing_cycle === "monthly" ? "month" : "year";
    add(ML, `(${pk(perBranch)} per branch / ${unit})`, 7, false); nl(14);
  }
  addDash(); nl(18);

  if (invoice.status === "paid") {
    addCenter(`PAID${invoice.paid_at ? " on " + fmtDate(invoice.paid_at) : ""}`, 10, true); nl(16);
  } else {
    addCenter("Please share payment proof over WhatsApp once transferred.", 8, false); nl(12);
  }
  addCenter("Thank you for using Pulse.", 8, false); nl(16);
  addDash(); nl(10);

  const PAGE_H = yTop + 16;

  // ─── Assemble PDF stream ─────────────────────────────────────────────
  const streamLines: string[] = [];
  for (const cmd of cmds) {
    const pdfY = PAGE_H - cmd.y;
    if (cmd.kind === "line") {
      streamLines.push(`0.6 w ${ML} ${pdfY} m ${MR} ${pdfY} l S`);
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
