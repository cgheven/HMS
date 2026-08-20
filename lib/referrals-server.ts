import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeReferralCode, REFERRAL_VIEW_HOURLY_LIMIT } from "@/lib/referrals";

// Deliberately NOT a "use server" module. Every export of a "use server" file is
// a directly invocable POST endpoint, and code resolution has no business being
// one: its only caller is the /ref/[code] server component, and as an action it
// was an unmetered service-role query anyone holding a link could loop.

// A link pasted into a chat is fetched by the messenger to build its preview
// card, and that arrives here as a normal request with a bot user-agent. It is
// the only observable trace of a share — forwarding itself is invisible to us —
// and it is also the thing that would silently inflate opens if left unsplit.
//
// Matched loosely on purpose. A crawler we fail to recognise lands in `view`
// and overstates opens; one we match wrongly lands in `share` and understates
// them. Neither is recoverable from the counter afterwards, so the list covers
// the messengers this product is actually shared through, plus the generic
// bot markers, and nothing speculative.
const PREVIEW_BOT_RE =
  /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|viber|line-podcast|snapchat|pinterest|redditbot|googlebot|bingbot|embedly|quora link preview|bot\b|crawler|spider|preview/i;

/**
 * Records one hit against a referral link, split into open vs share.
 *
 * The RPC write is deferred with after() so it stays off the response path, but
 * the request state it depends on is read during the render — see below. Every
 * failure is swallowed: analytics is never a reason to fail somebody's link.
 */
async function trackLinkHit(
  admin: ReturnType<typeof createAdminClient>,
  codeId: string
): Promise<void> {
  // The user-agent is read HERE, inside the render, not inside after().
  // Request APIs are not reliably reachable from an after() callback — the
  // headers() call threw there, was swallowed by the inner catch, and the
  // feature silently counted nothing at all. Capture request state while the
  // request still exists; leave only the write for afterwards.
  let ua = "";
  try {
    ua = (await headers()).get("user-agent") ?? "";
  } catch {
    return;
  }
  const kind = PREVIEW_BOT_RE.test(ua) ? "share" : "view";
  const write = async () => {
    try {
      await admin.rpc("hms_referral_link_hit", { p_code_id: codeId, p_kind: kind });
    } catch {
      // Swallowed by design: a counter is never a reason to fail a referral link.
    }
  };
  try {
    after(write);
  } catch {
    // No after() scope (a non-request caller). Writing inline is slower than
    // deferring but silently losing every count is worse.
    await write();
  }
}

/**
 * Read the client IP the way the rest of the codebase does — rightmost entry,
 * set by the trusted proxy, never the client-supplied left of the chain.
 * `||` and not `??`: a proxy that sets x-real-ip to "" must fall through, and
 * an empty string is exactly the value that has silently disabled a rate limit
 * in this codebase before.
 */
export async function clientIp(): Promise<string | null> {
  try {
    const headersList = await headers();
    return (
      headersList.get("x-vercel-forwarded-for") ||
      headersList.get("x-real-ip") ||
      headersList.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      null
    );
  } catch {
    return null;
  }
}

export type ReferralTarget =
  /**
   * hostelName is the only thing about the branch the public page may name.
   * referredPercent rides along because it IS the offer — a stranger has no
   * reason to fill the form without it — and it costs no extra query: the
   * branch row is already being read to check referral_enabled. 0 means the
   * owner runs referrer-only mode, and the page then makes no promise.
   *
   * `source` rides on THIS variant and no other. A caller who reaches "ok"
   * already holds a working code, so naming who circulated it leaks nothing;
   * putting it on a refusal would turn the answer into a code-validity oracle.
   */
  | { kind: "ok"; hostelName: string; referredPercent: number; source: "tenant" | "pulse" }
  /** The branch has paused its campaign. Distinct from "dead": the link is
   *  genuinely theirs and will work again, so telling a stranger it is dead
   *  would be both wrong and a lost referral once it resumes. */
  | { kind: "paused"; hostelName: string }
  /** Unknown, rotated, referrer gone, branch not entitled — one answer for all. */
  | { kind: "dead" }
  /** Infrastructure, not the code: safe to invite a retry, leaks nothing. */
  | { kind: "unavailable" };

/**
 * Resolves a code for the public page.
 *
 * Every code-dependent failure collapses to "dead" because a distinguishable
 * response is an oracle for which codes exist. A DB error is NOT code-dependent
 * — answering it with "dead" tells a real prospect their friend's link is
 * broken and loses the lead — so it gets its own retryable answer.
 */
export async function getReferralTarget(rawCode: string): Promise<ReferralTarget> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return { kind: "dead" };

  const admin = createAdminClient();
  const ip = await clientIp();

  const { data: allowed, error: rateErr } = await admin.rpc("hms_referral_rate_hit", {
    p_bucket: `view:${ip ?? "unknown"}`,
    p_limit: REFERRAL_VIEW_HOURLY_LIMIT,
  });
  // Fail closed on both: an unverifiable ceiling is no ceiling.
  if (rateErr) {
    console.error("[getReferralTarget] rate check failed:", rateErr.code ?? "unknown");
    return { kind: "unavailable" };
  }
  if (allowed === false) return { kind: "unavailable" };

  const { data, error } = await admin
    .from("hms_referral_codes")
    .select(
      "id, is_active, source, tenant:hms_tenants(is_active, is_waiting), hostel:hms_hostels(name, referral_enabled, referral_referred_percent, referral_campaign)"
    )
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[getReferralTarget] DB error:", error.code ?? "unknown");
    return { kind: "unavailable" };
  }
  if (!data) return { kind: "dead" };

  type Row = {
    id: string;
    is_active: boolean;
    source: string;
    tenant: { is_active: boolean; is_waiting: boolean } | { is_active: boolean; is_waiting: boolean }[] | null;
    hostel:
      | { name: string; referral_enabled: boolean; referral_referred_percent: number; referral_campaign: string }
      | { name: string; referral_enabled: boolean; referral_referred_percent: number; referral_campaign: string }[]
      | null;
  };
  const row = data as unknown as Row;
  const tenant = Array.isArray(row.tenant) ? row.tenant[0] : row.tenant;
  const hostel = Array.isArray(row.hostel) ? row.hostel[0] : row.hostel;
  // Narrowed rather than cast: the column is a CHECK-constrained text, and
  // anything unrecognised must degrade to the stricter tenant path, not to the
  // one that skips the resident gate.
  const source: "tenant" | "pulse" = row.source === "pulse" ? "pulse" : "tenant";

  if (!row.is_active) return { kind: "dead" };
  // is_active alone is not the house definition of an active tenant: a
  // waiting-list row can be is_active with is_waiting true, and someone who has
  // never moved in is not a resident handing out a link.
  //
  // A Pulse code has no tenant behind it at all, so the resident gate is not
  // merely skipped for it — it has nothing to read. Every other gate above and
  // below still applies, and a Pulse code on a disabled branch falls through to
  // the same hostel gate and the same indistinguishable "dead".
  if (source !== "pulse" && (!tenant?.is_active || tenant.is_waiting)) return { kind: "dead" };
  if (!hostel?.referral_enabled) return { kind: "dead" };

  // Clamped rather than trusted: the column is CHECK-constrained, but this
  // value is rendered to the public as a promise the owner must honour.
  const pct = Math.max(0, Math.min(100, Math.trunc(Number(hostel.referral_referred_percent ?? 0))));

  // A Pulse link on a branch discounting 0% is dead, and hms_submit_referral
  // refuses it identically. There is no referrer to reward and nothing to
  // promise the visitor, so the page would be advertising nothing — and the
  // owner would be taking public lead-gen while Pulse earned no commission,
  // because the fee is gated on the referral having actually paid somebody.
  //
  // A TENANT link at 0% is deliberately untouched: it can still pay its
  // referrer, so it is a real offer to a real person.
  if (source === "pulse" && pct < 1) return { kind: "dead" };

  // Counted from here on, where the link is known to be real and live.
  // Dead links are not counted at all: a mistyped code is not an open, and
  // letting it increment anything would make the funnel countable by strangers.
  // Deliberately above the paused check — a paused campaign still tells the
  // owner their tenants are circulating the link.
  await trackLinkHit(admin, row.id);
  // Paused, not dead. The link is genuine and works again the moment the owner
  // resumes, so a stranger is told to come back rather than told it is broken.
  if (hostel.referral_campaign === "paused") {
    return { kind: "paused", hostelName: hostel.name };
  }

  return { kind: "ok", hostelName: hostel.name, referredPercent: pct, source };
}
