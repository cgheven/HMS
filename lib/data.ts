import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getMonthRange, formatDateInput } from "@/lib/utils";
import type {
  Room, Expense, KitchenExpense, FoodItem, Bill, DashboardStats,
  Profile, Hostel, Tenant, Payment, Complaint, Announcement, RevenueMonth, AgingBucket,
} from "@/types";

// React cache() deduplicates within the same server request.
// Layout + every page data function share ONE auth.getUser() + ONE hostel lookup.
export const getAuthContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: hostel }] = await Promise.all([
    supabase.from("hms_profiles").select("*").eq("id", user.id).single(),
    supabase.from("hms_hostels").select("*").eq("owner_id", user.id).single(),
  ]);

  return {
    supabase,
    user,
    profile: profile as Profile | null,
    hostel: hostel as Hostel | null,
    hostelId: (hostel?.id ?? null) as string | null,
  };
});

export async function getDashboardData() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return null;
  const { supabase, hostelId } = ctx;

  const { start, end } = getMonthRange();
  const now = new Date();
  const fullStart = formatDateInput(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const fullEnd = formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [rooms, tenants, expenses, kitchen, bills, allExp, allKit] = await Promise.all([
    supabase.from("hms_rooms").select("status,monthly_rent").eq("hostel_id", hostelId),
    supabase.from("hms_tenants").select("monthly_rent").eq("hostel_id", hostelId).eq("is_active", true),
    supabase.from("hms_expenses").select("amount").eq("hostel_id", hostelId).gte("date", start).lte("date", end),
    supabase.from("hms_kitchen_expenses").select("amount").eq("hostel_id", hostelId).gte("date", start).lte("date", end),
    supabase.from("hms_bills").select("id,hostel_id,title,category,amount,due_date,paid_date,status,notes,created_at").eq("hostel_id", hostelId).neq("status", "paid").order("due_date").limit(5),
    supabase.from("hms_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_kitchen_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
  ]);

  const roomData = rooms.data ?? [];
  const totalRooms = roomData.length;
  const occupiedRooms = roomData.filter((r) => r.status === "occupied").length;
  const monthlyExpenses = (expenses.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const monthlyKitchen = (kitchen.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const unpaidBills = bills.data ?? [];
  const monthlyRevenue = (tenants.data ?? []).reduce((s, t) => s + Number(t.monthly_rent), 0);

  const ranges = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      month: d.toLocaleDateString("en-US", { month: "short" }),
      start: formatDateInput(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: formatDateInput(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  });

  const monthlyData = ranges.map(({ month, start: s, end: e }) => ({
    month,
    expenses: (allExp.data ?? []).filter((x) => x.date >= s && x.date <= e).reduce((sum, x) => sum + Number(x.amount), 0),
    kitchen: (allKit.data ?? []).filter((x) => x.date >= s && x.date <= e).reduce((sum, x) => sum + Number(x.amount), 0),
  }));

  const stats: DashboardStats = {
    total_rooms: totalRooms,
    occupied_rooms: occupiedRooms,
    available_rooms: totalRooms - occupiedRooms,
    total_tenants: tenants.data?.length ?? 0,
    monthly_expenses: monthlyExpenses,
    monthly_kitchen: monthlyKitchen,
    unpaid_bills: unpaidBills.length,
    unpaid_bills_amount: unpaidBills.reduce((s, b) => s + Number(b.amount), 0),
    occupancy_rate: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
    monthly_revenue: monthlyRevenue,
  };

  return { hostelId, stats, upcomingBills: unpaidBills as Bill[], monthlyData };
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
  if (!ctx?.hostelId) return { hostelId: null, active: [], waiting: [], checkedOut: [], rooms: [] };
  const { supabase, hostelId } = ctx;

  const [{ data: tenants }, { data: rooms }] = await Promise.all([
    supabase.from("hms_tenants").select("*").eq("hostel_id", hostelId).order("created_at", { ascending: false }),
    supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number"),
  ]);

  const all = (tenants ?? []) as Tenant[];
  return {
    hostelId,
    active: all.filter((t) => t.is_active && !t.is_waiting),
    waiting: all.filter((t) => t.is_waiting),
    checkedOut: all.filter((t) => !t.is_active && !t.is_waiting),
    rooms: (rooms ?? []) as Room[],
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
      .select("id, full_name, monthly_rent, room_id, is_active")
      .eq("hostel_id", hostelId)
      .eq("is_active", true),
    supabase.from("hms_rooms")
      .select("id, room_number, floor")
      .eq("hostel_id", hostelId),
  ]);

  return {
    hostelId,
    payments: (payments ?? []) as Payment[],
    tenants: (tenants ?? []) as Pick<Tenant, "id" | "full_name" | "monthly_rent" | "room_id" | "is_active">[],
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
  if (!ctx?.hostelId) return { hostelId: null, announcements: [] };
  const { supabase, hostelId } = ctx;

  const { data } = await supabase
    .from("hms_announcements")
    .select("*")
    .eq("hostel_id", hostelId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  return { hostelId, announcements: (data ?? []) as Announcement[] };
}

export async function getReportsData() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return null;
  const { supabase, hostelId } = ctx;

  const now = new Date();
  const ranges = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
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

  const [paymentsRes, expensesRes, kitchenRes, tenantsRes, roomsRes] = await Promise.all([
    supabase.from("hms_payments").select("for_month,amount,status").eq("hostel_id", hostelId),
    supabase.from("hms_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_kitchen_expenses").select("amount,date").eq("hostel_id", hostelId).gte("date", fullStart).lte("date", fullEnd),
    supabase.from("hms_tenants").select("check_in,check_out,is_active").eq("hostel_id", hostelId),
    supabase.from("hms_rooms").select("capacity").eq("hostel_id", hostelId),
  ]);

  const payments = paymentsRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const kitchen = kitchenRes.data ?? [];
  const tenants = tenantsRes.data ?? [];
  const totalCapacity = (roomsRes.data ?? []).reduce((s, r) => s + r.capacity, 0);

  const revenueByMonth: RevenueMonth[] = ranges.map(({ month, monthKey, start, end }) => {
    const monthPayments = payments.filter((p) => p.for_month === monthKey);
    const collected = monthPayments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
    const due = monthPayments.reduce((s, p) => s + Number(p.amount), 0);
    const exp = expenses.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.amount), 0);
    const kit = kitchen.filter((k) => k.date >= start && k.date <= end).reduce((s, k) => s + Number(k.amount), 0);
    const activeCount = tenants.filter((t) => t.check_in <= end && (!t.check_out || t.check_out >= start)).length;
    return {
      month,
      monthKey,
      collected,
      due,
      expenses: exp + kit,
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

  return { hostelId, revenueByMonth, aging };
}

export async function getExpenses(monthFilter: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, expenses: [] };
  const { supabase, hostelId } = ctx;
  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));
  const { data } = await supabase.from("hms_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
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

export async function getFoodItems(date: string) {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, items: [] };
  const { supabase, hostelId } = ctx;
  const { data } = await supabase.from("hms_food_items").select("*").eq("hostel_id", hostelId).eq("date", date).order("meal_type");
  return { hostelId, items: (data as FoodItem[]) ?? [] };
}

export async function getBills() {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) return { hostelId: null, bills: [] };
  const { supabase, hostelId } = ctx;
  const { data } = await supabase.from("hms_bills").select("*").eq("hostel_id", hostelId).order("due_date", { ascending: false });
  return { hostelId, bills: (data as Bill[]) ?? [] };
}
