import { createClient } from "@/lib/supabase/server";
import { getMonthRange, formatDateInput } from "@/lib/utils";
import type { Room, Expense, KitchenExpense, FoodItem, Bill, DashboardStats } from "@/types";

async function getHostelId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("hms_hostels").select("id").eq("owner_id", user.id).single();
  return data?.id ?? null;
}

export async function getDashboardData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: hostel } = await supabase.from("hms_hostels").select("id").eq("owner_id", user.id).single();
  const hostelId = hostel?.id;
  if (!hostelId) return null;

  const { start, end } = getMonthRange();
  const now = new Date();
  const fullStart = formatDateInput(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const fullEnd = formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [rooms, tenants, expenses, kitchen, bills, allExp, allKit] = await Promise.all([
    supabase.from("hms_rooms").select("status, monthly_rent").eq("hostel_id", hostelId),
    supabase.from("hms_tenants").select("monthly_rent").eq("hostel_id", hostelId).eq("is_active", true),
    supabase.from("hms_expenses").select("amount").eq("hostel_id", hostelId).gte("date", start).lte("date", end),
    supabase.from("hms_kitchen_expenses").select("amount").eq("hostel_id", hostelId).gte("date", start).lte("date", end),
    supabase.from("hms_bills").select("*").eq("hostel_id", hostelId).neq("status", "paid").order("due_date").limit(5),
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

  // Build 6-month chart data
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
  const hostelId = await getHostelId();
  if (!hostelId) return { hostelId: null, rooms: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number");
  return { hostelId, rooms: (data as Room[]) ?? [] };
}

export async function getExpenses(monthFilter: string) {
  const hostelId = await getHostelId();
  if (!hostelId) return { hostelId: null, expenses: [] };
  const supabase = await createClient();
  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));
  const { data } = await supabase.from("hms_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
  return { hostelId, expenses: (data as Expense[]) ?? [] };
}

export async function getKitchenExpenses(monthFilter: string) {
  const hostelId = await getHostelId();
  if (!hostelId) return { hostelId: null, items: [] };
  const supabase = await createClient();
  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));
  const { data } = await supabase.from("hms_kitchen_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
  return { hostelId, items: (data as KitchenExpense[]) ?? [] };
}

export async function getFoodItems(date: string) {
  const hostelId = await getHostelId();
  if (!hostelId) return { hostelId: null, items: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("hms_food_items").select("*").eq("hostel_id", hostelId).eq("date", date).order("meal_type");
  return { hostelId, items: (data as FoodItem[]) ?? [] };
}

export async function getBills() {
  const hostelId = await getHostelId();
  if (!hostelId) return { hostelId: null, bills: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("hms_bills").select("*").eq("hostel_id", hostelId).order("due_date", { ascending: false });
  return { hostelId, bills: (data as Bill[]) ?? [] };
}
