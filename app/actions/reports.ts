"use server";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/data";
import { capitalize } from "@/lib/utils";
import type { Profile } from "@/types";

// Reports is pure read — any active partner tier suffices. Owners/super_admin
// keep their existing hms_hostels.owner_id / hms_owner_hostels check; a
// partner is verified against hms_partnerships instead (mirrors the RLS
// policy shape in migrations 092/093, just expressed in application code
// since this file never used RLS to begin with — it always re-verifies
// ownership manually via the admin client).
async function verifyReportAccess(
  profile: Profile,
  hostelId: string,
  hostelOwnerId: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  if (profile.role === "super_admin") return true;
  if (profile.role === "owner") {
    if (hostelOwnerId === profile.id) return true;
    const { data: junction } = await admin
      .from("hms_owner_hostels")
      .select("hostel_id")
      .eq("hostel_id", hostelId)
      .eq("owner_id", profile.id)
      .maybeSingle();
    return !!junction;
  }
  if (profile.role === "partner") {
    const { data: partnership } = await admin
      .from("hms_partnerships")
      .select("id")
      .eq("hostel_id", hostelId)
      .eq("partner_id", profile.id)
      .eq("is_active", true)
      .maybeSingle();
    return !!partnership;
  }
  return false;
}

export interface ReportData {
  hostelId: string;
  hostelName: string;
  from: string;
  to: string;
  label: string;

  // Overview
  totalRevenue: number;
  pendingCollections: number;
  occupancyRate: number;
  newTenants: number;

  // Revenue by month
  revenueByMonth: {
    month: string;
    monthKey: string;
    rentRevenue: number;
    foodRevenue: number;
    acRevenue: number;
    total: number;
    collected: number;
    pending: number;
  }[];

  // Top tenants
  topTenants: { id: string; name: string; totalPaid: number }[];

  // Overdue payments
  overduePayments: {
    id: string;
    tenantName: string;
    forMonth: string;
    amount: number;
    status: string;
  }[];

  // Expense breakdown (6-month summary for bar chart)
  monthlyExpenses: {
    month: string;
    monthKey: string;
    expenses: number;
    kitchen: number;
    salaries: number;
    collected: number;
  }[];

  // Occupancy by room type
  occupancyByType: {
    type: string;
    total: number;
    occupied: number;
    rate: number;
  }[];

  totalCapacity: number;
  totalOccupied: number;

  // Room options for the Member Ledger's room filter (reuses the already-fetched rooms list)
  roomOptions: { id: string; roomNumber: string }[];

  // Payment method breakdown (for bank reconciliation)
  paymentMethodBreakdown: {
    method: string;
    label: string;
    count: number;
    amount: number;
  }[];

  // Paid payments list for reconciliation detail
  paidPaymentsList: {
    id: string;
    tenantName: string;
    phone: string | null;
    roomNumber: string | null;
    forMonth: string;
    amount: number;
    lateFee: number;
    method: string;
    paymentDate: string | null;
    receiptNumber: string | null;
    isPartial: boolean;
  }[];

  // AC analytics
  acByRoom: {
    roomNumber: string;
    tenantName: string;
    unitsConsumed: number;
    acCharge: number;
    forMonth: string;
  }[];
  acStats: {
    avgUnitsPerTenant: number;
    totalAcRevenue: number;
    totalAcTenants: number;
  };

  // Consolidated expense report — bills + staff salaries + general expenses + kitchen
  expenseReport: {
    rows: {
      id: string;
      source: "bill" | "salary" | "expense" | "kitchen";
      sourceLabel: string;
      date: string;
      title: string;
      category: string;
      amount: number;
      status: string | null;
      notes: string | null;
    }[];
    totalsBySource: { bills: number; staff: number; expenses: number; kitchen: number };
    grandTotal: number;
    unpaidBillsTotal: number;
    pendingSalariesTotal: number;
  };

  // Receivables aging — deliberately IGNORES the selected date range. Its whole
  // purpose is surfacing debt older than whatever window the user is looking at,
  // which every other metric here would hide.
  receivablesAging: {
    current: number;      // this month — not late yet
    late1Month: number;
    late2Months: number;
    late3PlusMonths: number;
    totalOwed: number;
    totalLate: number;    // everything except `current`
    activeDebtors: number;
    activeTenants: number;
    // Tenants who already checked out but never settled — this money is far
    // harder to recover, so it's kept separate rather than blended into the rest.
    formerDebtors: number;
    formerDebtorsOwed: number;
    topDebtors: {
      id: string;
      name: string;
      owed: number;
      monthsUnpaid: number;
      oldestMonth: string;
      isActive: boolean;
    }[];
  };
}

export async function getReportData(
  hostelId: string,
  from: string,
  to: string,
  label: string
): Promise<{ data: ReportData | null; error: string | null }> {
  const profile = await requireOwnerOrPartnerTier("read_only");

  const admin = createAdminClient();

  // Verify ownership
  const { data: hostelRow } = await admin
    .from("hms_hostels")
    .select("id, name, owner_id, slug")
    .eq("id", hostelId)
    .single();

  if (!hostelRow) return { data: null, error: "Hostel not found" };

  if (!(await verifyReportAccess(profile, hostelId, hostelRow.owner_id, admin))) {
    return { data: null, error: "Unauthorized" };
  }

  // Generate month keys in the range
  const monthKeys: { monthKey: string; label: string; start: string; end: string }[] = [];
  const startDate = new Date(from + "-01");
  const endDate = new Date(to + "-01");
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const mk = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${mk}-01`;
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const monthEnd = `${mk}-${String(lastDay).padStart(2, "0")}`;
    monthKeys.push({
      monthKey: mk,
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      start: monthStart,
      end: monthEnd,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const fullStart = monthKeys[0]?.start ?? from;
  const fullEnd = monthKeys[monthKeys.length - 1]?.end ?? to;

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [
    paymentsRes,
    expensesRes,
    kitchenRes,
    salariesRes,
    tenantsRes,
    roomsRes,
    billsRes,
    agingRes,
  ] = await Promise.all([
    admin
      .from("hms_payments")
      .select("id, tenant_id, for_month, amount, amount_paid, status, late_fee, food_charge, ac_charge, security_deposit_charge, payment_package_tier, payment_method, payment_date, receipt_number, tenant:hms_tenants(full_name, phone, room_id, hms_rooms(room_number))")
      .eq("hostel_id", hostelId)
      .gte("for_month", from)
      .lte("for_month", to),
    admin
      .from("hms_expenses")
      .select("id, title, amount, category, date, notes")
      .eq("hostel_id", hostelId)
      .gte("date", fullStart)
      .lte("date", fullEnd),
    admin
      .from("hms_kitchen_expenses")
      .select("id, title, amount, date, type, notes")
      .eq("hostel_id", hostelId)
      .gte("date", fullStart)
      .lte("date", fullEnd),
    admin
      .from("hms_salary_payments")
      .select("id, amount, for_month, status, payment_date, notes, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .gte("for_month", from)
      .lte("for_month", to),
    admin
      .from("hms_tenants")
      .select("id, full_name, check_in, check_out, is_active, package_tier")
      .eq("hostel_id", hostelId),
    admin
      .from("hms_rooms")
      .select("id, room_number, type, capacity, occupied, status")
      .eq("hostel_id", hostelId),
    admin
      .from("hms_bills")
      .select("id, title, amount, category, due_date, paid_date, status, notes")
      .eq("hostel_id", hostelId)
      .gte("due_date", fullStart)
      .lte("due_date", fullEnd),
    // No date filter by design — see receivablesAging on ReportData. Capped at
    // for_month <= current month so pre-billed future months aren't called "owed".
    admin
      .from("hms_payments")
      .select("tenant_id, for_month, amount, amount_paid, late_fee, tenant:hms_tenants(full_name, is_active)")
      .eq("hostel_id", hostelId)
      .in("status", ["pending", "overdue", "partially_paid"])
      .lte("for_month", currentMonthKey),
  ]);

  type PaymentRow = {
    id: string;
    tenant_id: string;
    for_month: string;
    amount: unknown;
    amount_paid?: unknown;
    status: string;
    late_fee: unknown;
    food_charge: unknown;
    ac_charge: unknown;
    security_deposit_charge?: unknown;
    ac_units_consumed?: unknown;
    payment_package_tier: unknown;
    payment_method: string | null;
    payment_date: string | null;
    receipt_number: string | null;
    tenant: { full_name: string; phone: string | null; room_id: string | null; hms_rooms: { room_number: string } | { room_number: string }[] | null } | null;
  };
  const payments = ((paymentsRes.data ?? []) as unknown as PaymentRow[]);
  const expenses = expensesRes.data ?? [];
  const kitchen = kitchenRes.data ?? [];
  const salaries = salariesRes.data ?? [];
  const tenants = tenantsRes.data ?? [];
  const rooms = roomsRes.data ?? [];
  const newTenants = tenants.filter(
    (t) => t.check_in >= fullStart && t.check_in <= fullEnd
  ).length;

  // Total revenue & pending
  // "paid" = fully settled rows only, used for breakdowns (rent/food/AC split, AC
  // analytics) where attributing a partial payment across categories isn't
  // well-defined. Top-level money figures (totalRevenue, pendingCollections,
  // topTenants, overduePayments) separately account for partially_paid rows below.
  const paidPayments = payments.filter((p) => p.status === "paid");
  const collectedPayments = payments.filter((p) => p.status === "paid" || p.status === "partially_paid");
  const totalRevenue = collectedPayments.reduce((s, p) => s + Number(p.amount_paid ?? p.amount), 0);
  const pendingPayments = payments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid");
  const pendingCollections = pendingPayments.reduce((s, p) => s + Math.max(0, Number(p.amount) + Number(p.late_fee || 0) - Number(p.amount_paid ?? 0)), 0);

  // Occupancy
  const totalCapacity = rooms.reduce((s, r) => s + r.capacity, 0);
  const totalOccupied = rooms.reduce((s, r) => s + r.occupied, 0);
  const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

  // Revenue by month
  const revenueByMonth = monthKeys.map(({ monthKey, label }) => {
    const mPayments = payments.filter((p) => p.for_month === monthKey);
    // rent/food/AC split stays paid-only — a partial payment can't be cleanly
    // attributed across categories (which portion did it cover?).
    const mPaid = mPayments.filter((p) => p.status === "paid");
    const mCollected = mPayments.filter((p) => p.status === "paid" || p.status === "partially_paid");
    const mPending = mPayments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid");
    const collected = mCollected.reduce((s, p) => s + Number(p.amount_paid ?? p.amount), 0);
    const pending = mPending.reduce((s, p) => s + Math.max(0, Number(p.amount) + Number(p.late_fee || 0) - Number(p.amount_paid ?? 0)), 0);
    return {
      month: label,
      monthKey,
      rentRevenue: mPaid.reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.food_charge || 0) - Number(p.ac_charge || 0) - Number(p.security_deposit_charge || 0)), 0),
      foodRevenue: mPaid.reduce((s, p) => s + Number(p.food_charge || 0), 0),
      acRevenue: mPaid.reduce((s, p) => s + Number(p.ac_charge || 0), 0),
      // total = collected + pending (a clean invariant) rather than re-deriving
      // from status, which gets ambiguous once a row can be partially settled.
      collected,
      pending,
      total: collected + pending,
    };
  });

  // Monthly expense breakdown
  const monthlyExpenses = monthKeys.map(({ monthKey, label, start, end }) => {
    const exp = expenses.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.amount), 0);
    const kit = kitchen.filter((k) => k.date >= start && k.date <= end).reduce((s, k) => s + Number(k.amount), 0);
    const sal = salaries.filter((s) => s.for_month === monthKey && s.status === "paid").reduce((sum, s) => sum + Number(s.amount), 0);
    const col = payments.filter((p) => p.for_month === monthKey && (p.status === "paid" || p.status === "partially_paid")).reduce((s, p) => s + Number(p.amount_paid ?? p.amount), 0);
    return { month: label, monthKey, expenses: exp, kitchen: kit, salaries: sal, collected: col };
  });

  // Top tenants by total paid
  const tenantTotals: Record<string, { id: string; name: string; totalPaid: number }> = {};
  collectedPayments.forEach((p) => {
    const name = p.tenant?.full_name ?? "Unknown";
    if (!tenantTotals[p.tenant_id]) tenantTotals[p.tenant_id] = { id: p.tenant_id, name, totalPaid: 0 };
    tenantTotals[p.tenant_id].totalPaid += Number(p.amount_paid ?? p.amount);
  });
  const topTenants = Object.values(tenantTotals)
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 5);

  // Overdue payments — remaining balance, not the full bill, for a partially_paid row
  const overduePayments = pendingPayments.map((p) => ({
    id: p.id,
    tenantName: p.tenant?.full_name ?? "Unknown",
    forMonth: p.for_month,
    amount: Math.max(0, Number(p.amount) + Number(p.late_fee || 0) - Number(p.amount_paid ?? 0)),
    status: p.status,
  }));

  // Occupancy by room type
  const typeMap: Record<string, { total: number; occupied: number }> = {};
  rooms.forEach((r) => {
    const tp = r.type ?? "general";
    if (!typeMap[tp]) typeMap[tp] = { total: 0, occupied: 0 };
    typeMap[tp].total += r.capacity;
    typeMap[tp].occupied += r.occupied;
  });
  const occupancyByType = Object.entries(typeMap).map(([type, { total, occupied }]) => ({
    type,
    total,
    occupied,
    rate: total > 0 ? Math.round((occupied / total) * 100) : 0,
  }));

  // AC analytics — from paid payments with ac_charge > 0
  const acPayments = paidPayments.filter((p) => Number(p.ac_charge || 0) > 0);
  const acByRoom = acPayments.map((p) => {
    const t = p.tenant;
    const rooms_raw = t?.hms_rooms;
    const roomEntry = Array.isArray(rooms_raw) ? (rooms_raw as { room_number: string }[])[0] : (rooms_raw as { room_number: string } | null);
    return {
      roomNumber: roomEntry?.room_number ?? "—",
      tenantName: t?.full_name ?? "Unknown",
      unitsConsumed: Number(p.ac_units_consumed || 0),
      acCharge: Number(p.ac_charge || 0),
      forMonth: p.for_month,
    };
  }).sort((a, b) => b.unitsConsumed - a.unitsConsumed).slice(0, 10);

  const totalAcRevenue = acPayments.reduce((s, p) => s + Number(p.ac_charge || 0), 0);
  const totalAcTenants = acPayments.length;
  const avgUnitsPerTenant = totalAcTenants > 0
    ? Math.round(acPayments.reduce((s, p) => s + Number(p.ac_units_consumed || 0), 0) / totalAcTenants)
    : 0;

  // Payment method breakdown (reconciliation)
  const METHOD_LABELS: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    jazzcash: "JazzCash",
    easypaisa: "Easypaisa",
    cheque: "Cheque",
    online: "Online",
  };

  const methodMap: Record<string, { count: number; amount: number }> = {};
  collectedPayments.forEach((p) => {
    const m = p.payment_method ?? "cash";
    if (!methodMap[m]) methodMap[m] = { count: 0, amount: 0 };
    methodMap[m].count += 1;
    methodMap[m].amount += Number(p.amount_paid ?? p.amount);
  });
  const paymentMethodBreakdown = Object.entries(methodMap)
    .map(([method, { count, amount }]) => ({
      method,
      label: METHOD_LABELS[method] ?? method,
      count,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  // A partial payment is a real transaction (method + date) — include it here
  // showing what was actually received, not the full bill amount.
  const paidPaymentsList = collectedPayments
    .map((p) => {
      const roomsRaw = p.tenant?.hms_rooms;
      const roomEntry = Array.isArray(roomsRaw) ? roomsRaw[0] : roomsRaw;
      const isPartial = p.status === "partially_paid";
      return {
        id: p.id,
        tenantName: p.tenant?.full_name ?? "Unknown",
        phone: p.tenant?.phone ?? null,
        roomNumber: (roomEntry as { room_number?: string } | null)?.room_number ?? null,
        forMonth: p.for_month,
        amount: Number(p.amount_paid ?? p.amount),
        lateFee: Number(p.late_fee || 0),
        method: p.payment_method ?? "cash",
        paymentDate: p.payment_date,
        receiptNumber: p.receipt_number,
        isPartial,
      };
    })
    .sort((a, b) => (b.paymentDate ?? "").localeCompare(a.paymentDate ?? ""));

  // Consolidated expense report — bills + staff salaries + general expenses + kitchen
  const bills = billsRes.data ?? [];

  type ExpenseReportRow = ReportData["expenseReport"]["rows"][number];

  const billRows: ExpenseReportRow[] = bills.map((b) => ({
    id: b.id,
    source: "bill",
    sourceLabel: "Bill",
    date: b.due_date,
    title: b.title,
    category: capitalize(b.category),
    amount: Number(b.amount),
    status: b.status,
    notes: b.notes,
  }));

  const salaryRows: ExpenseReportRow[] = salaries.map((s) => {
    const empRaw = (s as unknown as { employee: { full_name: string; role: string } | { full_name: string; role: string }[] | null }).employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    return {
      id: s.id,
      source: "salary",
      sourceLabel: "Staff Salary",
      date: s.payment_date ?? `${s.for_month}-01`,
      title: emp?.full_name ?? "Unknown Employee",
      category: emp?.role ? capitalize(emp.role) : "Staff",
      amount: Number(s.amount),
      status: s.status,
      notes: s.notes,
    };
  });

  const expenseRows: ExpenseReportRow[] = expenses.map((e) => ({
    id: e.id,
    source: "expense",
    sourceLabel: "General Expense",
    date: e.date,
    title: e.title,
    category: capitalize(e.category),
    amount: Number(e.amount),
    status: null,
    notes: e.notes,
  }));

  const kitchenRows: ExpenseReportRow[] = kitchen.map((k) => ({
    id: k.id,
    source: "kitchen",
    sourceLabel: "Kitchen",
    date: k.date,
    title: k.title,
    category: k.type === "monthly_grocery" ? "Monthly Grocery" : "Daily",
    amount: Number(k.amount),
    status: null,
    notes: k.notes,
  }));

  const expenseReportRows = [...billRows, ...salaryRows, ...expenseRows, ...kitchenRows]
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalsBySource = {
    bills: billRows.reduce((s, r) => s + r.amount, 0),
    staff: salaryRows.reduce((s, r) => s + r.amount, 0),
    expenses: expenseRows.reduce((s, r) => s + r.amount, 0),
    kitchen: kitchenRows.reduce((s, r) => s + r.amount, 0),
  };
  const grandTotal = totalsBySource.bills + totalsBySource.staff + totalsBySource.expenses + totalsBySource.kitchen;
  const unpaidBillsTotal = billRows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.amount, 0);
  const pendingSalariesTotal = salaryRows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.amount, 0);

  // ── Receivables aging ──────────────────────────────────────────────────────
  // "How late" is derived from for_month vs the current month: the DB has no
  // overdue concept — every unpaid row is `pending` whether it's days or months
  // old — so age is the only way to tell a slow payer from a real debtor.
  type AgingRow = {
    tenant_id: string;
    for_month: string;
    amount: unknown;
    amount_paid?: unknown;
    late_fee: unknown;
    tenant: { full_name: string; is_active: boolean } | { full_name: string; is_active: boolean }[] | null;
  };
  const agingRows = (agingRes.data ?? []) as unknown as AgingRow[];

  function monthsBetween(fromKey: string, toKey: string): number {
    const [fy, fm] = fromKey.split("-").map(Number);
    const [ty, tm] = toKey.split("-").map(Number);
    return (ty - fy) * 12 + (tm - fm);
  }

  const aging = { current: 0, late1Month: 0, late2Months: 0, late3PlusMonths: 0 };
  const debtorMap = new Map<string, { name: string; owed: number; months: number; oldestMonth: string; isActive: boolean }>();

  for (const r of agingRows) {
    const owed = Number(r.amount ?? 0) + Number(r.late_fee ?? 0) - Number(r.amount_paid ?? 0);
    if (owed <= 0) continue;

    const age = monthsBetween(r.for_month, currentMonthKey);
    if (age <= 0) aging.current += owed;
    else if (age === 1) aging.late1Month += owed;
    else if (age === 2) aging.late2Months += owed;
    else aging.late3PlusMonths += owed;

    const tenantRel = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
    const existing = debtorMap.get(r.tenant_id);
    if (existing) {
      existing.owed += owed;
      existing.months += 1;
      if (r.for_month < existing.oldestMonth) existing.oldestMonth = r.for_month;
    } else {
      debtorMap.set(r.tenant_id, {
        name: tenantRel?.full_name ?? "Unknown",
        owed,
        months: 1,
        oldestMonth: r.for_month,
        isActive: tenantRel?.is_active ?? false,
      });
    }
  }

  const totalOwed = aging.current + aging.late1Month + aging.late2Months + aging.late3PlusMonths;
  const allDebtors = [...debtorMap.entries()].map(([id, d]) => ({
    id, name: d.name, owed: d.owed, monthsUnpaid: d.months, oldestMonth: d.oldestMonth, isActive: d.isActive,
  }));
  const formerDebtorList = allDebtors.filter((d) => !d.isActive);
  const topDebtors = [...allDebtors].sort((a, b) => b.owed - a.owed).slice(0, 5);

  return {
    data: {
      hostelId,
      hostelName: hostelRow.name,
      from,
      to,
      label,
      totalRevenue,
      pendingCollections,
      occupancyRate,
      newTenants,
      revenueByMonth,
      topTenants,
      overduePayments,
      monthlyExpenses,
      occupancyByType,
      totalCapacity,
      totalOccupied,
      acByRoom,
      acStats: { avgUnitsPerTenant, totalAcRevenue, totalAcTenants },
      roomOptions: rooms.map((r) => ({ id: r.id, roomNumber: r.room_number })).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)),
      paymentMethodBreakdown,
      paidPaymentsList,
      expenseReport: {
        rows: expenseReportRows,
        totalsBySource,
        grandTotal,
        unpaidBillsTotal,
        pendingSalariesTotal,
      },
      receivablesAging: {
        ...aging,
        totalOwed,
        totalLate: aging.late1Month + aging.late2Months + aging.late3PlusMonths,
        activeDebtors: allDebtors.filter((d) => d.isActive).length,
        activeTenants: tenants.filter((t) => t.is_active).length,
        formerDebtors: formerDebtorList.length,
        formerDebtorsOwed: formerDebtorList.reduce((s, d) => s + d.owed, 0),
        topDebtors,
      },
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Member Ledger — cross-tenant landing table for the Reports page.
// Per-tenant full history (drill-in) reuses getTenantTimeline() from
// app/actions/tenants.ts rather than duplicating event-building logic.
// ---------------------------------------------------------------------------

const LEDGER_TIER_LABELS: Record<string, string> = {
  space_only: "Space Only",
  space_food: "Space + 2 Meals",
  space_3meals: "Space + 3 Meals",
  space_food_ac: "Space + Meals + AC",
  space_meals_cooler: "Space + Meals + Cooler",
};

export interface LedgerTenantRow {
  id: string;
  fullName: string;
  phone: string | null;
  roomNumber: string | null;
  status: "active" | "waiting" | "checked_out";
  packageLabel: string;
  /** The tenant's recurring rate (not a period total) — Rs/mo or Rs/day depending on billingType */
  packagePrice: number;
  billingType: "monthly" | "daily";
  securityDeposit: number;
  /** Sum of food_charge across all payments in range — surfaced separately so a
      food/breakfast add-on isn't hidden inside the combined Charged total. */
  totalFoodCharge: number;
  totalCharged: number;
  totalPaid: number;
  totalOwed: number;
  lastPaymentDate: string | null;
}

export interface LedgerFilters {
  roomId?: string;
  status?: "active" | "waiting" | "checked_out" | "all";
  search?: string;
  hasDeposit?: boolean;
  /** A PackageTier key, or "custom" for tenants on a custom package */
  packageTier?: string;
}

export async function getLedgerTenants(
  hostelId: string,
  from: string,
  to: string,
  filters: LedgerFilters
): Promise<{ data: LedgerTenantRow[] | null; error: string | null }> {
  const profile = await requireOwnerOrPartnerTier("read_only");
  const admin = createAdminClient();

  const { data: hostelRow } = await admin
    .from("hms_hostels")
    .select("id, owner_id")
    .eq("id", hostelId)
    .single();

  if (!hostelRow) return { data: null, error: "Hostel not found" };

  if (!(await verifyReportAccess(profile, hostelId, hostelRow.owner_id, admin))) {
    return { data: null, error: "Unauthorized" };
  }

  let tenantQuery = admin
    .from("hms_tenants")
    .select("id, full_name, phone, is_active, is_waiting, package_tier, custom_package_id, security_deposit, billing_type, monthly_rent, daily_rate, room:hms_rooms(room_number)")
    .eq("hostel_id", hostelId);

  if (filters.roomId) tenantQuery = tenantQuery.eq("room_id", filters.roomId);
  if (filters.status === "active") tenantQuery = tenantQuery.eq("is_active", true).eq("is_waiting", false);
  if (filters.status === "waiting") tenantQuery = tenantQuery.eq("is_waiting", true);
  if (filters.status === "checked_out") tenantQuery = tenantQuery.eq("is_active", false).eq("is_waiting", false);
  if (filters.search?.trim()) {
    const q = filters.search.trim();
    tenantQuery = tenantQuery.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  }
  if (filters.hasDeposit) tenantQuery = tenantQuery.gt("security_deposit", 0);
  if (filters.packageTier === "custom") {
    tenantQuery = tenantQuery.not("custom_package_id", "is", null);
  } else if (filters.packageTier) {
    tenantQuery = tenantQuery.eq("package_tier", filters.packageTier).is("custom_package_id", null);
  }

  const [{ data: tenants, error: tenantsErr }, { data: payments, error: paymentsErr }] = await Promise.all([
    tenantQuery,
    admin
      .from("hms_payments")
      .select("tenant_id, amount, amount_paid, late_fee, status, payment_date, food_charge")
      .eq("hostel_id", hostelId)
      .gte("for_month", from)
      .lte("for_month", to),
  ]);

  if (tenantsErr) return { data: null, error: "Failed to load tenants" };
  if (paymentsErr) return { data: null, error: "Failed to load payments" };

  type TenantRow = {
    id: string; full_name: string; phone: string | null; is_active: boolean; is_waiting: boolean;
    package_tier: string | null; custom_package_id: string | null; security_deposit: number | null;
    billing_type: string; monthly_rent: number | null; daily_rate: number | null;
    room: { room_number: string } | { room_number: string }[] | null;
  };
  type PaymentRow = { tenant_id: string; amount: number; amount_paid: number | null; late_fee: number | null; status: string; payment_date: string | null; food_charge: number | null };

  const paymentsByTenant: Record<string, PaymentRow[]> = {};
  ((payments ?? []) as PaymentRow[]).forEach((p) => {
    (paymentsByTenant[p.tenant_id] ??= []).push(p);
  });

  const rows: LedgerTenantRow[] = ((tenants ?? []) as TenantRow[]).map((t) => {
    const tPayments = paymentsByTenant[t.id] ?? [];
    const collected = tPayments.filter((p) => p.status === "paid" || p.status === "partially_paid");
    const owed = tPayments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid");
    const totalCharged = tPayments.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee ?? 0), 0);
    const totalPaid = collected.reduce((s, p) => s + Number(p.amount_paid ?? p.amount), 0);
    const totalOwed = owed.reduce((s, p) => s + Math.max(0, Number(p.amount) + Number(p.late_fee ?? 0) - Number(p.amount_paid ?? 0)), 0);
    const totalFoodCharge = tPayments.reduce((s, p) => s + Number(p.food_charge ?? 0), 0);
    const lastPaymentDate = collected.reduce<string | null>((latest, p) => (p.payment_date && (!latest || p.payment_date > latest) ? p.payment_date : latest), null);
    const roomRel = t.room;
    const roomNumber = Array.isArray(roomRel) ? roomRel[0]?.room_number ?? null : roomRel?.room_number ?? null;
    const packageLabel = t.custom_package_id ? "Custom Package" : (LEDGER_TIER_LABELS[t.package_tier ?? ""] ?? t.package_tier ?? "Space Only");
    const billingType = t.billing_type === "daily" ? "daily" : "monthly";
    const packagePrice = billingType === "daily" ? Number(t.daily_rate ?? 0) : Number(t.monthly_rent ?? 0);

    return {
      id: t.id,
      fullName: t.full_name,
      phone: t.phone,
      roomNumber,
      status: t.is_waiting ? "waiting" : t.is_active ? "active" : "checked_out",
      packageLabel,
      packagePrice,
      billingType,
      securityDeposit: Number(t.security_deposit ?? 0),
      totalFoodCharge,
      totalCharged,
      totalPaid,
      totalOwed,
      lastPaymentDate,
    };
  });

  return { data: rows, error: null };
}
