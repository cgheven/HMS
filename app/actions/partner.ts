"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Payment, Tenant, Room, PaymentStatus } from "@/types";

// ── Guard: verify the current user is an active partner of some hostel ────────

async function requirePartner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminClient();

  const { data: partnership, error } = await admin
    .from("hms_partnerships")
    .select("id, hostel_id")
    .eq("partner_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !partnership) throw new Error("Forbidden: no active partnership");

  return { user, hostelId: partnership.hostel_id as string };
}

// ── Dashboard Stats ────────────────────────────────────────────────────────────

export interface PartnerDashboardData {
  hostelName: string;
  hostelId: string;
  totalTenants: number;
  monthlyRevenue: number;
  collected: number;
  pendingAmount: number;
  occupancyRate: number;
  totalRooms: number;
  occupiedRooms: number;
  recentPayments: {
    id: string;
    tenantName: string;
    amount: number;
    status: PaymentStatus;
    for_month: string;
    payment_date: string | null;
  }[];
}

export async function getPartnerDashboardData(): Promise<{
  data?: PartnerDashboardData;
  error?: string;
}> {
  try {
    const { hostelId } = await requirePartner();
    const admin = createAdminClient();

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [hostelRes, tenantsRes, roomsRes, paymentsRes, recentRes] =
      await Promise.all([
        admin
          .from("hms_hostels")
          .select("name")
          .eq("id", hostelId)
          .single(),
        admin
          .from("hms_tenants")
          .select("monthly_rent")
          .eq("hostel_id", hostelId)
          .eq("is_active", true),
        admin
          .from("hms_rooms")
          .select("status")
          .eq("hostel_id", hostelId),
        admin
          .from("hms_payments")
          .select("amount, status")
          .eq("hostel_id", hostelId)
          .eq("for_month", currentMonth),
        admin
          .from("hms_payments")
          .select("id, amount, status, for_month, payment_date, tenant:hms_tenants(full_name)")
          .eq("hostel_id", hostelId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    const hostelName = hostelRes.data?.name ?? "Hostel";
    const tenants = tenantsRes.data ?? [];
    const rooms = roomsRes.data ?? [];
    const payments = paymentsRes.data ?? [];
    const recent = (recentRes.data ?? []) as any[];

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter((r) => r.status === "occupied").length;
    const monthlyRevenue = tenants.reduce((s, t) => s + Number(t.monthly_rent), 0);
    const collected = payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + Number(p.amount), 0);
    const pendingAmount = payments
      .filter((p) => p.status === "pending" || p.status === "overdue")
      .reduce((s, p) => s + Number(p.amount), 0);

    const recentPayments = recent.map((p) => ({
      id: p.id,
      tenantName: (p.tenant as any)?.full_name ?? "Unknown",
      amount: Number(p.amount),
      status: p.status as PaymentStatus,
      for_month: p.for_month,
      payment_date: p.payment_date,
    }));

    return {
      data: {
        hostelName,
        hostelId,
        totalTenants: tenants.length,
        monthlyRevenue,
        collected,
        pendingAmount,
        occupancyRate:
          totalRooms > 0
            ? Math.round((occupiedRooms / totalRooms) * 100)
            : 0,
        totalRooms,
        occupiedRooms,
        recentPayments,
      },
    };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Failed to load partner dashboard",
    };
  }
}

// ── Tenants (read-only) ────────────────────────────────────────────────────────

export interface PartnerTenant {
  id: string;
  full_name: string;
  phone: string | null;
  type: string;
  room_number: string | null;
  bed_number: string | null;
  check_in: string;
  monthly_rent: number;
  billing_type: string;
  package_tier: string;
  is_active: boolean;
}

export async function getPartnerTenants(): Promise<{
  tenants?: PartnerTenant[];
  hostelId?: string;
  error?: string;
}> {
  try {
    const { hostelId } = await requirePartner();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_tenants")
      .select(
        "id, full_name, phone, type, room_id, bed_number, check_in, monthly_rent, billing_type, package_tier, is_active, room:hms_rooms(room_number)"
      )
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .order("full_name");

    if (error) throw error;

    const tenants: PartnerTenant[] = (data ?? []).map((t: any) => ({
      id: t.id,
      full_name: t.full_name,
      phone: t.phone,
      type: t.type,
      room_number: (t.room as { room_number: string } | null)?.room_number ?? null,
      bed_number: t.bed_number,
      check_in: t.check_in,
      monthly_rent: Number(t.monthly_rent),
      billing_type: t.billing_type,
      package_tier: t.package_tier,
      is_active: t.is_active,
    }));

    return { tenants, hostelId };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to load partner tenants",
    };
  }
}

// ── Payments (read-only) ───────────────────────────────────────────────────────

export interface PartnerPayment {
  id: string;
  tenantName: string;
  for_month: string;
  amount: number;
  late_fee: number;
  status: PaymentStatus;
  payment_method: string | null;
  payment_date: string | null;
  receipt_number: string | null;
}

export async function getPartnerPayments(month: string): Promise<{
  payments?: PartnerPayment[];
  hostelId?: string;
  error?: string;
}> {
  try {
    const { hostelId } = await requirePartner();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_payments")
      .select(
        "id, for_month, amount, late_fee, status, payment_method, payment_date, receipt_number, tenant:hms_tenants(full_name)"
      )
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const payments: PartnerPayment[] = (data ?? []).map((p: any) => ({
      id: p.id,
      tenantName: p.tenant?.full_name ?? "Unknown",
      for_month: p.for_month,
      amount: Number(p.amount),
      late_fee: Number(p.late_fee ?? 0),
      status: p.status as PaymentStatus,
      payment_method: p.payment_method,
      payment_date: p.payment_date,
      receipt_number: p.receipt_number,
    }));

    return { payments, hostelId };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to load partner payments",
    };
  }
}
