"use server";
import { isTestOwner } from "@/lib/test-accounts";
import { getProfile } from "@/lib/auth";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { generateInvoiceForOwner } from "@/lib/invoice-generation";
import { sendInvoiceMail } from "@/lib/client-invoice-mailer";
import { sendInvoiceWhatsApp, sendPaymentReceivedWhatsApp } from "@/lib/client-invoice-whatsapp";
import type { ClientBilling, PlatformInvoice } from "@/types";

/**
 * Delegates to lib/auth's cache()d getProfile instead of re-authenticating.
 *
 * This file used to run its own getUser() + profile SELECT. So did four other
 * action files and the super-admin layout — six uncached copies of the same two
 * round trips. One Dashboard render performed the identical auth check three to
 * four times, and with functions in us-east and Postgres in Singapore each of
 * those round trips cost ~264ms.
 *
 * Deliberately keeps THROWING rather than calling lib/auth's requireSuperAdmin,
 * which redirects: these are server actions whose callers catch the error and
 * surface it in the UI, and a redirect() thrown inside those catch blocks would
 * be swallowed as a generic failure.
 */
async function requireSuperAdmin() {
  const profile = await getProfile();
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return profile;
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

    const [billingRes, invoicesRes, profileRes, hostelsRes] = await Promise.all([
      admin.from("hms_client_billing").select("*").eq("owner_id", ownerId).maybeSingle(),
      admin
        .from("hms_platform_invoices")
        .select("*")
        .eq("owner_id", ownerId)
        .order("period_start", { ascending: false }),
      admin.from("hms_profiles").select("phone").eq("id", ownerId).maybeSingle(),
      admin
        .from("hms_hostels")
        .select("phone, whatsapp")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true }),
    ]);

    if (billingRes.error) throw billingRes.error;
    if (invoicesRes.error) throw invoicesRes.error;

    // The owner's own profile phone is often never captured at signup — fall back
    // to whichever branch has a WhatsApp/phone number on file so sharing still works.
    const fallbackPhone = hostelsRes.data?.find((h) => h.whatsapp)?.whatsapp
      ?? hostelsRes.data?.find((h) => h.phone)?.phone
      ?? null;

    return {
      billing: (billingRes.data as ClientBilling | null) ?? null,
      invoices: (invoicesRes.data ?? []) as PlatformInvoice[],
      ownerPhone: profileRes.data?.phone || fallbackPhone,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load billing" };
  }
}

// ── setClientBilling ──────────────────────────────────────────────────────────

export async function setClientBilling(data: {
  ownerId: string;
  billingCycle: "monthly" | "annual";
  monthlyRate: number;
  waiveOnboarding: boolean;
  pricingNotes?: string;
  nextInvoiceDate?: string;
}): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    if (!data.ownerId) throw new Error("Owner is required");
    if (!data.monthlyRate || data.monthlyRate <= 0) throw new Error("Monthly rate must be greater than 0");
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
        monthly_rate: data.monthlyRate,
        waive_onboarding: data.waiveOnboarding,
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
      meta: {
        billing_cycle: data.billingCycle,
        monthly_rate: data.monthlyRate,
        waive_onboarding: data.waiveOnboarding,
      },
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

    // Read the status BEFORE the write, so the confirmation fires only on a real
    // unpaid -> paid transition. Re-marking an already-paid invoice (a correction,
    // a double click, or paid -> unpaid -> paid) would otherwise send the client a
    // second "we received your payment" for money that arrived once.
    const { data: before } = await admin
      .from("hms_platform_invoices")
      .select("status")
      .eq("id", invoiceId)
      .maybeSingle();
    const wasUnpaid = before?.status === "unpaid";

    const { error } = await admin
      .from("hms_platform_invoices")
      .update({
        status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
        marked_paid_by: status === "paid" ? caller.id : null,
      })
      .eq("id", invoiceId);
    if (error) throw error;

    // Both channels, fire-and-forget: the payment is already recorded, and an
    // outage at Meta or Resend must never fail marking an invoice paid.
    //
    // Email is the one that always lands — all 9 client owners have an address
    // on file, and it is the record they keep for their own books. WhatsApp is
    // the one they notice. Independent of each other, so a failure in either
    // still leaves the client informed by the other.
    if (status === "paid" && wasUnpaid) {
      void sendInvoiceMail(admin, invoiceId, "receipt").then((r) => {
        if (!r.sent) console.error(`[client-payment-received] email not sent for invoice ${invoiceId}: ${r.reason}`);
      });
      void sendPaymentReceivedWhatsApp(admin, invoiceId).then((r) => {
        if (!r.sent) console.error(`[client-payment-received] whatsapp not sent for invoice ${invoiceId}: ${r.reason}`);
      });
    }

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

// ── sendInvoiceEmail ──────────────────────────────────────────────────────────
// Emails the client their invoice with the PDF attached, and arms the reminder
// job — /api/cron/client-invoice-reminders only chases invoices that have a
// first_sent_at, so generating an invoice never mails anyone on its own. Safe
// to press again: it re-sends the same invoice and resets the 3-day clock.

export async function sendInvoiceEmail(
  invoiceId: string
): Promise<{ error?: string; sentTo?: string; redirectedTo?: string; whatsappSent?: boolean; whatsappReason?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const result = await sendInvoiceMail(admin, invoiceId, "invoice");
    if (!result.sent) return { error: result.reason ?? "Could not send invoice" };

    // Same invoice on WhatsApp. Deliberately after the email and deliberately
    // non-fatal: the email is the record of record (it arms the reminder clock
    // via first_sent_at), so a client with no phone must not turn a successful
    // send into an error the admin has to interpret.
    const wa = await sendInvoiceWhatsApp(admin, invoiceId).catch((err) => ({
      sent: false,
      reason: err instanceof Error ? err.message : "whatsapp failed",
    }));

    const { data: inv } = await admin
      .from("hms_platform_invoices")
      .select("owner_id, period_label")
      .eq("id", invoiceId)
      .maybeSingle();
    const { data: authUser } = inv
      ? await admin.auth.admin.getUserById(inv.owner_id)
      : { data: null };

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.send_invoice_email",
      entity: "invoice",
      entity_id: invoiceId,
      meta: { redirected_to: result.redirectedTo ?? null },
    });

    return {
      sentTo: authUser?.user?.email ?? undefined,
      redirectedTo: result.redirectedTo,
      whatsappSent: wa.sent,
      whatsappReason: wa.sent ? undefined : wa.reason,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send invoice" };
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

// ── resetClientInvoices ────────────────────────────────────────────────────────
// For test accounts only — wipes a client's invoice history (so their next
// invoice is treated as "first" again, re-enabling the onboarding fee) while
// leaving their billing config (rate/cycle/waiver) untouched. Refuses if any
// invoice has been marked paid, since that's a settled financial record for a
// real client, not a test fixture — same protection as updateInvoiceAmount.

export async function resetClientInvoices(ownerId: string): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    // Paid invoices block a reset — a real client's settled billing history is
    // not something to delete from a dialog. Known test accounts
    // (lib/test-accounts.ts) are exempt: invoice generation cannot be rehearsed
    // on a real client, so the only way to test it end to end is an account
    // whose "payments" were never real money.
    if (!isTestOwner(ownerId)) {
      const { count: paidCount, error: countErr } = await admin
        .from("hms_platform_invoices")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("status", "paid");
      if (countErr) throw countErr;
      if ((paidCount ?? 0) > 0) {
        throw new Error("Cannot reset — this client has paid invoices. This is only for test accounts with no settled payments.");
      }
    }

    const { error } = await admin.from("hms_platform_invoices").delete().eq("owner_id", ownerId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.reset_client_invoices",
      entity: "profile",
      entity_id: ownerId,
      // Recorded so a reset that skipped the paid-invoice guard is answerable
      // later, rather than looking identical to an ordinary one.
      meta: { test_account: isTestOwner(ownerId) },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reset invoices" };
  }
}

// ── updateOwnerPhone ──────────────────────────────────────────────────────────
// Most owners never had a phone captured at creation (the field is optional and
// there's no settings UI to add one later), which silently breaks the "Share on
// WhatsApp" invoice button — it falls back to a contact-less wa.me link with no
// recipient. This lets the admin backfill it right where the WhatsApp button lives.

export async function updateOwnerPhone(ownerId: string, phone: string): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_profiles")
      .update({ phone: phone.trim() || null })
      .eq("id", ownerId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.update_owner_phone",
      entity: "profile",
      entity_id: ownerId,
      meta: {},
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update phone" };
  }
}
