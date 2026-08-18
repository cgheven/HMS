import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";

const SITE_URL = siteUrl();

/**
 * A shareable link to one payment's itemised bill.
 *
 * The SAME link renders an invoice while the bill is unpaid and a receipt once
 * it is settled — app/r/[token] switches on the payment's live status. So a
 * reminder link does not go stale after payment, and nothing needs to expire or
 * be reissued. That is also why there is no expiry here: killing the link would
 * take the tenant's receipt with it.
 *
 * Reuses an existing unexpired link for the payment rather than minting a
 * second. hms_invoice_links has no uniqueness constraint, so a monthly reminder
 * would otherwise leave twelve live credentials a year pointing at one bill.
 *
 * Returns null rather than throwing: the caller falls back to a reminder
 * without a link, and a tenant getting the old wording is far better than a
 * reminder that never sends.
 */
export async function billLinkForPayment(
  paymentId: string,
  hostelId: string
): Promise<string | null> {
  try {
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("hms_invoice_links")
      .select("token")
      .eq("payment_id", paymentId)
      .eq("hostel_id", hostelId)
      .is("installment_id", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing?.token) return `${SITE_URL}/r/${existing.token}`;

    const { data: created, error } = await admin
      .from("hms_invoice_links")
      .insert({ payment_id: paymentId, hostel_id: hostelId })
      .select("token")
      .single();
    if (error || !created?.token) return null;

    return `${SITE_URL}/r/${created.token}`;
  } catch {
    return null;
  }
}
