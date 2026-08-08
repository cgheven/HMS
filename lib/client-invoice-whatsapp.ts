import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, clientBillingDueParams, clientPaymentReceivedParams } from "@/lib/whatsapp-templates";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io";

export interface InvoiceWhatsAppResult {
  sent: boolean;
  reason?: string;
}

/**
 * WhatsApp companion to sendInvoiceMail — same invoice, second channel.
 *
 * Runs alongside the email rather than replacing it: an invoice email can sit
 * unread for weeks, and every one of these clients runs their business from
 * WhatsApp. Neither channel's failure affects the other.
 *
 * Unlike the owner daily summary, this MAY fall back to the hostel's own
 * number. That summary carries profit figures a manager should not see; this
 * says "your supplier's invoice is due", which is ordinary business post — and
 * getClientBilling already uses the same fallback so the SuperAdmin's "Share on
 * WhatsApp" button has somewhere to point.
 */
export async function sendInvoiceWhatsApp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  invoiceId: string
): Promise<InvoiceWhatsAppResult> {
  const { data: invoice } = await admin
    .from("hms_platform_invoices")
    .select("id, owner_id, amount, period_label, due_date, share_token, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { sent: false, reason: "Invoice not found" };
  if (invoice.status !== "unpaid") return { sent: false, reason: `Invoice is ${invoice.status}` };

  const [{ data: profile }, { data: hostels }] = await Promise.all([
    admin.from("hms_profiles").select("full_name, phone").eq("id", invoice.owner_id).maybeSingle(),
    admin
      .from("hms_hostels")
      .select("name, phone, whatsapp, created_at")
      .eq("owner_id", invoice.owner_id)
      .order("created_at", { ascending: true }),
  ]);

  const branches = hostels ?? [];
  const raw =
    profile?.phone ||
    branches.find((h) => h.whatsapp)?.whatsapp ||
    branches.find((h) => h.phone)?.phone ||
    "";
  const digits = raw.replace(/\D/g, "").replace(/^0/, "92");
  if (digits.length < 11) return { sent: false, reason: "No phone number on file for this client" };

  const result = await sendWhatsAppTemplateMessage(
    digits,
    TEMPLATES.clientBillingDue.name,
    TEMPLATES.clientBillingDue.language,
    clientBillingDueParams({
      clientName: profile?.full_name,
      // Oldest branch — for a multi-branch client the invoice is account-level,
      // so any single branch name is a label, not a scope. The first one they
      // created is the one they recognise as the business.
      businessName: branches[0]?.name,
      periodLabel: invoice.period_label as string,
      amount: Number(invoice.amount),
      dueDate: invoice.due_date as string,
      invoiceUrl: `${SITE_URL}/invoice/${invoice.share_token}`,
    }),
    { hostelId: null, tenantId: null, ownerId: invoice.owner_id as string, messageType: "reminder" }
  );

  return result.ok ? { sent: true } : { sent: false, reason: result.error };
}

/**
 * Turn on once Meta approves hms_client_payment_received.
 *
 * Sending against a template still in review fails with 132001, so this stays
 * off until the approval lands. Marking an invoice paid must never break
 * because a message could not go out.
 */
const PAYMENT_RECEIVED_ENABLED = false;

/**
 * Confirms to the CLIENT that we received their platform payment.
 *
 * Until now, a client who paid heard nothing: the reminders simply stopped, and
 * the last message they had was one asking for money they had already sent.
 *
 * Deliberately reuses the reminder's phone resolution — profile, then any
 * branch's WhatsApp number, then any branch's phone — so the receipt reaches
 * exactly the number that was being chased.
 */
export async function sendPaymentReceivedWhatsApp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  invoiceId: string
): Promise<InvoiceWhatsAppResult> {
  if (!PAYMENT_RECEIVED_ENABLED) return { sent: false, reason: "Template not approved yet" };

  const { data: invoice } = await admin
    .from("hms_platform_invoices")
    .select("id, owner_id, amount, period_label, paid_at, share_token, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { sent: false, reason: "Invoice not found" };
  // Only ever confirms money we actually hold. If the status was flipped back
  // to unpaid between the mark and this send, the message would be false.
  if (invoice.status !== "paid") return { sent: false, reason: `Invoice is ${invoice.status}` };

  const [{ data: profile }, { data: hostels }] = await Promise.all([
    admin.from("hms_profiles").select("full_name, phone").eq("id", invoice.owner_id).maybeSingle(),
    admin
      .from("hms_hostels")
      .select("name, phone, whatsapp, created_at")
      .eq("owner_id", invoice.owner_id)
      .order("created_at", { ascending: true }),
  ]);

  const branches = hostels ?? [];
  const raw =
    profile?.phone ||
    branches.find((h) => h.whatsapp)?.whatsapp ||
    branches.find((h) => h.phone)?.phone ||
    "";
  const digits = raw.replace(/\D/g, "").replace(/^0/, "92");
  if (digits.length < 11) return { sent: false, reason: "No phone number on file for this client" };

  const result = await sendWhatsAppTemplateMessage(
    digits,
    TEMPLATES.clientPaymentReceived.name,
    TEMPLATES.clientPaymentReceived.language,
    clientPaymentReceivedParams({
      clientName: profile?.full_name,
      businessName: branches[0]?.name,
      periodLabel: invoice.period_label as string,
      amount: Number(invoice.amount),
      receivedOn: (invoice.paid_at as string | null) ?? null,
      invoiceUrl: `${SITE_URL}/invoice/${invoice.share_token}`,
    }),
    { hostelId: null, tenantId: null, ownerId: invoice.owner_id as string, messageType: "receipt" }
  );

  return result.ok ? { sent: true } : { sent: false, reason: result.error };
}
