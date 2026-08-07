import "server-only";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, paymentConfirmedParams } from "@/lib/whatsapp-templates";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io";

/**
 * Sends the approved hms_payment_confirmed template after a payment is
 * recorded.
 *
 * Gated on hms_hostels.whatsapp_enabled, the same Super Admin switch that
 * gates reminders — WhatsApp is granted per branch, and a hostel that hasn't
 * been granted it must not start messaging its tenants because a payment was
 * recorded. Off for every branch today, so wiring this changes nothing until
 * someone turns it on deliberately.
 *
 * Fire-and-forget by design: the money is already recorded by the time this
 * runs, and a Meta outage must never fail or roll back a collection. Failures
 * are logged, not surfaced.
 */
export async function sendPaymentConfirmation(paymentId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: payment } = await admin
      .from("hms_payments")
      .select(
        "id, hostel_id, tenant_id, for_month, amount_paid, status, tenant:hms_tenants(full_name, phone), hostel:hms_hostels(name, whatsapp_enabled)"
      )
      .eq("id", paymentId)
      .maybeSingle();
    if (!payment) return;

    const tenant = Array.isArray(payment.tenant) ? payment.tenant[0] : payment.tenant;
    const hostel = Array.isArray(payment.hostel) ? payment.hostel[0] : payment.hostel;

    if (!hostel?.whatsapp_enabled) return;
    const digits = (tenant?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    if (digits.length < 11) return;

    // Reuse the receipt link already shared for this payment rather than
    // minting another permanent public token — same rule createInvoiceLink
    // follows, and the oldest token stays canonical so a link already sent
    // over WhatsApp keeps working.
    const { data: existing } = await admin
      .from("hms_invoice_links")
      .select("token")
      .eq("payment_id", paymentId)
      .eq("hostel_id", payment.hostel_id)
      .is("installment_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let token = existing?.token as string | undefined;
    if (!token) {
      token = randomBytes(32).toString("hex");
      const { error: insertErr } = await admin.from("hms_invoice_links").insert({
        payment_id: paymentId,
        hostel_id: payment.hostel_id,
        token,
      });
      if (insertErr) {
        console.error("[payment-confirmation] could not mint receipt link:", insertErr.message);
        return;
      }
    }

    const result = await sendWhatsAppTemplateMessage(
      digits,
      TEMPLATES.paymentConfirmed.name,
      TEMPLATES.paymentConfirmed.language,
      paymentConfirmedParams({
        tenantName: tenant?.full_name,
        amountPaid: Number(payment.amount_paid ?? 0),
        forMonth: payment.for_month as string,
        receiptUrl: `${SITE_URL}/r/${token}`,
        hostelName: hostel?.name,
      }),
      { hostelId: payment.hostel_id as string, tenantId: payment.tenant_id as string, messageType: "receipt" }
    );

    if (!result.ok) {
      console.error(`[payment-confirmation] Meta rejected receipt for payment ${paymentId}:`, result.error);
    }
  } catch (err) {
    console.error("[payment-confirmation] unexpected failure:", err);
  }
}
