import "server-only";

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  FeedbackFood,
  FeedbackRating,
  FeedbackRecommend,
  FeedbackRoommate,
} from "@/types";

// Server-side core for tenant checkout feedback.
//
// Deliberately NOT a "use server" file — every export from one of those becomes
// a client-callable RPC, and minting a token is emphatically not something a
// browser may ask for. The one function the public form needs is exported from
// app/actions/feedback.ts instead.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io";

// 32 bytes = 256 bits, base64url = 43 characters, no padding.
//
// The raw token is base64url while the stored digest is hex, ON PURPOSE: the
// two shapes are mutually exclusive, so migration 161's
// CHECK (token_hash ~ '^[0-9a-f]{64}$') genuinely rejects a raw token written
// into the hash column by mistake. Had both been hex the constraint would have
// been decorative.
const RAW_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function feedbackUrl(rawToken: string): string {
  return `${SITE_URL}/fb/${rawToken}`;
}

/**
 * Mint a single-use feedback credential for a tenant who has just checked out.
 *
 * Returns the absolute URL to put in the WhatsApp {{5}} variable, or null if
 * anything at all went wrong. NEVER throws: this runs at the tail of
 * performTenantCheckout, and a tenant must always be able to leave even when
 * the feedback subsystem is having a bad day.
 *
 * THE RETURN VALUE IS A LIVE WRITE CREDENTIAL. It must reach the tenant's
 * WhatsApp message and nothing else — never a Server Action return value, never
 * a log line, never a page payload. Whoever holds it can author the response,
 * and question 3 asks the tenant to rate the hostel staff, so the one party
 * that must never hold it is the person who ran the checkout.
 *
 * Rotates rather than reuses. The raw value is not recoverable from the stored
 * hash, and migration 161's partial unique index allows at most one live token
 * per tenant, so a re-issue MUST revoke the outstanding one first.
 */
export async function mintFeedbackToken(
  hostelId: string,
  tenantId: string
): Promise<string | null> {
  try {
    const admin = createAdminClient();

    // Already answered? Then there is nothing left to authorise, and issuing a
    // second link would only produce a link that can never be redeemed (the
    // UNIQUE (tenant_id) on hms_tenant_feedback would reject the insert).
    const { data: existing } = await admin
      .from("hms_tenant_feedback")
      .select("id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existing) return null;

    await admin
      .from("hms_feedback_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .is("consumed_at", null)
      .is("revoked_at", null);

    const raw = randomBytes(32).toString("base64url");

    const { error } = await admin.from("hms_feedback_tokens").insert({
      // Only the digest ever reaches the database. The raw value lives in the
      // WhatsApp message and the tenant's URL bar, nowhere else.
      token_hash: hashToken(raw),
      tenant_id: tenantId,
      hostel_id: hostelId,
    });
    if (error) return null;

    return feedbackUrl(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve a raw token for rendering the form.
 *
 * Returns the hostel NAME and nothing else when the token is live, and null in
 * every other case — unknown, malformed, expired, revoked, already consumed.
 * The single failure shape is the point: the caller has no reason code to
 * branch on, so it cannot accidentally build a page that tells a stranger which
 * tokens exist.
 */
export async function resolveFeedbackToken(
  rawToken: string
): Promise<{ hostelName: string } | null> {
  if (!RAW_TOKEN_SHAPE.test(rawToken ?? "")) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hms_feedback_token_hostel", {
      p_token_hash: hashToken(rawToken),
    });

    const rows = (data ?? []) as { hostel_name: string }[];
    if (error || rows.length === 0) return null;

    return { hostelName: rows[0].hostel_name };
  } catch {
    return null;
  }
}

export interface FeedbackAnswers {
  food: FeedbackFood;
  cleanliness: FeedbackRating;
  staff: FeedbackRating;
  roommate: FeedbackRoommate;
  recommend: FeedbackRecommend;
  comment: string | null;
}

export interface SubmittedFeedback {
  feedbackId: string;
  tenantId: string;
  hostelId: string;
  needsAttention: boolean;
}

/**
 * Claim the token and record the response, atomically, in one statement pair
 * inside one database transaction (see hms_submit_tenant_feedback in migration
 * 161). Returns null when the token was not live — same shape for all four
 * reasons, so two concurrent submits produce exactly one response and the loser
 * is indistinguishable from a stranger with a guessed token.
 *
 * THROWS when the database could not be reached or the call itself failed.
 * That is a different thing from "the token was not live" and the caller must
 * be able to tell them apart: one means the tenant's feedback is recorded and
 * the link is spent, the other means nothing was written and retrying is both
 * free and the only way they will ever be heard. Collapsing the two is what
 * made the form tell tenants their lost answers had been received.
 */
export async function submitFeedback(
  rawToken: string,
  answers: FeedbackAnswers,
  meta: { ip: string | null; agent: string | null }
): Promise<SubmittedFeedback | null> {
  if (!RAW_TOKEN_SHAPE.test(rawToken ?? "")) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("hms_submit_tenant_feedback", {
    p_token_hash: hashToken(rawToken),
    p_food: answers.food,
    p_cleanliness: answers.cleanliness,
    p_staff: answers.staff,
    p_roommate: answers.roommate,
    p_recommend: answers.recommend,
    p_comment: answers.comment,
    p_ip: meta.ip,
    p_agent: meta.agent,
  });

  if (error) throw new Error(`hms_submit_tenant_feedback: ${error.message}`);

  const rows = (data ?? []) as {
    feedback_id: string;
    tenant_id: string;
    hostel_id: string;
    needs_attention: boolean;
  }[];
  if (rows.length === 0) return null;

  return {
    feedbackId: rows[0].feedback_id,
    tenantId: rows[0].tenant_id,
    hostelId: rows[0].hostel_id,
    needsAttention: rows[0].needs_attention,
  };
}

// Shape check, not validation. The point is that hms_tenant_feedback.submitted_ip
// is a bare text column: without this, whatever the header happened to contain
// is stored verbatim, and a forensic column that holds attacker-chosen text is
// not evidence of anything.
function isIpLiteral(v: string): boolean {
  if (v.length === 0 || v.length > 45) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return true;
  return v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v);
}

/**
 * Client IP, recorded on the response purely as forensics.
 *
 * The LAST x-forwarded-for hop, then x-real-ip. That order matters: the last
 * entry is the one the platform's own proxy appended and is the only part of
 * the chain the client could not write. x-real-ip is trustworthy on Vercel
 * today because the platform sets it, but it is a plain request header — put
 * anything else in front of the app, or reach the origin directly, and it
 * becomes whatever the caller typed. The leftmost x-forwarded-for entry is
 * client-supplied on every deployment; app/actions/onboarding-intake.ts reads
 * that one and has exactly that bug — do not copy it.
 */
export function clientIpFromHeaders(h: Headers): string | null {
  const last = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (last && isIpLiteral(last)) return last;

  const real = h.get("x-real-ip")?.trim();
  if (real && isIpLiteral(real)) return real;

  return null;
}
