import type { ReportData, LedgerTenantRow } from "@/app/actions/reports";

function pk(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// PDF Export (jsPDF + jspdf-autotable)
// ---------------------------------------------------------------------------
export async function exportReportPDF(data: ReportData, label: string): Promise<void> {
  // Dynamic import so this only runs client-side
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const PAGE_W = 210;
  const MARGIN = 14;
  let y = 16;

  // ---------- Header ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(data.hostelName, MARGIN, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(`Report Period: ${label}   |   Generated: ${new Date().toLocaleDateString()}`, MARGIN, y);
  y += 8;

  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

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
    ["Top Tenants", "Total Paid (Rs.)"],
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
    ["Total AC Revenue (Rs.)", data.acStats.totalAcRevenue],
    [],
    ["Room", "Tenant", "Units Consumed (kWh)", "AC Charge (Rs.)", "Month", "Status"],
    ...data.acByRoom.map((r) => [r.roomNumber, r.tenantName, r.unitsConsumed, r.acCharge, r.forMonth, r.status]),
  ];
  const wsAC = XLSX.utils.aoa_to_sheet(acRows);
  XLSX.utils.book_append_sheet(wb, wsAC, "AC Analytics");

  // Auto-size columns for all sheets
  [wsOverview, wsRevenue, wsOccupancy, wsAC].forEach((ws) => {
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
  methodLabel: string
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MARGIN = 14;
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(hostelName, MARGIN, y); y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Reconciliation Report · ${period}${methodLabel !== "All Methods" ? ` · ${methodLabel}` : ""}   Generated: ${new Date().toLocaleDateString()}`, MARGIN, y); y += 5;

  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, 196, y); y += 5;

  doc.setTextColor(0, 0, 0);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  autoTable(doc, {
    startY: y,
    head: [["Tenant", "Mobile", "Room", "Period", "Receipt #", "Method", "Date", "Amount (Rs.)"]],
    body: rows.map((r) => [
      r.tenantName,
      r.phone ?? "—",
      r.roomNumber ? `Rm ${r.roomNumber}` : "—",
      r.forMonth,
      r.receiptNumber ?? "—",
      METHOD_LABELS[r.method] ?? r.method,
      fmtDate(r.paymentDate),
      r.amount.toLocaleString("en-PK"),
    ]),
    foot: [["", "", "", "", "", "", "Total", total.toLocaleString("en-PK")]],
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
  methodLabel: string
): Promise<void> {
  const XLSX = await import("xlsx");

  const total = rows.reduce((s, r) => s + r.amount, 0);

  const sheetRows = [
    [`Reconciliation Report — ${hostelName}`],
    [`Period: ${period}${methodLabel !== "All Methods" ? ` | Method: ${methodLabel}` : ""}`],
    [],
    ["Tenant", "Mobile", "Room", "Period", "Receipt #", "Method", "Payment Date", "Amount (Rs.)"],
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
  sourceLabel: string
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MARGIN = 14;
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(hostelName, MARGIN, y); y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Expense Report · ${period}${sourceLabel !== "All Sources" ? ` · ${sourceLabel}` : ""}   Generated: ${new Date().toLocaleDateString()}`, MARGIN, y); y += 5;

  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, 196, y); y += 5;
  doc.setTextColor(0, 0, 0);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  autoTable(doc, {
    startY: y,
    head: [["Date", "Source", "Title", "Category", "Status", "Amount (Rs.)"]],
    body: rows.map((r) => [
      fmtDate(r.date),
      r.sourceLabel,
      r.title,
      r.category,
      r.status ? capitalizeWord(r.status) : "—",
      r.amount.toLocaleString("en-PK"),
    ]),
    foot: [["", "", "", "", "Total", total.toLocaleString("en-PK")]],
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
  sourceLabel: string
): Promise<void> {
  const XLSX = await import("xlsx");

  const total = rows.reduce((s, r) => s + r.amount, 0);

  const sheetRows = [
    [`Expense Report — ${hostelName}`],
    [`Period: ${period}${sourceLabel !== "All Sources" ? ` | Source: ${sourceLabel}` : ""}`],
    [],
    ["Date", "Source", "Title", "Category", "Status", "Amount (Rs.)"],
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
  filterLabel: string
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: autoTable } = await import("jspdf-autotable") as any;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MARGIN = 14;
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(hostelName, MARGIN, y); y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Member Ledger · ${period} · ${filterLabel}   Generated: ${new Date().toLocaleDateString()}`, MARGIN, y); y += 5;

  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, 196, y); y += 5;

  doc.setTextColor(0, 0, 0);

  const totalCharged = rows.reduce((s, r) => s + r.totalCharged, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);
  const totalDeposit = rows.reduce((s, r) => s + r.securityDeposit, 0);

  autoTable(doc, {
    startY: y,
    head: [["Tenant", "Phone", "Room", "Plan", "Price", "Status", "Charged (Rs.)", "Paid (Rs.)", "Due (Rs.)", "Deposit (Rs.)", "Last Payment"]],
    body: rows.map((r) => [
      r.fullName,
      r.phone ?? "—",
      r.roomNumber ? `Rm ${r.roomNumber}` : "—",
      r.packageLabel,
      r.packagePrice > 0 ? `${r.packagePrice.toLocaleString("en-PK")}/${r.billingType === "daily" ? "day" : "mo"}` : "—",
      LEDGER_STATUS_LABELS[r.status] ?? r.status,
      r.totalFoodCharge > 0 ? `${r.totalCharged.toLocaleString("en-PK")} (incl. ${r.totalFoodCharge.toLocaleString("en-PK")} food)` : r.totalCharged.toLocaleString("en-PK"),
      r.totalPaid.toLocaleString("en-PK"),
      r.totalOwed.toLocaleString("en-PK"),
      r.securityDeposit > 0 ? r.securityDeposit.toLocaleString("en-PK") : "—",
      fmtDate(r.lastPaymentDate),
    ]),
    foot: [["", "", "", "", "", "Total", totalCharged.toLocaleString("en-PK"), totalPaid.toLocaleString("en-PK"), totalOwed.toLocaleString("en-PK"), totalDeposit.toLocaleString("en-PK"), ""]],
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
  filterLabel: string
): Promise<void> {
  const XLSX = await import("xlsx");

  const totalCharged = rows.reduce((s, r) => s + r.totalCharged, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);
  const totalDeposit = rows.reduce((s, r) => s + r.securityDeposit, 0);

  const sheetRows = [
    [`Member Ledger — ${hostelName}`],
    [`Period: ${period} | ${filterLabel}`],
    [],
    ["Tenant", "Phone", "Room", "Plan", "Package Price", "Status", "Charged (Rs.)", "incl. Food (Rs.)", "Paid (Rs.)", "Due (Rs.)", "Deposit (Rs.)", "Last Payment"],
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
