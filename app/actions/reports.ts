"use server";
import { requireOwnerOrAbove } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/data";

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

  // Plan distribution (active tenants)
  planDistribution: {
    tier: string;
    label: string;
    count: number;
    percentage: number;
    revenue: number;
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
}

export async function getReportData(
  hostelId: string,
  from: string,
  to: string,
  label: string
): Promise<{ data: ReportData | null; error: string | null }> {
  const profile = await requireOwnerOrAbove();

  const admin = createAdminClient();

  // Verify ownership
  const { data: hostelRow } = await admin
    .from("hms_hostels")
    .select("id, name, owner_id, slug")
    .eq("id", hostelId)
    .single();

  if (!hostelRow) return { data: null, error: "Hostel not found" };

  if (profile.role !== "super_admin" && hostelRow.owner_id !== profile.id) {
    const { data: junction } = await admin
      .from("hms_owner_hostels")
      .select("hostel_id")
      .eq("hostel_id", hostelId)
      .eq("owner_id", profile.id)
      .maybeSingle();
    if (!junction) return { data: null, error: "Unauthorized" };
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

  const [
    paymentsRes,
    expensesRes,
    kitchenRes,
    salariesRes,
    tenantsRes,
    roomsRes,
    newTenantsRes,
  ] = await Promise.all([
    admin
      .from("hms_payments")
      .select("id, tenant_id, for_month, amount, status, late_fee, food_charge, ac_charge, payment_package_tier, tenant:hms_tenants(full_name, room_id, hms_rooms(room_number))")
      .eq("hostel_id", hostelId)
      .gte("for_month", from)
      .lte("for_month", to),
    admin
      .from("hms_expenses")
      .select("amount, date")
      .eq("hostel_id", hostelId)
      .gte("date", fullStart)
      .lte("date", fullEnd),
    admin
      .from("hms_kitchen_expenses")
      .select("amount, date")
      .eq("hostel_id", hostelId)
      .gte("date", fullStart)
      .lte("date", fullEnd),
    admin
      .from("hms_salary_payments")
      .select("amount, for_month, status")
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
      .from("hms_tenants")
      .select("id")
      .eq("hostel_id", hostelId)
      .gte("check_in", fullStart)
      .lte("check_in", fullEnd),
  ]);

  type PaymentRow = {
    id: string;
    tenant_id: string;
    for_month: string;
    amount: unknown;
    status: string;
    late_fee: unknown;
    food_charge: unknown;
    ac_charge: unknown;
    ac_units_consumed?: unknown;
    payment_package_tier: unknown;
    tenant: { full_name: string; room_id: string | null; hms_rooms: { room_number: string } | { room_number: string }[] | null } | null;
  };
  const payments = ((paymentsRes.data ?? []) as unknown as PaymentRow[]);
  const expenses = expensesRes.data ?? [];
  const kitchen = kitchenRes.data ?? [];
  const salaries = salariesRes.data ?? [];
  const tenants = tenantsRes.data ?? [];
  const rooms = roomsRes.data ?? [];

  // Total revenue & pending
  const paidPayments = payments.filter((p) => p.status === "paid");
  const totalRevenue = paidPayments.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);
  const pendingPayments = payments.filter((p) => p.status === "pending" || p.status === "overdue");
  const pendingCollections = pendingPayments.reduce((s, p) => s + Number(p.amount), 0);

  // Occupancy
  const totalCapacity = rooms.reduce((s, r) => s + r.capacity, 0);
  const totalOccupied = rooms.reduce((s, r) => s + r.occupied, 0);
  const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

  // Revenue by month
  const revenueByMonth = monthKeys.map(({ monthKey, label }) => {
    const mPayments = payments.filter((p) => p.for_month === monthKey);
    const mPaid = mPayments.filter((p) => p.status === "paid");
    const mPending = mPayments.filter((p) => p.status === "pending" || p.status === "overdue");
    return {
      month: label,
      monthKey,
      rentRevenue: mPaid.reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.food_charge || 0) - Number(p.ac_charge || 0)), 0),
      foodRevenue: mPaid.reduce((s, p) => s + Number(p.food_charge || 0), 0),
      acRevenue: mPaid.reduce((s, p) => s + Number(p.ac_charge || 0), 0),
      total: mPaid.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0),
      collected: mPaid.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0),
      pending: mPending.reduce((s, p) => s + Number(p.amount), 0),
    };
  });

  // Monthly expense breakdown
  const monthlyExpenses = monthKeys.map(({ monthKey, label, start, end }) => {
    const exp = expenses.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.amount), 0);
    const kit = kitchen.filter((k) => k.date >= start && k.date <= end).reduce((s, k) => s + Number(k.amount), 0);
    const sal = salaries.filter((s) => s.for_month === monthKey && s.status === "paid").reduce((sum, s) => sum + Number(s.amount), 0);
    const col = payments.filter((p) => p.for_month === monthKey && p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
    return { month: label, monthKey, expenses: exp, kitchen: kit, salaries: sal, collected: col };
  });

  // Top tenants by total paid
  const tenantTotals: Record<string, { id: string; name: string; totalPaid: number }> = {};
  paidPayments.forEach((p) => {
    const name = p.tenant?.full_name ?? "Unknown";
    if (!tenantTotals[p.tenant_id]) tenantTotals[p.tenant_id] = { id: p.tenant_id, name, totalPaid: 0 };
    tenantTotals[p.tenant_id].totalPaid += Number(p.amount) + Number(p.late_fee || 0);
  });
  const topTenants = Object.values(tenantTotals)
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 5);

  // Overdue payments
  const overduePayments = pendingPayments.map((p) => ({
    id: p.id,
    tenantName: p.tenant?.full_name ?? "Unknown",
    forMonth: p.for_month,
    amount: Number(p.amount),
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

  // Plan distribution — active tenants grouped by package_tier
  const TIER_LABELS: Record<string, string> = {
    space_only: "Space Only",
    space_food: "Space + 2 Meals",
    space_3meals: "Space + 3 Meals",
    space_food_ac: "Space + Meals + AC",
    space_meals_cooler: "Space + Meals + Cooler",
  };
  const activeTenants = tenants.filter((t) => t.is_active);
  const tierCounts: Record<string, number> = {};
  activeTenants.forEach((t) => {
    const tier = ((t as { package_tier?: string }).package_tier) ?? "space_only";
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  });
  const tierRevenue: Record<string, number> = {};
  paidPayments.forEach((p) => {
    const tier = (p.payment_package_tier as string) ?? "space_only";
    tierRevenue[tier] = (tierRevenue[tier] ?? 0) + Number(p.amount) + Number(p.late_fee || 0);
  });
  const totalActiveTenants = activeTenants.length;
  const planDistribution = Object.entries(tierCounts)
    .map(([tier, count]) => ({
      tier,
      label: TIER_LABELS[tier] ?? tier,
      count,
      percentage: totalActiveTenants > 0 ? Math.round((count / totalActiveTenants) * 100) : 0,
      revenue: tierRevenue[tier] ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

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
      newTenants: newTenantsRes.data?.length ?? 0,
      revenueByMonth,
      topTenants,
      overduePayments,
      monthlyExpenses,
      occupancyByType,
      totalCapacity,
      totalOccupied,
      acByRoom,
      acStats: { avgUnitsPerTenant, totalAcRevenue, totalAcTenants },
      planDistribution,
    },
    error: null,
  };
}
