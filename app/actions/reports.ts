"use server";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { capitalize, getMonthRange } from "@/lib/utils";
import { pktYearMonth } from "@/lib/pkt-time";
import { tenantDueDay, shouldRemindToday } from "@/lib/payment-calc";
import {
  collectedFrom,
  pendingFrom,
  depositsCollectedFrom,
  salaryCashOutFrom,
  enumerateMonths,
} from "@/lib/report-math";
import type { Profile } from "@/types";

// Per-day snapshot for the "Today" tab — one entry per date that had any
// activity (an expense/kitchen row, a payment, a join, or a checkout) within
// the current calendar month, so the tab can show any single day the owner
// picks, not just today. Empty arrays mean that category had nothing that
// day, not that the query failed.
export interface DailyExpenseDetail {
  date: string;
  income: number;
  kitchenTotal: number;
  otherTotal: number;
  /** Staff salaries actually paid out on this date. Counted in `total` like any
   *  other cash leaving the hostel — this tab is the daily register, and a
   *  salary handed over is as real an expense as a bag of flour. */
  salaryTotal: number;
  /** Utility/rent bills settled on this date. Keyed on paid_date, so an unpaid
   *  bill never appears — this register is cash that moved, not what is owed. */
  billTotal: number;
  total: number;
  expenseList: {
    id: string;
    source: "expense" | "kitchen" | "salary" | "bill";
    title: string;
    category: string;
    amount: number;
    notes: string | null;
  }[];
  paymentsList: {
    id: string;
    tenantName: string;
    phone: string | null;
    roomNumber: string | null;
    amount: number;
    forMonth: string;
    method: string;
    receiptNumber: string | null;
  }[];
  joinedList: {
    id: string;
    name: string;
    phone: string | null;
    type: string;
    packageTier: string;
    roomNumber: string | null;
  }[];
  leftList: {
    id: string;
    name: string;
    phone: string | null;
    type: string;
    packageTier: string;
    roomNumber: string | null;
  }[];
  // Not an "event that happened on this date" like the lists above — a
  // projection of which currently-owing tenants would be reminder-worthy on
  // this specific day of the month (their own due day, or every 3rd day past
  // it), using the exact same rule the WhatsApp reminder cron uses. Lets the
  // owner see who's due without leaving Reports for the Payments page.
  dueList: {
    id: string;
    name: string;
    phone: string | null;
    roomNumber: string | null;
    amount: number;
    forMonth: string;
  }[];
}

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
  // Who exactly joined in the selected period — newTenants is just a count,
  // this is the filterable list behind it (name/room/type so the owner can
  // actually verify who, not just how many).
  joinedTenantsList: {
    id: string;
    name: string;
    phone: string | null;
    type: string;
    packageTier: string;
    roomNumber: string | null;
    checkIn: string;
  }[];

  // Revenue by month
  revenueByMonth: {
    month: string;
    monthKey: string;
    rentRevenue: number;
    foodRevenue: number;
    acRevenue: number;
    registrationFeeRevenue: number;
    acMaintenanceRevenue: number;
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
    /** Refundable deposits inside `collected` — subtract for true profit. */
    depositsCollected: number;
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
    status: string;
  }[];
  acStats: {
    totalAcRevenue: number;
    totalAcTenants: number;
    paidAcTenants: number;
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
    /** Everything owed for the period, paid or not. Drives the "of Rs X" sub-lines. */
    totalsBySource: { bills: number; staff: number; expenses: number; kitchen: number };
    /** What actually left the bank. Bills and salaries can sit unpaid; general
     *  expenses and kitchen are only ever recorded after the money is spent. */
    paidBySource: { bills: number; staff: number };
    /** Actual spend — paid rows only, so this reconciles with the Today tab. */
    grandTotal: number;
    /** Advances inside paidBySource.staff. Broken out because that figure is cash
     *  paid out while totalsBySource.staff is salary EARNED — without naming the
     *  difference the tile reads as "paid more than the total". */
    advancesTotal: number;
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

  // Daily snapshot — standard for every client. Deliberately scoped to the
  // CURRENT calendar month, not the report's selected date range — "today"
  // wouldn't mean anything for a "Last Month" or "12 Months" view. One entry
  // per day of activity, so the owner can pick any date and see exactly what
  // happened, not just today. The *List fields inside each entry exist so the
  // owner can verify each figure against their own physical register — a
  // headcount alone ("3 joined") isn't verifiable, but a name + room number is.
  dailyExpenseDetails: DailyExpenseDetail[];
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

  const monthKeys = enumerateMonths(from, to);

  const fullStart = monthKeys[0]?.start ?? from;
  const fullEnd = monthKeys[monthKeys.length - 1]?.end ?? to;

  const now = new Date();
  // Pakistan-anchored, not the server process's own OS timezone — Vercel's
  // serverless functions default to UTC, a developer's own machine is
  // whatever it's set to, and "this month" must agree between them.
  const { year: curYear, month: curMonth } = pktYearMonth(now); // curMonth is 1-indexed
  const currentMonthKey = `${curYear}-${String(curMonth).padStart(2, "0")}`;

  const [
    paymentsRes,
    expensesRes,
    kitchenRes,
    salariesRes,
    advancesRes,
    tenantsRes,
    roomsRes,
    billsRes,
    agingRes,
  ] = await Promise.all([
    admin
      .from("hms_payments")
      .select("id, tenant_id, for_month, amount, amount_paid, status, late_fee, food_charge, ac_charge, ac_units_consumed, security_deposit_charge, registration_fee_charge, ac_maintenance_charge, payment_package_tier, payment_method, payment_date, receipt_number, tenant:hms_tenants(full_name, phone, room_id, hms_rooms(room_number))")
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
      .select("id, amount, advance_deducted, for_month, status, payment_date, notes, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .gte("for_month", from)
      .lte("for_month", to),
    // Advances handed over in the range. Listed so the expense report shows all
    // staff cash movement, but kept OUT of totalsBySource.staff — that figure is
    // what staff EARNED, and a loan is not earnings.
    admin
      .from("hms_salary_advances")
      .select("id, amount, advance_date, notes, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .gte("advance_date", fullStart)
      .lte("advance_date", fullEnd),
    admin
      .from("hms_tenants")
      .select("id, full_name, phone, type, check_in, check_out, is_active, package_tier, hms_rooms(room_number)")
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
    registration_fee_charge?: unknown;
    ac_maintenance_charge?: unknown;
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
  const advancesGiven = advancesRes.data ?? [];
  type TenantWithRoomRow = {
    id: string;
    full_name: string;
    phone: string | null;
    type: string;
    check_in: string;
    check_out: string | null;
    is_active: boolean;
    package_tier: string;
    hms_rooms: { room_number: string } | { room_number: string }[] | null;
  };
  const tenants = (tenantsRes.data ?? []) as unknown as TenantWithRoomRow[];
  const rooms = roomsRes.data ?? [];
  const joinedInPeriod = tenants.filter((t) => t.check_in >= fullStart && t.check_in <= fullEnd);
  const newTenants = joinedInPeriod.length;
  const joinedTenantsList = [...joinedInPeriod]
    .sort((a, b) => b.check_in.localeCompare(a.check_in))
    .map((t) => {
      const r = t.hms_rooms;
      return {
        id: t.id,
        name: t.full_name,
        phone: t.phone,
        type: t.type,
        packageTier: t.package_tier,
        roomNumber: (Array.isArray(r) ? r[0] : r)?.room_number ?? null,
        checkIn: t.check_in,
      };
    });

  // Total revenue & pending
  const collectedPayments = payments.filter((p) => p.status === "paid" || p.status === "partially_paid");
  const totalRevenue = collectedFrom(payments);
  const pendingPayments = payments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid");
  const pendingCollections = pendingFrom(payments);

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
    const collected = collectedFrom(mPayments);
    const pending = pendingFrom(mPayments);
    return {
      month: label,
      monthKey,
      rentRevenue: mPaid.reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.food_charge || 0) - Number(p.ac_charge || 0) - Number(p.security_deposit_charge || 0) - Number(p.registration_fee_charge || 0) - Number(p.ac_maintenance_charge || 0)), 0),
      foodRevenue: mPaid.reduce((s, p) => s + Number(p.food_charge || 0), 0),
      acRevenue: mPaid.reduce((s, p) => s + Number(p.ac_charge || 0), 0),
      registrationFeeRevenue: mPaid.reduce((s, p) => s + Number(p.registration_fee_charge || 0), 0),
      acMaintenanceRevenue: mPaid.reduce((s, p) => s + Number(p.ac_maintenance_charge || 0), 0),
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
    const sal = salaryCashOutFrom(salaries, advancesGiven, monthKey, start, end);
    const monthPayments = payments.filter((p) => p.for_month === monthKey);
    const col = collectedFrom(monthPayments);
    // Deposits are returned alongside rather than pre-subtracted so the Collected
    // tile keeps meaning "cash in" while profit can still exclude them.
    const dep = depositsCollectedFrom(monthPayments);
    return { month: label, monthKey, expenses: exp, kitchen: kit, salaries: sal, collected: col, depositsCollected: dep };
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

  // AC analytics — every tenant billed for AC this period, any payment
  // status, so owners can see everyone who owes an AC bill and filter down
  // to who's actually paid (rather than only ever seeing the paid ones).
  const acAllPayments = payments.filter((p) => Number(p.ac_charge || 0) > 0);
  const acPaidPayments = acAllPayments.filter((p) => p.status === "paid");

  const acByRoom = acAllPayments.map((p) => {
    const t = p.tenant;
    const rooms_raw = t?.hms_rooms;
    const roomEntry = Array.isArray(rooms_raw) ? (rooms_raw as { room_number: string }[])[0] : (rooms_raw as { room_number: string } | null);
    return {
      roomNumber: roomEntry?.room_number ?? "—",
      tenantName: t?.full_name ?? "Unknown",
      unitsConsumed: Number(p.ac_units_consumed || 0),
      acCharge: Number(p.ac_charge || 0),
      forMonth: p.for_month,
      status: p.status,
    };
  }).sort((a, b) => b.unitsConsumed - a.unitsConsumed);

  const totalAcRevenue = acPaidPayments.reduce((s, p) => s + Number(p.ac_charge || 0), 0);
  const totalAcTenants = acAllPayments.length;
  const paidAcTenants = acPaidPayments.length;

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

  // Advances are cash out but not earnings, so they get their own rows and are
  // added only to what was PAID — never to totalsBySource.staff.
  const advanceRows: ExpenseReportRow[] = advancesGiven.map((a) => {
    const empRaw = (a as unknown as { employee: { full_name: string; role: string } | { full_name: string; role: string }[] | null }).employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    return {
      id: a.id,
      source: "salary",
      sourceLabel: "Salary Advance",
      date: a.advance_date,
      title: `${emp?.full_name ?? "Staff"} — advance`,
      category: emp?.role ? capitalize(emp.role) : "Staff",
      amount: Number(a.amount),
      status: "paid",
      notes: a.notes ?? "Advance against future salary",
    };
  });

  const expenseReportRows = [...billRows, ...salaryRows, ...advanceRows, ...expenseRows, ...kitchenRows]
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalsBySource = {
    bills: billRows.reduce((s, r) => s + r.amount, 0),
    // What staff EARNED in the period — gross, advances excluded. An advance is
    // a loan against this, not an addition to it.
    staff: salaryRows.reduce((s, r) => s + r.amount, 0),
    expenses: expenseRows.reduce((s, r) => s + r.amount, 0),
    kitchen: kitchenRows.reduce((s, r) => s + r.amount, 0),
  };

  // What actually left the bank: salaries NET of any advance held back, plus the
  // advances themselves on the day they were handed over. Summing gross salary
  // here would count the deducted rupees twice — once as the advance, once
  // inside the salary that never fully went out.
  const salaryCashOut = salaries
    .filter((x) => x.status === "paid")
    .reduce((sum, x) => sum + (Number(x.amount) - Number(x.advance_deducted ?? 0)), 0);
  const advanceCashOut = advanceRows.reduce((s, r) => s + r.amount, 0);

  const paidBySource = {
    bills: billRows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0),
    staff: salaryCashOut + advanceCashOut,
  };
  // Paid rows only. A pending salary is a liability, not money spent — counting
  // it here made this tab disagree with the Today tab and the dashboard by
  // exactly the unpaid amount.
  const grandTotal = paidBySource.bills + paidBySource.staff + totalsBySource.expenses + totalsBySource.kitchen;
  const unpaidBillsTotal = totalsBySource.bills - paidBySource.bills;
  // Derived from the unpaid rows themselves, NOT totals minus paid: now that
  // "paid" is net of advances and includes advance cash, that subtraction would
  // report a deduction as an unpaid salary.
  const pendingSalariesTotal = salaryRows
    .filter((r) => r.status !== "paid")
    .reduce((s, r) => s + r.amount, 0);

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

  // ── Daily snapshot ───────────────────────────────────────────────────────
  // Standard for every client with Reports access. Scoped to the CURRENT
  // calendar month regardless of the report's selected from/to range —
  // "today" wouldn't mean anything for a "Last Month" or "12 Months" view.
  // Every query here is month-scoped (not just "today") so the Today tab's
  // date picker can show any day, not only the day the page happened to load.
  //
  // The end bound is widened one month further (through the end of NEXT
  // month, not just this one) so an expense/kitchen entry someone logs a few
  // days ahead of today — for their own convenience — doesn't fall off the
  // edge of the window entirely whenever "today" happens to be near month-end.
  const { start: curStart } = getMonthRange(now);
  // curYear/curMonth (from pktYearMonth above) instead of now's own local
  // getters — otherwise "next month" is computed relative to whatever month
  // the server's own OS timezone thinks it is, which can disagree with
  // Pakistan time for the same reason getMonthRange itself had to be fixed.
  const { end: curEnd } = getMonthRange(new Date(Date.UTC(curYear, curMonth, 1)));
  const [
    curExpensesRes, curKitchenRes, curSalariesRes, curBillsRes, curAdvancesRes, monthInstallmentsRes, joinedRes, leftRes, dueRes,
  ] = await Promise.all([
    // Full rows, not just amount/date — the owner needs to verify exactly
    // what each expense was, not just a total.
    admin.from("hms_expenses").select("id,title,category,amount,date,notes").eq("hostel_id", hostelId).gte("date", curStart).lte("date", curEnd),
    admin.from("hms_kitchen_expenses").select("id,title,type,amount,date,notes").eq("hostel_id", hostelId).gte("date", curStart).lte("date", curEnd),
    // Keyed on payment_date, not for_month: this tab answers "what left the till
    // on this day". Only paid rows — an unpaid salary is a liability, not a
    // day's spend. Fetched separately from salariesRes above because that one is
    // scoped to the selected report range, which need not cover this month.
    admin
      .from("hms_salary_payments")
      .select("id, amount, advance_deducted, payment_date, notes, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .eq("status", "paid")
      .not("payment_date", "is", null)
      .gte("payment_date", curStart)
      .lte("payment_date", curEnd),
    // Bills settled in this window. Keyed on paid_date, not due_date: this tab
    // answers "what left the till on this day", and an unpaid bill is a
    // liability, not a day's spend. They were missing entirely, so a hostel that
    // paid its electricity bill saw the day's total ignore it — while the
    // expense report and the owner's daily WhatsApp summary both counted it.
    admin
      .from("hms_bills")
      .select("id, title, category, amount, paid_date, notes")
      .eq("hostel_id", hostelId)
      .eq("status", "paid")
      .not("paid_date", "is", null)
      .gte("paid_date", curStart)
      .lte("paid_date", curEnd),
    // Advances handed over in this period. This tab is the day's cash register,
    // and an advance is cash out of the drawer — it belongs here even though it
    // is NOT a staff cost (it is a loan; see migration 160). The monthly P&L
    // below deliberately still counts gross salary only, so nothing is
    // double-counted between the two views.
    admin
      .from("hms_salary_advances")
      .select("id, amount, advance_date, notes, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .gte("advance_date", curStart)
      .lte("advance_date", curEnd),
    // Granular, not just a total — the owner cross-checks this against their
    // own physical register, so each installment needs a name/room/amount.
    admin
      .from("hms_payment_installments")
      .select("id, amount, payment_date, for_month, payment_method, receipt_number, tenant:hms_tenants(full_name, phone, room_id, hms_rooms(room_number))")
      .eq("hostel_id", hostelId)
      .gte("payment_date", curStart)
      .lte("payment_date", curEnd),
    admin
      .from("hms_tenants")
      .select("id, full_name, phone, type, package_tier, check_in, hms_rooms(room_number)")
      .eq("hostel_id", hostelId)
      .gte("check_in", curStart)
      .lte("check_in", curEnd),
    admin
      .from("hms_tenants")
      .select("id, full_name, phone, type, package_tier, check_out, hms_rooms(room_number)")
      .eq("hostel_id", hostelId)
      .gte("check_out", curStart)
      .lte("check_out", curEnd),
    // Still-owing payments for the current month — bucketed into dueList below
    // by whichever days of the month match each tenant's own due-day cadence,
    // the same rule the WhatsApp reminder cron uses (lib/payment-calc.ts).
    admin
      .from("hms_payments")
      .select("id, tenant_id, amount, late_fee, amount_paid, for_month, tenant:hms_tenants(full_name, phone, check_in, is_active, is_waiting, hms_rooms(room_number))")
      .eq("hostel_id", hostelId)
      .eq("for_month", currentMonthKey)
      .in("status", ["pending", "overdue", "partially_paid"]),
  ]);

  const detailByDate = new Map<string, DailyExpenseDetail>();
  function getDetailRow(date: string): DailyExpenseDetail {
    let row = detailByDate.get(date);
    if (!row) {
      row = { date, income: 0, kitchenTotal: 0, otherTotal: 0, salaryTotal: 0, billTotal: 0, total: 0, expenseList: [], paymentsList: [], joinedList: [], leftList: [], dueList: [] };
      detailByDate.set(date, row);
    }
    return row;
  }
  for (const x of curExpensesRes.data ?? []) {
    const row = getDetailRow(x.date);
    const amount = Number(x.amount);
    row.otherTotal += amount;
    row.total += amount;
    row.expenseList.push({ id: x.id, source: "expense", title: x.title, category: capitalize(x.category), amount, notes: x.notes });
  }
  for (const x of curKitchenRes.data ?? []) {
    const row = getDetailRow(x.date);
    const amount = Number(x.amount);
    row.kitchenTotal += amount;
    row.total += amount;
    row.expenseList.push({ id: x.id, source: "kitchen", title: x.title, category: x.type === "monthly_grocery" ? "Monthly Grocery" : "Daily", amount, notes: x.notes });
  }

  for (const x of curSalariesRes.data ?? []) {
    if (!x.payment_date) continue;
    const row = getDetailRow(x.payment_date);
    // NET, not gross. If an advance was held back, that money left the drawer
    // on the day the advance was given, not today — counting the gross here
    // would bill the same rupees to the register twice.
    const deducted = Number(x.advance_deducted ?? 0);
    const amount = Number(x.amount) - deducted;
    const empRaw = (x as unknown as { employee: { full_name: string; role: string } | { full_name: string; role: string }[] | null }).employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    row.salaryTotal += amount;
    row.total += amount;
    row.expenseList.push({
      id: x.id,
      source: "salary",
      title: emp?.full_name ?? "Staff salary",
      category: emp?.role ? capitalize(emp.role) : "Staff",
      amount,
      notes: deducted > 0
        ? `Salary ${Number(x.amount).toLocaleString()} less advance ${deducted.toLocaleString()}${x.notes ? ` · ${x.notes}` : ""}`
        : x.notes,
    });
  }

  for (const x of curBillsRes.data ?? []) {
    if (!x.paid_date) continue;
    const row = getDetailRow(x.paid_date);
    const amount = Number(x.amount);
    row.billTotal += amount;
    row.total += amount;
    row.expenseList.push({
      id: x.id,
      source: "bill",
      title: x.title,
      category: capitalize(x.category),
      amount,
      notes: x.notes,
    });
  }

  for (const x of curAdvancesRes.data ?? []) {
    if (!x.advance_date) continue;
    const row = getDetailRow(x.advance_date);
    const amount = Number(x.amount);
    const empRaw = (x as unknown as { employee: { full_name: string; role: string } | { full_name: string; role: string }[] | null }).employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    row.salaryTotal += amount;
    row.total += amount;
    row.expenseList.push({
      id: x.id,
      source: "salary",
      title: `${emp?.full_name ?? "Staff"} — salary advance`,
      category: emp?.role ? capitalize(emp.role) : "Staff",
      amount,
      notes: x.notes ?? "Advance against future salary — recovered from a later salary",
    });
  }

  type RoomsRel = { room_number: string } | { room_number: string }[] | null;
  function roomNumberOf(r: RoomsRel): string | null {
    return (Array.isArray(r) ? r[0] : r)?.room_number ?? null;
  }

  type InstallmentRow = {
    id: string;
    amount: unknown;
    payment_date: string;
    for_month: string;
    payment_method: string | null;
    receipt_number: string | null;
    tenant: { full_name: string; phone: string | null; hms_rooms: RoomsRel } | null;
  };
  for (const i of (monthInstallmentsRes.data ?? []) as unknown as InstallmentRow[]) {
    const row = getDetailRow(i.payment_date);
    const amount = Number(i.amount);
    row.income += amount;
    row.paymentsList.push({
      id: i.id,
      tenantName: i.tenant?.full_name ?? "Unknown",
      phone: i.tenant?.phone ?? null,
      roomNumber: roomNumberOf(i.tenant?.hms_rooms ?? null),
      amount,
      forMonth: i.for_month,
      method: i.payment_method ?? "cash",
      receiptNumber: i.receipt_number,
    });
  }

  type TenantEventRow = {
    id: string;
    full_name: string;
    phone: string | null;
    type: string;
    package_tier: string;
    hms_rooms: RoomsRel;
  };
  for (const t of (joinedRes.data ?? []) as unknown as (TenantEventRow & { check_in: string })[]) {
    const row = getDetailRow(t.check_in);
    row.joinedList.push({ id: t.id, name: t.full_name, phone: t.phone, type: t.type, packageTier: t.package_tier, roomNumber: roomNumberOf(t.hms_rooms) });
  }
  for (const t of (leftRes.data ?? []) as unknown as (TenantEventRow & { check_out: string })[]) {
    const row = getDetailRow(t.check_out);
    row.leftList.push({ id: t.id, name: t.full_name, phone: t.phone, type: t.type, packageTier: t.package_tier, roomNumber: roomNumberOf(t.hms_rooms) });
  }

  type DuePaymentRow = {
    id: string;
    tenant_id: string;
    amount: unknown;
    late_fee: unknown;
    amount_paid: unknown;
    for_month: string;
    tenant: { full_name: string; phone: string | null; check_in: string; is_active: boolean; is_waiting: boolean; hms_rooms: RoomsRel } | null;
  };
  const [dueY, dueM] = currentMonthKey.split("-").map(Number);
  const daysInCurrentMonth = new Date(dueY, dueM, 0).getDate();
  for (const p of (dueRes.data ?? []) as unknown as DuePaymentRow[]) {
    // Checked-out and waiting-list tenants never get reminded (same guard as
    // the actual cron in lib/reminder-engine.ts) — a stale unpaid row from
    // before checkout shouldn't show up as "due" here either.
    if (!p.tenant || !p.tenant.is_active || p.tenant.is_waiting || !p.tenant.check_in) continue;
    const remaining = Number(p.amount) + Number(p.late_fee ?? 0) - Number(p.amount_paid ?? 0);
    if (remaining <= 0) continue;
    const dueDay = tenantDueDay(p.tenant.check_in, currentMonthKey);
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      if (!shouldRemindToday(dueDay, day)) continue;
      const dateStr = `${currentMonthKey}-${String(day).padStart(2, "0")}`;
      const row = getDetailRow(dateStr);
      row.dueList.push({
        id: p.tenant_id,
        name: p.tenant.full_name,
        phone: p.tenant.phone,
        roomNumber: roomNumberOf(p.tenant.hms_rooms),
        amount: remaining,
        forMonth: p.for_month,
      });
    }
  }

  const dailyExpenseDetails: DailyExpenseDetail[] = Array.from(detailByDate.values())
    .map((row) => ({
      ...row,
      expenseList: [...row.expenseList].sort((a, b) => b.amount - a.amount),
      paymentsList: [...row.paymentsList].sort((a, b) => b.amount - a.amount),
      dueList: [...row.dueList].sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

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
      joinedTenantsList,
      revenueByMonth,
      topTenants,
      overduePayments,
      monthlyExpenses,
      occupancyByType,
      totalCapacity,
      totalOccupied,
      acByRoom,
      acStats: { totalAcRevenue, totalAcTenants, paidAcTenants },
      roomOptions: rooms.map((r) => ({ id: r.id, roomNumber: r.room_number })).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)),
      paymentMethodBreakdown,
      paidPaymentsList,
      expenseReport: {
        rows: expenseReportRows,
        totalsBySource,
        paidBySource,
        grandTotal,
        unpaidBillsTotal,
        pendingSalariesTotal,
        advancesTotal: advanceCashOut,
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
      dailyExpenseDetails,
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
