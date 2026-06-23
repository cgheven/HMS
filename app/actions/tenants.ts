"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import type { Payment, PackageTier, PaymentMethod } from "@/types";

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
// getTenantTimeline
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | "joined"
  | "payment"
  | "package_changed"
  | "check_out"
  | "status_change";

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
}

export async function getTenantTimeline(
  tenantId: string
): Promise<{ events?: TimelineEvent[]; error?: string }> {
  try {
    const hostelId = await resolveHostelId();
    const supabase = await createClient();

    // Fetch tenant (verify ownership via hostel_id)
    const { data: tenant, error: tenantErr } = await supabase
      .from("hms_tenants")
      .select("id, full_name, check_in, check_out, is_active, created_at")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single();

    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied");

    // Fetch all payments for this tenant
    const { data: payments, error: paymentsErr } = await supabase
      .from("hms_payments")
      .select(
        "id, for_month, amount, late_fee, payment_method, payment_date, status, food_charge, ac_charge, payment_package_tier, created_at"
      )
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .order("created_at", { ascending: false });

    if (paymentsErr) throw new Error(paymentsErr.message);

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

    // Insert the invoice link (DB defaults token via gen_random_bytes)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("hms_invoice_links")
      .insert({ payment_id: paymentId, hostel_id: hostelId, expires_at: expiresAt })
      .select("token")
      .single();

    if (error) throw new Error(error.message);
    return { token: (data as { token: string }).token };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
