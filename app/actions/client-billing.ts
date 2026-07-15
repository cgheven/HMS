"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { generateInvoiceForOwner } from "@/lib/invoice-generation";
import type { ClientBilling, PlatformInvoice } from "@/types";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return user;
}

// ── getClientBilling ──────────────────────────────────────────────────────────

export async function getClientBilling(ownerId: string): Promise<{
  billing?: ClientBilling | null;
  invoices?: PlatformInvoice[];
  ownerPhone?: string | null;
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [billingRes, invoicesRes, profileRes] = await Promise.all([
      admin.from("hms_client_billing").select("*").eq("owner_id", ownerId).maybeSingle(),
      admin
        .from("hms_platform_invoices")
        .select("*")
        .eq("owner_id", ownerId)
        .order("period_start", { ascending: false }),
      admin.from("hms_profiles").select("phone").eq("id", ownerId).maybeSingle(),
    ]);

    if (billingRes.error) throw billingRes.error;
    if (invoicesRes.error) throw invoicesRes.error;

    return {
      billing: (billingRes.data as ClientBilling | null) ?? null,
      invoices: (invoicesRes.data ?? []) as PlatformInvoice[],
      ownerPhone: profileRes.data?.phone ?? null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load billing" };
  }
}

// ── setClientBilling ──────────────────────────────────────────────────────────

export async function setClientBilling(data: {
  ownerId: string;
  billingCycle: "monthly" | "annual";
  customPrice: number;
  pricingNotes?: string;
  nextInvoiceDate?: string;
}): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    if (!data.ownerId) throw new Error("Owner is required");
    if (!data.customPrice || data.customPrice <= 0) throw new Error("Price must be greater than 0");
    if (data.nextInvoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.nextInvoiceDate)) {
      throw new Error("Invalid billing start date");
    }

    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("hms_client_billing")
      .select("next_invoice_date")
      .eq("owner_id", data.ownerId)
      .maybeSingle();

    const { error } = await admin.from("hms_client_billing").upsert(
      {
        owner_id: data.ownerId,
        billing_cycle: data.billingCycle,
        custom_price: data.customPrice,
        pricing_notes: data.pricingNotes?.trim() || null,
        // Explicit override wins; otherwise preserve the existing schedule; only
        // a brand-new setup with no date picked at all defaults to today.
        next_invoice_date: data.nextInvoiceDate || existing?.next_invoice_date || new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_client_billing",
      entity: "profile",
      entity_id: data.ownerId,
      meta: { billing_cycle: data.billingCycle, custom_price: data.customPrice },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save billing" };
  }
}

// ── generateInvoiceNow ────────────────────────────────────────────────────────

export async function generateInvoiceNow(ownerId: string): Promise<{ error?: string; generated?: boolean; reason?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const result = await generateInvoiceForOwner(admin, ownerId);

    if (result.generated) {
      await writeAuditLog({
        actor_id: caller.id,
        actor_email: caller.email ?? "",
        action: "super_admin.generate_invoice",
        entity: "invoice",
        entity_id: result.invoiceId,
        meta: { owner_id: ownerId },
      });
    }

    return { generated: result.generated, reason: result.reason };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to generate invoice" };
  }
}

// ── markInvoiceStatus ─────────────────────────────────────────────────────────

export async function markInvoiceStatus(
  invoiceId: string,
  status: "paid" | "unpaid"
): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_platform_invoices")
      .update({
        status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
        marked_paid_by: status === "paid" ? caller.id : null,
      })
      .eq("id", invoiceId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: status === "paid" ? "super_admin.mark_invoice_paid" : "super_admin.mark_invoice_unpaid",
      entity: "invoice",
      entity_id: invoiceId,
      meta: {},
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update invoice" };
  }
}

// ── updateInvoiceAmount ───────────────────────────────────────────────────────
// Corrects a mistaken amount on an already-generated invoice (e.g. a price was
// typed but not saved before "Generate Invoice Now" was clicked). Locked once
// paid — a settled invoice must stay an accurate historical record.

export async function updateInvoiceAmount(invoiceId: string, amount: number): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    if (!amount || amount <= 0) throw new Error("Amount must be greater than 0");

    const admin = createAdminClient();

    const { data: invoice, error: fetchErr } = await admin
      .from("hms_platform_invoices")
      .select("status")
      .eq("id", invoiceId)
      .single();
    if (fetchErr || !invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid") throw new Error("Cannot edit a paid invoice — it's a settled record");

    const { error } = await admin.from("hms_platform_invoices").update({ amount }).eq("id", invoiceId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.update_invoice_amount",
      entity: "invoice",
      entity_id: invoiceId,
      meta: { new_amount: amount },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update invoice" };
  }
}
