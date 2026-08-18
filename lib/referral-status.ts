import "server-only";

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneDigits } from "@/lib/phone";
import { siteUrl } from "@/lib/site-url";

// Server-side core for the tenant's own referral status page.
//
// Deliberately NOT "use server": every export of one of those files is a
// client-callable RPC, and minting a credential is not something a browser may
// ask for. The one function the public page needs is exported from
// app/actions/referral-status.ts.
//
// Same shape as lib/tenant-feedback.ts: the raw token is base64url and exists
// exactly once (in the WhatsApp message); only its SHA-256 hex digest is stored.
// The two shapes are mutually exclusive, so the CHECK on status_token_hash
// genuinely rejects a raw token written into the hash column by mistake.

const SITE_URL = siteUrl();

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function referralStatusUrl(rawToken: string): string {
  return `${SITE_URL}/rs/${rawToken}`;
}

/** 32 bytes = 256 bits, base64url, 43 chars. Guessing one is not a strategy. */
export function mintStatusToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export type ReferralStatus = {
  tenantName: string;
  hostelName: string;
  shareUrl: string;
  /** 'active' | 'paused' — 'off' can never reach here, since a link only exists
   *  once a campaign has run. Rendered so a tenant is told rather than left to
   *  wonder why their link stopped attracting anyone. */
  campaign: string;
  referrerPercent: number;
  referredPercent: number;
  totalReferred: number;
  joined: number;
  /** Money already taken off their bills — BOTH roles: what they earned by
   *  referring, plus the welcome discount for joining through someone's link.
   *  Every such row is a rupee off this tenant's own bill. */
  earned: number;
  /** The part of `earned` that is their own joining discount, so the page can
   *  explain a figure that would otherwise not match their referral count. */
  joiningDiscount: number;
  /** How many rewards are earned but not yet applied. */
  pending: number;
  /** What those pending rewards are worth, in rupees.
   *
   *  A scheduled reward stores only `percent` — applied_amount is filled at
   *  settlement — so this is rent x percent, the same estimate the Marketing
   *  page shows the owner. 0 when the rent is unknown (a daily-billed tenant),
   *  in which case the count is the only honest thing to show. */
  pendingAmount: number;
  /** First names only. Never a phone, a CNIC, a room, or a full name — this
   *  page is reachable by anyone holding the URL. */
  people: { name: string; joined: boolean }[];
};

/**
 * Resolves a status token AND verifies the phone the visitor typed.
 *
 * TWO factors on purpose. The token alone leaks — browser history, a forwarded
 * screenshot, an archive crawler — so possession of the link is not enough. The
 * phone is compared server-side and NEVER returned, so a wrong guess learns
 * nothing: the caller cannot tell a bad token from a bad phone, because both
 * answer null.
 */
export async function getReferralStatus(
  rawToken: string,
  typedPhone: string
): Promise<ReferralStatus | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const digits = normalizePhoneDigits(typedPhone);
  if (!digits) return null;

  const admin = createAdminClient();

  const { data: row } = await admin
    .from("hms_referral_codes")
    .select(
      "id, code, tenant_id, hostel_id, is_active, " +
        "tenant:hms_tenants(full_name, phone_digits, is_active, monthly_rent), " +
        "hostel:hms_hostels(name, referral_campaign, referral_referrer_percent, referral_referred_percent)"
    )
    .eq("status_token_hash", hashToken(rawToken))
    .maybeSingle();

  if (!row) return null;
  // The embed's inferred type is a union with an error shape; the runtime value
  // is the row. Narrowed once here rather than at each field.
  const r = row as unknown as {
    id: string; code: string; tenant_id: string; hostel_id: string;
    tenant: { full_name: string; phone_digits: string | null; is_active: boolean; monthly_rent: number | null }
          | { full_name: string; phone_digits: string | null; is_active: boolean; monthly_rent: number | null }[] | null;
    hostel: { name: string; referral_campaign: string; referral_referrer_percent: number; referral_referred_percent: number }
          | { name: string; referral_campaign: string; referral_referrer_percent: number; referral_referred_percent: number }[] | null;
  };

  const tenant = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
  const hostel = Array.isArray(r.hostel) ? r.hostel[0] : r.hostel;
  if (!tenant || !hostel) return null;

  // The second factor. A mismatch is indistinguishable from a bad token.
  if (tenant.phone_digits !== digits) return null;

  const [{ data: referrals, count: referralCount }, { count: joinedCount }, { data: rewards }] = await Promise.all([
    admin
      .from("hms_referrals")
      // Keyed on the REFERRER, not on this code. A rotated code leaves its
      // submissions pointing at the old row, and scoping to the live code told
      // a tenant who had referred five people that they had referred none.
      // Matches how the owner's Marketing page counts, so the two agree.
      //
      // count is exact and separate from the row limit: the limit caps the
      // NAMES rendered, and folding it into the totals silently capped anyone
      // past the 50th at 50.
      .select("name, status", { count: "exact" })
      .eq("referrer_tenant_id", r.tenant_id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Counted, not derived from the 50 names above — a prolific referrer past
    // that limit would have had their joins undercounted alongside them.
    admin
      .from("hms_referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_tenant_id", r.tenant_id)
      .eq("status", "joined"),
    admin
      .from("hms_referral_rewards")
      .select("role, status, percent, applied_amount")
      .eq("tenant_id", r.tenant_id)
      .neq("status", "void"),
  ]);

  const list = referrals ?? [];
  const all = rewards ?? [];

  // BOTH roles. Every one of these rows is money coming off THIS tenant's own
  // bill: 'referrer' is what they earned by referring, 'referred' is the
  // welcome discount they got for joining through somebody else's link.
  // Counting only the first told a tenant whose bill already showed a Rs 1,500
  // referral discount that they had earned Rs 0 — the page and their bill
  // disagreeing about their own money.
  const applied = all.filter((w) => w.status === "applied");
  const earned = applied.reduce((s, w) => s + Number(w.applied_amount ?? 0), 0);
  const joiningDiscount = applied
    .filter((w) => w.role === "referred")
    .reduce((s, w) => s + Number(w.applied_amount ?? 0), 0);

  const pendingRewards = all.filter(
    (w) => w.status === "scheduled" || w.status === "held"
  );
  // "Rs 0 earned, 1 pending" is what a tenant saw after successfully referring
  // somebody who joined AND paid — a count answers "how many", when the only
  // question they have is "how much". Estimated off their own rent and percent,
  // the same way estimateRewardValue does for the owner, so the two screens
  // cannot disagree.
  const rent = Number(tenant.monthly_rent ?? 0);
  const pendingAmount = pendingRewards.reduce(
    (s, w) => s + Math.round((rent * Number(w.percent ?? 0)) / 100),
    0
  );

  return {
    tenantName: tenant.full_name ?? "",
    hostelName: hostel.name ?? "",
    shareUrl: `${SITE_URL}/ref/${r.code}`,
    campaign: hostel.referral_campaign ?? "active",
    referrerPercent: Number(hostel.referral_referrer_percent ?? 0),
    referredPercent: Number(hostel.referral_referred_percent ?? 0),
    totalReferred: referralCount ?? list.length,
    joined: joinedCount ?? list.filter((x) => x.status === "joined").length,
    earned,
    joiningDiscount,
    pending: pendingRewards.length,
    pendingAmount,
    // FIRST NAME ONLY. The full name of somebody who did not consent to appear
    // on a page their friend can forward is not ours to publish.
    people: list.map((r) => ({
      name: String(r.name ?? "").trim().split(/\s+/)[0] || "Someone",
      joined: r.status === "joined",
    })),
  };
}
