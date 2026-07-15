import type { SupabaseClient } from "@supabase/supabase-js";
import { computeInvoicePeriod, calculateAnnualPrice, type BillingCycle } from "@/lib/pricing";
import { pktTodayDateString } from "@/lib/pkt-time";

// Shared by the super-admin "Generate Invoice Now" action and the daily cron
// (app/api/cron/generate-invoices) so both paths generate identical invoices.
export async function generateInvoiceForOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  ownerId: string
): Promise<{ generated: boolean; reason?: string; invoiceId?: string }> {
  const { data: billing } = await admin
    .from("hms_client_billing")
    .select("*")
    .eq("owner_id", ownerId)
    .single();

  if (!billing || billing.custom_price == null) {
    return { generated: false, reason: "Billing price not configured for this client" };
  }

  const anchor = billing.next_invoice_date
    ? new Date(`${billing.next_invoice_date}T00:00:00Z`)
    : new Date(`${pktTodayDateString()}T00:00:00Z`);
  const { periodStart, periodEnd, label } = computeInvoicePeriod(billing.billing_cycle as BillingCycle, anchor);

  // Idempotency: never generate two invoices for the same client + period.
  const { data: existing } = await admin
    .from("hms_platform_invoices")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (existing) {
    // Advance the anchor anyway so a stale next_invoice_date doesn't get stuck re-checking forever.
    await admin.from("hms_client_billing").update({ next_invoice_date: periodEnd }).eq("owner_id", ownerId);
    return { generated: false, reason: "An invoice for this period already exists" };
  }

  // Snapshot branch count + standard price NOW — an invoice is a historical
  // record and must not change if the client's branch count changes later.
  const { count: branchCount } = await admin
    .from("hms_hostels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  const { data: invoice, error: insertErr } = await admin
    .from("hms_platform_invoices")
    .insert({
      owner_id: ownerId,
      amount: billing.custom_price,
      billing_cycle: billing.billing_cycle,
      period_label: label,
      period_start: periodStart,
      period_end: periodEnd,
      due_date: periodStart,
      status: "unpaid",
      branch_count: branchCount ?? 1,
      standard_annual_price: calculateAnnualPrice(branchCount ?? 1),
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  await admin.from("hms_client_billing").update({ next_invoice_date: periodEnd }).eq("owner_id", ownerId);

  return { generated: true, invoiceId: invoice.id };
}
