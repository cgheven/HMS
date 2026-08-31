import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerContext } from "@/lib/manager-auth";
import { formatDateInput } from "@/lib/utils";
import { pktYearMonth } from "@/lib/pkt-time";
import type {
  Room, Tenant, Payment, Expense, KitchenExpense, PackageConfig, PackageTier, Hostel,
  TenantApplication, WaitlistEntry,
} from "@/types";

// Manager-scoped mirrors of the owner data functions in lib/data.ts.
//
// Managers deliberately have NO RLS policies (migration 051) and
// getAuthContext() resolves their hostelId to null, so the owner functions
// bail on their first line. Every read here therefore goes through the
// service-role admin client, scoped to the manager's server-resolved active
// branch — never to a client-supplied hostel id.
//
// Return shapes are byte-identical to their owner counterparts because the
// same owner client components consume both.

async function resolveManagerHostel(): Promise<{ hostelId: string } | null> {
  const ctx = await getManagerContext();
  if (!ctx?.activeHostel) return null;
  return { hostelId: ctx.activeHostel.id };
}

const getManagerPackageConfig = cache(
  async (hostelId: string): Promise<PackageConfig | null> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_package_configs")
      .select("*")
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (error) {
      console.error("[getManagerPackageConfig]", error.message);
      return null;
    }
    return (data as PackageConfig) ?? null;
  }
);

// ---------------------------------------------------------------------------
// getManagerTenants — mirrors lib/data.ts getTenants()
// ---------------------------------------------------------------------------

export async function getManagerTenants() {
  const scope = await resolveManagerHostel();
  if (!scope) {
    return {
      hostelId: null, active: [], waiting: [], checkedOut: [], rooms: [],
      packageConfig: null as PackageConfig | null,
      applications: [] as TenantApplication[],
      waitlistEntries: [] as WaitlistEntry[],
      foodAddonRates: { food_breakfast_rate: 0, food_lunch_rate: 0, food_dinner_rate: 0, food_all_meals_rate: 0 },
      foodMonthlyRate: 0,
      noticePeriodDays: 30,
      currentMonthPaymentByTenant: {} as Record<string, { status: string; remaining: number }>,
    };
  }

  const { hostelId } = scope;
  const admin = createAdminClient();
  // Pakistan-anchored, not the server process's own OS timezone — Vercel's
  // serverless functions default to UTC, which can silently disagree with
  // Pakistan on what "this month" is.
  const { year: curYear, month: curMonth } = pktYearMonth();
  const currentMonthKey = `${curYear}-${String(curMonth).padStart(2, "0")}`;

  const [
    { data: tenants }, { data: rooms }, packageConfig, { data: currentMonthPayments },
    { data: applications }, { data: waitlistEntries },
  ] = await Promise.all([
    admin.from("hms_tenants").select("*").eq("hostel_id", hostelId).order("created_at", { ascending: false }),
    admin.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number"),
    getManagerPackageConfig(hostelId),
    admin.from("hms_payments").select("tenant_id,status,amount,amount_paid").eq("hostel_id", hostelId).eq("for_month", currentMonthKey),
    admin.from("hms_tenant_applications").select("*").eq("hostel_id", hostelId).order("applied_at", { ascending: false }),
    admin.from("hms_waitlist").select("*").eq("hostel_id", hostelId).order("created_at", { ascending: false }),
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
    // Handed to TenantsClient as initialPackageConfig — a manager cannot read
    // this table from the browser, so the Add Tenant dialog depends on it.
    packageConfig,
    applications: (applications ?? []) as TenantApplication[],
    waitlistEntries: (waitlistEntries ?? []) as WaitlistEntry[],
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

// ---------------------------------------------------------------------------
// getManagerPaymentsPageData — mirrors lib/data.ts getPaymentsPageData()
// ---------------------------------------------------------------------------

export async function getManagerPaymentsPageData(forMonth: string) {
  const scope = await resolveManagerHostel();
  if (!scope) {
    return { hostelId: null, payments: [], tenants: [], rooms: [], packageConfig: null, hostelName: "", hostelPhone: null, paymentMethods: [], reminderTemplate: null, meterAllRooms: false, acReadings: [], acCheckoutReadings: [], acJoinReadings: [], waitingTenantIds: [] };
  }

  const { hostelId } = scope;
  const admin = createAdminClient();

  const [
    { data: payments, error: paymentsErr },
    { data: tenants, error: tenantsErr },
    { data: rooms, error: roomsErr },
    packageConfig,
    { data: hostel },
    { data: acReadings, error: acReadingsErr },
    { data: acCheckoutReadings },
    { data: acJoinReadings, error: acJoinErr },
    { data: waitingTenants, error: waitingErr },
  ] = await Promise.all([
    admin.from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id, phone, check_in, joining_meter_reading)")
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .order("created_at", { ascending: false }),
    admin.from("hms_tenants")
      .select("id, full_name, billing_type, monthly_rent, daily_rate, check_in, check_out, room_id, is_active, package_tier, security_deposit, deposit_collected_amount, registration_fee, food_breakfast, food_lunch, food_dinner, joining_meter_reading, ac_maintenance")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .eq("is_waiting", false),
    admin.from("hms_rooms")
      .select("id, room_number, floor, has_ac")
      .eq("hostel_id", hostelId),
    getManagerPackageConfig(hostelId),
    admin.from("hms_hostels")
      .select("id, name, phone, whatsapp, payment_methods, reminder_template, meter_all_rooms")
      .eq("id", hostelId)
      .maybeSingle(),
    // All months — see getPaymentsPageData() for why this is not month-scoped.
    admin.from("hms_room_ac_readings")
      .select("room_id, for_month, total_units, meter_reading, per_unit_rate, tenant_count, recorded_while_vacant")
      .eq("hostel_id", hostelId),
    // Absolute meter values written against the ROOM at each checkout. The card
    // needs them to resolve a previous month that was recorded while the room was
    // empty and then let — see effectivePrevReading — or "Previous month ended
    // at" and the unit preview would disagree with the figure Apply uses.
    admin.from("hms_room_ac_checkout_readings")
      .select("room_id, for_month, meter_reading")
      .eq("hostel_id", hostelId),
    admin.from("hms_room_ac_join_readings")
      .select("room_id, tenant_id, units_at_join, for_month")
      .eq("hostel_id", hostelId),
    // Mirrors getPaymentsPageData() (lib/data.ts) — the header stats need this
    // to exclude payment rows for tenants edited back to the waiting list
    // after their row was already generated.
    admin.from("hms_tenants")
      .select("id")
      .eq("hostel_id", hostelId)
      .eq("is_waiting", true),
  ]);

  // See getPaymentsPageData in lib/data.ts — a swallowed error here rendered a
  // manager an empty tenant list beside non-zero money tiles. Failing loudly is
  // the only outcome that cannot be mistaken for "nobody lives here".
  const readErr =
    paymentsErr ?? tenantsErr ?? roomsErr ?? acReadingsErr ?? acJoinErr ?? waitingErr;
  if (readErr) {
    throw new Error(`Payments page could not load for ${forMonth}: ${readErr.message}`);
  }

  const h = hostel as Pick<Hostel, "id" | "name" | "phone" | "whatsapp" | "payment_methods" | "reminder_template" | "meter_all_rooms"> | null;

  return {
    hostelId,
    payments: (payments ?? []) as Payment[],
    tenants: (tenants ?? []) as (Pick<Tenant, "id" | "full_name" | "billing_type" | "monthly_rent" | "daily_rate" | "check_in" | "check_out" | "room_id" | "is_active" | "security_deposit" | "deposit_collected_amount" | "registration_fee" | "food_breakfast" | "food_lunch" | "food_dinner" | "joining_meter_reading" | "ac_maintenance"> & { package_tier: PackageTier })[],
    rooms: (rooms ?? []) as Pick<Room, "id" | "room_number" | "floor" | "has_ac">[],
    packageConfig,
    hostelName: h?.name ?? "",
    hostelPhone: h?.whatsapp ?? h?.phone ?? null,
    paymentMethods: h?.payment_methods ?? [],
    reminderTemplate: h?.reminder_template ?? null,
    meterAllRooms: h?.meter_all_rooms ?? false,
    acReadings: (acReadings ?? []) as { room_id: string; for_month: string; total_units: number; meter_reading?: number | null; per_unit_rate: number; tenant_count: number; recorded_while_vacant?: boolean | null }[],
    acCheckoutReadings: (acCheckoutReadings ?? []) as { room_id: string; for_month: string; meter_reading: number | null }[],
    acJoinReadings: (acJoinReadings ?? []) as { room_id: string; tenant_id: string; units_at_join: number; for_month: string }[],
    waitingTenantIds: (waitingTenants ?? []).map((t) => t.id as string),
  };
}

// ---------------------------------------------------------------------------
// getManagerExpenses — mirrors lib/data.ts getExpenses()
// ---------------------------------------------------------------------------

export async function getManagerExpenses(monthFilter: string) {
  const scope = await resolveManagerHostel();
  if (!scope) return { hostelId: null, expenses: [] as Expense[] };

  const { hostelId } = scope;
  const admin = createAdminClient();

  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));

  const { data } = await admin
    .from("hms_expenses")
    .select("*")
    .eq("hostel_id", hostelId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  return { hostelId, expenses: (data as Expense[]) ?? [] };
}

// ---------------------------------------------------------------------------
// getManagerKitchenExpenses — mirrors lib/data.ts getKitchenExpenses()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getManagerRooms — mirrors lib/data.ts getRooms()
// ---------------------------------------------------------------------------

export async function getManagerRooms() {
  const scope = await resolveManagerHostel()
  if (!scope) return { hostelId: null, rooms: [] as Room[], hostelName: "" }

  const { hostelId } = scope
  const admin = createAdminClient()

  const [{ data: rooms }, { data: hostel }] = await Promise.all([
    admin.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number"),
    admin.from("hms_hostels").select("name").eq("id", hostelId).maybeSingle(),
  ])

  return { hostelId, rooms: (rooms ?? []) as Room[], hostelName: hostel?.name ?? "" }
}

export async function getManagerKitchenExpenses(monthFilter: string) {
  const scope = await resolveManagerHostel();
  if (!scope) return { hostelId: null, items: [] as KitchenExpense[] };

  const { hostelId } = scope;
  const admin = createAdminClient();

  const [year, month] = monthFilter.split("-");
  const start = `${year}-${month}-01`;
  const end = formatDateInput(new Date(parseInt(year), parseInt(month), 0));

  const { data } = await admin
    .from("hms_kitchen_expenses")
    .select("*")
    .eq("hostel_id", hostelId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: false });

  return { hostelId, items: (data as KitchenExpense[]) ?? [] };
}
