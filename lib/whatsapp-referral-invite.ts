import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES } from "@/lib/whatsapp-templates";
import { normalizePhoneDigits } from "@/lib/phone";
import { generateReferralCode } from "@/lib/referrals";
import { mintStatusToken, referralStatusUrl } from "@/lib/referral-status";
import { sendReferralInviteEmail } from "@/lib/email";
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
          "hostel:hms_hostels(name, country, whatsapp_enabled, referral_enabled, referral_campaign, " +
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
      hostel: Emb<{ name: string; country: string | null; whatsapp_enabled: boolean; referral_enabled: boolean;
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
    // WhatsApp referral marketing is now superadmin-exclusive: it rides on the
    // manual whatsapp_enabled grant like every other WhatsApp send, so a
    // self-registered branch does not blast referral invites over WhatsApp until a
    // Super Admin turns it on. The referral EMAIL (sent on admission by
    // ensureAndSendReferralInvite when WhatsApp is off) keeps the referral cycle
    // reaching residents. The discount ENGINE stays on referral_enabled
    // (plan-driven) and is untouched by this gate.
    if (!hostel.referral_enabled) return { sent: false, reason: "referrals_off" };
    if (hostel.referral_campaign !== "active") return { sent: false, reason: "campaign_not_active" };
    if (!hostel.whatsapp_enabled) return { sent: false, reason: "whatsapp_off" };
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


/**
 * Email counterpart of sendReferralInvite — used on admission when a branch's
 * WhatsApp is off (self-registered). Mirrors its load + gates + status-token mint,
 * then sends the referral EMAIL and stamps link_sent_at the SAME way, so the two
 * channels share one "already sent" guard and a resident is never double-invited.
 * Kept separate (not folded into sendReferralInvite) so the revenue-critical
 * WhatsApp path stays untouched.
 */
async function sendReferralInviteEmailForCode(
  admin: Admin,
  codeRowId: string
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { data: row } = await admin
      .from("hms_referral_codes")
      .select(
        "id, code, tenant_id, hostel_id, is_active, link_sent_at, status_token_hash, " +
          "tenant:hms_tenants(full_name, email, is_active, is_waiting), " +
          "hostel:hms_hostels(name, country, referral_enabled, referral_campaign, " +
          "referral_referrer_percent, referral_referred_percent)"
      )
      .eq("id", codeRowId)
      .maybeSingle();
    if (!row) return { sent: false, reason: "no_code" };
    type Emb<T> = T | T[] | null;
    const r = row as unknown as {
      id: string; code: string; tenant_id: string; hostel_id: string;
      is_active: boolean; link_sent_at: string | null; status_token_hash: string | null;
      tenant: Emb<{ full_name: string; email: string | null; is_active: boolean; is_waiting: boolean }>;
      hostel: Emb<{ name: string; country: string | null; referral_enabled: boolean; referral_campaign: string;
                    referral_referrer_percent: number; referral_referred_percent: number }>;
    };
    if (!r.is_active) return { sent: false, reason: "no_code" };
    if (r.link_sent_at) return { sent: false, reason: "already_sent" };

    const tenant = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
    const hostel = Array.isArray(r.hostel) ? r.hostel[0] : r.hostel;
    if (!tenant || !hostel) return { sent: false, reason: "no_tenant" };

    if (!hostel.referral_enabled) return { sent: false, reason: "referrals_off" };
    if (hostel.referral_campaign !== "active") return { sent: false, reason: "campaign_not_active" };
    if (!tenant.is_active || tenant.is_waiting) return { sent: false, reason: "not_resident" };

    const email = (tenant.email ?? "").trim();
    if (!email) return { sent: false, reason: "no_email" };

    const referrerPct = Number(hostel.referral_referrer_percent ?? 0);
    const referredPct = Number(hostel.referral_referred_percent ?? 0);
    if (referrerPct < 1 || referredPct < 1) return { sent: false, reason: "no_offer" };

    // Status token — same mint-once posture as the WhatsApp path: the raw value
    // exists only at mint time, stored one-way as a hash.
    let rawToken: string | null = null;
    const tokenHash = r.status_token_hash;
    if (!tokenHash) {
      const minted = mintStatusToken();
      rawToken = minted.raw;
      const { error: tokErr } = await admin
        .from("hms_referral_codes")
        .update({ status_token_hash: minted.hash })
        .eq("id", r.id)
        .is("status_token_hash", null);
      if (tokErr) return { sent: false, reason: "token_failed" };
    }
    if (!rawToken) {
      const minted = mintStatusToken();
      rawToken = minted.raw;
      await admin.from("hms_referral_codes").update({ status_token_hash: minted.hash }).eq("id", r.id);
    }

    const firstName = String(tenant.full_name ?? "").trim().split(/\s+/)[0] || "there";

    await sendReferralInviteEmail({
      tenantEmail: email,
      firstName,
      hostelName: hostel.name ?? "your hostel",
      country: hostel.country ?? null,
      refLink: `${SITE_URL}/ref/${r.code}`,
      referrerPct,
      referredPct,
      statusUrl: referralStatusUrl(rawToken),
    });

    // Stamped only AFTER the send, and on the SAME column the WhatsApp path uses,
    // so a later channel switch cannot re-invite the same resident.
    await admin
      .from("hms_referral_codes")
      .update({ link_sent_at: new Date().toISOString() })
      .eq("id", r.id);

    return { sent: true };
  } catch (err) {
    console.error(
      "[sendReferralInviteEmailForCode] failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return { sent: false, reason: "error" };
  }
}


/**
 * Send a tenant their referral link on the right channel: WhatsApp when a Super
 * Admin has granted it (whatsapp_enabled), otherwise the referral EMAIL. Shared by
 * the on-admission invite AND the owner "Start campaign" blast, so a WhatsApp-off
 * (self-registered) branch reaches every tenant who has an email.
 *
 * The fallback is BRANCH-LEVEL (only whatsapp_off), not per-tenant: a WhatsApp-ON
 * branch behaves exactly as before — a tenant with no phone is skipped, NOT
 * emailed — so this changes nothing for existing WhatsApp branches. sendReferralInvite
 * returns whatsapp_off BEFORE any DB write, so falling through has no side effects;
 * every other reason (already_sent, no_phone, no_offer, send_failed, …) is returned as-is.
 */
export async function sendReferralInviteAnyChannel(
  admin: Admin,
  codeRowId: string
): Promise<{ sent: boolean; reason?: string }> {
  const wa = await sendReferralInvite(admin, codeRowId);
  if (wa.reason === "whatsapp_off") {
    return await sendReferralInviteEmailForCode(admin, codeRowId);
  }
  return wa;
}


/**
 * Assemble the referral section for the ONE consolidated welcome email (admission),
 * for WhatsApp-off / self-registered branches. Ensures the tenant has a code and
 * mints the status token, and returns the link + offer — but does NOT stamp
 * link_sent_at. The welcome email stamps it (markReferralInviteSent) only AFTER a
 * successful send, so a failed email never marks the resident invited. Returns null
 * when the referral programme is inactive, the offer is unset, or the tenant was
 * already invited (so the campaign/WhatsApp guard is respected — no double-invite).
 */
export async function prepareReferralEmailSection(
  admin: Admin,
  hostelId: string,
  tenantId: string
): Promise<{ codeId: string; link: string; referrerPct: number; referredPct: number; statusUrl: string } | null> {
  try {
    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("referral_enabled, referral_campaign, referral_referrer_percent, referral_referred_percent")
      .eq("id", hostelId)
      .maybeSingle();
    if (!hostel?.referral_enabled) return null;
    if (hostel.referral_campaign !== "active") return null;
    const referrerPct = Number(hostel.referral_referrer_percent ?? 0);
    const referredPct = Number(hostel.referral_referred_percent ?? 0);
    if (referrerPct < 1 || referredPct < 1) return null;

    const { data: existing } = await admin
      .from("hms_referral_codes")
      .select("id, code, link_sent_at, status_token_hash")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .maybeSingle();
    if (existing?.link_sent_at) return null;

    let codeId = existing?.id as string | undefined;
    let code = existing?.code as string | undefined;
    let tokenHash = (existing?.status_token_hash as string | null | undefined) ?? null;
    if (!codeId) {
      for (let attempt = 0; attempt < 5 && !codeId; attempt++) {
        const c = generateReferralCode();
        const { data: inserted, error } = await admin
          .from("hms_referral_codes")
          .insert({ tenant_id: tenantId, hostel_id: hostelId, code: c })
          .select("id, code, status_token_hash")
          .maybeSingle();
        if (!error) {
          codeId = inserted?.id as string | undefined;
          code = inserted?.code as string | undefined;
          tokenHash = (inserted?.status_token_hash as string | null | undefined) ?? null;
          break;
        }
        if (error.code !== "23505") return null;
        const { data: raced } = await admin
          .from("hms_referral_codes")
          .select("id, code, link_sent_at, status_token_hash")
          .eq("tenant_id", tenantId).eq("hostel_id", hostelId).eq("is_active", true)
          .maybeSingle();
        if (raced?.link_sent_at) return null;
        codeId = raced?.id as string | undefined;
        code = raced?.code as string | undefined;
        tokenHash = (raced?.status_token_hash as string | null | undefined) ?? null;
      }
    }
    if (!codeId || !code) return null;

    let rawToken: string | null = null;
    if (!tokenHash) {
      const minted = mintStatusToken();
      rawToken = minted.raw;
      const { error: tokErr } = await admin
        .from("hms_referral_codes")
        .update({ status_token_hash: minted.hash })
        .eq("id", codeId)
        .is("status_token_hash", null);
      if (tokErr) return null;
    }
    if (!rawToken) {
      const minted = mintStatusToken();
      rawToken = minted.raw;
      await admin.from("hms_referral_codes").update({ status_token_hash: minted.hash }).eq("id", codeId);
    }

    return {
      codeId,
      link: `${SITE_URL}/ref/${code}`,
      referrerPct,
      referredPct,
      statusUrl: referralStatusUrl(rawToken),
    };
  } catch (err) {
    console.error("[prepareReferralEmailSection] failed:", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

/** Stamp link_sent_at after the welcome email that carried the referral actually
 *  sent, so the campaign and WhatsApp never re-invite the same resident. */
export async function markReferralInviteSent(admin: Admin, codeId: string): Promise<void> {
  await admin
    .from("hms_referral_codes")
    .update({ link_sent_at: new Date().toISOString() })
    .eq("id", codeId);
}


/**
 * Give a newly admitted tenant their referral link: mint a code if they have
 * none, then send it.
 *
 * Lives HERE, taking an admin client and a hostel id, rather than in
 * app/actions/referrals.ts — the action wrapper there resolves the branch
 * through requireOwnerOrAbove(), and three of the four admission paths do not
 * run as an owner. A manager admitting a tenant would throw inside that check
 * and be swallowed by the caller's catch, which is exactly how an approved
 * application produced a tenant with no code and no message.
 *
 * Each caller has already authorised the admission by the time it gets here;
 * re-authorising as an owner would only exclude the legitimate ones.
 *
 * FAIL-OPEN and never awaited for correctness: a marketing message must never
 * be able to fail an admission.
 */
export async function ensureAndSendReferralInvite(
  admin: Admin,
  hostelId: string,
  tenantId: string
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("referral_enabled, referral_campaign, whatsapp_enabled, referral_referrer_percent, referral_referred_percent")
      .eq("id", hostelId)
      .maybeSingle();

    // Gated on the campaign as well as the entitlement, so an admission on a
    // branch that never opted in does not quietly accumulate codes.
    if (!hostel?.referral_enabled) return { sent: false, reason: "referrals_off" };
    if (hostel.referral_campaign !== "active") {
      return { sent: false, reason: "campaign_not_active" };
    }
    // Do not mint a code (or send) until the reward is actually configured — no
    // link exists on a branch that has not set both percentages.
    if (Number(hostel.referral_referrer_percent ?? 0) < 1 || Number(hostel.referral_referred_percent ?? 0) < 1) {
      return { sent: false, reason: "no_offer" };
    }

    // link_sent_at is deliberately not part of this lookup: filtering on it
    // makes an already-messaged tenant look like one with no code, and the mint
    // below would then issue a second link, silently retiring the one already
    // in their WhatsApp. Fetch first, decide second.
    const { data: existing } = await admin
      .from("hms_referral_codes")
      .select("id, link_sent_at")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .maybeSingle();

    if (existing?.link_sent_at) return { sent: false, reason: "already_sent" };

    let codeId = existing?.id as string | undefined;
    if (!codeId) {
      for (let attempt = 0; attempt < 5 && !codeId; attempt++) {
        const code = generateReferralCode();
        const { data: inserted, error } = await admin
          .from("hms_referral_codes")
          .insert({ tenant_id: tenantId, hostel_id: hostelId, code })
          .select("id")
          .maybeSingle();
        if (!error) {
          codeId = inserted?.id as string | undefined;
          break;
        }
        // 23505 is the unique violation on the code itself — a collision in the
        // alphabet, not a duplicate tenant. Anything else is a real failure.
        if (error.code !== "23505") return { sent: false, reason: "mint_failed" };
        const { data: raced } = await admin
          .from("hms_referral_codes")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("hostel_id", hostelId)
          .eq("is_active", true)
          .maybeSingle();
        codeId = raced?.id as string | undefined;
      }
    }
    if (!codeId) return { sent: false, reason: "no_code" };

    // WhatsApp only. On admission the referral EMAIL is folded into the ONE
    // welcome email (lib/welcome-email.ts) for WhatsApp-off branches, so here we
    // only send the WhatsApp invite where a Super Admin has granted it. A
    // WhatsApp-off branch returns whatsapp_off and the welcome email carries the
    // referral instead — sharing the same link_sent_at guard, so no double-invite.
    return await sendReferralInvite(admin, codeId);
  } catch (err) {
    console.error(
      "[ensureAndSendReferralInvite] failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return { sent: false, reason: "error" };
  }
}
