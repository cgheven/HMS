"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { performTenantCheckout } from "@/lib/tenant-checkout";
import { backfillTenantPaymentsAction, logTenantEvent } from "@/app/actions/tenants";
import { sendTenantWelcomeMessageAction } from "@/lib/whatsapp-welcome-action";
import { pktYearMonth } from "@/lib/pkt-time"
import { isValidCnic, normalizeCnic } from "@/lib/cnic";
import { normalizeVisitPurpose } from "@/lib/visit-purpose";
import { linkReferralForNewTenant } from "@/lib/referral-attribution";
import type { CheckoutInput, CheckoutSettlement, Payment } from "@/types";

// Partner write actions — the safe, admin-client mutation layer a partner's
// reused owner-dashboard UI calls into instead of the owner's raw mutation
// path. Reads don't need this file at all: with getAuthContext() resolving a
// partner's branch via hms_partnerships (see lib/data.ts) and the matching
// RLS SELECT policies (migrations 092/093), the owner's own getDashboardData/
// getTenants/getPaymentsPageData in lib/data.ts already work for a partner.
//
// Every action below resolves hostelId from the guarded, session-derived
// active branch (getAuthContext()) — never from a client-supplied argument.

async function requirePartnerHostelId(minTier: "standard" | "full"): Promise<string> {
  await requireOwnerOrPartnerTier(minTier);
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

// ── Writes — Standard tier and above ───────────────────────────────────────────

// Full field parity with the owner's add/edit tenant form (components/modules/
// tenants/tenants-client.tsx handleSave() payload) — a partner is equally
// involved in running the branch, so this deliberately isn't a reduced subset.
export interface PartnerTenantPayload {
  full_name: string;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  type: string;
  package_tier: string;
  custom_package_id: string | null;
  room_id: string | null;
  bed_number: string | null;
  check_in: string;
  check_out: string | null;
  billing_type: string;
  monthly_rent: number;
  daily_rate: number;
  security_deposit: number;
  registration_fee: number;
  vehicle_type: string | null;
  vehicle_number: string | null;
  vehicle_model: string | null;
  joining_meter_reading: number | null;
  emergency_contact: string | null;
  emergency_relationship: string | null;
  permanent_address: string | null;
  father_name: string | null;
  purpose_of_visit: string | null;
  purpose_of_visit_detail: string | null;
  emergency_phone: string | null;
  notes: string | null;
  is_waiting: boolean;
  photo_url: string | null;
  food_breakfast: boolean;
  food_lunch: boolean;
  food_dinner: boolean;
  institute_name: string | null;
  student_category: string | null;
  student_specialization: string | null;
  organization: string | null;
  organization_type: string | null;
  department: string | null;
}

function validateTenantPayload(payload: PartnerTenantPayload): string | null {
  if (!payload.full_name?.trim() || payload.full_name.trim().length < 2) {
    return "Full name must be at least 2 characters.";
  }
  if (!payload.is_waiting && !payload.check_in) return "Check-in date is required.";
  if (payload.cnic && !isValidCnic(normalizeCnic(payload.cnic))) {
    return "Invalid CNIC format. Must be XXXXX-XXXXXXX-X.";
  }
  return null;
}

export async function addTenantAsPartner(
  payload: PartnerTenantPayload
): Promise<{ error: string | null; tenantId?: string }> {
  try {
    const hostelId = await requirePartnerHostelId("standard");
    const admin = createAdminClient();

    const validationError = validateTenantPayload(payload);
    if (validationError) return { error: validationError };

    const roomId = payload.is_waiting ? null : payload.room_id;
    let room: { id: string; capacity: number; occupied: number } | null = null;
    if (roomId) {
      const { data: r } = await admin
        .from("hms_rooms")
        .select("id, capacity, occupied, status")
        .eq("id", roomId)
        .eq("hostel_id", hostelId)
        .single();
      if (!r) return { error: "Invalid room selection." };
      if (r.status === "maintenance") return { error: "Selected room is under maintenance." };
      if (r.occupied >= r.capacity) return { error: "Selected room is at full capacity." };
      room = r;
    }

    const billingType = payload.billing_type === "daily" ? "daily" : "monthly";
    const insertData: Record<string, unknown> = {
      hostel_id: hostelId,
      full_name: payload.full_name.trim(),
      phone: payload.phone?.trim() || null,
      email: payload.email?.trim() || null,
      cnic: normalizeCnic(payload.cnic),
      type: payload.type,
      package_tier: payload.package_tier,
      custom_package_id: payload.custom_package_id || null,
      room_id: roomId,
      bed_number: payload.bed_number || null,
      check_in: payload.is_waiting ? new Date().toISOString().slice(0, 10) : payload.check_in,
      check_out: billingType === "daily" && payload.check_out ? payload.check_out : null,
      billing_type: billingType,
      monthly_rent: billingType === "monthly" ? Number(payload.monthly_rent) || 0 : 0,
      daily_rate: billingType === "daily" ? Number(payload.daily_rate) || 0 : 0,
      security_deposit: Number(payload.security_deposit) || 0,
      registration_fee: Number(payload.registration_fee) || 0,
      vehicle_type: payload.vehicle_type?.trim() || null,
      vehicle_number: payload.vehicle_number?.trim() || null,
      vehicle_model: payload.vehicle_model?.trim() || null,
      joining_meter_reading: payload.joining_meter_reading ?? null,
      emergency_contact: payload.emergency_contact || null,
      emergency_relationship: payload.emergency_relationship || null,
      permanent_address: payload.permanent_address?.trim() || null,
      father_name: payload.father_name?.trim() || null,
      ...normalizeVisitPurpose(payload.purpose_of_visit, payload.purpose_of_visit_detail),
      emergency_phone: payload.emergency_phone || null,
      notes: payload.notes || null,
      is_waiting: payload.is_waiting,
      is_active: !payload.is_waiting,
      photo_url: payload.photo_url || null,
      food_breakfast: !!payload.food_breakfast,
      food_lunch: !!payload.food_lunch,
      food_dinner: !!payload.food_dinner,
      institute_name: payload.institute_name || null,
      student_category: payload.student_category || null,
      student_specialization: payload.student_specialization || null,
      organization: payload.organization || null,
      organization_type: payload.organization_type || null,
      department: payload.department || null,
    };

    const { data: created, error: insErr } = await admin
      .from("hms_tenants")
      .insert(insertData)
      .select("id")
      .single();
    if (insErr) return { error: insErr.message };
    const tenantId = created.id as string;

    // Fire-and-forget welcome WhatsApp — never awaited, never blocks this action.
    if (!payload.is_waiting) {
      void sendTenantWelcomeMessageAction(tenantId);
    }

    if (room && roomId) {
      const newOccupied = room.occupied + 1;
      await admin
        .from("hms_rooms")
        .update({ occupied: newOccupied, status: newOccupied >= room.capacity ? "occupied" : "available" })
        .eq("id", roomId)
        .eq("hostel_id", hostelId);
    }

    // Ledger entry — best-effort, mirrors the owner flow exactly.
    const depositAmount = insertData.security_deposit as number;
    if (depositAmount > 0) {
      await admin.from("hms_tenant_events").insert({
        hostel_id: hostelId,
        tenant_id: tenantId,
        event_type: "deposit_collected",
        amount: depositAmount,
      });
    }

    // Best-effort backfill for a historical check-in date — requires full tier
    // internally, so this silently no-ops for a standard-tier partner, same
    // graceful degradation the owner flow already has if backfill fails for
    // any other reason (it never blocks tenant creation either way).
    if (!payload.is_waiting && payload.check_in) {
      const checkInMonth = payload.check_in.slice(0, 7);
      // Pakistan-anchored — see addTenantAsManager (app/actions/managers.ts) for why.
      const { year: curYear, month: curMonth } = pktYearMonth();
      const currentMonth = `${curYear}-${String(curMonth).padStart(2, "0")}`;
      if (checkInMonth < currentMonth) {
        await backfillTenantPaymentsAction(tenantId);
      }
    }

    // A new tenant means the Payments page has a missing row to generate, so its
    // cached RSC payload is stale the moment this returns.
    revalidatePath("/tenants");
    revalidatePath("/payments");

    // Attribution runs LAST, after every write that makes an admission complete
    // (room occupancy, deposit ledger, application status). try/catch bounds a
    // THROW, not TIME: supabase-js sets no fetch timeout, so a stalled query is an
    // unbounded await the catch never sees — the platform kills the invocation
    // instead. Sitting mid-sequence, that left the tenant row committed with
    // occupancy un-incremented and the application still pending, and the
    // operator's natural retry created a SECOND tenant. Last means a stall can
    // only ever cost the attribution.
  // Skipped for a waiting-list row on purpose, mirroring the welcome message
    // above. A waiting tenant has not moved in, has no bill and no deadline to
    // measure against — attributing here would CONSUME the referral at 'joined'
    // and leave nothing to pay out when they actually activate. Firing on the
    // activation transition is Phase 2 Step 0.
    if (!payload.is_waiting) await linkReferralForNewTenant(admin, {
      tenantId,
      hostelId,
      phone: payload.phone,
      checkIn: payload.check_in,
    });

    return { error: null, tenantId };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." };
  }
}

export async function recordPaymentAsPartner(
  tenantId: string,
  amount: number,
  method: string,
  month: string,
  acUnitsConsumed?: number,
  notes?: string,
): Promise<{ payment?: Payment; installmentId?: string; error: string | null }> {
  try {
    const hostelId = await requirePartnerHostelId("standard");
    const admin = createAdminClient();

    const VALID_METHODS = new Set(["cash", "bank_transfer", "jazzcash", "easypaisa", "sadapay", "other"]);
    if (!VALID_METHODS.has(method)) return { error: "Invalid payment method." };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Invalid payment amount." };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Invalid month." };
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (month !== currentMonth) return { error: "Payments can only be recorded for the current month." };

    // Verify tenant belongs to the active branch and get their package tier
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("hostel_id, package_tier")
      .eq("id", tenantId)
      .maybeSingle();

    if (!tenant || tenant.hostel_id !== hostelId) {
      return { error: "Tenant not found in your active branch." };
    }

    const isAcTier = tenant.package_tier === "space_food_ac";

    // Fetch the actual outstanding bill so the entered amount is validated
    // against it, mirroring the manager/owner recording flows exactly.
    const { data: existingPayment } = await admin
      .from("hms_payments")
      .select("id, amount, amount_paid, late_fee, ac_charge, status")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .in("status", ["pending", "overdue", "partially_paid"])
      .maybeSingle();

    if (!existingPayment) {
      return { error: "No outstanding bill found for this tenant this month." };
    }

    let newAcCharge = Number(existingPayment.ac_charge ?? 0);
    const updatePayload: Record<string, unknown> = {
      payment_method: method,
      payment_date: new Date().toISOString().slice(0, 10),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
    };

    if (isAcTier && acUnitsConsumed !== undefined) {
      // ac_units_consumed is numeric(10,2) — a room's units rarely split into
      // whole numbers per tenant, so allow up to 2 decimal places.
      if (!Number.isFinite(acUnitsConsumed) || acUnitsConsumed < 0 || acUnitsConsumed > 9999) {
        return { error: "AC units must be a non-negative number between 0 and 9999." };
      }
      const roundedUnits = Math.round(acUnitsConsumed * 100) / 100;
      // Fetch AC rate from DB — never trust the client-supplied value
      const { data: config } = await admin
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle();

      const acUnitRate = Number(config?.ac_per_unit_rate ?? 0);
      newAcCharge = Math.round(roundedUnits * acUnitRate);
      updatePayload.ac_units_consumed = roundedUnits;
      updatePayload.ac_charge = newAcCharge;
    }

    // The bill's non-AC portion stays fixed here; only the AC charge can shift,
    // if a fresh meter reading was entered above. Mirrors what the DB trigger recomputes.
    const nonAcPortion = Number(existingPayment.amount) - Number(existingPayment.ac_charge ?? 0);
    const fullAmountDue = nonAcPortion + newAcCharge + Number(existingPayment.late_fee ?? 0);
    const previousAmountPaid = Number(existingPayment.amount_paid ?? 0);
    const remainingBefore = Math.max(0, fullAmountDue - previousAmountPaid);

    if (amount > remainingBefore + 0.01) {
      return {
        error: `Amount collected (Rs. ${amount.toLocaleString()}) exceeds the remaining balance (Rs. ${remainingBefore.toLocaleString()}). Enter the exact remaining amount instead.`,
      };
    }

    const newAmountPaid = previousAmountPaid + amount;
    const isFullyPaid = newAmountPaid >= fullAmountDue - 0.01;
    updatePayload.status = isFullyPaid ? "paid" : "partially_paid";
    updatePayload.amount_paid = newAmountPaid;

    // Select the updated row back (same shape markPaymentPaidAction returns)
    // so the caller can drive the post-payment WhatsApp-receipt share dialog —
    // without this, that dialog silently never appears for partner-recorded payments.
    const { data: updated, error } = await admin
      .from("hms_payments")
      .update(updatePayload)
      .eq("id", existingPayment.id)
      .eq("hostel_id", hostelId)
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .single();

    if (error) return { error: error.message };

    // Record this transaction as its own immutable snapshot, same as the
    // owner/manager payment flows — so a partner-collected installment shows up
    // in the Member Ledger/timeline as its own event, not silently merged in.
    const { data: installmentRow, error: installmentErr } = await admin.from("hms_payment_installments").insert({
      hostel_id: hostelId,
      tenant_id: tenantId,
      payment_id: existingPayment.id,
      for_month: month,
      amount,
      amount_before: previousAmountPaid,
      amount_after: newAmountPaid,
      total_due: fullAmountDue,
      payment_method: method,
      payment_date: new Date().toISOString().slice(0, 10),
      notes: notes?.trim() || null,
    }).select("id").single();
    if (installmentErr) {
      console.error("[recordPaymentAsPartner] Failed to record payment installment:", installmentErr.message);
    }

    revalidatePath("/payments");
    revalidatePath("/dashboard");
    return { payment: updated as Payment, installmentId: installmentRow?.id as string | undefined, error: null };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." };
  }
}

export async function addExpenseAsPartner(
  category: string,
  amount: number,
  description: string,
  date: string,
): Promise<{ error: string | null }> {
  try {
    const hostelId = await requirePartnerHostelId("standard");
    const admin = createAdminClient();

    const VALID_CATEGORIES = new Set(["furniture", "repairs", "cleaning", "security", "utilities", "other"]);
    if (!VALID_CATEGORIES.has(category)) return { error: "Invalid expense category." };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0." };
    if (!description?.trim()) return { error: "Description is required." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." };

    const { error } = await admin.from("hms_expenses").insert({
      hostel_id: hostelId,
      title: description.trim(),
      amount,
      category,
      date,
      notes: null,
    });

    if (error) return { error: error.message };

    revalidatePath("/dashboard");
    return { error: null };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." };
  }
}

// ── Writes — Full tier only (equal to owner on this branch) ───────────────────

export async function checkoutTenantAsPartner(
  input: CheckoutInput
): Promise<{ success: boolean; error?: string; warning?: string; settlement?: CheckoutSettlement }> {
  try {
    const hostelId = await requirePartnerHostelId("full");
    return await performTenantCheckout(hostelId, input);
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function editTenantAsPartner(
  tenantId: string,
  payload: PartnerTenantPayload
): Promise<{ error: string | null }> {
  try {
    const hostelId = await requirePartnerHostelId("full");
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("hms_tenants")
      .select("id, hostel_id, room_id, package_tier, is_waiting")
      .eq("id", tenantId)
      .maybeSingle();

    if (!existing || existing.hostel_id !== hostelId) {
      return { error: "Tenant not found in your active branch." };
    }

    const validationError = validateTenantPayload(payload);
    if (validationError) return { error: validationError };

    const prevRoomId = existing.room_id as string | null;
    const roomId = payload.is_waiting ? null : payload.room_id;
    let newRoom: { id: string; capacity: number; occupied: number } | null = null;
    if (roomId && roomId !== prevRoomId) {
      const { data: r } = await admin
        .from("hms_rooms")
        .select("id, capacity, occupied, status")
        .eq("id", roomId)
        .eq("hostel_id", hostelId)
        .single();
      if (!r) return { error: "Invalid room selection." };
      if (r.status === "maintenance") return { error: "Selected room is under maintenance." };
      if (r.occupied >= r.capacity) return { error: "Selected room is at full capacity." };
      newRoom = r;
    }

    const billingType = payload.billing_type === "daily" ? "daily" : "monthly";
    const updatePayload: Record<string, unknown> = {
      full_name: payload.full_name.trim(),
      phone: payload.phone?.trim() || null,
      email: payload.email?.trim() || null,
      cnic: normalizeCnic(payload.cnic),
      type: payload.type,
      package_tier: payload.package_tier,
      custom_package_id: payload.custom_package_id || null,
      room_id: roomId,
      bed_number: payload.bed_number || null,
      check_in: payload.is_waiting ? new Date().toISOString().slice(0, 10) : payload.check_in,
      check_out: billingType === "daily" && payload.check_out ? payload.check_out : null,
      billing_type: billingType,
      monthly_rent: billingType === "monthly" ? Number(payload.monthly_rent) || 0 : 0,
      daily_rate: billingType === "daily" ? Number(payload.daily_rate) || 0 : 0,
      security_deposit: Number(payload.security_deposit) || 0,
      registration_fee: Number(payload.registration_fee) || 0,
      vehicle_type: payload.vehicle_type?.trim() || null,
      vehicle_number: payload.vehicle_number?.trim() || null,
      vehicle_model: payload.vehicle_model?.trim() || null,
      joining_meter_reading: payload.joining_meter_reading ?? null,
      emergency_contact: payload.emergency_contact || null,
      emergency_relationship: payload.emergency_relationship || null,
      permanent_address: payload.permanent_address?.trim() || null,
      father_name: payload.father_name?.trim() || null,
      ...normalizeVisitPurpose(payload.purpose_of_visit, payload.purpose_of_visit_detail),
      emergency_phone: payload.emergency_phone || null,
      notes: payload.notes || null,
      is_waiting: payload.is_waiting,
      is_active: !payload.is_waiting,
      photo_url: payload.photo_url || null,
      food_breakfast: !!payload.food_breakfast,
      food_lunch: !!payload.food_lunch,
      food_dinner: !!payload.food_dinner,
      institute_name: payload.institute_name || null,
      student_category: payload.student_category || null,
      student_specialization: payload.student_specialization || null,
      organization: payload.organization || null,
      organization_type: payload.organization_type || null,
      department: payload.department || null,
    };

    const { error } = await admin
      .from("hms_tenants")
      .update(updatePayload)
      .eq("id", tenantId)
      .eq("hostel_id", hostelId);

    if (error) return { error: error.message };

    // Fire-and-forget welcome WhatsApp — only on the waiting-list → active
    // transition, not on every routine edit of an already-active tenant.
    if (existing.is_waiting && !payload.is_waiting) {
      void sendTenantWelcomeMessageAction(tenantId);
    }

    // Moving an already-active tenant back to the waiting list leaves behind
    // any payment row already generated for them — they were never actually
    // billable, unlike a genuinely checked-out tenant. Only this month/later,
    // and only rows nothing has been paid against yet.
    if (!existing.is_waiting && payload.is_waiting) {
      const currentMonth = new Date().toISOString().slice(0, 7);
      await admin.from("hms_payments")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .gte("for_month", currentMonth)
        .in("status", ["pending", "overdue"]);
    }

    // Ledger events — best-effort, mirrors the owner flow exactly.
    if (prevRoomId !== roomId) {
      const [{ data: oldRoomRow }, { data: newRoomRow }] = await Promise.all([
        prevRoomId ? admin.from("hms_rooms").select("room_number").eq("id", prevRoomId).maybeSingle() : Promise.resolve({ data: null }),
        roomId ? admin.from("hms_rooms").select("room_number").eq("id", roomId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      await logTenantEvent({
        tenantId,
        eventType: "room_changed",
        fromValue: oldRoomRow?.room_number ?? "None",
        toValue: newRoomRow?.room_number ?? "None",
      });
    }
    if (existing.package_tier !== payload.package_tier) {
      await logTenantEvent({
        tenantId,
        eventType: "plan_changed",
        fromValue: existing.package_tier ?? null,
        toValue: payload.package_tier,
      });
    }

    // Room occupancy adjustments — old room decrements, new room increments.
    if (prevRoomId !== roomId) {
      if (prevRoomId) {
        const { data: oldRoom } = await admin.from("hms_rooms").select("occupied, capacity").eq("id", prevRoomId).single();
        if (oldRoom) {
          const newOcc = Math.max(0, oldRoom.occupied - 1);
          await admin
            .from("hms_rooms")
            .update({ occupied: newOcc, status: newOcc < oldRoom.capacity ? "available" : "occupied" })
            .eq("id", prevRoomId);
        }
      }
      if (roomId && newRoom) {
        const newOcc = newRoom.occupied + 1;
        await admin
          .from("hms_rooms")
          .update({ occupied: newOcc, status: newOcc >= newRoom.capacity ? "occupied" : "available" })
          .eq("id", roomId);
      }
    }

    revalidatePath("/tenants");
    return { error: null };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." };
  }
}
