import type { SupabaseClient } from "@supabase/supabase-js";
import { computeInvoicePeriod, clientDiscountPct, ONBOARDING_FEE, type BillingCycle } from "@/lib/pricing";
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

  if (!billing || billing.monthly_rate == null) {
    return { generated: false, reason: "Billing rate not configured for this client" };
  }

  const anchor = billing.next_invoice_date
    ? new Date(`${billing.next_invoice_date}T00:00:00Z`)
    : new Date(`${pktTodayDateString()}T00:00:00Z`);
  const { periodStart, periodEnd, label } = computeInvoicePeriod(billing.billing_cycle as BillingCycle, anchor);

  // Due date is Net 7 — 7 days from when the invoice is actually issued, not the
  // billing period it covers. Tying it to period_start meant an invoice for a
  // period starting in the future looked "due" the same day service starts,
  // with zero time to actually pay it.
  const issueDate = new Date(`${pktTodayDateString()}T00:00:00Z`);
  const dueDate = new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth(), issueDate.getUTCDate() + 7))
    .toISOString()
    .slice(0, 10);

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

  // Snapshot branch count + the rate/discount/onboarding that produced this
  // amount NOW — an invoice is a historical record and must not change if the
  // client's branch count or billing config changes later.
  // billing_active only (migration 162): a branch the client asked us to pause
  // stays fully usable to them but stops being charged for.
  const { count: branchCount } = await admin
    .from("hms_hostels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("billing_active", true);

  // Onboarding is a one-time cost — only the very first invoice this client
  // has ever been sent can carry it, no matter how billing is reconfigured later.
  const { count: priorInvoiceCount } = await admin
    .from("hms_platform_invoices")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  const isFirstInvoice = (priorInvoiceCount ?? 0) === 0;

  // The client's monthly_rate is PER BRANCH — discount_pct is just how far below
  // our standard per-branch rate that is, for display on the invoice. It applies
  // the same way regardless of billing cycle (a discounted monthly client is just
  // as real a discount as a discounted annual one). Onboarding stays a flat
  // one-time account-level fee, not multiplied by branch count.
  const months = billing.billing_cycle === "annual" ? 12 : 1;
  // `?? 1` covers a null count (a failed query), NOT a zero one. Zero is now a
  // real, intended state — every branch paused — and coercing it to 1 would
  // invoice a client we deliberately decided not to charge, which is exactly
  // the complaint this feature exists to stop.
  const billableBranches = branchCount ?? 1;

  // Every branch paused: generate nothing rather than a zero-rupee invoice.
  // A Rs 0 bill still emails the client, still starts the 4-day reminder clock,
  // and still shows up as unpaid on the billing page — chasing a client for
  // nothing is worse than the over-billing this feature was built to prevent.
  if (billableBranches === 0) {
    return { generated: false, reason: "All of this client's branches are paused from billing" };
  }

  const actualSubtotal = Number(billing.monthly_rate) * months * billableBranches;
  const discountPct = clientDiscountPct(Number(billing.monthly_rate));
  const onboardingFeeCharged = isFirstInvoice && !billing.waive_onboarding ? ONBOARDING_FEE : 0;
  const amount = Math.round((actualSubtotal + onboardingFeeCharged) * 100) / 100;

  const { data: invoice, error: insertErr } = await admin
    .from("hms_platform_invoices")
    .insert({
      owner_id: ownerId,
      amount,
      billing_cycle: billing.billing_cycle,
      period_label: label,
      period_start: periodStart,
      period_end: periodEnd,
      due_date: dueDate,
      status: "unpaid",
      branch_count: billableBranches,
      monthly_rate: billing.monthly_rate,
      discount_pct: discountPct,
      onboarding_fee_charged: onboardingFeeCharged,
      is_first_invoice: isFirstInvoice,
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  await admin.from("hms_client_billing").update({ next_invoice_date: periodEnd }).eq("owner_id", ownerId);

  return { generated: true, invoiceId: invoice.id };
}
