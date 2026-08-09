/**
 * Platform invoice PDF — Pulse billing a hostel-owner client (distinct from
 * lib/receipt-pdf.ts, which is tenant-payment receipts). Built with jsPDF
 * (already a project dependency) rather than raw PDF bytes, since the visual
 * design needs filled/rounded rects, icons and color that a hand-rolled writer
 * can't do without reimplementing half of jsPDF.
 */
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";
import { ONBOARDING_FEE, listSubtotalFromDiscount } from "@/lib/pricing";

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
  /** Rate/discount/onboarding snapshot that produced `amount` at generation time */
  monthly_rate: number;
  discount_pct: number;
  onboarding_fee_charged: number;
  is_first_invoice: boolean;
}

interface InvoiceClient {
  owner_name: string;
  owner_email?: string | null;
  owner_phone?: string | null;
}

const INK: [number, number, number] = [17, 17, 19];
const ORANGE: [number, number, number] = [245, 166, 35];
const GRAY: [number, number, number] = [110, 110, 116];
const LIGHT_GRAY: [number, number, number] = [244, 244, 246];
const BORDER: [number, number, number] = [225, 225, 229];
const WHITE: [number, number, number] = [255, 255, 255];
const EMERALD: [number, number, number] = [16, 150, 100];
const CREAM: [number, number, number] = [250, 238, 216];

// Logo is a transparent-cutout PNG (see lib/assets/pulse-logo.png) so it composites
// cleanly onto the header's ink background regardless of exact shade.
const LOGO_PATH = path.join(process.cwd(), "lib/assets/pulse-logo.png");
const LOGO_ASPECT = 1255 / 403;
let logoBase64: string | null | undefined;
function getLogoBase64(): string | null {
  if (logoBase64 === undefined) {
    try {
      logoBase64 = fs.readFileSync(LOGO_PATH).toString("base64");
    } catch {
      logoBase64 = null;
    }
  }
  return logoBase64;
}

function pk(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

type IconName = "building" | "person" | "envelope" | "globe" | "phone" | "percent" | "calendar" | "package" | "pin";

/** Small hand-drawn vector glyphs — base14 fonts have no icon characters, so these
 * are built from jsPDF's primitive shapes instead of a font/image dependency. */
function drawIcon(doc: jsPDF, name: IconName, x: number, y: number, size: number, color: [number, number, number]): void {
  doc.setDrawColor(...color);
  doc.setFillColor(...color);
  doc.setLineWidth(0.6);
  const cx = x + size / 2;
  const cy = y + size / 2;

  switch (name) {
    case "building": {
      // A door anchors this as unmistakably a building rather than a plain grid —
      // the previous version (just 4 evenly-spaced window squares near-touching
      // the outer wall) read as an abstract grid icon at small sizes.
      const w = size * 0.64;
      const h = size * 0.86;
      const bx = x + (size - w) / 2;
      const by = y + (size - h);
      doc.rect(bx, by, w, h, "S");
      const winW = w * 0.24;
      const winH = h * 0.16;
      doc.rect(bx + w * 0.14, by + h * 0.16, winW, winH, "S");
      doc.rect(bx + w * 0.62, by + h * 0.16, winW, winH, "S");
      doc.rect(bx + w * 0.14, by + h * 0.44, winW, winH, "S");
      doc.rect(bx + w * 0.62, by + h * 0.44, winW, winH, "S");
      const doorW = w * 0.32;
      const doorH = h * 0.3;
      doc.rect(bx + (w - doorW) / 2, by + h - doorH, doorW, doorH, "S");
      break;
    }
    case "person": {
      const headR = size * 0.19;
      doc.circle(cx, y + size * 0.28, headR, "S");
      const bw = size * 0.62;
      doc.roundedRect(cx - bw / 2, y + size * 0.48, bw, size * 0.46, 2, 2, "S");
      break;
    }
    case "envelope": {
      const w = size;
      const h = size * 0.72;
      const ey = y + (size - h) / 2;
      doc.rect(x, ey, w, h, "S");
      doc.line(x, ey, x + w / 2, ey + h * 0.58);
      doc.line(x + w, ey, x + w / 2, ey + h * 0.58);
      break;
    }
    case "globe": {
      const r = size / 2;
      doc.circle(cx, cy, r, "S");
      doc.line(x, cy, x + size, cy);
      doc.ellipse(cx, cy, r * 0.4, r, "S");
      break;
    }
    case "phone": {
      const w = size * 0.5;
      const h = size * 0.85;
      doc.roundedRect(cx - w / 2, y + (size - h) / 2, w, h, 2, 2, "S");
      doc.circle(cx, y + size * 0.76, 0.7, "F");
      break;
    }
    case "percent": {
      const r = size * 0.15;
      doc.circle(x + size * 0.27, y + size * 0.27, r, "S");
      doc.circle(x + size * 0.73, y + size * 0.73, r, "S");
      doc.line(x + size * 0.15, y + size * 0.85, x + size * 0.85, y + size * 0.15);
      break;
    }
    case "calendar": {
      const w = size;
      const h = size * 0.82;
      const topPad = size * 0.18;
      doc.roundedRect(x, y + topPad, w, h, 1.2, 1.2, "S");
      doc.line(x + w * 0.24, y + topPad - 2.5, x + w * 0.24, y + topPad + 2);
      doc.line(x + w * 0.76, y + topPad - 2.5, x + w * 0.76, y + topPad + 2);
      doc.line(x, y + topPad + h * 0.32, x + w, y + topPad + h * 0.32);
      doc.rect(x + w * 0.38, y + topPad + h * 0.52, w * 0.24, h * 0.24, "F");
      break;
    }
    case "package": {
      const w = size * 0.85;
      const h = size * 0.75;
      const bx = x + (size - w) / 2;
      const by = y + (size - h);
      doc.rect(bx, by, w, h, "S");
      doc.line(bx, by + h * 0.32, bx + w, by + h * 0.32);
      doc.line(bx + w / 2, by, bx + w / 2, by + h * 0.32);
      break;
    }
    case "pin": {
      const r = size * 0.3;
      const pcx = x + size / 2;
      const pcy = y + r + 1;
      doc.circle(pcx, pcy, r, "S");
      doc.triangle(pcx - r * 0.7, pcy + r * 0.55, pcx + r * 0.7, pcy + r * 0.55, pcx, y + size, "S");
      doc.circle(pcx, pcy, r * 0.32, "F");
      break;
    }
  }
}

function badgedIcon(doc: jsPDF, name: IconName, cx: number, cy: number, badgeR: number): void {
  doc.setFillColor(...CREAM);
  doc.circle(cx, cy, badgeR, "F");
  const size = badgeR * 1.05;
  drawIcon(doc, name, cx - size / 2, cy - size / 2, size, [190, 140, 40]);
}

export function generatePlatformInvoicePDF(invoice: InvoiceData, client: InvoiceClient): Uint8Array {
  const W = 480;
  const ML = 24;
  const MR = W - 24;
  /**
   * Draw text that must not cross into the next column.
   *
   * The BILLED TO column is ~101pt wide before it meets the vertical rule at
   * COL_INFO - 14. An 8pt email of ~25 characters fits; a real one like
   * muhammadfaizannadeem95@gmail.com is 32 and used to run straight through the
   * divider and into the billing box.
   *
   * Shrinks a step at a time down to 6pt — an invoice is a document someone may
   * need to read back, so truncating an email with an ellipsis would destroy
   * information rather than present it. Only if it still will not fit does it
   * split across two lines, and it returns the height consumed so the caller can
   * advance past however many lines were used.
   */
  function fitText(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: any, text: string, x: number, y: number, maxWidth: number, baseSize = 8
  ): number {
    let size = baseSize;
    d.setFontSize(size);
    while (size > 6 && d.getTextWidth(text) > maxWidth) {
      size -= 0.5;
      d.setFontSize(size);
    }
    if (d.getTextWidth(text) <= maxWidth) {
      d.text(text, x, y);
      d.setFontSize(baseSize);
      return 15;
    }
    // Still too wide at the floor — wrap rather than clip.
    const lines: string[] = d.splitTextToSize(text, maxWidth);
    lines.forEach((ln: string, i: number) => d.text(ln, x, y + i * (size + 2)));
    d.setFontSize(baseSize);
    return 15 + (lines.length - 1) * (size + 2);
  }

  const COL_FROM = ML;
  const COL_BILLED = ML + 130;
  const COL_INFO = ML + 260;

  // Everything is shown in the client's OWN billing cycle — never force-converted
  // to the other unit, so a monthly client never sees an unfamiliar annual number.
  // invoice.monthly_rate is the ACTUAL (already-discounted) PER-BRANCH rate; the
  // list/standard price is derived back from the snapshotted discount_pct, not
  // recomputed live. Onboarding stays flat account-level, not per branch.
  const months = invoice.billing_cycle === "monthly" ? 1 : 12;
  const actualSubtotal = invoice.monthly_rate * months * invoice.branch_count;
  const listSubtotal = listSubtotalFromDiscount(actualSubtotal, invoice.discount_pct);
  const discount = listSubtotal - actualSubtotal;
  // The onboarding fee is fixed platform-wide — if it was waived, onboarding_fee_charged
  // is 0, but the "everything included" reference still needs to show what it would've been.
  const standardOnboarding = invoice.is_first_invoice ? ONBOARDING_FEE : 0;
  const onboardingWaived = standardOnboarding - invoice.onboarding_fee_charged;
  const listTotal = listSubtotal + standardOnboarding;
  const totalSavings = listTotal - invoice.amount;
  const branchLabel = `${invoice.branch_count} Branch${invoice.branch_count !== 1 ? "es" : ""}`;
  // Both the standard (undiscounted) and actual charged per-branch rate are shown
  // side by side on the subscription line, so the discount is never just an
  // abstract percentage — it's visibly tied to a concrete before/after number.
  const perBranchStandard = listSubtotal / invoice.branch_count;
  const perBranchActual = invoice.monthly_rate * months;
  const cycleWord = invoice.billing_cycle === "monthly" ? "month" : "year";

  const statusInfo =
    invoice.status === "paid"
      ? { label: `PAID${invoice.paid_at ? " ON " + fmtDate(invoice.paid_at).toUpperCase() : ""}`, color: EMERALD }
      : invoice.status === "cancelled"
        ? { label: "CANCELLED", color: GRAY }
        : { label: "PENDING PAYMENT", color: ORANGE };

  // ─── Pass 1: measure total height, then pass 2: draw at that page size ────
  function layout(doc: jsPDF | null): number {
    let y = 0;

    // Header band
    const headerH = 108;
    y = headerH;
    if (doc) {
      doc.setFillColor(...INK);
      doc.rect(0, 0, W, headerH, "F");

      const logo = getLogoBase64();
      if (logo) {
        const logoH = 42;
        const logoW = logoH * LOGO_ASPECT;
        doc.addImage(logo, "PNG", ML, (headerH - logoH) / 2 - 4, logoW, logoH);
      } else {
        doc.setTextColor(...ORANGE);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("Pulse", ML, 40);
        doc.setTextColor(200, 200, 205);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Hostel Management System", ML, 54);
      }

      doc.setTextColor(...WHITE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("INVOICE", MR, 38, { align: "right" });
      doc.setTextColor(190, 190, 196);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`#INV-${invoice.id.slice(0, 8).toUpperCase()}`, MR, 51, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      const pillLabel = statusInfo.label;
      const pillTextW = doc.getTextWidth(pillLabel);
      const pillW = pillTextW + 22;
      const pillH = 18;
      const pillX = MR - pillW;
      const pillY = 62;
      doc.setDrawColor(...statusInfo.color);
      doc.setLineWidth(0.8);
      doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, "S");
      doc.setTextColor(...statusInfo.color);
      doc.text(pillLabel, pillX + pillW / 2, pillY + 12.5, { align: "center" });

      doc.setFillColor(...ORANGE);
      doc.rect(0, headerH - 2, W, 2, "F");
    }
    y += 26;

    // From | Billed To | Billing details — three columns side by side, matching
    // the reference layout exactly, separated by thin vertical rules.
    const sectionTop = y;
    const headerIconSize = 11;
    const iconSize = 9;
    const textX = 15;

    if (doc) {
      drawIcon(doc, "building", COL_FROM, y - headerIconSize * 0.78, headerIconSize, ORANGE);
      doc.setTextColor(...ORANGE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("FROM", COL_FROM + headerIconSize + 5, y);

      drawIcon(doc, "person", COL_BILLED, y - headerIconSize * 0.78, headerIconSize, ORANGE);
      doc.text("BILLED TO", COL_BILLED + headerIconSize + 5, y);
    }
    y += 20;

    let leftY = y;
    let rightY = y;

    if (doc) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(20, 20, 22);
      doc.text("PulseHub Private Limited", COL_FROM, leftY);
      fitText(doc, client.owner_name, COL_BILLED, rightY, COL_INFO - 14 - COL_BILLED - 6, 9);
    }
    leftY += 17;
    rightY += 17;

    if (doc) {
      drawIcon(doc, "envelope", COL_FROM, leftY - iconSize * 0.68, iconSize, GRAY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      doc.text("hello@yourpulse.io", COL_FROM + textX, leftY);
    }
    leftY += 15;

    if (client.owner_email && doc) {
      drawIcon(doc, "envelope", COL_BILLED, rightY - iconSize * 0.68, iconSize, GRAY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      rightY += fitText(
        doc, client.owner_email, COL_BILLED + textX, rightY,
        // Stop short of the vertical rule at COL_INFO - 14, with a small gutter
        // so a descender never touches the line.
        COL_INFO - 14 - (COL_BILLED + textX) - 6
      );
    }

    if (doc) {
      drawIcon(doc, "globe", COL_FROM, leftY - iconSize * 0.68, iconSize, GRAY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      doc.text("hostel.yourpulse.io", COL_FROM + textX, leftY);
    }
    leftY += 15;

    if (client.owner_phone && doc) {
      drawIcon(doc, "phone", COL_BILLED, rightY - iconSize * 0.68, iconSize, GRAY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      rightY += fitText(
        doc, client.owner_phone, COL_BILLED + textX, rightY,
        COL_INFO - 14 - (COL_BILLED + textX) - 6
      );
    }

    if (doc) {
      drawIcon(doc, "pin", COL_FROM, leftY - iconSize * 0.68, iconSize, GRAY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      doc.text("Karachi, Pakistan", COL_FROM + textX, leftY);
    }
    leftY += 15;

    const colContentH = Math.max(leftY, rightY) - sectionTop;

    // Dark billing-details box — sits alongside FROM/BILLED TO as the third column
    const boxRows: [IconName, string, string][] = [
      ["calendar", "Billing Period", `${invoice.period_label} (${invoice.billing_cycle === "monthly" ? "Monthly" : "Annual"})`],
      ["calendar", "Issue Date", fmtDate(invoice.created_at)],
      ["calendar", "Due Date", fmtDate(invoice.due_date)],
      ["package", "Plan", invoice.billing_cycle === "monthly" ? "Monthly" : "Annual"],
    ];
    const boxPad = 10;
    const boxRowH = 18;
    const boxH = boxPad * 2 + boxRows.length * boxRowH - 4;
    const infoBoxX = COL_INFO;
    const infoBoxW = MR - COL_INFO;
    if (doc) {
      doc.setFillColor(...INK);
      doc.roundedRect(infoBoxX, sectionTop - headerIconSize * 0.6, infoBoxW, boxH, 6, 6, "F");
      let ry = sectionTop - headerIconSize * 0.6 + boxPad + 9;
      for (const [ic, k, v] of boxRows) {
        drawIcon(doc, ic, infoBoxX + 12, ry - 8, 10, ORANGE);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(160, 160, 166);
        doc.text(k, infoBoxX + 28, ry);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...WHITE);
        doc.text(v, infoBoxX + infoBoxW - 12, ry, { align: "right" });
        ry += boxRowH;
      }
    }

    const dividerH = Math.max(colContentH, boxH);
    if (doc) {
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.line(COL_BILLED - 14, sectionTop - 6, COL_BILLED - 14, sectionTop - 6 + dividerH);
      doc.line(COL_INFO - 14, sectionTop - 6, COL_INFO - 14, sectionTop - 6 + dividerH);
    }

    y = sectionTop - headerIconSize * 0.6 + boxH + 24;

    if (doc) {
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.line(ML, y, MR, y);
    }
    y += 22;

    // Line-item table
    const tableHeaderH = 22;
    if (doc) {
      doc.setFillColor(...INK);
      doc.rect(ML, y, MR - ML, tableHeaderH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...WHITE);
      doc.text("DESCRIPTION", ML + 10, y + 14);
      doc.text("QTY", MR - 150, y + 14, { align: "center" });
      doc.text("RATE", MR - 80, y + 14, { align: "right" });
      doc.text("AMOUNT", MR - 10, y + 14, { align: "right" });
    }
    y += tableHeaderH + 28;

    // The subscription row shows what's ACTUALLY charged (rate × qty = amount),
    // exactly like a normal invoice line — with the standard rate as a visible
    // point of comparison underneath whenever a discount applies, so the number
    // in AMOUNT is never a "before discount" figure dressed up as the charge.
    const rowBadgeR = 13;
    const subLineH = 11;
    if (doc) {
      badgedIcon(doc, "building", ML + rowBadgeR, y + 4, rowBadgeR);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(20, 20, 22);
      doc.text(`Hostel Subscription (${branchLabel})`, ML + rowBadgeR * 2 + 8, y);
      // No subtitle at all when paying full price — RATE and AMOUNT already say
      // everything there is to say. The before/after comparison only earns its
      // place on the invoice when there's an actual discount to explain.
      if (discount > 0) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...GRAY);
        doc.text(`Standard ${pk(perBranchStandard)}/branch/${cycleWord}`, ML + rowBadgeR * 2 + 8, y + 14);
        doc.text(`Charging ${pk(perBranchActual)}/branch/${cycleWord}`, ML + rowBadgeR * 2 + 8, y + 14 + subLineH);
      }
      doc.setTextColor(20, 20, 22);
      doc.text(String(invoice.branch_count), MR - 150, y, { align: "center" });
      doc.text(pk(perBranchActual), MR - 80, y, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(pk(actualSubtotal), MR - 10, y, { align: "right" });
    }
    // 40 is the base clearance the icon badge itself needs (radius 13, centered
    // at y+4, so it extends to y+17) — that space exists regardless of whether
    // a subtitle is shown, so removing the subtitle must not shrink it. The extra
    // 28pt only belongs here when an Onboarding Fee row is actually coming next —
    // on a renewal invoice (not first invoice) there's nothing to separate it
    // from, so reserving that gap just left dead space before the closing divider.
    const rowGapExtra = invoice.is_first_invoice ? 28 : 0;
    y += 40 + (discount > 0 ? subLineH : 0) + rowGapExtra;

    // Onboarding is a one-time cost that only ever appears on a client's first
    // invoice — the amount shown is what's ACTUALLY charged (0 if waived), with
    // the standard fee noted underneath so a waiver is never just an invisible Rs 0.
    if (invoice.is_first_invoice && doc) {
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.line(ML, y - 18 - rowGapExtra / 2, MR, y - 18 - rowGapExtra / 2);

      badgedIcon(doc, "package", ML + rowBadgeR, y - 5, rowBadgeR);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(20, 20, 22);
      doc.text("Onboarding Fee (one-time)", ML + rowBadgeR * 2 + 8, y);
      doc.text(pk(invoice.onboarding_fee_charged), MR - 10, y, { align: "right" });
      if (onboardingWaived > 0) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...GRAY);
        doc.text(`Standard ${pk(ONBOARDING_FEE)} — waived for this client`, ML + rowBadgeR * 2 + 8, y + 14);
      }
    }
    if (invoice.is_first_invoice) y += 30;

    if (doc) {
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.line(ML, y, MR, y);
    }
    y += 16;

    // Totals box (right aligned) — shows the full "everything included" standard
    // price and each deduction on the way down to what's actually charged, so
    // the total discount/waiver being given is never just an invisible typed
    // number. Each deduction names what it's discounting, not a bare percentage.
    const boxW = 190;
    const boxX = MR - boxW;
    const lines: [string, string][] = [];
    if (totalSavings > 0) {
      lines.push(["Standard Price", pk(listTotal)]);
      if (discount > 0) lines.push([`Subscription Discount (${invoice.discount_pct.toFixed(0)}%)`, `- ${pk(discount)}`]);
      if (onboardingWaived > 0) lines.push(["Onboarding Fee Waived", `- ${pk(onboardingWaived)}`]);
    }
    const totalsRowH = 17;
    const totalsPad = 12;
    const totalsH = totalsPad * 2 + lines.length * totalsRowH + 26 + (totalSavings > 0 ? 16 : 0);

    // Bank details — shown only while payment is outstanding, placed beside
    // the totals box (instead of stacked full-width below it) so the empty
    // left column next to that box gets used rather than wasted.
    const showBank = invoice.status === "unpaid";
    const bankRows: [string, string][] = [
      ["Bank", "UBL"],
      ["Account Title", "PulseHub SMC Pvt Ltd"],
      ["Account Number", "0253388111143"],
    ];
    const bankX = ML;
    const bankW = boxX - ML - 20;
    const bankPad = 12;
    const bankHeadH = 18;
    const bankRowH = 15;
    const bankH = bankPad * 2 + bankHeadH + bankRows.length * bankRowH;

    if (doc) {
      doc.setFillColor(...LIGHT_GRAY);
      doc.roundedRect(boxX, y, boxW, totalsH, 6, 6, "F");
      let ry = y + totalsPad + 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      for (const [k, v] of lines) {
        doc.setTextColor(...GRAY);
        doc.text(k, boxX + 14, ry);
        doc.setTextColor(20, 20, 22);
        doc.text(v, boxX + boxW - 14, ry, { align: "right" });
        ry += totalsRowH;
      }
      if (lines.length > 0) {
        doc.setDrawColor(...BORDER);
        doc.line(boxX + 14, ry - 6, boxX + boxW - 14, ry - 6);
        ry += 8;
      } else {
        ry += 2;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(20, 20, 22);
      doc.text("AMOUNT CHARGED", boxX + 14, ry + 4);
      doc.setTextColor(...ORANGE);
      doc.setFontSize(14);
      doc.text(pk(invoice.amount), boxX + boxW - 14, ry + 5, { align: "right" });

      if (totalSavings > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...EMERALD);
        doc.text(`${pk(totalSavings)} saved vs. our standard pricing`, boxX + boxW - 14, ry + 18, { align: "right" });
      }
    }

    if (showBank && doc) {
      doc.setFillColor(...LIGHT_GRAY);
      doc.roundedRect(bankX, y, bankW, bankH, 6, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(20, 20, 22);
      doc.text("BANK DETAILS FOR PAYMENT", bankX + 14, y + bankPad + 6);
      let ry = y + bankPad + bankHeadH + 8;
      doc.setFontSize(8.5);
      for (const [k, v] of bankRows) {
        const label = `${k}: `;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...GRAY);
        doc.text(label, bankX + 14, ry);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20, 20, 22);
        doc.text(v, bankX + 14 + doc.getTextWidth(label), ry);
        ry += bankRowH;
      }
    }

    y += Math.max(totalsH, showBank ? bankH : 0) + (totalSavings > 0 ? 40 : 26);

    // Payment note — only shown for a settled/cancelled invoice; an unpaid
    // invoice shows bank details instead (drawn above, beside the totals box).
    if (invoice.status !== "unpaid") {
      const noteText =
        invoice.status === "paid"
          ? statusInfo.label.replace("PAID ON", "Payment received on")
          : "This invoice has been cancelled.";
      const noteBg = invoice.status === "paid" ? [230, 246, 240] : LIGHT_GRAY;
      const noteColor = invoice.status === "paid" ? EMERALD : GRAY;
      const noteH = 30;
      if (doc) {
        doc.setFillColor(noteBg[0], noteBg[1], noteBg[2]);
        doc.roundedRect(ML, y, MR - ML, noteH, 6, 6, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(noteColor[0], noteColor[1], noteColor[2]);
        doc.text(noteText, W / 2, y + 19, { align: "center" });
      }
      y += noteH + 20;
    }

    if (doc) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      doc.text("Thank you for using Pulse.", W / 2, y, { align: "center" });
    }
    y += 26;

    // Bottom bar
    const footerH = 30;
    if (doc) {
      doc.setFillColor(...INK);
      doc.rect(0, y, W, footerH, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(200, 200, 205);
      doc.text("hello@yourpulse.io", ML, y + 19);
      doc.text("hostel.yourpulse.io", MR, y + 19, { align: "right" });
    }
    y += footerH;

    return y;
  }

  const totalHeight = layout(null);
  // jsPDF silently swaps width/height to force portrait unless orientation is
  // told explicitly — this page is wider than it is tall, so it must say so.
  const doc = new jsPDF({ unit: "pt", format: [W, totalHeight], orientation: totalHeight >= W ? "p" : "l" });
  layout(doc);

  return new Uint8Array(doc.output("arraybuffer"));
}
