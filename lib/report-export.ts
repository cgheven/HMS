import type { ReportData, LedgerTenantRow } from "@/app/actions/reports";
import type { MemberLedgerData, MemberLedgerBill } from "@/app/actions/tenants";
import { splitPaymentCharges } from "@/lib/payment-calc";
import { getCountryConfig } from "@/lib/country-config";

// Currency formatter bound to the hostel's country. PKR stays byte-identical
// ("Rs. 1,234" on en-PK grouping); every other country uses the registry's
// symbol + locale. Built once per export so the ~40 call sites stay `pk(x)`.
function makePk(country?: string | null): (amount: number) => string {
  const cfg = getCountryConfig(country);
  if (cfg.currency === "PKR") {
    return (amount: number) => `Rs. ${amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  const fmt = new Intl.NumberFormat(cfg.locale, {
    style: "currency",
    currency: cfg.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (amount: number) => fmt.format(amount);
}

// Bare grouped number for cells whose column header already names the unit.
// PK keeps en-PK grouping (byte-identical); others group in their own locale.
function makeNum(country?: string | null): (amount: number) => string {
  const loc = getCountryConfig(country).locale;
  return (amount: number) => amount.toLocaleString(loc);
}

// Parenthetical column-unit shown in a header, e.g. "Amount (Rs.)" / "Amount (£)".
// PKR keeps the literal "Rs." (byte-identical); others use the symbol.
function unitLabel(country?: string | null): string {
  const cfg = getCountryConfig(country);
  return cfg.currency === "PKR" ? "Rs." : cfg.currencySymbol;
}

const PULSE_AMBER: [number, number, number] = [245, 166, 35];
// A4 width (210mm) minus the 14mm side margin — the right edge every report's
// content + header rule aligns to.
const REPORT_RIGHT_X = 210 - 14;

/**
 * Pulse-branded report header (product identity, not the hostel's). The document
 * leads with the Pulse wordmark; the hostel name moves to a context line beneath
 * it so the report is branded as Pulse while still naming which hostel the data
 * is for. These exports run client-side (dynamic jsPDF import), where the logo
 * PNG can't be read off disk, so the wordmark is drawn as text. Returns the y to
 * continue drawing from.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawPulseReportHeader(doc: any, margin: number, rightX: number, hostelName: string, subtitle: string): number {
  // No header branding text — the Pulse logo image is a later report-design task.
  // The header leads with the hostel name; the amber rule keeps the brand accent.
  let y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(hostelName, margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`${subtitle}   Generated: ${new Date().toLocaleDateString()}`, margin, y);
  y += 5;

  doc.setDrawColor(PULSE_AMBER[0], PULSE_AMBER[1], PULSE_AMBER[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, y, rightX, y);
  y += 6;
  doc.setTextColor(0, 0, 0);
  return y;
}

// ---------------------------------------------------------------------------
// PDF Export (jsPDF + jspdf-autotable)
// ---------------------------------------------------------------------------
export async function exportReportPDF(data: ReportData, label: string): Promise<void> {
  // Dynamic import so this only runs client-side
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const pk = makePk(data.country);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const MARGIN = 14;

  // ---------- Pulse-branded header ----------
  let y = drawPulseReportHeader(doc, MARGIN, REPORT_RIGHT_X, data.hostelName, `Report Period: ${label}`);

  // ---------- Overview KPIs ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text("Overview", MARGIN, y);
  y += 6;

  const kpis = [
    ["Total Revenue", pk(data.totalRevenue)],
    ["Pending Collections", pk(data.pendingCollections)],
    ["Occupancy Rate", `${data.occupancyRate}%`],
    ["New Tenants", String(data.newTenants)],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: kpis,
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: [245, 166, 35] },
    styles: { fontSize: 10 },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ---------- Revenue by Month ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Revenue by Month", MARGIN, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Month", "Rent", "Food", "AC", "Referral Discount", "Total", "Collected", "Pending"]],
    body: data.revenueByMonth.map((m) => [
      m.month,
      pk(m.rentRevenue),
      pk(m.foodRevenue),
      pk(m.acRevenue),
      pk(m.referralDiscountGiven),
      pk(m.total),
      pk(m.collected),
      pk(m.pending),
    ]),
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: [50, 50, 50] },
    styles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ---------- Top Tenants ----------
  if (data.topTenants.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Top 5 Tenants by Payment", MARGIN, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["#", "Tenant", "Total Paid"]],
      body: data.topTenants.map((t, i) => [String(i + 1), t.name, pk(t.totalPaid)]),
      margin: { left: MARGIN, right: MARGIN },
      headStyles: { fillColor: [50, 50, 50] },
      styles: { fontSize: 10 },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ---------- Occupancy ----------
  doc.addPage();
  y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Occupancy by Room Type", MARGIN, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Type", "Total Beds", "Occupied", "Rate"]],
    body: data.occupancyByType.map((o) => [
      o.type.charAt(0).toUpperCase() + o.type.slice(1),
      String(o.total),
      String(o.occupied),
      `${o.rate}%`,
    ]),
    margin: { left: MARGIN, right: MARGIN },
    headStyles: { fillColor: [245, 166, 35] },
    styles: { fontSize: 10 },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ---------- AC Analytics ----------
  if (data.acByRoom.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("AC Analytics", MARGIN, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Room", "Tenant", "Units (kWh)", "AC Charge", "Month", "Status"]],
      body: data.acByRoom.map((r) => [
        r.roomNumber,
        r.tenantName,
        String(r.unitsConsumed),
        pk(r.acCharge),
        r.forMonth,
        r.status.charAt(0).toUpperCase() + r.status.slice(1),
      ]),
      margin: { left: MARGIN, right: MARGIN },
      headStyles: { fillColor: [50, 50, 50] },
      styles: { fontSize: 9 },
    });
  }

  // ---------- Discounts ----------
  if (data.discountReport.standing.length > 0 || data.discountReport.oneOff.length > 0) {
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    if (y > 220) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Rent Discounts", MARGIN, y);
    y += 4;

    if (data.discountReport.standing.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [["Member", "Room", "Full Rent", "Discount", "Off / Month", "Billed"]],
        body: [
          ...data.discountReport.standing.map((r) => [
            r.tenantName,
            r.roomNumber ?? "-",
            pk(r.monthlyRent),
            `${r.percent}%`,
            pk(r.monthlyDiscount),
            pk(Math.max(0, r.monthlyRent - r.monthlyDiscount)),
          ]),
          ["Total", "", "", "", pk(data.discountReport.standingMonthlyTotal), ""],
        ],
        margin: { left: MARGIN, right: MARGIN },
        headStyles: { fillColor: [50, 50, 50] },
        styles: { fontSize: 9 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }

    if (data.discountReport.oneOff.length > 0) {
      if (y > 240) { doc.addPage(); y = 16; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("One-off Discounts", MARGIN, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [["Member", "Room", "Month", "Discount", "Amount"]],
        body: [
          ...data.discountReport.oneOff.map((r) => [
            r.tenantName,
            r.roomNumber ?? "-",
            r.forMonth,
            `${r.percent}%`,
            pk(r.amount),
          ]),
          ["Total", "", "", "", pk(data.discountReport.oneOffTotal)],
        ],
        margin: { left: MARGIN, right: MARGIN },
        headStyles: { fillColor: [50, 50, 50] },
        styles: { fontSize: 9 },
      });
    }
  }

  // ---------- Overdue ----------
  if (data.overduePayments.length > 0) {
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Overdue / Pending Payments", MARGIN, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Tenant", "Month", "Amount", "Status"]],
      body: data.overduePayments.map((p) => [
        p.tenantName,
        p.forMonth,
        pk(p.amount),
        p.status.charAt(0).toUpperCase() + p.status.slice(1),
      ]),
      margin: { left: MARGIN, right: MARGIN },
      headStyles: { fillColor: [200, 50, 50] },
      styles: { fontSize: 9 },
    });
  }

  doc.save(`report-${data.hostelName.replace(/\s+/g, "-").toLowerCase()}-${label.replace(/\s+/g, "-")}.pdf`);
}

// ---------------------------------------------------------------------------
// Excel Export (xlsx / SheetJS)
// ---------------------------------------------------------------------------
export async function exportReportExcel(data: ReportData, label: string): Promise<void> {
  const XLSX = await import("xlsx");

  const unit = unitLabel(data.country);
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Overview
  const overviewRows = [
    ["Metric", "Value"],
    ["Report Period", label],
    ["Hostel", data.hostelName],
    ["Total Revenue", data.totalRevenue],
    ["Pending Collections", data.pendingCollections],
    ["Occupancy Rate (%)", data.occupancyRate],
    ["New Tenants", data.newTenants],
    ["Total Capacity", data.totalCapacity],
    ["Total Occupied", data.totalOccupied],
    [],
    ["Top Tenants", `Total Paid (${unit})`],
    ...data.topTenants.map((t) => [t.name, t.totalPaid]),
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  XLSX.utils.book_append_sheet(wb, wsOverview, "Overview");

  // Sheet 2 — Revenue
  const revenueRows = [
    ["Month", "Rent Revenue", "Food Revenue", "AC Revenue", "Referral Discount", "Total", "Collected", "Pending"],
    ...data.revenueByMonth.map((m) => [
      m.month,
      m.rentRevenue,
      m.foodRevenue,
      m.acRevenue,
      m.referralDiscountGiven,
      m.total,
      m.collected,
      m.pending,
    ]),
    [],
    ["", "Totals"],
    [
      "",
      data.revenueByMonth.reduce((s, m) => s + m.rentRevenue, 0),
      data.revenueByMonth.reduce((s, m) => s + m.foodRevenue, 0),
      data.revenueByMonth.reduce((s, m) => s + m.acRevenue, 0),
      data.revenueByMonth.reduce((s, m) => s + m.referralDiscountGiven, 0),
      data.revenueByMonth.reduce((s, m) => s + m.total, 0),
      data.revenueByMonth.reduce((s, m) => s + m.collected, 0),
      data.revenueByMonth.reduce((s, m) => s + m.pending, 0),
    ],
    [],
    ["Overdue Payments"],
    ["Tenant", "Month", "Amount", "Status"],
    ...data.overduePayments.map((p) => [p.tenantName, p.forMonth, p.amount, p.status]),
  ];
  const wsRevenue = XLSX.utils.aoa_to_sheet(revenueRows);
  XLSX.utils.book_append_sheet(wb, wsRevenue, "Revenue");

  // Sheet 3 — Occupancy
  const occupancyRows = [
    ["Room Type", "Total Beds", "Occupied", "Occupancy Rate (%)"],
    ...data.occupancyByType.map((o) => [o.type, o.total, o.occupied, o.rate]),
    [],
    ["Total", data.totalCapacity, data.totalOccupied, data.occupancyRate],
    [],
    ["Monthly Expenses"],
    ["Month", "General Expenses", "Kitchen", "Salaries", "Collected Revenue"],
    ...data.monthlyExpenses.map((m) => [m.month, m.expenses, m.kitchen, m.salaries, m.collected]),
  ];
  const wsOccupancy = XLSX.utils.aoa_to_sheet(occupancyRows);
  XLSX.utils.book_append_sheet(wb, wsOccupancy, "Occupancy");

  // Sheet 4 — AC Analytics
  const acRows = [
    ["AC Analytics Summary"],
    ["Total AC Tenants", data.acStats.totalAcTenants],
    ["AC Bills Paid", data.acStats.paidAcTenants],
    [`Total AC Revenue (${unit})`, data.acStats.totalAcRevenue],
    [],
    ["Room", "Tenant", "Units Consumed (kWh)", `AC Charge (${unit})`, "Month", "Status"],
    ...data.acByRoom.map((r) => [r.roomNumber, r.tenantName, r.unitsConsumed, r.acCharge, r.forMonth, r.status]),
  ];
  const wsAC = XLSX.utils.aoa_to_sheet(acRows);
  XLSX.utils.book_append_sheet(wb, wsAC, "AC Analytics");

  // Sheet 5 — Discounts. Standing and one-off are stacked in one sheet but
  // never summed together: one is a monthly commitment going forward, the other
  // is money already given away inside the selected period.
  const discountRows = [
    ["Rent Discounts Summary"],
    ["Members on a Standing Discount", data.discountReport.standingCount],
    [`Standing Cost per Month (${unit})`, data.discountReport.standingMonthlyTotal],
    ["One-off Discounts Given", data.discountReport.oneOffCount],
    [`One-off Total (${unit})`, data.discountReport.oneOffTotal],
    [`Total Discounted in Period (${unit})`, data.discountReport.totalGivenInPeriod],
    ["Bills Carrying a Discount", data.discountReport.discountedBillCount],
    [],
    ["Standing Discounts"],
    ["Member", "Room", `Full Rent (${unit})`, "Discount (%)", `Off per Month (${unit})`, `Billed (${unit})`],
    ...data.discountReport.standing.map((r) => [
      r.tenantName,
      r.roomNumber ?? "",
      r.monthlyRent,
      r.percent,
      r.monthlyDiscount,
      Math.max(0, r.monthlyRent - r.monthlyDiscount),
    ]),
    [],
    ["One-off Discounts"],
    ["Member", "Room", "Month", "Discount (%)", `Amount (${unit})`],
    ...data.discountReport.oneOff.map((r) => [
      r.tenantName,
      r.roomNumber ?? "",
      r.forMonth,
      r.percent,
      r.amount,
    ]),
  ];
  const wsDiscounts = XLSX.utils.aoa_to_sheet(discountRows);
  XLSX.utils.book_append_sheet(wb, wsDiscounts, "Discounts");

  // Auto-size columns for all sheets
  [wsOverview, wsRevenue, wsOccupancy, wsAC, wsDiscounts].forEach((ws) => {
    const ref = ws["!ref"];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    const colWidths: number[] = [];
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        const len = String(cell.v ?? "").length;
        if (!colWidths[C] || colWidths[C] < len) colWidths[C] = len;
      }
    }
    ws["!cols"] = colWidths.map((w) => ({ wch: Math.min(w + 2, 40) }));
  });

  const filename = `report-${data.hostelName.replace(/\s+/g, "-").toLowerCase()}-${label.replace(/\s+/g, "-")}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ---------------------------------------------------------------------------
// Reconciliation exports — operates on a filtered payment list
// ---------------------------------------------------------------------------
type ReconciliationRow = ReportData["paidPaymentsList"][number];

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  cheque: "Cheque",
  online: "Online",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

export async function exportReconciliationPDF(
  rows: ReconciliationRow[],
  hostelName: string,
  period: string,
  methodLabel: string,
  country?: string | null
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const num = makeNum(country);
  const unit = unitLabel(country);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MARGIN = 14;

  let y = drawPulseReportHeader(doc, MARGIN, REPORT_RIGHT_X, hostelName, `Reconciliation Report · ${period}${methodLabel !== "All Methods" ? ` · ${methodLabel}` : ""}`);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  autoTable(doc, {
    startY: y,
    head: [["Tenant", "Mobile", "Room", "Period", "Receipt #", "Method", "Date", `Amount (${unit})`]],
    body: rows.map((r) => [
      r.tenantName,
      r.phone ?? "—",
      r.roomNumber ? `Rm ${r.roomNumber}` : "—",
      r.forMonth,
      r.receiptNumber ?? "—",
      METHOD_LABELS[r.method] ?? r.method,
      fmtDate(r.paymentDate),
      num(r.amount),
    ]),
    foot: [["", "", "", "", "", "", "Total", num(total)]],
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [245, 166, 35], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: MARGIN, right: MARGIN },
    columnStyles: { 7: { halign: "right" } },
  });

  const slug = methodLabel === "All Methods" ? "all" : methodLabel.toLowerCase().replace(/\s+/g, "-");
  doc.save(`reconciliation-${period}-${slug}.pdf`);
}

export async function exportReconciliationExcel(
  rows: ReconciliationRow[],
  hostelName: string,
  period: string,
  methodLabel: string,
  country?: string | null
): Promise<void> {
  const XLSX = await import("xlsx");

  const unit = unitLabel(country);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const sheetRows = [
    [`Reconciliation Report — ${hostelName}`],
    [`Period: ${period}${methodLabel !== "All Methods" ? ` | Method: ${methodLabel}` : ""}`],
    [],
    ["Tenant", "Mobile", "Room", "Period", "Receipt #", "Method", "Payment Date", `Amount (${unit})`],
    ...rows.map((r) => [
      r.tenantName,
      r.phone ?? "",
      r.roomNumber ? `Rm ${r.roomNumber}` : "",
      r.forMonth,
      r.receiptNumber ?? "",
      METHOD_LABELS[r.method] ?? r.method,
      fmtDate(r.paymentDate),
      r.amount,
    ]),
    [],
    ["", "", "", "", "", "", "Total", total],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) continue;
      const len = String(cell.v ?? "").length;
      if (!colWidths[C] || colWidths[C] < len) colWidths[C] = len;
    }
  }
  ws["!cols"] = colWidths.map((w) => ({ wch: Math.min(w + 2, 40) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");

  const slug = methodLabel === "All Methods" ? "all" : methodLabel.toLowerCase().replace(/\s+/g, "-");
  XLSX.writeFile(wb, `reconciliation-${period}-${slug}.xlsx`);
}

// ---------------------------------------------------------------------------
// Expense report exports — bills + staff salaries + general expenses + kitchen
// ---------------------------------------------------------------------------
type ExpenseReportRow = ReportData["expenseReport"]["rows"][number];

function capitalizeWord(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export async function exportExpenseReportPDF(
  rows: ExpenseReportRow[],
  hostelName: string,
  period: string,
  sourceLabel: string,
  country?: string | null
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const num = makeNum(country);
  const unit = unitLabel(country);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MARGIN = 14;

  let y = drawPulseReportHeader(doc, MARGIN, REPORT_RIGHT_X, hostelName, `Expense Report · ${period}${sourceLabel !== "All Sources" ? ` · ${sourceLabel}` : ""}`);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  autoTable(doc, {
    startY: y,
    head: [["Date", "Source", "Title", "Category", "Status", `Amount (${unit})`]],
    body: rows.map((r) => [
      fmtDate(r.date),
      r.sourceLabel,
      r.title,
      r.category,
      r.status ? capitalizeWord(r.status) : "—",
      num(r.amount),
    ]),
    foot: [["", "", "", "", "Total", num(total)]],
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [245, 166, 35], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: MARGIN, right: MARGIN },
    columnStyles: { 5: { halign: "right" } },
  });

  const slug = sourceLabel === "All Sources" ? "all" : sourceLabel.toLowerCase().replace(/\s+/g, "-");
  doc.save(`expense-report-${period}-${slug}.pdf`);
}

export async function exportExpenseReportExcel(
  rows: ExpenseReportRow[],
  hostelName: string,
  period: string,
  sourceLabel: string,
  country?: string | null
): Promise<void> {
  const XLSX = await import("xlsx");

  const unit = unitLabel(country);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const sheetRows = [
    [`Expense Report — ${hostelName}`],
    [`Period: ${period}${sourceLabel !== "All Sources" ? ` | Source: ${sourceLabel}` : ""}`],
    [],
    ["Date", "Source", "Title", "Category", "Status", `Amount (${unit})`],
    ...rows.map((r) => [
      fmtDate(r.date),
      r.sourceLabel,
      r.title,
      r.category,
      r.status ? capitalizeWord(r.status) : "",
      r.amount,
    ]),
    [],
    ["", "", "", "", "Total", total],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) continue;
      const len = String(cell.v ?? "").length;
      if (!colWidths[C] || colWidths[C] < len) colWidths[C] = len;
    }
  }
  ws["!cols"] = colWidths.map((w) => ({ wch: Math.min(w + 2, 40) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Expense Report");

  const slug = sourceLabel === "All Sources" ? "all" : sourceLabel.toLowerCase().replace(/\s+/g, "-");
  XLSX.writeFile(wb, `expense-report-${period}-${slug}.xlsx`);
}

// ---------------------------------------------------------------------------
// Member Ledger exports — cross-tenant landing table
// ---------------------------------------------------------------------------

const LEDGER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  waiting: "Waiting",
  checked_out: "Checked Out",
};

export async function exportLedgerPDF(
  rows: LedgerTenantRow[],
  hostelName: string,
  period: string,
  filterLabel: string,
  country?: string | null
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const num = makeNum(country);
  const unit = unitLabel(country);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MARGIN = 14;

  let y = drawPulseReportHeader(doc, MARGIN, REPORT_RIGHT_X, hostelName, `Member Ledger · ${period} · ${filterLabel}`);

  const totalCharged = rows.reduce((s, r) => s + r.totalCharged, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);
  const totalDeposit = rows.reduce((s, r) => s + r.securityDeposit, 0);

  autoTable(doc, {
    startY: y,
    head: [["Tenant", "Phone", "Room", "Plan", "Price", "Status", `Charged (${unit})`, `Paid (${unit})`, `Due (${unit})`, `Deposit (${unit})`, "Last Payment"]],
    body: rows.map((r) => [
      r.fullName,
      r.phone ?? "—",
      r.roomNumber ? `Rm ${r.roomNumber}` : "—",
      r.packageLabel,
      r.packagePrice > 0 ? `${num(r.packagePrice)}/${r.billingType === "daily" ? "day" : "mo"}` : "—",
      LEDGER_STATUS_LABELS[r.status] ?? r.status,
      r.totalFoodCharge > 0 ? `${num(r.totalCharged)} (incl. ${num(r.totalFoodCharge)} food)` : num(r.totalCharged),
      num(r.totalPaid),
      num(r.totalOwed),
      r.securityDeposit > 0 ? num(r.securityDeposit) : "—",
      fmtDate(r.lastPaymentDate),
    ]),
    foot: [["", "", "", "", "", "Total", num(totalCharged), num(totalPaid), num(totalOwed), num(totalDeposit), ""]],
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [245, 166, 35], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: MARGIN, right: MARGIN },
    columnStyles: { 4: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
  });

  doc.save(`member-ledger-${period}.pdf`);
}

export async function exportLedgerExcel(
  rows: LedgerTenantRow[],
  hostelName: string,
  period: string,
  filterLabel: string,
  country?: string | null
): Promise<void> {
  const XLSX = await import("xlsx");

  const unit = unitLabel(country);
  const totalCharged = rows.reduce((s, r) => s + r.totalCharged, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);
  const totalDeposit = rows.reduce((s, r) => s + r.securityDeposit, 0);

  const sheetRows = [
    [`Member Ledger — ${hostelName}`],
    [`Period: ${period} | ${filterLabel}`],
    [],
    ["Tenant", "Phone", "Room", "Plan", "Package Price", "Status", `Charged (${unit})`, `incl. Food (${unit})`, `Paid (${unit})`, `Due (${unit})`, `Deposit (${unit})`, "Last Payment"],
    ...rows.map((r) => [
      r.fullName,
      r.phone ?? "",
      r.roomNumber ? `Rm ${r.roomNumber}` : "",
      r.packageLabel,
      r.packagePrice > 0 ? `${r.packagePrice}/${r.billingType === "daily" ? "day" : "mo"}` : "",
      LEDGER_STATUS_LABELS[r.status] ?? r.status,
      r.totalCharged,
      r.totalFoodCharge || "",
      r.totalPaid,
      r.totalOwed,
      r.securityDeposit,
      fmtDate(r.lastPaymentDate),
    ]),
    [],
    ["", "", "", "", "", "Total", totalCharged, rows.reduce((s, r) => s + r.totalFoodCharge, 0), totalPaid, totalOwed, totalDeposit, ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) continue;
      const len = String(cell.v ?? "").length;
      if (!colWidths[C] || colWidths[C] < len) colWidths[C] = len;
    }
  }
  ws["!cols"] = colWidths.map((w) => ({ wch: Math.min(w + 2, 40) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Member Ledger");

  XLSX.writeFile(wb, `member-ledger-${period}.xlsx`);
}

// ---------------------------------------------------------------------------
// Single-member Payment Ledger — the itemised, client-facing record: every
// charge, line by line per month, with expected / received / balance and the
// running totals. Decomposes each bill with the same splitPaymentCharges() the
// receipts use, so the line items reconcile to the receipts exactly.
// ---------------------------------------------------------------------------

function nameSlug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "member";
}

function fmtMonth(ym: string): string {
  const [y, m] = (ym || "").split("-").map(Number);
  if (!y || !m) return ym || "—";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// A bill's charge lines (expected amounts), in the order a payment is applied:
// essentials first so any shortfall lands on the last line (AC), matching how
// hostels collect. Rent is shown NET of any discount (what was actually owed).
function billChargeLines(b: MemberLedgerBill): { desc: string; amount: number }[] {
  const c = splitPaymentCharges({
    amount: b.amount, food_charge: b.foodCharge, ac_charge: b.acCharge,
    security_deposit_charge: b.securityDepositCharge, registration_fee_charge: b.registrationFeeCharge,
    ac_maintenance_charge: b.acMaintenanceCharge, referral_discount: b.referralDiscount, discount_amount: b.discountAmount,
  });
  const rentNet = Math.max(0, c.rent - c.referralDiscount - c.discount);
  const lines: { desc: string; amount: number }[] = [];
  if (c.deposit > 0) lines.push({ desc: "Security Deposit", amount: c.deposit });
  if (c.registrationFee > 0) lines.push({ desc: "Admission Fee", amount: c.registrationFee });
  if (rentNet > 0) lines.push({ desc: b.isReservation ? "Bed Reservation" : "Monthly Rent", amount: rentNet });
  if (c.food > 0) lines.push({ desc: "Food", amount: c.food });
  if (c.ac > 0) lines.push({ desc: "AC (Electricity)", amount: c.ac });
  if (c.acMaintenance > 0) lines.push({ desc: "AC Service", amount: c.acMaintenance });
  if (b.lateFee > 0) lines.push({ desc: "Late Fee", amount: b.lateFee });
  return lines;
}

interface LedgerRow {
  // When set, this row is a ROOM-SECTION header spanning the whole table (e.g.
  // "Room 101 · Jan 2026 – Jun 2026"). Only emitted when the member changed rooms.
  section?: string;
  room: string; month: string; desc: string; expected: number; received: number; balance: number;
  method: string; date: string | null; tid: string | null; notes: string | null;
}

function buildLedgerRows(bills: MemberLedgerBill[]): { rows: LedgerRow[]; totalExpected: number; totalReceived: number } {
  const rows: LedgerRow[] = [];
  let totalExpected = 0, totalReceived = 0;
  const methodLabel = (m: string | null) => (m ? m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

  // Group bills into CONTIGUOUS room runs so the ledger segments by room
  // (Room 101: Jan–Jun, then Room 102: Jun–Aug). Bills arrive ordered by month.
  const groups: { label: string; from: string; to: string; items: MemberLedgerBill[] }[] = [];
  for (const b of bills) {
    const label = b.roomNumber ? `Room ${b.roomNumber}` : "No room assigned";
    const last = groups[groups.length - 1];
    if (last && last.label === label) { last.items.push(b); last.to = b.forMonth; }
    else groups.push({ label, from: b.forMonth, to: b.forMonth, items: [b] });
  }
  // A section header only adds clarity when the member actually lived in >1 room;
  // for a single-room member it would just be noise, so skip it.
  const multiRoom = groups.length > 1;

  for (const g of groups) {
    if (multiRoom) {
      const range = g.from === g.to ? fmtMonth(g.from) : `${fmtMonth(g.from)} – ${fmtMonth(g.to)}`;
      rows.push({ section: `${g.label} · ${range}`, room: "", month: "", desc: "", expected: 0, received: 0, balance: 0, method: "", date: null, tid: null, notes: null });
    }
    for (const b of g.items) {
      const lines = billChargeLines(b);
      let rem = b.amountPaid;
      for (const l of lines) {
        const rec = Math.max(0, Math.min(rem, l.amount));
        rem -= rec;
        totalExpected += l.amount;
        totalReceived += rec;
        rows.push({
          room: b.roomNumber ? `Rm ${b.roomNumber}` : "—",
          month: fmtMonth(b.forMonth),
          desc: l.desc,
          expected: l.amount,
          received: rec,
          balance: l.amount - rec,
          method: methodLabel(b.method),
          date: b.paymentDate,
          tid: b.transactionId,
          notes: b.notes,
        });
      }
    }
  }
  return { rows, totalExpected, totalReceived };
}

export async function exportMemberLedgerPDF(
  data: MemberLedgerData,
  hostelName: string,
  country?: string | null,
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;
  const pk = makePk(country);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const MARGIN = 14;
  const RIGHT = 297 - MARGIN; // A4 landscape width
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  let y = drawPulseReportHeader(doc, MARGIN, RIGHT, hostelName, "Payment Ledger");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(data.member.fullName, MARGIN, y);
  y += 5;

  autoTable(doc, {
    startY: y,
    body: [
      ["Room", data.member.roomNumber ? `Rm ${data.member.roomNumber}` : "—", "Phone", data.member.phone ?? "—", "Check-in", data.member.checkIn ? fmtDate(data.member.checkIn) : "—"],
      ["CNIC", data.member.cnic ?? "—", "Guardian", data.member.guardianPhone ?? "—", "Generated", new Date().toLocaleDateString()],
    ],
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 1 },
    columnStyles: { 0: { fontStyle: "bold", textColor: [120, 120, 120] }, 2: { fontStyle: "bold", textColor: [120, 120, 120] }, 4: { fontStyle: "bold", textColor: [120, 120, 120] } },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY() + 4;

  const { rows, totalExpected, totalReceived } = buildLedgerRows(data.bills);
  const totalBalance = totalExpected - totalReceived;

  autoTable(doc, {
    startY: y,
    head: [["Total Expected", "Total Received", "Total Balance"]],
    body: [[pk(totalExpected), pk(totalReceived), pk(totalBalance)]],
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9, halign: "center" },
    bodyStyles: { fontSize: 12, halign: "center", fontStyle: "bold" },
    columnStyles: { 2: { textColor: totalBalance > 0 ? [200, 30, 30] : [30, 150, 30] } },
    tableWidth: 150,
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY() + 6;

  autoTable(doc, {
    startY: y,
    head: [["Room", "Month", "Description", "Amount", "Received", "Balance", "Mode", "Paid On", "TID", "Notes"]],
    body: rows.map((r) => r.section
      ? [{ content: r.section, colSpan: 10, styles: { fontStyle: "bold", fillColor: [235, 235, 235], textColor: [20, 20, 20], fontSize: 8 } }]
      : [r.room, r.month, r.desc, pk(r.expected), pk(r.received), r.balance > 0 ? pk(r.balance) : "—", r.method, fmtDate(r.date), r.tid ?? "—", r.notes ?? "—"]),
    foot: [["", "", "Total", pk(totalExpected), pk(totalReceived), totalBalance > 0 ? pk(totalBalance) : "—", "", "", "", ""]],
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [245, 166, 35], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: MARGIN, right: MARGIN },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
  });

  doc.save(`payment-ledger-${nameSlug(data.member.fullName)}.pdf`);
}

export async function exportMemberLedgerExcel(
  data: MemberLedgerData,
  hostelName: string,
  country?: string | null,
): Promise<void> {
  const XLSX = await import("xlsx");
  const unit = unitLabel(country);
  const { rows, totalExpected, totalReceived } = buildLedgerRows(data.bills);
  const totalBalance = totalExpected - totalReceived;

  const sheet: (string | number)[][] = [
    [`Payment Ledger — ${hostelName}`],
    [data.member.fullName],
    ["Room", data.member.roomNumber ? `Rm ${data.member.roomNumber}` : "", "Phone", data.member.phone ?? "", "CNIC", data.member.cnic ?? ""],
    ["Check-in", data.member.checkIn ? fmtDate(data.member.checkIn) : "", "Guardian", data.member.guardianPhone ?? ""],
    [],
    [`Total Expected (${unit})`, totalExpected, `Total Received (${unit})`, totalReceived, `Total Balance (${unit})`, totalBalance],
    [],
    ["Room", "Month", "Description", `Amount (${unit})`, `Received (${unit})`, `Balance (${unit})`, "Mode", "Paid On", "TID", "Notes"],
    ...rows.map((r) => r.section
      ? ([r.section, "", "", "", "", "", "", "", "", ""] as (string | number)[])
      : ([r.room, r.month, r.desc, r.expected, r.received, r.balance, r.method, fmtDate(r.date), r.tid ?? "", r.notes ?? ""] as (string | number)[])),
    [],
    ["", "", "Total", totalExpected, totalReceived, totalBalance, "", "", "", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payment Ledger");
  XLSX.writeFile(wb, `payment-ledger-${nameSlug(data.member.fullName)}.xlsx`);
}
