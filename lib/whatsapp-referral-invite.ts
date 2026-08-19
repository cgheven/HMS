import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES } from "@/lib/whatsapp-templates";
import { normalizePhoneDigits } from "@/lib/phone";
import { mintStatusToken, referralStatusUrl } from "@/lib/referral-status";
import { siteUrl } from "@/lib/site-url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const SITE_URL = siteUrl();

/**
 * Sends one tenant their referral link.
 *
 * IDEMPOTENT ON (tenant, code). link_sent_at is stamped on the code row, and a
 * row that already carries one is skipped — so a re-run of the blast fills only
 * the gaps, and Meta is never billed twice for the same message. Rotating a code
 * inserts a NEW row with a null stamp, which is exactly the requested rule: the
 * tenant is told once per code, and again only when the code changes.
 *
 * The status token is minted HERE, on first send, because that is the only
 * moment the raw value can reach the tenant. It is written as a digest; the raw
 * string exists once, inside the message.
 *
 * FAIL-OPEN. Every caller is an admission path or a bulk job — a failed
 * marketing message must never take down admitting a tenant.
 */
export async function sendReferralInvite(
  admin: Admin,
  codeRowId: string,
  /** Retry mode. Skips the already-sent guard, because link_sent_at means Meta
   *  ACCEPTED the message, not that it arrived — a delivery failure lands later
   *  on the webhook, and by then the row already looks sent. Only the retry
   *  pass sets this; it selects on the message actually having failed. */
  opts: { retry?: boolean } = {}
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { data: row } = await admin
      .from("hms_referral_codes")
      .select(
        "id, code, tenant_id, hostel_id, is_active, link_sent_at, status_token_hash, invite_attempts, " +
          "tenant:hms_tenants(full_name, phone, is_active, is_waiting), " +
          "hostel:hms_hostels(name, whatsapp_enabled, referral_enabled, referral_campaign, " +
          "referral_referrer_percent, referral_referred_percent)"
      )
      .eq("id", codeRowId)
      .maybeSingle();

    if (!row) return { sent: false, reason: "no_code" };
    // The embed's inferred type is a union with an error shape; the runtime
    // value is the row. Narrowed once here rather than at every field.
    type Emb<T> = T | T[] | null;
    const r = row as unknown as {
      id: string; code: string; tenant_id: string; hostel_id: string;
      is_active: boolean; link_sent_at: string | null; status_token_hash: string | null;
      invite_attempts: number | null;
      tenant: Emb<{ full_name: string; phone: string | null; is_active: boolean; is_waiting: boolean }>;
      hostel: Emb<{ name: string; whatsapp_enabled: boolean; referral_enabled: boolean;
                    referral_campaign: string; referral_referrer_percent: number;
                    referral_referred_percent: number }>;
    };

    if (!r.is_active) return { sent: false, reason: "no_code" };
    if (r.link_sent_at && !opts.retry) return { sent: false, reason: "already_sent" };

    const tenant = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
    const hostel = Array.isArray(r.hostel) ? r.hostel[0] : r.hostel;
    if (!tenant || !hostel) return { sent: false, reason: "no_tenant" };

    // Every gate that could make this message wrong or unwanted, checked at the
    // moment of sending rather than when the job was queued — a pause pressed
    // mid-blast has to stop the messages still in the queue.
    if (!hostel.whatsapp_enabled) return { sent: false, reason: "whatsapp_off" };
    if (!hostel.referral_enabled) return { sent: false, reason: "referrals_off" };
    if (hostel.referral_campaign !== "active") return { sent: false, reason: "campaign_not_active" };
    if (!tenant.is_active || tenant.is_waiting) return { sent: false, reason: "not_resident" };

    const digits = normalizePhoneDigits(tenant.phone);
    if (!digits) return { sent: false, reason: "no_phone" };

    const referrerPct = Number(hostel.referral_referrer_percent ?? 0);
    const referredPct = Number(hostel.referral_referred_percent ?? 0);
    // "you get 0% off" is not an offer. The campaign start refuses this too;
    // this is the second line of defence for a percentage edited mid-campaign.
    if (referrerPct < 1 || referredPct < 1) return { sent: false, reason: "no_offer" };

    // Reuse an existing token if one was somehow minted without a send; only
    // mint when there is none, so a retry cannot invalidate a link already sent.
    let rawToken: string | null = null;
    let tokenHash = r.status_token_hash;
    if (!tokenHash) {
      const minted = mintStatusToken();
      rawToken = minted.raw;
      tokenHash = minted.hash;
      const { error: tokErr } = await admin
        .from("hms_referral_codes")
        .update({ status_token_hash: tokenHash })
        .eq("id", r.id)
        .is("status_token_hash", null);
      if (tokErr) return { sent: false, reason: "token_failed" };
    }
    // A pre-existing hash means the raw value is gone — it is stored one-way.
    // Re-mint rather than send a link that cannot be opened.
    if (!rawToken) {
      const minted = mintStatusToken();
      rawToken = minted.raw;
      await admin
        .from("hms_referral_codes")
        .update({ status_token_hash: minted.hash })
        .eq("id", r.id);
    }

    const firstName = String(tenant.full_name ?? "").trim().split(/\s+/)[0] || "there";

    // Counted here, immediately before the call, so it records ATTEMPTS rather
    // than successes — a retry loop that only counted successes would never
    // reach its cap and would hammer an unreachable number forever.
    await admin
      .from("hms_referral_codes")
      .update({
        invite_attempts: Number(r.invite_attempts ?? 0) + 1,
        invite_last_attempt_at: new Date().toISOString(),
      })
      .eq("id", r.id);

    const result = await sendWhatsAppTemplateMessage(
      digits,
      TEMPLATES.referralInvitation.name,
      TEMPLATES.referralInvitation.language,
      [
        firstName,
        hostel.name ?? "your hostel",
        `${SITE_URL}/ref/${r.code}`,
        String(referrerPct),
        String(referredPct),
        referralStatusUrl(rawToken),
      ],
      // "marketing", not "announcement": this is a promotional template and the
      // monitoring page must be able to separate outreach from service messages.
      { hostelId: r.hostel_id, tenantId: r.tenant_id, messageType: "marketing" as const }
    );

    if (!result.ok) return { sent: false, reason: "send_failed" };

    // Stamped only AFTER Meta accepted it. Stamping first would silently skip
    // anyone whose send failed, and they would never be told about the campaign.
    await admin
      .from("hms_referral_codes")
      .update({ link_sent_at: new Date().toISOString() })
      .eq("id", r.id);

    return { sent: true };
  } catch (err) {
    console.error(
      "[sendReferralInvite] failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return { sent: false, reason: "error" };
  }
}
