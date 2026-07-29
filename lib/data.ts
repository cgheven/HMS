import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getMonthRange, formatDateInput } from "@/lib/utils";
import { calcDailyRent } from "@/lib/daily-billing";
import type {
  Room, Expense, KitchenExpense, FoodItem, Bill, DashboardStats,
  Profile, Hostel, Tenant, Payment, Complaint, Announcement, RevenueMonth, AgingBucket,
  Employee, SalaryPayment, PackageConfig, PackageTier, UpcomingVacancy,
  ClientBilling, PlatformInvoice, PartnerTier, PartnerFeatureFlags,
} from "@/types";

// React cache() deduplicates within the same server request.
// Layout + every page data function share ONE auth.getUser() + ONE hostel lookup.
export const getAuthContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const cookieStore = await cookies();
  // Support both cookie names: new "hms_active_hostel" (httpOnly, set server-side)
  // and legacy "hms_active_hostel" set client-side via document.cookie
  const activeHostelId =
    cookieStore.get("hms_active_hostel")?.value ?? null;

  // All four run in parallel regardless of role — whichever path doesn't apply
  // (owner queries for a partner, or vice versa) comes back empty and cheap,
  // rather than adding a second sequential round-trip to check role first.
  const [{ data: profile }, { data: hostelData }, { data: junctionData }, { data: partnerships }] = await Promise.all([
    supabase.from("hms_profiles").select("*").eq("id", user.id).single(),
    supabase.from("hms_hostels").select("*").eq("owner_id", user.id).order("created_at"),
    // Also fetch hostels via the junction table for multi-owner scenarios
    supabase
      .from("hms_owner_hostels")
      .select("hostel_id, is_primary")
      .eq("owner_id", user.id),
    // Partner path: branch access lives in hms_partnerships, not hms_owner_hostels
    supabase
      .from("hms_partnerships")
      .select("hostel_id, tier, feature_flags, hostel:hms_hostels(*)")
      .eq("partner_id", user.id)
      .eq("is_active", true),
  ]);

  if (profile?.role === "partner") {
    type PartnershipRow = { hostel_id: string; tier: PartnerTier; feature_flags: PartnerFeatureFlags | null; hostel: Hostel | null };
    const rows = ((partnerships ?? []) as unknown as PartnershipRow[]).filter((r) => r.hostel !== null);
    const hostels = rows.map((r) => r.hostel as Hostel);
    const tierByHostel = new Map(rows.map((r) => [r.hostel_id, r.tier]));
    const flagsByHostel = new Map(rows.map((r) => [r.hostel_id, r.feature_flags ?? {}]));

    const hostel: Hostel | null =
      (activeHostelId && hostels.find((h) => h.id === activeHostelId)) || hostels[0] || null;

    return {
      supabase,
      user,
      profile: profile as Profile | null,
      hostel,
      hostels,
      hostelId: (hostel?.id ?? null) as string | null,
      partnerTier: (hostel ? tierByHostel.get(hostel.id) ?? null : null) as PartnerTier | null,
      partnerFeatureFlags: (hostel ? flagsByHostel.get(hostel.id) ?? {} : {}) as PartnerFeatureFlags,
    };
  }

  // Build the merged hostel list: direct owner_id rows + junction rows (de-duped)
  const directHostels = (hostelData ?? []) as Hostel[];

  let hostels = directHostels;

  if (junctionData && junctionData.length > 0) {
    const directIds = new Set(directHostels.map((h) => h.id));
    const extraIds = junctionData
      .map((r) => r.hostel_id)
      .filter((id) => !directIds.has(id));

    if (extraIds.length > 0) {
      const { data: extraHostels } = await supabase
        .from("hms_hostels")
        .select("*")
        .in("id", extraIds)
        .order("created_at");
      hostels = [...directHostels, ...((extraHostels ?? []) as Hostel[])];
    }
  }

  // Resolve active hostel:
  // 1. Cookie value (validated against owned list)
  // 2. Primary hostel from junction table
  // 3. First hostel in list
  let hostel: Hostel | null = null;

  if (activeHostelId) {
    hostel = hostels.find((h) => h.id === activeHostelId) ?? null;
  }

  if (!hostel && junctionData && junctionData.length > 0) {
    const primaryEntry = junctionData.find((r) => r.is_primary);
    if (primaryEntry) {
      hostel = hostels.find((h) => h.id === primaryEntry.hostel_id) ?? null;
    }
  }

  if (!hostel) {
    hostel = hostels[0] ?? null;
  }

  return {
    supabase,
    user,
    profile: profile as Profile | null,
    hostel,
    hostels,
    hostelId: (hostel?.id ?? null) as string | null,
    partnerTier: null as PartnerTier | null,
    partnerFeatureFlags: {} as PartnerFeatureFlags,
  };
});

export async function getDashboardData() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return null;
  const { supabase, hostelId } = ctx;
  const { start, end } = getMonthRange();
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Compute ranges first so monthKeys are available for queries
  const ranges = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      month: d.toLocaleDateString("en-US", { month: "short" }),
      monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      start: formatDateInput(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: formatDateInput(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  });

  const fullStart = ranges[0].start;
  const fullEnd = ranges[5].end;

  const [
    rooms, tenants, expenses, kitchen, bills,
    allExp, allKit, collectedPayments, paidSalaries,
    pendingPaymentsRes, allPayments6moRes, acReadingsRes,
  ] = await Promise.all([
    supabase.from("hms_rooms").select("status,monthly_rent").eq("hostel_id", hostelId),
    supabase.from("hms_tenants")
      .select("id, full_name, monthly_rent, daily_rate, billing_type, check_in, check_out, security_deposit, notice_given_date, intended_checkout_date, room:hms_rooms(room_number)")
      .eq("hostel_id", hostelId).eq("is_active", true).eq("is_waiting", false),
    supabase.from("hms_expenses").select("amount").eq("hostel_id", hostelId).gte("date", start).lte("date", end),
    supabase.from("hms_kitchen_expenses").select("amount").eq("hostel_id", hostelId).gte("date", start).lte("date", end),
    supabase.from("hms_bills").select("id,hostel_id,title,category,amount,due_date,paid_date,status,notes,created_at").eq("hostel_id", hostelId).neq("status", "paid").order("due_date").limit(5),
    supabase.from("hms_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_kitchen_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_payments").select("amount,amount_paid,security_deposit_charge").eq("hostel_id", hostelId).eq("for_month", currentMonthKey).in("status", ["paid", "partially_paid"]),
    supabase.from("hms_salary_payments").select("amount").eq("hostel_id", hostelId).eq("for_month", currentMonthKey).eq("status", "paid"),
    supabase.from("hms_payments").select("id,amount,amount_paid,late_fee,status,tenant:hms_tenants(full_name)").eq("hostel_id", hostelId).eq("for_month", currentMonthKey).in("status", ["pending", "overdue", "partially_paid"]),
    supabase.from("hms_payments").select("for_month,amount,amount_paid,status").eq("hostel_id", hostelId).gte("for_month", ranges[0].monthKey).lte("for_month", ranges[5].monthKey),
    supabase.from("hms_room_ac_readings").select("total_units").eq("hostel_id", hostelId).eq("for_month", currentMonthKey),
  ]);

  const roomData = rooms.data ?? [];
  const totalRooms = roomData.length;
  const occupiedRooms = roomData.filter((r) => r.status === "occupied").length;
  const monthlyExpenses = (expenses.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const monthlyKitchen = (kitchen.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const monthlySalaries = (paidSalaries.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  // amount_paid equals amount for legacy fully-paid rows (backfilled), so summing
  // it uniformly captures both full and partial payments without branching on status.
  const monthlyCollected = (collectedPayments.data ?? []).reduce((s, e) => s + Number(e.amount_paid ?? e.amount), 0);
  // A security deposit is a LIABILITY, not income — it is refundable at
  // checkout. It rides inside `amount` (security_deposit_charge), so summing
  // amount_paid counts it as profit and then silently reverses that profit when
  // the deposit is returned. "Collected" legitimately includes it (the cash was
  // received, and the dashboard shows deposits held separately); net profit must
  // not. Reports already excludes it from rentRevenue — this brings the
  // dashboard into line.
  //
  // On a partially-paid bill nothing records WHICH component the money went to,
  // so the deposit is treated as collected in the same proportion as the bill —
  // neutral between rent and deposit, and it degrades smoothly as more is paid.
  const depositsCollected = (collectedPayments.data ?? []).reduce((s, e) => {
    const charged = Number(e.security_deposit_charge ?? 0);
    if (charged <= 0) return s;
    const amount = Number(e.amount ?? 0);
    const paid = Number(e.amount_paid ?? e.amount ?? 0);
    if (amount <= 0) return s + charged;
    return s + Math.min(charged, charged * (paid / amount));
  }, 0);
  const monthlyACUnits = (acReadingsRes.data ?? []).reduce((s, r) => s + Number(r.total_units ?? 0), 0);
  type PendingRow = { id: string; amount: unknown; amount_paid?: unknown; late_fee?: unknown; status: string; tenant: { full_name: string } | null };
  const pendingRows = ((pendingPaymentsRes.data ?? []) as unknown) as PendingRow[];
  // Owed = remaining balance, not the full amount — a partially_paid row has
  // already had some of it collected. Late fee is real money owed too — must
  // match the Payments page's "Pending", which already includes it.
  const monthlyUncollected = pendingRows.reduce((s, p) => s + Math.max(0, Number(p.amount) + Number(p.late_fee ?? 0) - Number(p.amount_paid ?? 0)), 0);
  const unpaidBills = bills.data ?? [];
  // Daily tenants have monthly_rent 0, so summing that alone silently dropped every
  // one of them from expected revenue. Their contribution is this month's billable
  // nights × daily_rate, counted by the same helper the payment rows are built from.
  const monthlyRevenue = (tenants.data ?? []).reduce((s, t) => {
    const row = (t as unknown) as { billing_type?: string; monthly_rent: unknown; daily_rate: unknown; check_in: string; check_out: string | null };
    if (row.billing_type === "daily") {
      return s + calcDailyRent({
        checkIn: row.check_in,
        checkOut: row.check_out,
        month: currentMonthKey,
        dailyRate: Number(row.daily_rate ?? 0),
      });
    }
    return s + Number(row.monthly_rent);
  }, 0);
  const depositTenants = (tenants.data ?? []).filter((t) => Number(t.security_deposit) > 0);
  const securityDepositTotal = depositTenants.reduce((s, t) => s + Number(t.security_deposit), 0);
  const securityDepositCount = depositTenants.length;

  const defaulters = pendingRows.map((p) => ({
    id: p.id,
    name: p.tenant?.full_name ?? "Unknown",
    // Remaining balance, not the full amount — a partially_paid row already had some collected.
    amount: Math.max(0, Number(p.amount) - Number(p.amount_paid ?? 0)),
    status: p.status,
  }));

  type ActiveTenantRow = {
    id: string;
    full_name: string;
    monthly_rent: unknown;
    security_deposit: unknown;
    notice_given_date: string | null;
    intended_checkout_date: string | null;
    room: { room_number: string } | null;
  };
  const activeTenantRows = ((tenants.data ?? []) as unknown) as ActiveTenantRow[];
  const upcomingVacancies: UpcomingVacancy[] = activeTenantRows
    .filter((t) => t.intended_checkout_date != null)
    .sort((a, b) => (a.intended_checkout_date as string).localeCompare(b.intended_checkout_date as string))
    .map((t) => ({
      id: t.id,
      name: t.full_name,
      roomNumber: t.room?.room_number ?? null,
      noticeGivenDate: t.notice_given_date,
      intendedCheckoutDate: t.intended_checkout_date,
    }));

  const allPayments6mo = allPayments6moRes.data ?? [];

  const monthlyData = ranges.map(({ month, monthKey, start: s, end: e }) => ({
    month,
    expenses: (allExp.data ?? []).filter((x) => x.date >= s && x.date <= e).reduce((sum, x) => sum + Number(x.amount), 0),
    kitchen: (allKit.data ?? []).filter((x) => x.date >= s && x.date <= e).reduce((sum, x) => sum + Number(x.amount), 0),
    collected: allPayments6mo.filter((p) => p.for_month === monthKey && (p.status === "paid" || p.status === "partially_paid")).reduce((sum, p) => sum + Number(p.amount_paid ?? p.amount), 0),
  }));

  const stats: DashboardStats = {
    total_rooms: totalRooms,
    occupied_rooms: occupiedRooms,
    available_rooms: totalRooms - occupiedRooms,
    total_tenants: tenants.data?.length ?? 0,
    monthly_expenses: monthlyExpenses,
    monthly_kitchen: monthlyKitchen,
    monthly_salaries: monthlySalaries,
    monthly_collected: monthlyCollected,
    monthly_uncollected: monthlyUncollected,
    net_profit: monthlyCollected - depositsCollected - monthlyExpenses - monthlyKitchen - monthlySalaries,
    unpaid_bills: unpaidBills.length,
    unpaid_bills_amount: unpaidBills.reduce((s, b) => s + Number(b.amount), 0),
    occupancy_rate: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
    monthly_revenue: monthlyRevenue,
    security_deposit_total: securityDepositTotal,
    security_deposit_count: securityDepositCount,
    monthly_ac_units: monthlyACUnits,
  };

  return {
    hostelId, stats, upcomingBills: unpaidBills as Bill[], monthlyData, defaulters, upcomingVacancies,
  };
}

// Account-level (not per-branch) — billing follows the owner, not the active hostel,
// so this deliberately does NOT depend on ctx.hostelId / the branch switcher.
export async function getOwnerBilling() {
  const ctx = await getAuthContext();
  if (!ctx?.user) return { billing: null, invoices: [] as PlatformInvoice[], branchCount: 1 };
  const { supabase, user } = ctx;

  const [{ data: billing }, { data: invoices }, { count: branchCount }] = await Promise.all([
    supabase.from("hms_client_billing").select("*").eq("owner_id", user.id).maybeSingle(),
    supabase
      .from("hms_platform_invoices")
      .select("*")
      .eq("owner_id", user.id)
      .order("period_start", { ascending: false }),
    supabase.from("hms_hostels").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
  ]);

  return {
    billing: (billing as ClientBilling | null) ?? null,
    invoices: (invoices ?? []) as PlatformInvoice[],
    branchCount: branchCount ?? 1,
  };
}

export async function getRooms() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, rooms: [] };
  const { supabase, hostelId } = ctx;
  const { data } = await supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number");
  return { hostelId, rooms: (data as Room[]) ?? [] };
}

export async function getTenants() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) {
    return {
      hostelId: null, active: [], waiting: [], checkedOut: [], rooms: [],
      foodAddonRates: { food_breakfast_rate: 0, food_lunch_rate: 0, food_dinner_rate: 0, food_all_meals_rate: 0 },
      foodMonthlyRate: 0,
      noticePeriodDays: 30,
      currentMonthPaymentByTenant: {} as Record<string, { status: string; remaining: number }>,
    };
  }
  const { supabase, hostelId } = ctx;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [{ data: tenants }, { data: rooms }, packageConfig, { data: currentMonthPayments }] = await Promise.all([
    supabase.from("hms_tenants").select("*").eq("hostel_id", hostelId).order("created_at", { ascending: false }),
    supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number"),
    getPackageConfig(hostelId),
    supabase.from("hms_payments").select("tenant_id,status,amount,amount_paid").eq("hostel_id", hostelId).eq("for_month", currentMonthKey),
  ]);

  const all = (tenants ?? []) as Tenant[];
  const currentMonthPaymentByTenant: Record<string, { status: string; remaining: number }> = {};
  for (const p of currentMonthPayments ?? []) {
    if (!p.tenant_id) continue;
    currentMonthPaymentByTenant[p.tenant_id] = {
      status: p.status,
      remaining: Math.max(0, Number(p.amount) - Number(p.amount_paid ?? 0)),
    };
  }

  return {
    hostelId,
    active: all.filter((t) => t.is_active && !t.is_waiting),
    waiting: all.filter((t) => t.is_waiting),
    checkedOut: all.filter((t) => !t.is_active && !t.is_waiting),
    rooms: (rooms ?? []) as Room[],
    foodAddonRates: {
      food_breakfast_rate: Number(packageConfig?.food_breakfast_rate ?? 0),
      food_lunch_rate: Number(packageConfig?.food_lunch_rate ?? 0),
      food_dinner_rate: Number(packageConfig?.food_dinner_rate ?? 0),
      food_all_meals_rate: Number(packageConfig?.food_all_meals_rate ?? 0),
    },
    foodMonthlyRate: Number(packageConfig?.food_monthly_rate ?? 0),
    noticePeriodDays: Number(packageConfig?.notice_period_days ?? 30),
    currentMonthPaymentByTenant,
  };
}

export async function getPaymentsData(forMonth: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, payments: [], tenants: [], rooms: [] };
  const { supabase, hostelId } = ctx;

  const [{ data: payments }, { data: tenants }, { data: rooms }] = await Promise.all([
    supabase.from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id)")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .order("created_at", { ascending: false }),
    supabase.from("hms_tenants")
      .select("id, full_name, billing_type, monthly_rent, daily_rate, check_in, check_out, room_id, is_active")
      .eq("hostel_id", hostelId)
      .eq("is_active", true),
    supabase.from("hms_rooms")
      .select("id, room_number, floor")
      .eq("hostel_id", hostelId),
  ]);

  return {
    hostelId,
    payments: (payments ?? []) as Payment[],
    tenants: (tenants ?? []) as Pick<Tenant, "id" | "full_name" | "billing_type" | "monthly_rent" | "daily_rate" | "check_in" | "check_out" | "room_id" | "is_active">[],
    rooms: (rooms ?? []) as Pick<Room, "id" | "room_number" | "floor">[],
  };
}

export async function getComplaints() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, complaints: [], tenants: [], rooms: [] };
  const { supabase, hostelId } = ctx;

  const [{ data: complaints }, { data: tenants }, { data: rooms }] = await Promise.all([
    supabase.from("hms_complaints")
      .select("*, tenant:hms_tenants(full_name), room:hms_rooms(room_number)")
      .eq("hostel_id", hostelId)
      .order("created_at", { ascending: false }),
    supabase.from("hms_tenants")
      .select("id, full_name")
      .eq("hostel_id", hostelId)
      .eq("is_active", true),
    supabase.from("hms_rooms")
      .select("id, room_number")
      .eq("hostel_id", hostelId)
      .order("room_number"),
  ]);

  return {
    hostelId,
    complaints: (complaints ?? []) as Complaint[],
    tenants: (tenants ?? []) as Pick<Tenant, "id" | "full_name">[],
    rooms: (rooms ?? []) as Pick<Room, "id" | "room_number">[],
  };
}

export async function getAnnouncements() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, announcements: [], whatsappEnabled: false };
  const { supabase, hostelId, hostel } = ctx;

  const { data } = await supabase
    .from("hms_announcements")
    .select("*")
    .eq("hostel_id", hostelId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  return {
    hostelId,
    announcements: (data ?? []) as Announcement[],
    whatsappEnabled: hostel?.whatsapp_enabled ?? false,
  };
}

export async function getReportsData() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return null;
  const { supabase, hostelId } = ctx;

  const now = new Date();
  const ranges = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      monthKey,
      start: formatDateInput(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: formatDateInput(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  });

  const fullStart = ranges[0].start;
  const fullEnd = ranges[5].end;

  const [paymentsRes, expensesRes, kitchenRes, tenantsRes, roomsRes, salariesRes] = await Promise.all([
    supabase.from("hms_payments").select("for_month,amount,status,security_deposit_charge").eq("hostel_id", hostelId),
    supabase.from("hms_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_kitchen_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_tenants").select("check_in,check_out,is_active").eq("hostel_id", hostelId),
    supabase.from("hms_rooms").select("capacity").eq("hostel_id", hostelId),
    supabase.from("hms_salary_payments").select("for_month,amount,status").eq("hostel_id", hostelId),
  ]);

  const payments = paymentsRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const kitchen = kitchenRes.data ?? [];
  const tenants = tenantsRes.data ?? [];
  const salaries = salariesRes.data ?? [];
  const totalCapacity = (roomsRes.data ?? []).reduce((s, r) => s + r.capacity, 0);

  const revenueByMonth: RevenueMonth[] = ranges.map(({ month, monthKey, start, end }) => {
    const monthPayments = payments.filter((p) => p.for_month === monthKey);
    const paidRows = monthPayments.filter((p) => p.status === "paid");
    const collected = paidRows.reduce((s, p) => s + Number(p.amount), 0);
    // Same reasoning as the dashboard: deposits are refundable, so they are cash
    // collected but never profit. These rows are fully paid, so the whole
    // charged deposit was collected.
    const depositsCollected = paidRows.reduce((s, p) => s + Number(p.security_deposit_charge ?? 0), 0);
    const due = monthPayments.reduce((s, p) => s + Number(p.amount), 0);
    const exp = expenses.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.amount), 0);
    const kit = kitchen.filter((k) => k.date >= start && k.date <= end).reduce((s, k) => s + Number(k.amount), 0);
    const sal = salaries.filter((s) => s.for_month === monthKey && s.status === "paid").reduce((sum, s) => sum + Number(s.amount), 0);
    const activeCount = tenants.filter((t) => t.check_in <= end && (!t.check_out || t.check_out >= start)).length;
    const totalExp = exp + kit + sal;
    return {
      month,
      monthKey,
      collected,
      due,
      expenses: totalExp,
      kitchen: kit,
      salaries: sal,
      profit: collected - depositsCollected - totalExp,
      collectionRate: due > 0 ? Math.round((collected / due) * 100) : 0,
      occupancyRate: totalCapacity > 0 ? Math.round((activeCount / totalCapacity) * 100) : 0,
      moveIns: tenants.filter((t) => t.check_in >= start && t.check_in <= end).length,
      moveOuts: tenants.filter((t) => t.check_out && t.check_out >= start && t.check_out <= end).length,
    };
  });

  const today = formatDateInput(now);
  const overduePayments = payments.filter((p) => p.status === "pending" || p.status === "overdue");
  const aging: { d30: AgingBucket; d60: AgingBucket; d90: AgingBucket; d90plus: AgingBucket } = {
    d30: { count: 0, amount: 0 },
    d60: { count: 0, amount: 0 },
    d90: { count: 0, amount: 0 },
    d90plus: { count: 0, amount: 0 },
  };

  overduePayments.forEach((p) => {
    const days = Math.floor((new Date(today).getTime() - new Date(`${p.for_month}-01`).getTime()) / 86400000);
    const amt = Number(p.amount);
    if (days <= 30) { aging.d30.count++; aging.d30.amount += amt; }
    else if (days <= 60) { aging.d60.count++; aging.d60.amount += amt; }
    else if (days <= 90) { aging.d90.count++; aging.d90.amount += amt; }
    else { aging.d90plus.count++; aging.d90plus.amount += amt; }
  });

  return { hostelId, revenueByMonth, aging, totalCapacity };
}

export async function getExpenses(monthFilter: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, expenses: [] };
  const { supabase, hostelId } = ctx;
  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));
  const { data } = await supabase.from("hms_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false }).order("created_at", { ascending: false });
  return { hostelId, expenses: (data as Expense[]) ?? [] };
}

export async function getKitchenExpenses(monthFilter: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, items: [] };
  const { supabase, hostelId } = ctx;
  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));
  const { data } = await supabase.from("hms_kitchen_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
  return { hostelId, items: (data as KitchenExpense[]) ?? [] };
}

export async function getFoodItems(month: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, items: [] };
  const { supabase, hostelId, hostel } = ctx;

  if (hostel?.food_menu_type === "weekly") {
    const { data } = await supabase
      .from("hms_food_items").select("*").eq("hostel_id", hostelId)
      .not("day_of_week", "is", null)
      .order("day_of_week").order("meal_type").order("sort_order");
    return { hostelId, items: (data as FoodItem[]) ?? [] };
  }

  const [y, m] = month.split("-").map(Number);
  const end = new Date(y, m, 0).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("hms_food_items").select("*").eq("hostel_id", hostelId)
    .gte("date", `${month}-01`).lte("date", end)
    .order("date").order("meal_type").order("sort_order");
  return { hostelId, items: (data as FoodItem[]) ?? [] };
}

export async function getBills() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, bills: [] };
  const { supabase, hostelId } = ctx;
  const { data } = await supabase.from("hms_bills").select("*").eq("hostel_id", hostelId).order("due_date", { ascending: false });
  return { hostelId, bills: (data as Bill[]) ?? [] };
}

export async function getEmployeesData() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, employees: [], salaryPayments: [] };
  const { supabase, hostelId } = ctx;

  const [{ data: employees }, { data: salaryPayments }] = await Promise.all([
    supabase.from("hms_employees").select("*").eq("hostel_id", hostelId).order("full_name"),
    supabase.from("hms_salary_payments")
      .select("*, employee:hms_employees(full_name, role)")
      .eq("hostel_id", hostelId)
      .order("for_month", { ascending: false })
      .limit(200),
  ]);

  return {
    hostelId,
    employees: (employees ?? []) as Employee[],
    salaryPayments: (salaryPayments ?? []) as SalaryPayment[],
  };
}

// ---------------------------------------------------------------------------
// Package config (hms_package_configs)
// ---------------------------------------------------------------------------

/**
 * Fetch the package config for a given hostel.
 * Returns null gracefully when no config row exists yet.
 */
export async function getPackageConfig(hostelId: string): Promise<PackageConfig | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hms_package_configs")
    .select("*")
    .eq("hostel_id", hostelId)
    .maybeSingle();

  if (error) {
    console.error("[getPackageConfig]", error.message);
    return null;
  }
  return (data as PackageConfig) ?? null;
}

/**
 * Create or update the package config rates for a hostel.
 * Uses ON CONFLICT (hostel_id) DO UPDATE so a single row is maintained per hostel.
 */
export async function upsertPackageConfig(
  hostelId: string,
  data: { food_monthly_rate: number; ac_per_unit_rate: number }
): Promise<PackageConfig> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("hms_package_configs")
    .upsert(
      {
        hostel_id: hostelId,
        food_monthly_rate: data.food_monthly_rate,
        ac_per_unit_rate: data.ac_per_unit_rate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hostel_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return row as PackageConfig;
}

// ---------------------------------------------------------------------------
// Payment helpers
// ---------------------------------------------------------------------------

export interface CreatePaymentInput {
  hostel_id: string;
  tenant_id: string;
  for_month: string;
  /** Base rent (monthly or pro-rated daily amount) before add-ons */
  base_rent: number;
  late_fee?: number;
  status?: "pending" | "paid" | "overdue" | "waived";
  payment_method?: string | null;
  payment_date?: string | null;
  receipt_number?: string | null;
  notes?: string | null;
  // Package-tier add-ons (all optional; omit for space_only tenants)
  food_charge?: number;
  ac_units_consumed?: number;
  ac_charge?: number;
  payment_package_tier?: PackageTier;
}

/**
 * Insert a new payment record with optional package-tier charges.
 * The persisted `amount` = base_rent + food_charge + ac_charge so the DB
 * always stores the full billable amount.
 */
export async function createPaymentWithCharges(input: CreatePaymentInput): Promise<Payment> {
  const supabase = await createClient();

  const foodCharge = input.food_charge ?? 0;
  const acCharge = input.ac_charge ?? 0;
  const totalAmount = input.base_rent + foodCharge + acCharge;

  const payload: Record<string, unknown> = {
    hostel_id: input.hostel_id,
    tenant_id: input.tenant_id,
    for_month: input.for_month,
    amount: totalAmount,
    late_fee: input.late_fee ?? 0,
    status: input.status ?? "pending",
    payment_method: input.payment_method ?? null,
    payment_date: input.payment_date ?? null,
    receipt_number: input.receipt_number ?? null,
    notes: input.notes ?? null,
  };

  // Only write add-on columns when a package tier is supplied
  if (input.payment_package_tier) {
    payload.payment_package_tier = input.payment_package_tier;
    payload.food_charge = foodCharge;
    payload.ac_units_consumed = input.ac_units_consumed ?? null;
    payload.ac_charge = acCharge;
  }

  const { data, error } = await supabase
    .from("hms_payments")
    .insert(payload)
    .select("*, tenant:hms_tenants(full_name, room_id)")
    .single();

  if (error) throw new Error(error.message);
  return data as Payment;
}

/**
 * Update an existing payment's package-tier charge fields and recalculate
 * the stored `amount` as base_rent + food_charge + ac_charge.
 */
export async function updatePaymentCharges(
  paymentId: string,
  update: {
    base_rent: number;
    food_charge?: number;
    ac_units_consumed?: number;
    ac_charge?: number;
    payment_package_tier?: PackageTier;
    late_fee?: number;
    status?: "pending" | "paid" | "overdue" | "waived";
    payment_method?: string | null;
    payment_date?: string | null;
    receipt_number?: string | null;
    notes?: string | null;
  }
): Promise<Payment> {
  const supabase = await createClient();

  const foodCharge = update.food_charge ?? 0;
  const acCharge = update.ac_charge ?? 0;
  const totalAmount = update.base_rent + foodCharge + acCharge;

  const payload: Record<string, unknown> = {
    amount: totalAmount,
    late_fee: update.late_fee ?? 0,
  };

  if (update.status !== undefined) payload.status = update.status;
  if (update.payment_method !== undefined) payload.payment_method = update.payment_method;
  if (update.payment_date !== undefined) payload.payment_date = update.payment_date;
  if (update.receipt_number !== undefined) payload.receipt_number = update.receipt_number;
  if (update.notes !== undefined) payload.notes = update.notes;
  if (update.payment_package_tier) {
    payload.payment_package_tier = update.payment_package_tier;
    payload.food_charge = foodCharge;
    payload.ac_units_consumed = update.ac_units_consumed ?? null;
    payload.ac_charge = acCharge;
  }

  const { data, error } = await supabase
    .from("hms_payments")
    .update(payload)
    .eq("id", paymentId)
    .select("*, tenant:hms_tenants(full_name, room_id)")
    .single();

  if (error) throw new Error(error.message);
  return data as Payment;
}

// ---------------------------------------------------------------------------
// Payments page data (extended to include package config)
// ---------------------------------------------------------------------------

export async function getPaymentsPageData(forMonth: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, payments: [], tenants: [], rooms: [], packageConfig: null, hostelName: "", hostelPhone: null, paymentMethods: [], reminderTemplate: null, autoReminderEnabled: false, acReadings: [], acJoinReadings: [], prevMonthACReadings: [] };
  const { supabase, hostelId, hostel } = ctx;

  const [y, m] = forMonth.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const [{ data: payments }, { data: tenants }, { data: rooms }, packageConfig, { data: acReadings }, { data: acJoinReadings }, { data: prevMonthACReadings }] = await Promise.all([
    supabase.from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id, phone, check_in, joining_meter_reading)")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .order("created_at", { ascending: false }),
    supabase.from("hms_tenants")
      .select("id, full_name, billing_type, monthly_rent, daily_rate, check_in, check_out, room_id, is_active, package_tier, security_deposit, food_breakfast, food_lunch, food_dinner, joining_meter_reading")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .eq("is_waiting", false),
    supabase.from("hms_rooms")
      .select("id, room_number, floor, has_ac")
      .eq("hostel_id", hostelId),
    getPackageConfig(hostelId),
    supabase.from("hms_room_ac_readings")
      .select("room_id, total_units, meter_reading, per_unit_rate, tenant_count")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth),
    supabase.from("hms_room_ac_join_readings")
      .select("room_id, tenant_id, units_at_join, for_month")
      .eq("hostel_id", hostelId),
    supabase.from("hms_room_ac_readings")
      .select("room_id, meter_reading, total_units")
      .eq("hostel_id", hostelId)
      .eq("for_month", prevMonth),
  ]);

  return {
    hostelId,
    payments: (payments ?? []) as Payment[],
    tenants: (tenants ?? []) as (Pick<Tenant, "id" | "full_name" | "billing_type" | "monthly_rent" | "daily_rate" | "check_in" | "check_out" | "room_id" | "is_active" | "security_deposit" | "food_breakfast" | "food_lunch" | "food_dinner" | "joining_meter_reading"> & { package_tier: PackageTier })[],
    rooms: (rooms ?? []) as Pick<Room, "id" | "room_number" | "floor" | "has_ac">[],
    packageConfig,
    hostelName: hostel?.name ?? "",
    hostelPhone: hostel?.whatsapp ?? hostel?.phone ?? null,
    paymentMethods: hostel?.payment_methods ?? [],
    reminderTemplate: hostel?.reminder_template ?? null,
    autoReminderEnabled: hostel?.whatsapp_enabled ?? false,
    acReadings: (acReadings ?? []) as { room_id: string; total_units: number; meter_reading?: number | null; per_unit_rate: number; tenant_count: number }[],
    acJoinReadings: (acJoinReadings ?? []) as { room_id: string; tenant_id: string; units_at_join: number; for_month: string }[],
    prevMonthACReadings: (prevMonthACReadings ?? []) as { room_id: string; meter_reading: number | null; total_units: number }[],
  };
}
