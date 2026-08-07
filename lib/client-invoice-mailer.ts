import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendClientInvoiceEmail } from "@/lib/email";
import { pktTodayDateString } from "@/lib/pkt-time";
import { ONBOARDING_FEE, listSubtotalFromDiscount } from "@/lib/pricing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io";

/** Days between reminders once an invoice has been sent — email and
 *  WhatsApp go out together on the same cadence. */
export const REMINDER_INTERVAL_DAYS = 4;

export interface InvoiceMailResult {
  sent: boolean;
  reason?: string;
  redirectedTo?: string;
}

/**
 * Sends one invoice email and records that it went out.
 *
 * Shared by the SuperAdmin "Send invoice" button (kind: "invoice") and the daily
 * reminder cron (kind: "reminder"); the two differ only in tone and subject, as
 * both carry the same full breakdown inline. Line items are derived from the
 * invoice's OWN snapshotted rate/discount/branch_count columns rather than live
 * billing config, so a reminder sent months later still shows the figures the
 * client was actually billed — same rule the public /invoice/[token] route follows.
 */
export async function sendInvoiceMail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  invoiceId: string,
  kind: "invoice" | "reminder"
): Promise<InvoiceMailResult> {
  const { data: invoice, error } = await admin
    .from("hms_platform_invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !invoice) return { sent: false, reason: "Invoice not found" };
  if (invoice.status !== "unpaid") return { sent: false, reason: `Invoice is ${invoice.status}` };

  const [{ data: profile }, { data: authUser }] = await Promise.all([
    admin.from("hms_profiles").select("full_name, phone").eq("id", invoice.owner_id).maybeSingle(),
    admin.auth.admin.getUserById(invoice.owner_id),
  ]);

  const clientEmail = authUser?.user?.email;
  if (!clientEmail) return { sent: false, reason: "Client has no email on file" };

  const clientName = profile?.full_name ?? "there";

  // Mirrors the line items in lib/platform-invoice-pdf.ts, derived from the
  // invoice's own snapshotted columns so the email and the PDF behind the link
  // can never disagree — and so a reminder sent months later still quotes the
  // figures the client was actually billed.
  const months = invoice.billing_cycle === "monthly" ? 1 : 12;
  const cycleWord = invoice.billing_cycle === "monthly" ? "month" : "year";
  const branchCount = invoice.branch_count;
  const actualSubtotal = Number(invoice.monthly_rate) * months * branchCount;
  const listSubtotal = listSubtotalFromDiscount(actualSubtotal, Number(invoice.discount_pct));
  const discount = listSubtotal - actualSubtotal;
  const standardOnboarding = invoice.is_first_invoice ? ONBOARDING_FEE : 0;
  const onboardingWaived = standardOnboarding - Number(invoice.onboarding_fee_charged);

  const pkr = (n: number) => `Rs. ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

  const lines: { label: string; value: string; muted?: boolean; credit?: boolean }[] = [
    { label: "Billing period", value: invoice.period_label, muted: true },
    {
      label: `Subscription — ${branchCount} branch${branchCount !== 1 ? "es" : ""} × ${pkr(listSubtotal / branchCount)}/${cycleWord}`,
      value: pkr(listSubtotal),
    },
  ];
  if (discount > 0) {
    lines.push({
      label: `Discount (${Number(invoice.discount_pct).toFixed(0)}%)`,
      value: `− ${pkr(discount)}`,
      credit: true,
    });
  }
  if (standardOnboarding > 0) {
    lines.push({ label: "One-time onboarding fee", value: pkr(standardOnboarding) });
    if (onboardingWaived > 0) {
      lines.push({ label: "Onboarding fee waived", value: `− ${pkr(onboardingWaived)}`, credit: true });
    }
  }

  // updateInvoiceAmount lets a SuperAdmin correct `amount` without touching the
  // rate/branch_count snapshot the lines above are derived from, so the two can
  // legitimately disagree — one live invoice is Rs 5,000 against a Rs 10,000
  // snapshot. In a PDF nobody opens that just looks odd; in an email body the
  // client reads the line items directly and a breakdown that contradicts its
  // own total destroys trust. Reconcile explicitly instead of hiding it.
  const lineTotal = listSubtotal - discount + standardOnboarding - onboardingWaived;
  const adjustment = Number(invoice.amount) - lineTotal;
  if (Math.abs(adjustment) >= 1) {
    lines.push({
      label: "Adjustment",
      value: `${adjustment < 0 ? "− " : ""}${pkr(Math.abs(adjustment))}`,
      credit: adjustment < 0,
    });
  }

  // Whole days, Pakistan-anchored — a Vercel function runs in UTC and would
  // otherwise flip "due today" to "1 day overdue" five hours early.
  const today = pktTodayDateString();
  const daysOverdue = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${invoice.due_date}T00:00:00Z`)) / 86_400_000
  );

  const { redirectedTo } = await sendClientInvoiceEmail({
    clientEmail,
    clientName,
    periodLabel: invoice.period_label,
    amount: Number(invoice.amount),
    dueDate: invoice.due_date,
    invoiceUrl: `${SITE_URL}/invoice/${invoice.share_token}`,
    lines,
    daysOverdue,
    isReminder: kind === "reminder",
  });

  const now = new Date().toISOString();
  await admin
    .from("hms_platform_invoices")
    .update(
      kind === "invoice"
        ? { first_sent_at: now, last_reminder_at: now }
        : { last_reminder_at: now, reminder_count: (invoice.reminder_count ?? 0) + 1 }
    )
    .eq("id", invoiceId);

  return { sent: true, redirectedTo };
}
