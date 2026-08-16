"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove, requireOwnerOrPartnerTier } from "@/lib/auth";
import { getManagerContext } from "@/lib/manager-auth";
import { getAuthContext } from "@/lib/data";
import { calcFoodAddonCharge } from "@/lib/food-addon";
import { calcDailyRent, countBillableNights } from "@/lib/daily-billing";
import { computeDepositCharge, computeRegistrationFeeCharge, computeAcMaintenanceCharge } from "@/lib/payment-calc";
import { pktTodayDateString, pktYearMonth } from "@/lib/pkt-time";
import { formatCurrency, formatDayLong, formatMonthLong } from "@/lib/utils";
import { genReceiptNumber, performTenantCheckout } from "@/lib/tenant-checkout";
import { deriveOpeningReading } from "@/lib/ac-billing";
import { sendWelcomeMessageNow, type WelcomeSendResult } from "@/lib/whatsapp-welcome-action";
import { sendSeatReservedConfirmation } from "@/lib/whatsapp-seat-reserved";
import type { Payment, PackageTier, PaymentMethod, PaymentStatus, TenantDocument, DocumentType, CheckoutPaymentSettlement, CheckoutInput, CheckoutSettlement, TenantEventType, TenantFeedback } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

// Resolves the caller's active hostel for the two receipt/invoice share-link
// actions, whoever the caller is. Managers have no RLS grant and no hostelId
// from getAuthContext(), so they need their own branch — but only with
// collect_payments, and only ever scoped to their own active branch. The
// owner/partner path below is reached unchanged for every non-manager.
async function resolveShareLinkHostelId(): Promise<string> {
  const mgr = await getManagerContext();
  if (mgr) {
    if (!mgr.permissions.has("collect_payments")) {
      throw new Error("Access denied");
    }
    if (!mgr.activeHostel) throw new Error("Unauthorized: no active hostel");
    return mgr.activeHostel.id;
  }
  await requireOwnerOrPartnerTier("read_only");
  return resolveHostelId();
}

// Same "add_members" permission that gates addTenantAsManager — resending the
// welcome message is a variant of the same capability, not a new one. Owner/
// partner path mirrors addTenantAsPartner's "standard" tier.
async function resolveWelcomeMessageHostelId(): Promise<string> {
  const mgr = await getManagerContext();
  if (mgr) {
    if (!mgr.permissions.has("add_members")) throw new Error("Access denied");
    if (!mgr.activeHostel) throw new Error("Unauthorized: no active hostel");
    return mgr.activeHostel.id;
  }
  await requireOwnerOrPartnerTier("standard");
  return resolveHostelId();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    // Managers have no RLS grant and no hostelId from getAuthContext(), so the
    // owner checks below would reject them. They get the same upload as long as
    // they can add members, and the client-supplied hostelId is discarded in
    // favour of their server-resolved active branch.
    const mgr = await getManagerContext();
    if (mgr) {
      if (!mgr.permissions.has("add_members")) throw new Error("Access denied");
      if (!mgr.activeHostel) throw new Error("Unauthorized: no active hostel");
      hostelId = mgr.activeHostel.id;
    } else {
      await requireOwnerOrPartnerTier("standard");

      // Verify caller owns this hostelId
      const ownedHostelId = await resolveHostelId();
      if (ownedHostelId !== hostelId) {
        throw new Error("Forbidden: hostel does not belong to you");
      }
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

    // Admin client: partners have no storage RLS grant on this bucket, and the
    // hybrid write architecture keeps all partner writes on the service role,
    // gated by the app-level checks above instead of new RLS policies.
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: "image/webp", upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
  } catch (err: unknown) {
    unstable_rethrow(err);
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
  supabase: ReturnType<typeof createAdminClient>,
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
    await requireOwnerOrPartnerTier("full");
    const hostelId = await resolveHostelId(); // F1: caller must have an active hostel
    // Admin client: same hybrid rationale as uploadTenantPhoto above — no
    // storage/table RLS grant exists for partners, so writes go through the
    // service role gated entirely by the app-level checks in this function.
    const supabase = createAdminClient();
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
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteTenantDocument(
  tenantId: string,
  docId: string
): Promise<{ error?: string }> {
  try {
    await requireOwnerOrPartnerTier("full");
    const hostelId = await resolveHostelId(); // F1
    const supabase = createAdminClient();
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
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// F3: generate a short-lived signed URL with forced download header — never expose raw storage URL
export async function getDocumentSignedUrl(
  tenantId: string,
  docId: string
): Promise<{ url?: string; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("full");
    const hostelId = await resolveHostelId();
    const supabase = createAdminClient();
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
    unstable_rethrow(err);
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
  | "room_changed"
  | "deposit_collected"
  | "deposit_returned"
  | "deposit_forfeited"
  | "deposit_applied"
  | "notice_given"
  | "notice_cancelled"
  | "check_out"
  | "status_change"
  | "pending"
  | "partially_paid"
  | "feedback_received";

const TIMELINE_TIER_LABELS: Record<string, string> = {
  space_only: "Space Only",
  space_food: "Space + 2 Meals",
  space_3meals: "Space + 3 Meals",
  space_food_ac: "Space + Meals + AC",
  space_meals_cooler: "Space + Meals + Cooler",
};

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string; // ISO string for sorting
  label: string;
  sub?: string;
  amount?: number;
  method?: string;
  forMonth?: string;
  rentCharge?: number;
  foodCharge?: number;
  acCharge?: number;
  depositCharge?: number;
  acUnitsConsumed?: number;
  lateFee?: number;
  paymentId?: string;
  installmentId?: string;
}

export async function getTenantTimeline(
  tenantId: string
): Promise<{
  events?: TimelineEvent[];
  feedback?: TenantFeedback | null;
  // Distinct from "no feedback": it is the difference between "they ignored us"
  // and "the link never went out", and only one of those is worth chasing.
  feedbackLinkSent?: boolean;
  error?: string;
}> {
  try {
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    const [tenantRes, paymentsRes, tenantEventsRes, checkoutReadingRes, installmentsRes, feedbackRes, feedbackTokenRes] = await Promise.all([
      supabase
        .from("hms_tenants")
        .select("id, full_name, check_in, check_out, is_active, created_at, joining_meter_reading")
        .eq("id", tenantId)
        .eq("hostel_id", hostelId)
        .single(),
      supabase
        .from("hms_payments")
        .select(
          "id, for_month, amount, amount_paid, late_fee, payment_method, payment_date, status, food_charge, ac_charge, ac_units_consumed, security_deposit_charge, payment_package_tier, created_at, is_reservation"
        )
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: false }),
      supabase
        .from("hms_tenant_events")
        .select("id, event_type, from_value, to_value, amount, notes, created_at")
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: false }),
      supabase
        .from("hms_room_ac_checkout_readings")
        .select("meter_reading")
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .order("checkout_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("hms_payment_installments")
        .select("id, payment_id, amount, amount_after, total_due, payment_method, payment_date, created_at")
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: true }),
      supabase
        .from("hms_tenant_feedback")
        .select("id, hostel_id, tenant_id, food, cleanliness, staff, roommate, recommend, comment, needs_attention, acknowledged_at, created_at")
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .maybeSingle(),
      // Whether a link was ever issued. HEAD + count only: not one column of
      // this table is ever selected into the dashboard, so no query here can
      // carry a credential into a page payload. The admin client is required
      // because the token table runs RLS with zero policies by design — it is
      // scoped to the already-resolved hostelId and returns a number.
      createAdminClient()
        .from("hms_feedback_tokens")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId),
    ]);

    if (tenantRes.error || !tenantRes.data) throw new Error("Tenant not found or access denied");
    if (paymentsRes.error) throw new Error(paymentsRes.error.message);

    const tenant = tenantRes.data;
    const payments = paymentsRes.data;
    const tenantEvents = tenantEventsRes.data ?? [];
    const checkoutReading = checkoutReadingRes.data;
    const installmentsByPayment = new Map<string, NonNullable<typeof installmentsRes.data>>();
    for (const inst of installmentsRes.data ?? []) {
      const list = installmentsByPayment.get(inst.payment_id) ?? [];
      list.push(inst);
      installmentsByPayment.set(inst.payment_id, list);
    }

    const events: TimelineEvent[] = [];

    // "Joined" event from check_in date
    events.push({
      id: `joined-${tenant.id}`,
      type: "joined",
      date: tenant.check_in ?? tenant.created_at,
      label: "Checked in",
      sub: tenant.joining_meter_reading != null
        ? `Tenant joined the hostel · AC meter at move-in: ${tenant.joining_meter_reading}`
        : "Tenant joined the hostel",
    });

    // Check-out event
    if (tenant.check_out && !tenant.is_active) {
      events.push({
        id: `checkout-${tenant.id}`,
        type: "check_out",
        date: tenant.check_out,
        label: "Checked out",
        sub: checkoutReading?.meter_reading != null
          ? `Tenant left the hostel · AC meter at checkout: ${checkoutReading.meter_reading}`
          : "Tenant left the hostel",
      });
    }

    // Payment events (only paid/waived are meaningful for timeline)
    for (const p of payments ?? []) {
      const eventDate = p.payment_date ?? p.created_at;
      const totalPaid =
        Number(p.amount) + Number(p.late_fee ?? 0);
      const installments = installmentsByPayment.get(p.id) ?? [];

      if ((p.status === "paid" || p.status === "partially_paid") && installments.length > 0) {
        // One event PER actual transaction, using each installment's own immutable
        // snapshot — a later top-up no longer collapses/erases an earlier one's
        // own date, method and amount into a single cumulative event.
        const foodChargeVal = p.food_charge != null ? Number(p.food_charge) : 0;
        const acChargeVal = p.ac_charge != null ? Number(p.ac_charge) : 0;
        const depositChargeVal = p.security_deposit_charge != null ? Number(p.security_deposit_charge) : 0;
        const lateFeeVal = Number(p.late_fee ?? 0);
        const rentCharge = Number(p.amount) - foodChargeVal - acChargeVal - depositChargeVal;

        installments.forEach((inst) => {
          const methodLabel = inst.payment_method
            ? inst.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : undefined;
          const instAmount = Number(inst.amount);
          const dueAfterThis = Math.max(0, Number(inst.total_due) - Number(inst.amount_after));
          const completesPayment = dueAfterThis <= 0.01;

          events.push({
            id: `installment-${inst.id}`,
            type: completesPayment ? "payment" : "partially_paid",
            date: inst.payment_date ?? inst.created_at,
            // Same reason as the no-installment branch below: "paid" against a
            // month the tenant has not lived in reads as that month's rent
            // being settled.
            label: p.is_reservation
              ? `Rs. ${instAmount.toLocaleString()} received to reserve a bed`
              : completesPayment
                ? `Rs. ${instAmount.toLocaleString()} paid`
                : `Rs. ${instAmount.toLocaleString()} received (partial)`,
            sub: completesPayment
              ? `${p.for_month}${methodLabel ? " · " + methodLabel : ""}`
              : `${p.for_month}${methodLabel ? " · " + methodLabel : ""} · Rs. ${dueAfterThis.toLocaleString()} remaining of Rs. ${Number(inst.total_due).toLocaleString()}`,
            amount: instAmount,
            method: methodLabel,
            forMonth: p.for_month,
            // Rent/food/AC breakdown describes the whole bill's composition, not
            // this one installment's share of it — only attach it to the
            // installment that actually completes the bill (mirrors the
            // fully-paid-only breakdown rule used elsewhere in the app).
            rentCharge: completesPayment ? rentCharge : undefined,
            foodCharge: completesPayment && foodChargeVal > 0 ? foodChargeVal : undefined,
            acCharge: completesPayment && acChargeVal > 0 ? acChargeVal : undefined,
            depositCharge: completesPayment && depositChargeVal > 0 ? depositChargeVal : undefined,
            acUnitsConsumed: completesPayment && p.ac_units_consumed != null ? Number(p.ac_units_consumed) : undefined,
            lateFee: completesPayment && lateFeeVal > 0 ? lateFeeVal : undefined,
            paymentId: p.id,
            installmentId: inst.id,
          });
        });
      } else if (p.status === "paid") {
        // Fallback for payments marked paid without an installment snapshot
        // (pre-dates this feature, or written by a code path that doesn't
        // record installments: manager quick-record, backfill, checkout settlement).
        const methodLabel =
          p.payment_method
            ? p.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : undefined;
        // Decompose the paid amount into its components — the receipt shows this
        // breakdown, and lumping it into one number here hides that the total
        // isn't just rent (and never includes the deposit, which is its own event).
        const foodChargeVal = p.food_charge != null ? Number(p.food_charge) : 0;
        const acChargeVal = p.ac_charge != null ? Number(p.ac_charge) : 0;
        const depositChargeVal = p.security_deposit_charge != null ? Number(p.security_deposit_charge) : 0;
        const lateFeeVal = Number(p.late_fee ?? 0);
        const rentCharge = Number(p.amount) - foodChargeVal - acChargeVal - depositChargeVal;
        events.push({
          id: `payment-${p.id}`,
          type: "payment",
          date: eventDate,
          // A reservation is money taken to hold a bed, not a month's rent being
          // settled. Unlabelled it reads as "July was paid" on the timeline, which
          // is the same confusion the WhatsApp text was reworded to avoid.
          label: p.is_reservation
            ? `Rs. ${totalPaid.toLocaleString()} received to reserve a bed`
            : `Rs. ${totalPaid.toLocaleString()} paid`,
          sub: `${p.for_month}${methodLabel ? " · " + methodLabel : ""}`,
          amount: totalPaid,
          method: methodLabel,
          forMonth: p.for_month,
          rentCharge,
          foodCharge: foodChargeVal > 0 ? foodChargeVal : undefined,
          acCharge: acChargeVal > 0 ? acChargeVal : undefined,
          depositCharge: depositChargeVal > 0 ? depositChargeVal : undefined,
          acUnitsConsumed: p.ac_units_consumed != null ? Number(p.ac_units_consumed) : undefined,
          lateFee: lateFeeVal > 0 ? lateFeeVal : undefined,
          paymentId: p.id,
        });
      } else if (p.status === "partially_paid") {
        // Fallback for the same reason as above — no installment rows recorded.
        const methodLabel =
          p.payment_method
            ? p.payment_method.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : undefined;
        const amountPaidVal = Number(p.amount_paid ?? 0);
        const fullDue = Number(p.amount) + Number(p.late_fee ?? 0);
        const remaining = Math.max(0, fullDue - amountPaidVal);
        events.push({
          id: `partial-${p.id}`,
          type: "partially_paid",
          date: eventDate,
          label: `Rs. ${amountPaidVal.toLocaleString()} received (partial)`,
          sub: `${p.for_month}${methodLabel ? " · " + methodLabel : ""} · Rs. ${remaining.toLocaleString()} remaining of Rs. ${fullDue.toLocaleString()}`,
          amount: amountPaidVal,
          method: methodLabel,
          forMonth: p.for_month,
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
        // Use billing month start as the date — more meaningful than created_at —
        // EXCEPT for the tenant's first billing month, where the month start can
        // predate their actual check-in (e.g. joined the 14th, month starts the 1st),
        // making a mid-month joiner look like they owed rent before they existed.
        // Anchor to check_in instead when this payment is for that first month.
        const isFirstBillingMonth = tenant.check_in && tenant.check_in.slice(0, 7) === p.for_month;
        const pendingDate = isFirstBillingMonth ? tenant.check_in! : `${p.for_month}-01`;
        events.push({
          id: `pending-${p.id}`,
          type: "pending",
          date: pendingDate,
          label: `Rs. ${totalPaid.toLocaleString()} ${p.status === "overdue" ? "overdue" : "due"}`,
          sub: `${p.for_month} · ${p.status === "overdue" ? "Overdue — not yet collected" : "Pending — not yet collected"}`,
          amount: totalPaid,
          forMonth: p.for_month,
          paymentId: p.id,
        });
      }
    }

    // Room/plan changes and deposit events (from hms_tenant_events — captured going
    // forward only; changes made before this table existed are not recoverable)
    for (const e of tenantEvents) {
      if (e.event_type === "room_changed") {
        events.push({
          id: `event-${e.id}`,
          type: "room_changed",
          date: e.created_at,
          label: "Room changed",
          sub: `${e.from_value ?? "None"} → ${e.to_value ?? "None"}`,
        });
      } else if (e.event_type === "plan_changed") {
        const fromLabel = TIMELINE_TIER_LABELS[e.from_value ?? ""] ?? e.from_value ?? "Unknown";
        const toLabel = TIMELINE_TIER_LABELS[e.to_value ?? ""] ?? e.to_value ?? "Unknown";
        events.push({
          id: `event-${e.id}`,
          type: "package_changed",
          date: e.created_at,
          label: "Plan changed",
          sub: `${fromLabel} → ${toLabel}`,
        });
      } else if (e.event_type === "deposit_collected") {
        events.push({
          id: `event-${e.id}`,
          type: "deposit_collected",
          date: e.created_at,
          label: `Rs. ${Number(e.amount ?? 0).toLocaleString()} deposit collected`,
          sub: e.notes ?? undefined,
          amount: e.amount != null ? Number(e.amount) : undefined,
        });
      } else if (e.event_type === "deposit_returned") {
        events.push({
          id: `event-${e.id}`,
          type: "deposit_returned",
          date: e.created_at,
          label: `Rs. ${Number(e.amount ?? 0).toLocaleString()} deposit returned`,
          sub: e.notes ?? undefined,
          amount: e.amount != null ? Number(e.amount) : undefined,
        });
      } else if (e.event_type === "deposit_forfeited") {
        events.push({
          id: `event-${e.id}`,
          type: "deposit_forfeited",
          date: e.created_at,
          label: `Rs. ${Number(e.amount ?? 0).toLocaleString()} deposit forfeited`,
          sub: e.notes ?? undefined,
          amount: e.amount != null ? Number(e.amount) : undefined,
        });
      } else if (e.event_type === "deposit_applied") {
        events.push({
          id: `event-${e.id}`,
          type: "deposit_applied",
          date: e.created_at,
          label: `Rs. ${Number(e.amount ?? 0).toLocaleString()} deposit applied to dues`,
          sub: e.notes ?? undefined,
          amount: e.amount != null ? Number(e.amount) : undefined,
        });
      } else if (e.event_type === "notice_given") {
        events.push({
          id: `event-${e.id}`,
          type: "notice_given",
          date: e.created_at,
          label: "Notice given",
          sub: e.to_value ? `Intends to check out on ${e.to_value}` : undefined,
        });
      } else if (e.event_type === "notice_cancelled") {
        events.push({
          id: `event-${e.id}`,
          type: "notice_cancelled",
          date: e.created_at,
          label: "Notice cancelled",
          sub: e.from_value ? `Was intending to check out on ${e.from_value}` : undefined,
        });
      }
    }

    // The deposit is billed as security_deposit_charge on the tenant's first
    // bill, so a paid bill already itemises it ("Rent: Rs 5,500 · Deposit:
    // Rs 8,000"). Emitting the standalone deposit_collected event alongside it
    // showed the SAME Rs 8,000 twice and read as two separate collections. The
    // bill is the authoritative record of money actually changing hands, so it
    // wins and the standalone entry is dropped.
    //
    // Only deposit_collected is de-duplicated. deposit_applied / _returned /
    // _forfeited at checkout are genuinely distinct movements of that money and
    // are never itemised on a bill, so they stay.
    // Keyed off the BILL, not off which timeline entries happened to get a
    // breakdown. A partially-paid bill attaches depositCharge only to the
    // installment that completes it, so deriving this from events missed the
    // partial case and showed the deposit twice — once as "deposit collected"
    // and again inside the payment.
    //
    // Suppressing it whenever the deposit is billed at all (paid, partial or
    // pending) is right because deposit_collected is not an independent record
    // of money changing hands: all three add-tenant paths emit it automatically
    // at creation, purely because security_deposit > 0, before anything has
    // been collected. It is really "deposit charged", and the bill already says
    // that. The header badge still shows the deposit currently held.
    const depositIsOnABill = (payments ?? []).some(
      (p) => Number(p.security_deposit_charge ?? 0) > 0
    );
    // Mutate in place ONLY when there is something to remove. An earlier version
    // assigned `events` itself to a local in the else branch and then cleared
    // `events` before re-pushing — same array reference, so the clear emptied
    // both and every tenant without a fully-paid deposit bill lost their entire
    // timeline.
    if (depositIsOnABill) {
      const kept = events.filter((e) => e.type !== "deposit_collected");
      events.length = 0;
      events.push(...kept);
    }

    // The dated fact belongs in history too. The answers themselves are shown
    // in the summary block above the timeline, not here — this is a "when".
    if (feedbackRes.data) {
      events.push({
        id: `feedback-${feedbackRes.data.id}`,
        type: "feedback_received",
        date: feedbackRes.data.created_at,
        label: "Shared checkout feedback",
      });
    }

    // Sort newest first; same-day ties broken by a logical same-day order
    // (e.g. deposit collected reads before that day's rent payment, not after)
    const SAME_DAY_PRIORITY: Record<TimelineEventType, number> = {
      joined: 0,
      deposit_collected: 1,
      room_changed: 2,
      package_changed: 2,
      notice_given: 2,
      notice_cancelled: 2,
      payment: 3,
      partially_paid: 3,
      pending: 4,
      status_change: 5,
      // Dues are cleared from the deposit before whatever is left is settled up.
      deposit_applied: 6,
      deposit_returned: 7,
      deposit_forfeited: 7,
      check_out: 8,
      feedback_received: 9,
    };
    events.sort((a, b) => {
      // Compare by calendar day, not exact millisecond timestamp — events logged
      // at different times of the same day (e.g. a date-only "joined" value vs. a
      // real created_at timestamp) must still tie-break by SAME_DAY_PRIORITY rather
      // than by incidental time-of-day differences.
      const dayA = new Date(a.date).toISOString().slice(0, 10);
      const dayB = new Date(b.date).toISOString().slice(0, 10);
      if (dayB !== dayA) return dayB < dayA ? -1 : 1;
      return SAME_DAY_PRIORITY[a.type] - SAME_DAY_PRIORITY[b.type];
    });

    const feedback = (feedbackRes.data as TenantFeedback | null) ?? null;

    return {
      events,
      feedback,
      feedbackLinkSent: (feedbackTokenRes.count ?? 0) > 0,
    };
  } catch (err: unknown) {
    unstable_rethrow(err);
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
    // read_only, not just standard+: this only packages data the caller can
    // already see (payments are partner-readable at every tier) into a
    // shareable link — it's the same class of action as Reports' exports,
    // not a mutation of tenant/payment state. Admin client because partners
    // have no write RLS grant on hms_invoice_links.
    const hostelId = await resolveShareLinkHostelId();
    const supabase = createAdminClient();

    // Verify the payment belongs to the caller's hostel
    const { data: payment, error: pErr } = await supabase
      .from("hms_payments")
      .select("id, hostel_id, status")
      .eq("id", paymentId)
      .eq("hostel_id", hostelId)
      .single();

    if (pErr || !payment) throw new Error("Payment not found or access denied");
    // Partial payments get a receipt too (showing amount received + remaining balance) —
    // only a payment with nothing collected at all (pending/overdue/waived) has none.
    if (payment.status !== "paid" && payment.status !== "partially_paid") {
      throw new Error("Cannot generate a receipt for a payment that hasn't been collected yet.");
    }

    // Reuse the existing link rather than minting another permanent public
    // token on every click. Previously this inserted unconditionally, so the
    // table had grown to 210 rows covering only 99 payments — every extra row
    // being a never-expiring receipt URL that could not be accounted for or
    // revoked. Oldest first, so the token already shared over WhatsApp stays
    // the canonical one and keeps working.
    const { data: existing } = await supabase
      .from("hms_invoice_links")
      .select("token")
      .eq("payment_id", paymentId)
      .eq("hostel_id", hostelId)
      .is("installment_id", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing?.token) return { token: existing.token as string };

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
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// createInstallmentReceiptLink
// A receipt scoped to ONE specific installment snapshot rather than the live,
// mutable hms_payments row — so it keeps showing "Rs X received, Rs Y
// remaining" exactly as it was at the time, even after later installments
// change the payment's current cumulative state.
// ---------------------------------------------------------------------------

export async function createInstallmentReceiptLink(
  installmentId: string
): Promise<{ token?: string; error?: string }> {
  try {
    // Same rationale as createInvoiceLink above — read_only, admin client.
    const hostelId = await resolveShareLinkHostelId();
    const supabase = createAdminClient();

    const { data: installment, error: iErr } = await supabase
      .from("hms_payment_installments")
      .select("id, hostel_id")
      .eq("id", installmentId)
      .eq("hostel_id", hostelId)
      .single();

    if (iErr || !installment) throw new Error("Payment record not found or access denied");

    // Same reuse rule as createInvoiceLink — see the rationale there.
    const { data: existing } = await supabase
      .from("hms_invoice_links")
      .select("token")
      .eq("installment_id", installmentId)
      .eq("hostel_id", hostelId)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing?.token) return { token: existing.token as string };

    const { data, error } = await supabase
      .from("hms_invoice_links")
      .insert({ installment_id: installmentId, hostel_id: hostelId })
      .select("token")
      .single();

    if (error) throw new Error(error.message);
    return { token: (data as { token: string }).token };
  } catch (err: unknown) {
    unstable_rethrow(err);
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
  // Pakistan-anchored, not the server process's own OS timezone — Vercel's
  // serverless functions default to UTC, which can silently disagree with
  // Pakistan on what "this month" is (and therefore which months count as
  // "past" here).
  const { year: curYear, month: curMonth } = pktYearMonth(); // curMonth is 1-indexed
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

export async function backfillTenantPaymentsAction(
  tenantId: string
): Promise<{ success: boolean; monthsCreated?: number; error?: string }> {
  try {
    // Full tier — this rewrites historical payment records, same class of
    // action as checkout, not a day-to-day operation.
    await requireOwnerOrPartnerTier("full");
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("Unauthorized");
    const { hostelId } = ctx;

    const adminDb = createAdminClient();

    // Fetch tenant — verify it belongs to this hostel
    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("id, full_name, hostel_id, room_id, check_in, check_out, monthly_rent, daily_rate, security_deposit, deposit_collected_amount, registration_fee, package_tier, billing_type, food_breakfast, food_lunch, food_dinner, ac_maintenance")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();

    // PGRST116 is the only code that means "no row matched". Anything else is
    // the query failing, and reporting that as "Tenant not found" is how a
    // missing column reads to an owner as a tenant who has vanished.
    if (tenantErr && tenantErr.code !== "PGRST116") {
      throw new Error(`Could not read the tenant record: ${tenantErr.message}`);
    }
    if (!tenant) throw new Error("Tenant not found");
    if (!tenant.check_in) return { success: true, monthsCreated: 0 };

    const pastMonths = getPastMonths(tenant.check_in);
    if (pastMonths.length === 0) return { success: true, monthsCreated: 0 };

    // Get food + AC maintenance rates from package config, and whether this
    // tenant's room has AC (constant across every backfilled month, unlike
    // the registration fee which only applies in the check-in month).
    const [{ data: pkgConfig }, { data: roomData }] = await Promise.all([
      adminDb
        .from("hms_package_configs")
        .select("food_monthly_rate, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, ac_maintenance_rate")
        .eq("hostel_id", hostelId)
        .single(),
      tenant.room_id
        ? adminDb.from("hms_rooms").select("has_ac").eq("id", tenant.room_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const foodRate = Number(pkgConfig?.food_monthly_rate ?? 0);
    const tierFoodCharge = FOOD_TIERS.has(tenant.package_tier ?? "") ? foodRate : 0;
    const addonFoodCharge = pkgConfig ? calcFoodAddonCharge(tenant, pkgConfig) : 0;
    const foodCharge = tierFoodCharge + addonFoodCharge;
    const acMaintenanceCharge = computeAcMaintenanceCharge(
      roomData?.has_ac,
      pkgConfig?.ac_maintenance_rate,
      tenant.ac_maintenance
    );
    const isDaily = tenant.billing_type === "daily";
    const checkIn = tenant.check_in.slice(0, 10);
    const checkOut = (tenant.check_out as string | null)?.slice(0, 10) ?? null;
    const dailyRate = Number(tenant.daily_rate ?? 0);

    // Daily tenants used to be skipped outright here, so they had no history at
    // all and read as absent from reports and the Member Ledger. Their rent is
    // per-month nights × rate; months the stay never touched produce 0 and are
    // dropped rather than written as empty rows.
    const rows = pastMonths.flatMap((month) => {
      const nights = isDaily
        ? countBillableNights({ checkIn, checkOut, month })
        : null;
      if (isDaily && nights === 0) return [];

      const baseRent = isDaily
        ? calcDailyRent({ checkIn, checkOut, month, dailyRate })
        : Number(tenant.monthly_rent);

      // Deposit and registration fee are billed once, on the check-in month
      // only. Shared helpers rather than an inline copy — the inline version
      // could not see deposit_collected_on and would re-bill a deposit already
      // collected as a seat reservation.
      const depositCharge = computeDepositCharge(tenant, month);
      const registrationFeeCharge = computeRegistrationFeeCharge(tenant, month);
      const monthAmount = baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge;

      // Monthly tenants are recorded as already settled: the backfill exists to
      // enter a resident who has been paying all along into the system, so their
      // history really is collected money. That assumption does NOT carry over to
      // daily tenants — a back-dated daily check-in is just as likely to be
      // someone who arrived a few days ago and hasn't paid yet. Booking that as
      // collected would overstate revenue in reports and the Member Ledger with
      // nothing on screen to reveal it. An outstanding due the owner can see and
      // clear is recoverable; silently fabricated income is not.
      const settlement = isDaily
        ? {
            status: "pending" as const,
            amount_paid: 0,
            payment_method: null,
            payment_date: null,
            receipt_number: null,
          }
        : {
            status: "paid" as const,
            amount_paid: monthAmount,
            payment_method: "cash" as const,
            payment_date: lastDayOfMonth(month),
            receipt_number: genReceiptNumber(tenant.full_name, month),
          };

      return [{
        hostel_id: hostelId,
        tenant_id: tenantId,
        for_month: month,
        amount: monthAmount,
        food_charge: foodCharge,
        ac_charge: 0,
        security_deposit_charge: depositCharge,
        registration_fee_charge: registrationFeeCharge,
        ac_maintenance_charge: acMaintenanceCharge,
        late_fee: 0,
        ...settlement,
        payment_package_tier: tenant.package_tier,
        billed_days: nights,
        daily_rate_billed: isDaily ? dailyRate : null,
        ...(depositCharge > 0 ? { notes: `Security deposit: Rs ${depositCharge} (paid on joining)` } : {}),
      }];
    });

    if (rows.length === 0) return { success: true, monthsCreated: 0 };

    // ignoreDuplicates: never overwrite if somehow a record already exists
    const { error } = await adminDb
      .from("hms_payments")
      .upsert(rows, { onConflict: "tenant_id,for_month", ignoreDuplicates: true });

    if (error) throw error;

    revalidatePath("/payments");
    return { success: true, monthsCreated: rows.length };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// recordReservationDepositAction
// An owner takes a deposit to HOLD a bed for a waiting-list tenant who joins
// later. It lives in tenants.ts rather than payments.ts because it is a tenant
// lifecycle event, not a monthly-bill mutation: it flips
// hms_tenants.deposit_collected_on, writes the Member Ledger event, and is
// driven entirely from the Tenants page's waiting list. Every other action that
// writes hms_payments as a side effect of a tenant lifecycle step
// (backfillTenantPaymentsAction, checkoutTenantAction) already lives here too.
//
// The row it writes is deliberately NOT a monthly bill: is_reservation = true,
// for_month = the month the CASH was taken (so it lands in that month's
// Payments page and Collected figure), and the tenant's own rent cycle still
// starts from check_in untouched.
// ---------------------------------------------------------------------------

const VALID_RESERVATION_METHODS = new Set<string>(["cash", "bank_transfer", "jazzcash", "easypaisa", "sadapay", "other"]);
// Same ceiling app/actions/payments.ts applies to every other money field.
const MAX_RESERVATION_AMOUNT = 9_999_999.99;

export interface RecordReservationDepositInput {
  tenantId: string;
  amount: number;
  collectedOn: string;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export async function recordReservationDepositAction(
  input: RecordReservationDepositInput
): Promise<{ success: boolean; paymentId?: string; receiptNumber?: string; collectedOn?: string; amount?: number; remainingDeposit?: number; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_RESERVATION_AMOUNT) {
      throw new Error(`Deposit amount must be a positive number no greater than ${MAX_RESERVATION_AMOUNT.toLocaleString()}.`);
    }
    if (!VALID_RESERVATION_METHODS.has(input.paymentMethod)) {
      throw new Error(`Invalid payment method: "${input.paymentMethod}"`);
    }
    if (!DATE_RE.test(input.collectedOn)) throw new Error("Invalid collection date format");
    // Built from parts rather than Date.parse: "2026-02-30" parses happily and
    // rolls over to 2 March, and a UTC round-trip shifts the day in PKT.
    const [cy, cm, cd] = input.collectedOn.split("-").map(Number);
    const collected = new Date(cy, cm - 1, cd);
    if (collected.getFullYear() !== cy || collected.getMonth() !== cm - 1 || collected.getDate() !== cd) {
      throw new Error("Invalid collection date");
    }
    if (input.collectedOn > pktTodayDateString()) {
      throw new Error("Collection date cannot be in the future.");
    }
    const notes = input.notes?.trim() ? input.notes.trim().slice(0, 500) : null;
    const forMonth = input.collectedOn.slice(0, 7);

    const [{ data: tenant, error: tenantErr }, { data: existingReservations, error: existingErr }] = await Promise.all([
      adminDb
        .from("hms_tenants")
        .select("id, full_name, check_in, is_waiting, security_deposit, deposit_collected_on, deposit_collected_amount")
        .eq("id", input.tenantId)
        .eq("hostel_id", hostelId)
        .maybeSingle(),
      adminDb
        .from("hms_payments")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("hostel_id", hostelId)
        .eq("is_reservation", true)
        .limit(1),
    ]);

    if (tenantErr) throw new Error(tenantErr.message);
    if (!tenant) throw new Error("Tenant not found or access denied");
    if (existingErr) throw new Error(existingErr.message);
    if ((existingReservations ?? []).length > 0) {
      throw new Error(`A reservation deposit has already been recorded for ${tenant.full_name}.`);
    }
    if (tenant.deposit_collected_on) {
      throw new Error(
        `${tenant.full_name}'s deposit was already collected on ${formatDayLong(tenant.deposit_collected_on)}.`
      );
    }
    if (!tenant.is_waiting) {
      throw new Error("Reservation deposits are only for waiting-list tenants — an active tenant's deposit is billed on their first monthly bill.");
    }
    // Overpaying a deposit is a typo, not a business case. The deposit itself is
    // what the tenant gets back at checkout, and taking more than that would
    // either quietly under-refund them or turn the excess into an unexplained
    // credit that nothing in the system knows how to spend.
    const agreedDeposit = Number(tenant.security_deposit ?? 0);
    if (agreedDeposit <= 0) {
      throw new Error(
        `${tenant.full_name} has no security deposit set, so there is nothing to collect. ` +
        `Set the deposit on their profile first.`
      );
    }
    if (amount > agreedDeposit) {
      throw new Error(
        `${tenant.full_name}'s deposit is ${formatCurrency(agreedDeposit)}, so ${formatCurrency(amount)} is more than the whole deposit. ` +
        `Enter ${formatCurrency(agreedDeposit)} or less, or change the deposit on their profile first.`
      );
    }
    // hms_payments is unique on (tenant_id, for_month), so a reservation taken
    // in the same month the tenant joins would occupy the slot their first rent
    // bill needs — and the monthly sync skips paid rows, so that bill would
    // never be created at all. A deposit collected in the joining month is
    // simply the normal first-bill deposit, which is already handled.
    if (tenant.check_in && forMonth >= tenant.check_in.slice(0, 7)) {
      const joinMonth = tenant.check_in.slice(0, 7);
      throw new Error(
        `${tenant.full_name} joins on ${formatDayLong(tenant.check_in)}, so ${formatMonthLong(joinMonth)} is their first rent month. ` +
        `A deposit recorded in ${formatMonthLong(forMonth)} would take the place of that rent bill and the rent would never be charged. ` +
        `Use a date before ${formatDayLong(`${joinMonth}-01`)}, or leave the deposit to be charged on their first bill.`
      );
    }

    const receiptNumber = genReceiptNumber(tenant.full_name, forMonth);

    const { data: inserted, error: insertErr } = await adminDb
      .from("hms_payments")
      .insert({
        hostel_id: hostelId,
        tenant_id: input.tenantId,
        for_month: forMonth,
        is_reservation: true,
        amount,
        amount_paid: amount,
        security_deposit_charge: amount,
        registration_fee_charge: 0,
        food_charge: 0,
        ac_charge: 0,
        ac_units_consumed: 0,
        ac_maintenance_charge: 0,
        late_fee: 0,
        status: "paid" as PaymentStatus,
        payment_method: input.paymentMethod,
        payment_date: input.collectedOn,
        receipt_number: receiptNumber,
        notes,
        billed_days: null,
        daily_rate_billed: null,
      })
      .select("id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        throw new Error(`${tenant.full_name} already has a payment record for ${formatMonthLong(forMonth)}.`);
      }
      throw new Error(insertErr.message);
    }
    const paymentId = (inserted as { id: string }).id;

    // The daily register on Reports → Today, and the Member Ledger's payment
    // entries, are both built from hms_payment_installments keyed on
    // payment_date — NOT from hms_payments. Writing only the payment row above
    // meant real cash taken today showed "No payments collected on 3 Aug 2026"
    // with Income Rs 0, which is precisely the register an owner checks their
    // physical cash box against. Mirrors markPaymentPaidAction's snapshot: a
    // reservation is always a single, full, first payment against its row, so
    // before = 0, after = total = the amount.
    const { error: installmentErr } = await adminDb.from("hms_payment_installments").insert({
      hostel_id: hostelId,
      tenant_id: input.tenantId,
      payment_id: paymentId,
      for_month: forMonth,
      amount,
      amount_before: 0,
      amount_after: amount,
      total_due: amount,
      late_fee: 0,
      payment_method: input.paymentMethod,
      payment_date: input.collectedOn,
      notes,
      receipt_number: receiptNumber,
    });
    if (installmentErr) {
      // Non-fatal, same call as markPaymentPaidAction makes: the money is
      // already recorded on the payment row, so failing here costs the daily
      // register entry, not the cash.
      console.error("[recordReservationDepositAction] Failed to record payment installment:", installmentErr.message);
    }

    // The AMOUNT, not a flag. A part payment leaves the balance to be billed on
    // the first monthly bill (computeDepositCharge subtracts this from
    // security_deposit); a flag would have written the shortfall off.
    // security_deposit is deliberately NOT touched — it stays the agreed figure
    // that checkout refunds in full.
    const { data: updatedTenant, error: updateErr } = await adminDb
      .from("hms_tenants")
      .update({ deposit_collected_on: input.collectedOn, deposit_collected_amount: amount })
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId)
      .select("id");

    // Without the flag the deposit gets billed again on the first real bill,
    // which is the entire bug this feature exists to prevent — so an orphaned
    // paid row is worse than no row at all. Undo it and make the operator retry.
    if (updateErr || !updatedTenant?.length) {
      const { error: rollbackErr } = await adminDb
        .from("hms_payments").delete().eq("id", paymentId).eq("hostel_id", hostelId);
      if (rollbackErr) {
        throw new Error(
          `The deposit could not be marked as collected AND the payment row could not be rolled back ` +
          `(receipt ${receiptNumber}). Delete it manually before retrying. Cause: ${rollbackErr.message}`
        );
      }
      throw new Error(updateErr?.message ?? "Failed to mark the deposit as collected. Nothing was saved — please try again.");
    }

    // Best-effort Member Ledger entry, same as every other logTenantEvent call
    // site — a failed audit line must not undo money that was actually taken.
    const logResult = await logTenantEvent({
      tenantId: input.tenantId,
      eventType: "deposit_collected",
      amount,
      notes: `Seat reservation deposit received ${formatDayLong(input.collectedOn)}${notes ? ` — ${notes}` : ""}`,
    });
    if (!logResult.success) {
      console.error("[recordReservationDepositAction] Failed to log deposit_collected:", logResult.error);
    }

    // One-time by construction: this action throws above if the deposit was
    // already collected, so its success path runs at most once per tenant.
    // Fire-and-forget — the money is banked, and Meta must never undo that.
    void sendSeatReservedConfirmation(input.tenantId);

    revalidatePath("/tenants");
    revalidatePath("/payments");
    return {
      success: true,
      paymentId,
      receiptNumber,
      collectedOn: input.collectedOn,
      amount,
      remainingDeposit: Math.max(0, agreedDeposit - amount),
    };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getCheckoutPendingPaymentAction
// The checkout dialog's "outstanding balance" lookup used to run as a plain
// client-side Supabase query. hms_payments only has RLS SELECT policies for
// owners (owner_id = auth.uid()) and partners (hms_partner_hostel_ids()) —
// there is no manager policy — so for any manager-initiated checkout that
// query silently returned zero rows, and the dialog always showed "nothing
// outstanding" regardless of the tenant's real balance. Moved server-side so
// it can go through the admin client, the same fix applied to
// getACCheckoutContextAction just above for the same underlying reason.
// ---------------------------------------------------------------------------

export async function getCheckoutPendingPaymentAction(
  tenantId: string,
  maxMonth: string,
): Promise<{
  payment?: {
    id: string; for_month: string; status: PaymentStatus; amount: number; amount_paid: number;
    late_fee: number; ac_charge: number; ac_units_consumed: number | null;
    food_charge: number; security_deposit_charge: number;
    registration_fee_charge: number; ac_maintenance_charge: number;
  } | null;
  error?: string;
}> {
  try {
    const mgr = await getManagerContext();
    let hostelId: string;
    if (mgr?.activeHostel) {
      if (!mgr.permissions.has("edit_members")) throw new Error("Access denied");
      hostelId = mgr.activeHostel.id;
    } else {
      await requireOwnerOrPartnerTier("standard");
      hostelId = await resolveHostelId();
    }
    const adminDb = createAdminClient();

    const { data, error } = await adminDb
      .from("hms_payments")
      .select("id, for_month, status, amount, amount_paid, late_fee, ac_charge, ac_units_consumed, food_charge, security_deposit_charge, registration_fee_charge, ac_maintenance_charge")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      // partially_paid included too — a genuine remaining balance (e.g. AC
      // usage billed after an advance rent payment already settled the rest)
      // is still real money to collect at checkout, not just a fully-unpaid row.
      .in("status", ["pending", "overdue", "partially_paid"])
      // Excludes a future month's not-yet-due advance-payment row — only a
      // month the tenant is actually departing in (or already past) can be a
      // real debt to collect at checkout.
      .lte("for_month", maxMonth)
      .order("for_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { payment: null };

    return {
      payment: {
        id: data.id,
        for_month: data.for_month,
        status: data.status as PaymentStatus,
        amount: Number(data.amount ?? 0),
        amount_paid: Number(data.amount_paid ?? 0),
        late_fee: Number(data.late_fee ?? 0),
        ac_charge: Number(data.ac_charge ?? 0),
        ac_units_consumed: data.ac_units_consumed != null ? Number(data.ac_units_consumed) : null,
        food_charge: Number(data.food_charge ?? 0),
        security_deposit_charge: Number(data.security_deposit_charge ?? 0),
        // Both are part of the row total and are never day-scaled, so the
        // pro-rate preview must subtract them when isolating base rent —
        // omitting them made the dialog quote Rs 3,000-5,000 under the server.
        registration_fee_charge: Number(data.registration_fee_charge ?? 0),
        ac_maintenance_charge: Number(data.ac_maintenance_charge ?? 0),
      },
    };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to load payment data" };
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
  /**
   * Arrival point of everyone still in the room, so the preview can segment the month
   * the way the server does. unitsAtJoin is already an offset; joiningMeterReading is
   * absolute and only set for tenants who arrived THIS month — the caller subtracts
   * whichever opening reading is in play, which may be one the operator is still typing.
   */
  joiners: { tenantId: string; unitsAtJoin: number | null; joiningMeterReading: number | null }[];
  /**
   * Raw inputs for computeACSegmentBilling (lib/ac-billing.ts) — the exact same
   * function the Payments page's AC Units tab bills with. Surfaced so the
   * checkout preview can call it directly instead of re-deriving the same
   * segment math in its own copy, which is how the dialog's estimate drifted
   * away from what the AC Units tab had already computed for the same room.
   */
  eligibleTenants: { id: string; check_in: string; joining_meter_reading: number | null }[];
  joinReadingsRaw: { tenant_id: string; units_at_join: number }[];
  checkoutReadingsRaw: { meter_reading: number; tenant_count_at_checkout: number }[];
  /** This month's meter reading, if the operator already applied AC units for
   *  this room via the AC Units tab (e.g. earlier the same day the tenant is
   *  checking out) — surfaced so the checkout dialog can default to it instead
   *  of leaving the operator to re-type a reading they already entered once. */
  currentMonthReading: number | null;
  /** Total units that reading was actually split against. Combined with
   *  currentMonthReading, lets the checkout preview back out the EXACT opening
   *  baseline the AC Units tab used (reading - units) instead of re-deriving its
   *  own — which can legitimately differ (e.g. a manually typed opening
   *  override), producing a different total and a preview that disagrees with
   *  what was already billed. */
  currentMonthUnits: number | null;
  /** Earliest active tenant's move-in meter reading — the same fallback baseline
   *  performTenantCheckout derives server-side when there's no prev-month record
   *  and no opening reading typed in. Surfaced so the dialog can show it instead
   *  of leaving the operator to guess or retype a number already on file. */
  derivedOpening: number | null;
  error?: string;
}> {
  try {
    // Checkout itself (checkoutTenantAsManager, app/actions/managers.ts) is
    // reachable by a manager holding edit_members — but this preview action
    // only ever checked requireOwnerOrPartnerTier, which redirects to /login
    // for a manager role outright (managers live in hms_managers, not
    // hms_profiles, so getProfile() finds nothing for them). That silently
    // broke the AC section of the checkout dialog for every manager on every
    // AC room. Same "try manager context first" pattern already used in
    // app/actions/payments.ts's resolvePaymentsReadScope.
    const mgr = await getManagerContext();
    let hostelId: string;
    if (mgr?.activeHostel) {
      if (!mgr.permissions.has("edit_members")) throw new Error("Access denied");
      hostelId = mgr.activeHostel.id;
    } else {
      await requireOwnerOrPartnerTier("standard");
      hostelId = await resolveHostelId();
    }
    const adminDb = createAdminClient();

    const [y, m] = checkoutMonth.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

    const [{ data: prevRecord }, { data: currentRecord }, { data: config }, { data: tenants }, { data: priorCheckouts }, { data: joinRows }] = await Promise.all([
      adminDb
        .from("hms_room_ac_readings")
        .select("meter_reading, total_units")
        .eq("room_id", roomId)
        .eq("hostel_id", hostelId)
        .eq("for_month", prevMonth)
        .maybeSingle(),
      adminDb
        .from("hms_room_ac_readings")
        .select("meter_reading, total_units")
        .eq("room_id", roomId)
        .eq("hostel_id", hostelId)
        .eq("for_month", checkoutMonth)
        .maybeSingle(),
      adminDb
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle(),
      adminDb
        .from("hms_tenants")
        .select("id, check_in, joining_meter_reading")
        .eq("hostel_id", hostelId)
        .eq("room_id", roomId)
        .eq("is_active", true),
      // Fetch prior checkout unit offsets for segment-based preview calculation.
      // Each value is (checkout_meter_reading - prev_month_reading), matching
      // the same boundary format used by the month-end AC billing algorithm.
      adminDb
        .from("hms_room_ac_checkout_readings")
        .select("units_consumed, meter_reading, tenant_count_at_checkout")
        .eq("room_id", roomId)
        .eq("hostel_id", hostelId)
        .eq("for_month", checkoutMonth),
      adminDb
        .from("hms_room_ac_join_readings")
        .select("tenant_id, units_at_join")
        .eq("room_id", roomId)
        .eq("hostel_id", hostelId)
        .eq("for_month", checkoutMonth),
    ]);

    const priorCheckoutUnits = (priorCheckouts ?? []).map(r => Number(r.units_consumed));

    const joiners = (tenants ?? []).map(t => {
      const manual = (joinRows ?? []).find(j => j.tenant_id === t.id);
      return {
        tenantId: t.id,
        unitsAtJoin: manual ? Number(manual.units_at_join) : null,
        joiningMeterReading:
          !manual && t.joining_meter_reading != null && (t.check_in as string | null)?.slice(0, 7) === checkoutMonth
            ? Number(t.joining_meter_reading)
            : null,
      };
    });

    const derivedOpening = deriveOpeningReading(tenants ?? [], checkoutMonth);

    return {
      prevMonthReading: prevRecord?.meter_reading != null ? Number(prevRecord.meter_reading) : null,
      prevMonthUnits: prevRecord?.total_units != null ? Number(prevRecord.total_units) : null,
      currentMonthReading: currentRecord?.meter_reading != null ? Number(currentRecord.meter_reading) : null,
      currentMonthUnits: currentRecord?.total_units != null ? Number(currentRecord.total_units) : null,
      perUnitRate: Number(config?.ac_per_unit_rate ?? 0),
      activeTenantCount: (tenants ?? []).length + priorCheckoutUnits.length,
      priorCheckoutUnits,
      joiners,
      derivedOpening,
      eligibleTenants: (tenants ?? []).map(t => ({
        id: t.id as string,
        check_in: t.check_in as string,
        joining_meter_reading: t.joining_meter_reading != null ? Number(t.joining_meter_reading) : null,
      })),
      joinReadingsRaw: (joinRows ?? []).map(j => ({
        tenant_id: j.tenant_id as string,
        units_at_join: Number(j.units_at_join),
      })),
      checkoutReadingsRaw: (priorCheckouts ?? []).map(r => ({
        meter_reading: Number(r.meter_reading),
        tenant_count_at_checkout: Number(r.tenant_count_at_checkout),
      })),
    };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return {
      prevMonthReading: null,
      prevMonthUnits: null,
      currentMonthReading: null,
      currentMonthUnits: null,
      perUnitRate: 0,
      activeTenantCount: 0,
      priorCheckoutUnits: [],
      joiners: [],
      derivedOpening: null,
      eligibleTenants: [],
      joinReadingsRaw: [],
      checkoutReadingsRaw: [],
      error: err instanceof Error ? err.message : "Failed to load AC context",
    };
  }
}

// ---------------------------------------------------------------------------
// logTenantEvent — Member Ledger event log (room/plan changes, deposit collection).
// Called from the tenant create/edit flow (client-side) after a successful save,
// since room_id/package_tier are overwritten in place with no history kept otherwise.
// ---------------------------------------------------------------------------

export async function logTenantEvent(input: {
  tenantId: string;
  eventType: TenantEventType;
  fromValue?: string | null;
  toValue?: string | null;
  amount?: number | null;
  notes?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Standard tier — a lightweight audit-trail entry, needed by both the
    // standard-gated add-tenant flow (deposit_collected) and the full-gated
    // edit-tenant flow (room_changed/plan_changed).
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("id")
      .eq("id", input.tenantId)
      .eq("hostel_id", hostelId)
      .single();
    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");

    const { error } = await adminDb.from("hms_tenant_events").insert({
      hostel_id: hostelId,
      tenant_id: input.tenantId,
      event_type: input.eventType,
      from_value: input.fromValue ?? null,
      to_value: input.toValue ?? null,
      amount: input.amount ?? null,
      notes: input.notes ?? null,
    });
    if (error) throw new Error("Failed to log tenant event.");

    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// giveTenantNoticeAction / cancelTenantNoticeAction
// Records that a tenant has told the owner they're leaving, and the date
// they intend to check out — reused later to pre-fill the actual checkout
// dialog. No penalty/reminder logic; this only tracks the dates.
// ---------------------------------------------------------------------------

// Owner-facing "Resend Welcome" button — sends the same hms_tenant_welcome
// message (room, WiFi password, meal times, mess/menu link) the tenant would
// have gotten automatically on activation. Useful when the original send
// failed, the tenant lost the message, or WiFi/menu details changed since.
export async function resendTenantWelcomeMessageAction(tenantId: string): Promise<WelcomeSendResult> {
  try {
    const hostelId = await resolveWelcomeMessageHostelId();
    const admin = createAdminClient();

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("id, full_name, phone, is_active, is_waiting, room_id, hostel_id")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();
    if (!tenant) throw new Error("Tenant not found or access denied");

    return await sendWelcomeMessageNow(tenant);
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function giveTenantNoticeAction(
  tenantId: string,
  intendedCheckoutDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    if (!DATE_RE.test(intendedCheckoutDate)) throw new Error("Invalid date format");
    const dateObj = new Date(intendedCheckoutDate + "T00:00:00");
    if (isNaN(dateObj.getTime())) throw new Error("Invalid date");
    const today = new Date().toISOString().slice(0, 10);
    if (intendedCheckoutDate < today) throw new Error("Intended checkout date cannot be in the past");

    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("id, is_active")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();
    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");
    if (!tenant.is_active) throw new Error("Tenant is not active");

    const noticeGivenDate = today;
    const { error } = await adminDb
      .from("hms_tenants")
      // Reset leaving_reminder_sent_at — a fresh or changed checkout date
      // means the 7-day-out reminder to the owner should fire again for it.
      .update({ notice_given_date: noticeGivenDate, intended_checkout_date: intendedCheckoutDate, leaving_reminder_sent_at: null })
      .eq("id", tenantId)
      .eq("hostel_id", hostelId);
    if (error) throw new Error("Failed to record notice.");

    await adminDb.from("hms_tenant_events").insert({
      hostel_id: hostelId,
      tenant_id: tenantId,
      event_type: "notice_given",
      to_value: intendedCheckoutDate,
    });

    revalidatePath("/tenants");
    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelTenantNoticeAction(
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("id, is_active, intended_checkout_date")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();
    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");
    if (!tenant.is_active) throw new Error("Tenant is not active");

    const { error } = await adminDb
      .from("hms_tenants")
      .update({ notice_given_date: null, intended_checkout_date: null, leaving_reminder_sent_at: null })
      .eq("id", tenantId)
      .eq("hostel_id", hostelId);
    if (error) throw new Error("Failed to cancel notice.");

    await adminDb.from("hms_tenant_events").insert({
      hostel_id: hostelId,
      tenant_id: tenantId,
      event_type: "notice_cancelled",
      from_value: tenant.intended_checkout_date,
    });

    revalidatePath("/tenants");
    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
): Promise<{ success: boolean; error?: string; warning?: string; settlement?: CheckoutSettlement }> {
  try {
    await requireOwnerOrAbove();
    const hostelId = await resolveHostelId();
    return await performTenantCheckout(hostelId, input);
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getTenantRecordedMoneyAction
// Deleting a tenant cascades their payment rows away, and every month those
// rows were counted in silently drops. The owner's decision is to allow the
// delete but to be told first, in money: "Ahsan has Rs 5,000 in recorded
// payments. Deleting will remove Rs 5,000 from July 2026's collected total."
//
// Read on demand from the confirm dialog rather than shipped with the Tenants
// page: this is one rare click, and pre-loading every tenant's whole payment
// history on every page load to answer it would be the more expensive mistake.
// ---------------------------------------------------------------------------

export async function getTenantRecordedMoneyAction(
  tenantId: string
): Promise<{ success: boolean; total?: number; byMonth?: { month: string; amount: number }[]; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("full");
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    const { data, error } = await adminDb
      .from("hms_payments")
      .select("for_month, status, amount, amount_paid")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .in("status", ["paid", "partially_paid"]);

    if (error) throw new Error(error.message);

    const byMonthMap = new Map<string, number>();
    for (const row of data ?? []) {
      // amount_paid is the money that actually came in. It is null on older
      // fully-paid rows written before the column existed, where `amount` is
      // the settled figure.
      const paid = row.amount_paid != null ? Number(row.amount_paid) : Number(row.amount ?? 0);
      if (!(paid > 0)) continue;
      byMonthMap.set(row.for_month, (byMonthMap.get(row.for_month) ?? 0) + paid);
    }

    const byMonth = [...byMonthMap.entries()]
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return { success: true, total: byMonth.reduce((s, m) => s + m.amount, 0), byMonth };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// deleteTenantAction
// Permanently removes a tenant record. Rewrites the room's occupancy count,
// so — like checkout — this is scoped to Full-tier partners, on par with owner.
// ---------------------------------------------------------------------------

export async function deleteTenantAction(
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("full");
    const hostelId = await resolveHostelId();
    const adminDb = createAdminClient();

    const { data: tenant, error: tenantErr } = await adminDb
      .from("hms_tenants")
      .select("room_id, is_active")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();
    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");

    const { error: deleteErr } = await adminDb
      .from("hms_tenants")
      .delete()
      .eq("id", tenantId)
      .eq("hostel_id", hostelId);
    if (deleteErr) throw new Error(deleteErr.message);

    if (tenant.room_id && tenant.is_active) {
      const { data: room } = await adminDb
        .from("hms_rooms")
        .select("capacity, occupied")
        .eq("id", tenant.room_id)
        .single();
      if (room) {
        const newOcc = Math.max(0, room.occupied - 1);
        await adminDb
          .from("hms_rooms")
          .update({ occupied: newOcc, status: newOcc < room.capacity ? "available" : "occupied" })
          .eq("id", tenant.room_id);
      }
    }

    revalidatePath("/tenants");
    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
