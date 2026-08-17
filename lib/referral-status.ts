import "server-only";

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneDigits } from "@/lib/phone";

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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io";

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
  /** Money already taken off their bills. */
  earned: number;
  /** Earned but not yet applied — a promise, shown separately so it never reads
   *  as money they already have. */
  pending: number;
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
        "tenant:hms_tenants(full_name, phone_digits, is_active), " +
        "hostel:hms_hostels(name, referral_campaign, referral_referrer_percent, referral_referred_percent)"
    )
    .eq("status_token_hash", hashToken(rawToken))
    .maybeSingle();

  if (!row) return null;
  // The embed's inferred type is a union with an error shape; the runtime value
  // is the row. Narrowed once here rather than at each field.
  const r = row as unknown as {
    id: string; code: string; tenant_id: string; hostel_id: string;
    tenant: { full_name: string; phone_digits: string | null; is_active: boolean }
          | { full_name: string; phone_digits: string | null; is_active: boolean }[] | null;
    hostel: { name: string; referral_campaign: string; referral_referrer_percent: number; referral_referred_percent: number }
          | { name: string; referral_campaign: string; referral_referrer_percent: number; referral_referred_percent: number }[] | null;
  };

  const tenant = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
  const hostel = Array.isArray(r.hostel) ? r.hostel[0] : r.hostel;
  if (!tenant || !hostel) return null;

  // The second factor. A mismatch is indistinguishable from a bad token.
  if (tenant.phone_digits !== digits) return null;

  const [{ data: referrals }, { data: rewards }] = await Promise.all([
    admin
      .from("hms_referrals")
      .select("name, status")
      .eq("code_id", r.id)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("hms_referral_rewards")
      .select("status, percent, applied_amount")
      .eq("tenant_id", r.tenant_id)
      .eq("role", "referrer")
      .neq("status", "void"),
  ]);

  const list = referrals ?? [];
  const earned = (rewards ?? [])
    .filter((r) => r.status === "applied")
    .reduce((s, r) => s + Number(r.applied_amount ?? 0), 0);
  const pending = (rewards ?? []).filter(
    (r) => r.status === "scheduled" || r.status === "held"
  ).length;

  return {
    tenantName: tenant.full_name ?? "",
    hostelName: hostel.name ?? "",
    shareUrl: `${SITE_URL}/ref/${r.code}`,
    campaign: hostel.referral_campaign ?? "active",
    referrerPercent: Number(hostel.referral_referrer_percent ?? 0),
    referredPercent: Number(hostel.referral_referred_percent ?? 0),
    totalReferred: list.length,
    joined: list.filter((r) => r.status === "joined").length,
    earned,
    pending,
    // FIRST NAME ONLY. The full name of somebody who did not consent to appear
    // on a page their friend can forward is not ours to publish.
    people: list.map((r) => ({
      name: String(r.name ?? "").trim().split(/\s+/)[0] || "Someone",
      joined: r.status === "joined",
    })),
  };
}
