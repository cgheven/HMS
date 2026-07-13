"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { calcFoodAddonCharge } from "@/lib/food-addon";
import type { Payment, PackageTier, PaymentMethod, PaymentStatus, TenantDocument, DocumentType, CheckoutPaymentSettlement, CheckoutInput } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

// ---------------------------------------------------------------------------
// uploadTenantPhoto
// ---------------------------------------------------------------------------

const ALLOWED_MIME = new Set(["image/webp", "image/jpeg", "image/png"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const BUCKET = "tenant-photos";

/**
 * F-004: Validate image magic bytes server-side.
 * The client-supplied Content-Type header is attacker-controlled; we must
 * verify the actual file content against known image signatures.
 *
 * Signatures:
 *   JPEG  : FF D8 FF
 *   PNG   : 89 50 4E 47 0D 0A 1A 0A
 *   WebP  : 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF....WEBP)
 */
function validateImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 12) return false;

  // JPEG: starts with FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;

  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return true;

  // WebP: RIFF at bytes 0-3 and WEBP at bytes 8-11
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;

  return false;
}

export async function uploadTenantPhoto(
  hostelId: string,
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  try {
    await requireOwnerOrAbove();

    // Verify caller owns this hostelId
    const ownedHostelId = await resolveHostelId();
    if (ownedHostelId !== hostelId) {
      throw new Error("Forbidden: hostel does not belong to you");
    }

    const file = formData.get("file") as File | null;
    if (!file) throw new Error("No file provided");
    if (!ALLOWED_MIME.has(file.type)) {
      throw new Error("Invalid file type. Only WebP, JPEG, and PNG are allowed.");
    }
    if (file.size > MAX_BYTES) {
      throw new Error("File too large. Maximum size is 2 MB.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // F-004: Validate magic bytes — reject files whose content does not
    // match a known image signature regardless of the client-supplied MIME.
    if (!validateImageMagicBytes(buffer)) {
      throw new Error("Invalid file content. Only real JPEG, PNG, or WebP images are accepted.");
    }
    const ext = "webp";
    const path = `${hostelId}/${randomUUID()}.${ext}`;

    const supabase = await createClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: "image/webp", upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Tenant Documents
// ---------------------------------------------------------------------------

const DOC_BUCKET = "tenant-documents";
const DOC_MAX_DOCS = 20; // F6: cap per tenant to prevent storage exhaustion
const DOC_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DOC_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
// Runtime docType allowlist — TypeScript types are erased at runtime; a direct server-action
// caller can supply arbitrary strings, so we validate here as well.
const VALID_DOC_TYPES = new Set<string>(["cnic", "police_verification", "lease_agreement", "passport", "other"]);

// F4: derive extension from MIME — never trust filename extension
const DOC_EXT: Record<string, string> = {
  "image/jpeg":      "jpg",
  "image/png":       "png",
  "image/webp":      "webp",
  "application/pdf": "pdf",
};

function validateDocMagicBytes(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true; // WebP
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true; // PDF
  return false;
}

// F1: verify tenantId belongs to the calling owner's active hostel
async function assertTenantOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  hostelId: string
): Promise<void> {
  const { data } = await supabase
    .from("hms_tenants")
    .select("hostel_id")
    .eq("id", tenantId)
    .single();
  if (!data || data.hostel_id !== hostelId) throw new Error("Forbidden");
}

export async function uploadTenantDocument(
  tenantId: string,
  docType: DocumentType,
  formData: FormData
): Promise<{ document?: TenantDocument; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId(); // F1: caller must have an active hostel
    const supabase = await createClient();
    await assertTenantOwnership(supabase, tenantId, hostelId); // F1: IDOR fix

    // Runtime docType validation (TypeScript types erased at runtime)
    if (!VALID_DOC_TYPES.has(docType)) throw new Error("Invalid document type.");

    const file = formData.get("file") as File | null;
    if (!file) throw new Error("No file provided");
    if (!DOC_ALLOWED_MIME.has(file.type)) throw new Error("Only PDF, JPEG, PNG, or WebP files are allowed.");

    // Read buffer first, then size-check against actual bytes — not client-supplied file.size
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > DOC_MAX_BYTES) throw new Error("File too large. Maximum size is 10 MB.");
    if (!validateDocMagicBytes(buffer)) throw new Error("Invalid file content. Only real PDF or image files are accepted.");

    // F4: extension from allowlist, never from filename
    const ext = DOC_EXT[file.type] ?? "bin";

    // F5: generate a meaningful sanitized display name; discard raw file.name
    const dateStr = new Date().toISOString().slice(0, 10);
    const typeSlug = docType.replace(/_/g, "-");
    const displayName = `${typeSlug}_${dateStr}.${ext}`;

    // Storage path: opaque UUID — no user-controlled segments after tenantId
    const storagePath = `${tenantId}/${randomUUID()}.${ext}`;

    // Fetch current docs first — check count limit before uploading
    const { data: tenant } = await supabase
      .from("hms_tenants").select("documents").eq("id", tenantId).single();
    const existing = (tenant?.documents ?? []) as TenantDocument[];
    if (existing.length >= DOC_MAX_DOCS) {
      throw new Error(`Maximum ${DOC_MAX_DOCS} documents per tenant. Delete an existing document first.`);
    }

    const { error: uploadError } = await supabase.storage
      .from(DOC_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    // F2: store storage path, never a URL (private bucket — URLs don't work and expose project ref)
    const newDoc: TenantDocument = {
      id: randomUUID(),
      name: displayName,
      path: storagePath,
      type: docType,
      uploaded_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("hms_tenants").update({ documents: [...existing, newDoc] }).eq("id", tenantId);

    if (updateError) {
      // F7: DB write failed — clean up the orphaned storage object
      await supabase.storage.from(DOC_BUCKET).remove([storagePath]);
      throw new Error(updateError.message);
    }

    return { document: newDoc };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteTenantDocument(
  tenantId: string,
  docId: string
): Promise<{ error?: string }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId(); // F1
    const supabase = await createClient();
    await assertTenantOwnership(supabase, tenantId, hostelId); // F1: IDOR fix

    const { data: tenant } = await supabase
      .from("hms_tenants").select("documents").eq("id", tenantId).single();

    const existing = (tenant?.documents ?? []) as TenantDocument[];
    const doc = existing.find((d) => d.id === docId);

    // F2 + F7: use stored path directly; check storage deletion before DB update
    if (doc?.path) {
      const { error: storageErr } = await supabase.storage.from(DOC_BUCKET).remove([doc.path]);
      if (storageErr) throw new Error(`Storage deletion failed: ${storageErr.message}`);
    }

    const { error } = await supabase
      .from("hms_tenants").update({ documents: existing.filter((d) => d.id !== docId) }).eq("id", tenantId);

    if (error) throw new Error(error.message);
    return {};
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// F3: generate a short-lived signed URL with forced download header — never expose raw storage URL
export async function getDocumentSignedUrl(
  tenantId: string,
  docId: string
): Promise<{ url?: string; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId();
    const supabase = await createClient();
    await assertTenantOwnership(supabase, tenantId, hostelId);

    const { data: tenant } = await supabase
      .from("hms_tenants").select("documents").eq("id", tenantId).single();

    const doc = ((tenant?.documents ?? []) as TenantDocument[]).find((d) => d.id === docId);
    if (!doc) throw new Error("Document not found");

    // F3: 1-hour expiry + Content-Disposition: attachment prevents inline execution
    const { data, error } = await supabase.storage
      .from(DOC_BUCKET)
      .createSignedUrl(doc.path, 3600, { download: doc.name });

    if (error) throw new Error(error.message);
    return { url: data.signedUrl };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getTenantTimeline
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | "joined"
  | "payment"
  | "package_changed"
  | "check_out"
  | "status_change"
  | "pending";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string; // ISO string for sorting
  label: string;
  sub?: string;
  amount?: number;
  method?: string;
  forMonth?: string;
  foodCharge?: number;
  acCharge?: number;
  paymentId?: string;
}

export async function getTenantTimeline(
  tenantId: string
): Promise<{ events?: TimelineEvent[]; error?: string }> {
  try {
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    const [tenantRes, paymentsRes] = await Promise.all([
      supabase
        .from("hms_tenants")
        .select("id, full_name, check_in, check_out, is_active, created_at")
        .eq("id", tenantId)
        .eq("hostel_id", hostelId)
        .single(),
      supabase
        .from("hms_payments")
        .select(
          "id, for_month, amount, late_fee, payment_method, payment_date, status, food_charge, ac_charge, payment_package_tier, created_at"
        )
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: false }),
    ]);

    if (tenantRes.error || !tenantRes.data) throw new Error("Tenant not found or access denied");
    if (paymentsRes.error) throw new Error(paymentsRes.error.message);

    const tenant = tenantRes.data;
    const payments = paymentsRes.data;

    const events: TimelineEvent[] = [];

    // "Joined" event from check_in date
    events.push({
      id: `joined-${tenant.id}`,
      type: "joined",
      date: tenant.check_in ?? tenant.created_at,
      label: "Checked in",
      sub: "Tenant joined the hostel",
    });

    // Check-out event
    if (tenant.check_out && !tenant.is_active) {
      events.push({
        id: `checkout-${tenant.id}`,
        type: "check_out",
        date: tenant.check_out,
        label: "Checked out",
        sub: "Tenant left the hostel",
      });
    }

    // Payment events (only paid/waived are meaningful for timeline)
    for (const p of payments ?? []) {
      const eventDate = p.payment_date ?? p.created_at;
      const totalPaid =
        Number(p.amount) + Number(p.late_fee ?? 0);

      if (p.status === "paid") {
        const methodLabel =
          p.payment_method
            ? p.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : undefined;
        events.push({
          id: `payment-${p.id}`,
          type: "payment",
          date: eventDate,
          label: `Rs. ${totalPaid.toLocaleString()} paid`,
          sub: `${p.for_month}${methodLabel ? " · " + methodLabel : ""}`,
          amount: totalPaid,
          method: methodLabel,
          forMonth: p.for_month,
          foodCharge: p.food_charge != null ? Number(p.food_charge) : undefined,
          acCharge: p.ac_charge != null ? Number(p.ac_charge) : undefined,
          paymentId: p.id,
        });
      } else if (p.status === "waived") {
        events.push({
          id: `waived-${p.id}`,
          type: "status_change",
          date: eventDate,
          label: "Payment waived",
          sub: p.for_month,
          forMonth: p.for_month,
        });
      } else if (p.status === "pending" || p.status === "overdue") {
        events.push({
          id: `pending-${p.id}`,
          type: "pending",
          // Use billing month start as the date — more meaningful than created_at
          date: `${p.for_month}-01`,
          label: `Rs. ${totalPaid.toLocaleString()} ${p.status === "overdue" ? "overdue" : "due"}`,
          sub: `${p.for_month} · ${p.status === "overdue" ? "Overdue — not yet collected" : "Pending — not yet collected"}`,
          amount: totalPaid,
          forMonth: p.for_month,
          paymentId: p.id,
        });
      }
    }

    // Sort newest first
    events.sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return db - da;
    });

    return { events };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// createInvoiceLink
// ---------------------------------------------------------------------------

export async function createInvoiceLink(
  paymentId: string
): Promise<{ token?: string; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    // Verify the payment belongs to the caller's hostel
    const { data: payment, error: pErr } = await supabase
      .from("hms_payments")
      .select("id, hostel_id")
      .eq("id", paymentId)
      .eq("hostel_id", hostelId)
      .single();

    if (pErr || !payment) throw new Error("Payment not found or access denied");

    // Insert the invoice link (DB defaults token via gen_random_bytes). No
    // expires_at — receipt links are permanent, not time-boxed.
    const { data, error } = await supabase
      .from("hms_invoice_links")
      .insert({ payment_id: paymentId, hostel_id: hostelId })
      .select("token")
      .single();

    if (error) throw new Error(error.message);
    return { token: (data as { token: string }).token };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// backfillTenantPaymentsAction
// When a tenant is added with a historical check_in date, create payment
// records for all past months (check_in month → last month) marked as Paid/Cash.
// Current month is intentionally excluded — handled by normal Sync.
// ---------------------------------------------------------------------------

const FOOD_TIERS = new Set<string>(["space_food", "space_3meals", "space_food_ac", "space_meals_cooler"]);

function getPastMonths(checkIn: string): string[] {
  const [ciYear, ciMonth] = checkIn.slice(0, 7).split("-").map(Number);
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1-based
  const months: string[] = [];
  let y = ciYear, m = ciMonth;
  while (y < curYear || (y === curYear && m < curMonth)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function lastDayOfMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

function genReceiptNumber(tenantName: string, month: string): string {
  const initials = tenantName.split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `HMS-${month.replace("-", "")}-${initials}-${rand}`;
}

export async function backfillTenantPaymentsAction(
  tenantId: string
): Promise<{ success: boolean; monthsCreated?: number; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("Unauthorized");
    const { hostelId } = ctx;

    const adminDb = createAdminClient();

    // Fetch tenant — verify it belongs to this hostel
    const { data: tenant } = await adminDb
      .from("hms_tenants")
      .select("id, full_name, hostel_id, check_in, monthly_rent, security_deposit, package_tier, billing_type, food_breakfast, food_lunch, food_dinner")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();

    if (!tenant) throw new Error("Tenant not found");
    if (tenant.billing_type !== "monthly") return { success: true, monthsCreated: 0 }; // daily tenants: skip
    if (!tenant.check_in) return { success: true, monthsCreated: 0 };

    const pastMonths = getPastMonths(tenant.check_in);
    if (pastMonths.length === 0) return { success: true, monthsCreated: 0 };

    // Get food rate from package config
    const { data: pkgConfig } = await adminDb
      .from("hms_package_configs")
      .select("food_monthly_rate, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate")
      .eq("hostel_id", hostelId)
      .single();
    const foodRate = Number(pkgConfig?.food_monthly_rate ?? 0);
    const tierFoodCharge = FOOD_TIERS.has(tenant.package_tier ?? "") ? foodRate : 0;
    const addonFoodCharge = pkgConfig ? calcFoodAddonCharge(tenant, pkgConfig) : 0;
    const foodCharge = tierFoodCharge + addonFoodCharge;
    const baseRent = Number(tenant.monthly_rent);
    const totalAmount = baseRent + foodCharge;
    const checkInMonth = tenant.check_in.slice(0, 7);

    const rows = pastMonths.map((month) => ({
      hostel_id: hostelId,
      tenant_id: tenantId,
      for_month: month,
      amount: totalAmount,
      food_charge: foodCharge,
      ac_charge: 0,
      late_fee: 0,
      status: "paid" as const,
      payment_method: "cash" as const,
      payment_date: lastDayOfMonth(month),
      receipt_number: genReceiptNumber(tenant.full_name, month),
      payment_package_tier: tenant.package_tier,
      // Security deposit recorded on first month's payment date for reference
      ...(month === checkInMonth ? { notes: `Security deposit: Rs ${tenant.security_deposit ?? 0} (paid on joining)` } : {}),
    }));

    // ignoreDuplicates: never overwrite if somehow a record already exists
    const { error } = await adminDb
      .from("hms_payments")
      .upsert(rows, { onConflict: "tenant_id,for_month", ignoreDuplicates: true });

    if (error) throw error;

    revalidatePath("/payments");
    return { success: true, monthsCreated: pastMonths.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getACCheckoutContextAction
// Returns the data needed to compute and preview the partial AC charge at checkout.
// Called by the checkout dialog when the tenant is in an AC room.
// ---------------------------------------------------------------------------

export async function getACCheckoutContextAction(
  roomId: string,
  checkoutMonth: string,
): Promise<{
  prevMonthReading: number | null;
  prevMonthUnits: number | null;
  perUnitRate: number;
  activeTenantCount: number;
  priorCheckoutUnits: number[];
  error?: string;
}> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    const [y, m] = checkoutMonth.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

    const [{ data: prevRecord }, { data: config }, { data: tenants }, { data: priorCheckouts }] = await Promise.all([
      adminDb
        .from("hms_room_ac_readings")
        .select("meter_reading, total_units")
        .eq("room_id", roomId)
        .eq("hostel_id", hostelId)
        .eq("for_month", prevMonth)
        .maybeSingle(),
      adminDb
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle(),
      adminDb
        .from("hms_tenants")
        .select("id")
        .eq("hostel_id", hostelId)
        .eq("room_id", roomId)
        .eq("is_active", true),
      // Fetch prior checkout unit offsets for segment-based preview calculation.
      // Each value is (checkout_meter_reading - prev_month_reading), matching
      // the same boundary format used by the month-end AC billing algorithm.
      adminDb
        .from("hms_room_ac_checkout_readings")
        .select("units_consumed")
        .eq("room_id", roomId)
        .eq("hostel_id", hostelId)
        .eq("for_month", checkoutMonth),
    ]);

    const priorCheckoutUnits = (priorCheckouts ?? []).map(r => Number(r.units_consumed));

    return {
      prevMonthReading: prevRecord?.meter_reading != null ? Number(prevRecord.meter_reading) : null,
      prevMonthUnits: prevRecord?.total_units != null ? Number(prevRecord.total_units) : null,
      perUnitRate: Number(config?.ac_per_unit_rate ?? 0),
      activeTenantCount: (tenants ?? []).length + priorCheckoutUnits.length,
      priorCheckoutUnits,
    };
  } catch (err: unknown) {
    return {
      prevMonthReading: null,
      prevMonthUnits: null,
      perUnitRate: 0,
      activeTenantCount: 0,
      priorCheckoutUnits: [],
      error: err instanceof Error ? err.message : "Failed to load AC context",
    };
  }
}

// ---------------------------------------------------------------------------
// checkoutTenantAction
// Handles the full checkout flow: settle payment → deactivate tenant → decrement room.
// Write order is intentional for EC-4 safety: payment first so that if tenant
// deactivation fails, the operator gets a clear error and retry is safe (the
// payment is already settled and won't be double-processed on retry).
// ---------------------------------------------------------------------------

export async function checkoutTenantAction(
  input: CheckoutInput
): Promise<{ success: boolean; error?: string; warning?: string }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    // Step 1: Fetch and verify tenant belongs to this hostel and is still active
    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("id, full_name, hostel_id, room_id, is_active, check_in")
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId)
      .single();

    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");
    if (!tenant.is_active) throw new Error("Tenant is already checked out");

    // SEC-F1: Validate checkoutDate server-side
    if (!input.checkoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.checkoutDate)) {
      throw new Error("Invalid checkout date format");
    }
    const checkoutDateObj = new Date(input.checkoutDate + "T00:00:00");
    if (isNaN(checkoutDateObj.getTime())) {
      throw new Error("Invalid checkout date");
    }
    const checkinStr = tenant.check_in as string | null;
    if (checkinStr && input.checkoutDate < checkinStr.slice(0, 10)) {
      throw new Error("Checkout date cannot be before the tenant's check-in date");
    }
    const maxFuture = new Date();
    maxFuture.setDate(maxFuture.getDate() + 7);
    if (checkoutDateObj > maxFuture) {
      throw new Error("Checkout date cannot be more than 7 days in the future");
    }

    // Step 2: Verify payment belongs to this tenant and hostel (prevents IDOR)
    let paymentAlreadySettled = false;
    let verifiedPayment: { id: string; tenant_id: string; hostel_id: string; status: string; for_month: string; amount: number | null } | null = null;
    if (input.paymentSettlement) {
      // SEC-F4: Runtime action validation — TypeScript enums are erased at runtime
      if (!new Set(["pay", "waive"]).has(input.paymentSettlement.action as string)) {
        throw new Error("Invalid payment action");
      }

      const { data: payment, error: payErr } = await adminDb
        .from("hms_payments")
        .select("id, tenant_id, hostel_id, status, for_month, amount")
        .eq("id", input.paymentSettlement.paymentId)
        .eq("tenant_id", input.tenantId)
        .eq("hostel_id", hostelId)
        .single();

      if (payErr || !payment) throw new Error("Payment not found or access denied");
      verifiedPayment = payment;

      // SEC-F2: EC-4 idempotent retry — if payment is already in the target state, skip the
      // update rather than throwing. This makes the action safe to retry in-place when tenant
      // deactivation failed after payment was already recorded.
      const { action } = input.paymentSettlement;
      paymentAlreadySettled =
        (action === "pay" && payment.status === "paid") ||
        (action === "waive" && payment.status === "waived");

      if (!paymentAlreadySettled && !["pending", "overdue"].includes(payment.status)) {
        throw new Error("Payment has already been settled");
      }
    }

    // Step 3a: AC checkout billing — compute partial AC charge if meter reading provided.
    // Runs before payment settlement so the charge is included in the payment being settled.
    let acCheckoutRecord: {
      units_consumed: number;
      tenant_count: number;
      ac_charge: number;
      prevReading: number;
      tenant_unit_share: number;
    } | null = null;

    if (input.acCheckoutReading !== undefined && tenant.room_id) {
      const checkoutMonth = input.checkoutDate.substring(0, 7);
      const [cy, cm] = checkoutMonth.split("-").map(Number);
      const prevDate = new Date(cy, cm - 2, 1);
      const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

      const [{ data: prevRecord }, { data: pkgConfig }, { data: roomInfo }, { data: activeTenantsInRoom }, { data: priorCheckoutsData }] = await Promise.all([
        adminDb.from("hms_room_ac_readings").select("meter_reading").eq("room_id", tenant.room_id).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
        adminDb.from("hms_package_configs").select("ac_per_unit_rate").eq("hostel_id", hostelId).maybeSingle(),
        adminDb.from("hms_rooms").select("has_ac").eq("id", tenant.room_id).eq("hostel_id", hostelId).single(),
        adminDb.from("hms_tenants").select("id").eq("hostel_id", hostelId).eq("room_id", tenant.room_id).eq("is_active", true),
        // Fetch prior checkout unit offsets (reading - prevMonthReading) so we can use them
        // as segment boundaries — same format as the month-end billing algorithm.
        adminDb.from("hms_room_ac_checkout_readings").select("units_consumed").eq("room_id", tenant.room_id).eq("hostel_id", hostelId).eq("for_month", checkoutMonth),
      ]);

      if (roomInfo?.has_ac) {
        const prevReading = prevRecord?.meter_reading != null
          ? Math.round(Number(prevRecord.meter_reading))
          : (input.acOpeningReading != null ? Math.round(Number(input.acOpeningReading)) : 0);
        const reading = Math.round(Number(input.acCheckoutReading));
        const perUnitRate = Number(pkgConfig?.ac_per_unit_rate ?? 0);

        // Prior unit offsets: each value = (prior_checkout_reading - prevMonthReading).
        // Used as segment boundaries so this tenant is only charged for units consumed
        // while they were present, not re-charged for periods already billed to prior checkouts.
        const priorUnitsOffsets = (priorCheckoutsData ?? []).map(r => Number(r.units_consumed));
        const totalStart = (activeTenantsInRoom ?? []).length + priorUnitsOffsets.length;

        if (!Number.isFinite(reading) || reading < 0 || reading > 999_999) {
          throw new Error("AC meter reading must be between 0 and 999,999");
        }
        if (reading < prevReading) {
          throw new Error(`AC meter reading (${reading}) cannot be less than previous month's reading (${prevReading})`);
        }
        if (perUnitRate > 0 && totalStart > 0) {
          const units = reading - prevReading;

          // Segment-based share calculation — mirrors the month-end billing algorithm.
          // Prior checkout offsets create boundaries within [0, units]. Each segment is
          // divided only among tenants who were still present during that segment.
          const boundaries = [
            0,
            ...priorUnitsOffsets.filter(u => u > 0 && u < units).sort((a, b) => a - b),
            units,
          ];
          let tenantUnitShare = 0;
          for (let i = 0; i < boundaries.length - 1; i++) {
            const segStart = boundaries[i];
            const segEnd = boundaries[i + 1];
            const checkoutsBeforeSeg = priorUnitsOffsets.filter(u => u <= segStart).length;
            const tenantsInSeg = totalStart - checkoutsBeforeSeg;
            if (tenantsInSeg > 0) tenantUnitShare += (segEnd - segStart) / tenantsInSeg;
          }

          const ac_charge = Math.round(tenantUnitShare * perUnitRate);
          // units_consumed = total room units — stored as billing breakpoint for month-end algorithm.
          acCheckoutRecord = { units_consumed: units, tenant_count: totalStart, ac_charge, prevReading, tenant_unit_share: tenantUnitShare };

          const tenantUnits = Math.round(tenantUnitShare);

          if (!input.paymentSettlement) {
            // No settlement selected — find any pending payment for this month and update it.
            // We fetch first to get the current amount so we can add the AC charge to it.
            const { data: pendingPayment } = await adminDb
              .from("hms_payments")
              .select("id, amount")
              .eq("tenant_id", input.tenantId)
              .eq("hostel_id", hostelId)
              .eq("for_month", checkoutMonth)
              .in("status", ["pending", "overdue"])
              .maybeSingle();
            if (pendingPayment) {
              await adminDb.from("hms_payments")
                .update({
                  ac_units_consumed: tenantUnits,
                  ac_charge,
                  amount: Number(pendingPayment.amount ?? 0) + ac_charge,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", pendingPayment.id);
            }
            // Non-fatal if no pending payment exists for this month
          }
          // When settlement IS provided, AC fields are merged into the Step 3 settlement
          // update below — targeting the exact payment ID avoids the for_month mismatch
          // that occurs when the pending payment's for_month differs from checkoutMonth.
        }
      }
    }

    // Step 3: Settle payment FIRST (before deactivating tenant — EC-4 safety)
    // Skip if already in the target state (SEC-F2 idempotent retry path)
    if (input.paymentSettlement && !paymentAlreadySettled) {
      if (input.paymentSettlement.action === "pay") {
        const { error: payUpdateErr } = await adminDb
          .from("hms_payments")
          .update({
            status: "paid" as PaymentStatus,
            payment_date: input.paymentSettlement.paymentDate ?? new Date().toISOString().split("T")[0],
            payment_method: (input.paymentSettlement.paymentMethod ?? null) as PaymentMethod | null,
            receipt_number: genReceiptNumber(tenant.full_name, verifiedPayment?.for_month ?? ""),
            // Merge AC fields here so the correct payment row is always targeted by ID,
            // not by for_month (which can differ from checkoutMonth for pre-generated payments).
            // Store the tenant's share of units (not total room units) so the receipt shows
            // "X units × Rs. rate/unit" correctly rather than the full room consumption.
            ...(acCheckoutRecord ? {
              ac_units_consumed: Math.round(acCheckoutRecord.tenant_unit_share),
              ac_charge: acCheckoutRecord.ac_charge,
              // Add AC charge to base amount so PDF formula (monthlyRent = amount - ac_charge) stays correct
              amount: Number(verifiedPayment!.amount ?? 0) + acCheckoutRecord.ac_charge,
            } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.paymentSettlement.paymentId)
          .eq("hostel_id", hostelId);

        // SEC-F5: sanitize — do not propagate raw DB error strings to client
        if (payUpdateErr) throw new Error("Failed to record payment. Please try again.");
      } else if (input.paymentSettlement.action === "waive") {
        const { error: waiveErr } = await adminDb
          .from("hms_payments")
          .update({
            status: "waived" as PaymentStatus,
            ...(acCheckoutRecord ? {
              ac_units_consumed: Math.round(acCheckoutRecord.tenant_unit_share),
              ac_charge: acCheckoutRecord.ac_charge,
            } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.paymentSettlement.paymentId)
          .eq("hostel_id", hostelId);

        // SEC-F5: sanitize — do not propagate raw DB error strings to client
        if (waiveErr) throw new Error("Failed to waive payment. Please try again.");
      }
    }

    // Step 4: Deactivate tenant (clear bed assignment, mark inactive)
    const { error: checkoutErr } = await adminDb
      .from("hms_tenants")
      .update({
        check_out: input.checkoutDate,
        is_active: false,
        is_waiting: false,
        bed_number: null,
      })
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId);

    if (checkoutErr) {
      // EC-4: Payment was settled but tenant deactivation failed.
      // The payment is now paid/waived, so a retry will skip that step (SEC-F2).
      if (input.paymentSettlement) {
        // SEC-F5: sanitize — omit raw DB error; the retry message is actionable enough
        throw new Error(
          `The payment was recorded successfully, but tenant checkout failed. ` +
          `The tenant is still active. Retry the checkout — the payment has already been saved and will not be re-processed.`
        );
      }
      // SEC-F5: sanitize — do not expose DB internals
      throw new Error("Tenant checkout failed. Please try again.");
    }

    // Step 4b: Persist AC checkout reading record — stored AFTER tenant deactivation
    // so it only exists if the checkout actually completed.
    let acReadingWarning: string | undefined;
    if (acCheckoutRecord && tenant.room_id) {
      const checkoutMonth = input.checkoutDate.substring(0, 7);
      const { error: acReadingErr } = await adminDb
        .from("hms_room_ac_checkout_readings")
        .upsert(
          {
            hostel_id: hostelId,
            room_id: tenant.room_id,
            tenant_id: input.tenantId,
            for_month: checkoutMonth,
            meter_reading: input.acCheckoutReading!,
            units_consumed: acCheckoutRecord.units_consumed,
            tenant_count_at_checkout: acCheckoutRecord.tenant_count,
            ac_charge: acCheckoutRecord.ac_charge,
            checkout_date: input.checkoutDate,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_id,tenant_id,for_month" }
        );
      if (acReadingErr) {
        // Checkout is complete but the billing breakpoint could not be stored.
        // Month-end billing for remaining tenants may be inaccurate without it.
        acReadingWarning =
          "Checkout complete, but the AC billing breakpoint could not be saved. " +
          "Month-end billing for remaining tenants may be slightly inaccurate. Contact support.";
      }
    }

    // Step 5: Atomically decrement room occupancy — non-fatal, best-effort
    // UX-F2 + SEC-F3: replaced read-compute-write with a single atomic RPC to eliminate
    // the race window for concurrent checkouts and carry the full ownership chain.
    // Requires DB function:
    //   CREATE OR REPLACE FUNCTION decrement_room_occupancy(p_room_id uuid, p_hostel_id uuid)
    //   RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    //     UPDATE hms_rooms
    //     SET occupied = GREATEST(occupied - 1, 0),
    //         status = CASE WHEN GREATEST(occupied - 1, 0) < capacity THEN 'available' ELSE 'occupied' END
    //     WHERE id = p_room_id AND hostel_id = p_hostel_id;
    //   $$;
    if (tenant.room_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminDb as any).rpc("decrement_room_occupancy", {
        p_room_id: tenant.room_id,
        p_hostel_id: hostelId,
      });
      // Non-fatal — Supabase returns error in result object, not thrown; ignored intentionally
    }

    revalidatePath("/tenants");
    revalidatePath("/payments");
    revalidatePath("/dashboard");

    return { success: true, ...(acReadingWarning ? { warning: acReadingWarning } : {}) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
