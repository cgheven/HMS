import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { sendCheckoutEmail } from "@/lib/email";
import { TEMPLATES, tenantCheckoutParams } from "@/lib/whatsapp-templates";
import { billLinkForPayment } from "@/lib/bill-link";
import { getCountryConfig, isSupportedCountry } from "@/lib/country-config";

/**
 * Sends hms_tenant_checkout once, as the tenant leaves: thank-you, receipt link
 * and the single-use feedback link.
 *
 * SERVER-SIDE ON PURPOSE, not a wa.me click-to-send like the salary advance
 * receipt. The feedback URL is a write credential — whoever holds it can submit
 * that tenant's one and only response. The security review found that handing it
 * back to whoever ran the checkout let a manager rate their own performance
 * under a real ex-tenant's name, irreversibly. Sending through the Business API
 * keeps the token on the server: it goes from here to Meta to the tenant's
 * phone, and never touches the operator's browser.
 *
 * Gated on hms_hostels.whatsapp_enabled like every other automated send, and
 * fire-and-forget: the tenant has already left and their money is already
 * settled by the time this runs. A Meta outage must never fail a checkout.
 */
export async function sendCheckoutMessage(
  tenantId: string,
  feedbackUrl: string | null
): Promise<void> {
  try {
    if (!feedbackUrl) return;

    const admin = createAdminClient();

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("id, full_name, phone, email, check_out, hostel_id, hostel:hms_hostels(name, whatsapp_enabled, country)")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return;

    const hostel = Array.isArray(tenant.hostel) ? tenant.hostel[0] : tenant.hostel;
    // Channel per country: WhatsApp where the country has it AND it's granted
    // (Pakistan today — unchanged); email for a REGISTERED non-WhatsApp country.
    // A hostel on an unregistered country isn't served — skip (no message).
    const supported = isSupportedCountry(hostel?.country);
    const whatsappCountry = supported && getCountryConfig(hostel?.country).whatsapp;
    if (!supported) return;

    const receiptUrl = await resolveReceiptUrl(admin, tenantId, tenant.hostel_id as string);

    if (whatsappCountry) {
      if (!hostel?.whatsapp_enabled) return;

      const digits = (tenant.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
      if (digits.length < 11) return;

      // Meta rejects an empty parameter outright, so a missing receipt would fail
      // the whole send — taking the feedback link down with it. Better to skip the
      // message than to deliver one whose receipt line points nowhere.
      if (!receiptUrl) {
        console.error(`[checkout-whatsapp] no receipt link for tenant ${tenantId}; message not sent`);
        return;
      }

      const result = await sendWhatsAppTemplateMessage(
        digits,
        TEMPLATES.tenantCheckout.name,
        TEMPLATES.tenantCheckout.language,
        tenantCheckoutParams({
          tenantName: tenant.full_name,
          hostelName: hostel?.name,
          checkoutDate: tenant.check_out,
          receiptUrl,
          feedbackUrl,
        }),
        { hostelId: tenant.hostel_id as string, tenantId, messageType: "receipt" }
      );

      if (!result.ok) {
        console.error(`[checkout-whatsapp] Meta rejected checkout message for tenant ${tenantId}:`, result.error);
      }
    } else {
      // Non-PK path — email. The receipt line is optional here (unlike the WA
      // template, an email renders fine without it); the feedback token stays
      // server-side, delivered only to the departing tenant's inbox.
      const email = tenant.email?.trim();
      if (!email) return;
      await sendCheckoutEmail({
        to: email,
        name: tenant.full_name,
        hostelName: hostel?.name ?? null,
        checkoutDate: tenant.check_out,
        receiptUrl,
        feedbackUrl,
      });
    }
  } catch (err) {
    console.error("[checkout-whatsapp] unexpected failure:", err);
  }
}

/**
 * The tenant's most recent settled bill, as a shareable receipt link.
 *
 * Only finds WHICH bill; minting is billLinkForPayment's job, shared with the
 * payment reminders so both reuse an existing link instead of each leaving its
 * own credential behind for the same payment.
 */
async function resolveReceiptUrl(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  hostelId: string
): Promise<string | null> {
  const { data: payment } = await admin
    .from("hms_payments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("hostel_id", hostelId)
    .in("status", ["paid", "partially_paid"])
    .order("for_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) return null;

  return billLinkForPayment(payment.id as string, hostelId);
}
