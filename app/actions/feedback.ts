"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFeedbackAlertEmail } from "@/lib/email";
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FOOD_OPTIONS,
  RATING_OPTIONS,
  RECOMMEND_OPTIONS,
  ROOMMATE_OPTIONS,
  feedbackChips,
  feedbackTriggers,
} from "@/lib/feedback-options";
import { clientIpFromHeaders, submitFeedback } from "@/lib/tenant-feedback";
import type {
  FeedbackFood,
  FeedbackRating,
  FeedbackRecommend,
  FeedbackRoommate,
} from "@/types";

// Runtime allowlists. The TypeScript unions on the payload are erased before
// the request arrives, so these Sets are the real gate — anything not in them
// is rejected before it can reach the database (where a CHECK constraint would
// reject it a second time).
const FOOD_SET = new Set<string>(FOOD_OPTIONS);
const RATING_SET = new Set<string>(RATING_OPTIONS);
const ROOMMATE_SET = new Set<string>(ROOMMATE_OPTIONS);
const RECOMMEND_SET = new Set<string>(RECOMMEND_OPTIONS);

export interface FeedbackSubmission {
  food: string;
  cleanliness: string;
  staff: string;
  roommate: string;
  recommend: string;
  comment?: string | null;
}

/**
 * Public, unauthenticated feedback submission. Anyone holding a link can call
 * this, so it trusts nothing it is given except the token — and the token is
 * only ever spent by the database, in one atomic claim-and-insert.
 *
 * There is deliberately no error string, no reason code and no distinction
 * between "already submitted", "expired", "revoked" and "never existed": the
 * resolver in the database returns zero rows for all four, so this action has
 * nothing to leak even if someone later tries to be helpful.
 *
 * `retry` is the one thing worth distinguishing, and it is not an oracle: it
 * says the request failed BEFORE the token was ever judged, so nothing was
 * written and nothing was spent. Without it, a tenant whose submit hit a
 * database blip was told their feedback had been received and that the link
 * only worked once — which destroyed the answers this feature exists to
 * collect, silently, and told them not to try again.
 */
export async function submitTenantFeedbackAction(
  token: string,
  answers: FeedbackSubmission
): Promise<{ ok: boolean; retry?: boolean }> {
  try {
    // Cheapest checks first, and the length check BEFORE the rewrite below on
    // purpose. This action is public and unauthenticated and the app's
    // serverActions.bodySizeLimit is 30mb, so a global replace plus a trim over
    // a 25MB comment allocates several more full-size copies of it per request
    // — all before anything has so much as looked at the token. .length on the
    // raw string costs nothing; the rewrite runs only for input already inside
    // the cap.
    if (
      !token ||
      !FOOD_SET.has(answers?.food) ||
      !RATING_SET.has(answers?.cleanliness) ||
      !RATING_SET.has(answers?.staff) ||
      !ROOMMATE_SET.has(answers?.roommate) ||
      !RECOMMEND_SET.has(answers?.recommend) ||
      (answers?.comment ?? "").length > FEEDBACK_COMMENT_MAX_LENGTH
    ) {
      return { ok: false };
    }

    const h = await headers();
    const ip = clientIpFromHeaders(h);

    // Normalisation only — trim, drop control characters that carry no meaning
    // in a sentence, cap the length. Nothing here rewrites the tenant's words:
    // the comment is stored VERBATIM and escaped at render, per destination.
    // See the column comment in migration 161 for why input-time sanitising is
    // the wrong answer for a value that lands in HTML, an email body and
    // possibly a CSV cell.
    //
    // Two classes, and the second is not cosmetic. First C0 and DEL except \n
    // and \t — \r is in the set now; it survived the old class by accident,
    // and a lone CR is the header- and CSV-injection character of that range.
    // Then the bidi and invisible format controls: U+202E and its neighbours
    // reorder what a mail client or the dashboard DISPLAYS, so the owner can
    // read a sentence the tenant never wrote. Stripping them is the opposite of
    // sanitising — it is what keeps the rendering equal to the testimony.
    const rawComment = (answers.comment ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      .trim();
    const comment = rawComment.length > 0 ? rawComment : null;

    const result = await submitFeedback(
      token,
      {
        food: answers.food as FeedbackFood,
        cleanliness: answers.cleanliness as FeedbackRating,
        staff: answers.staff as FeedbackRating,
        roommate: answers.roommate as FeedbackRoommate,
        recommend: answers.recommend as FeedbackRecommend,
        comment,
      },
      { ip, agent: h.get("user-agent")?.slice(0, 400) ?? null }
    );

    if (!result) return { ok: false };

    // Gated on the database's own GENERATED column, never recomputed here.
    //
    // after() rather than a floating promise. The response still goes back to
    // the tenant immediately, but the runtime now knows work is outstanding and
    // keeps the instance alive to finish it — a bare `void somePromise()` in a
    // serverless function is racing the freeze that follows the response, and
    // the only immediate alert this feature has is not something to leave to
    // that race.
    if (result.needsAttention) {
      const feedbackId = result.feedbackId;
      after(() =>
        notifyOwnerOfNegativeFeedback(feedbackId, result.hostelId, result.tenantId, {
          food: answers.food as FeedbackFood,
          cleanliness: answers.cleanliness as FeedbackRating,
          staff: answers.staff as FeedbackRating,
          roommate: answers.roommate as FeedbackRoommate,
          recommend: answers.recommend as FeedbackRecommend,
          comment,
        })
      );
    }

    revalidatePath("/feedback");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    // Never surface raw error text to an anonymous caller, and never a reason —
    // but DO say the request failed rather than claiming the feedback landed.
    // Nothing was written and the token is untouched, so retrying is free and
    // is the tenant's only route to being heard.
    console.error("[feedback] submit failed", err);
    return { ok: false, retry: true };
  }
}

// Runs under after(), so the response has already gone to the tenant and an
// email outage can never turn a recorded response into an error for them or
// cost the owner the feedback itself. Failures are logged with the feedback id:
// this is the feature's only alert, and an alert nobody can tell has stopped
// firing is indistinguishable from nobody being unhappy.
async function notifyOwnerOfNegativeFeedback(
  feedbackId: string,
  hostelId: string,
  tenantId: string,
  answers: {
    food: FeedbackFood;
    cleanliness: FeedbackRating;
    staff: FeedbackRating;
    roommate: FeedbackRoommate;
    recommend: FeedbackRecommend;
    comment: string | null;
  }
): Promise<void> {
  try {
    const admin = createAdminClient();

    // Recipient is resolved SERVER-SIDE from the hostel the claimed token was
    // bound to. Nothing from the submitted payload participates in routing.
    const [{ data: hostel }, { data: tenant }] = await Promise.all([
      admin.from("hms_hostels").select("name, owner_id").eq("id", hostelId).maybeSingle(),
      admin
        .from("hms_tenants")
        // Explicit column list, never select("*") — CNIC must not travel with
        // this row, and an email is a public-facing surface once forwarded.
        .select("full_name, phone, check_out, room:hms_rooms(room_number)")
        .eq("id", tenantId)
        .eq("hostel_id", hostelId)
        .maybeSingle(),
    ]);
    if (!hostel || !tenant) {
      console.error("[feedback] alert skipped, hostel or tenant not found", feedbackId);
      return;
    }

    const {
      data: { user: owner },
    } = await admin.auth.admin.getUserById(hostel.owner_id);
    if (!owner?.email) {
      console.error("[feedback] alert skipped, owner has no email", feedbackId);
      return;
    }

    const room = Array.isArray(tenant.room) ? tenant.room[0] : tenant.room;

    await sendFeedbackAlertEmail({
      ownerEmail: owner.email,
      hostelName: hostel.name,
      tenantName: tenant.full_name ?? "A tenant",
      phone: tenant.phone,
      roomNumber: room?.room_number ?? null,
      checkedOut: tenant.check_out,
      triggers: feedbackTriggers(answers),
      answers: feedbackChips(answers),
      comment: answers.comment,
    });
  } catch (err) {
    // Still never surfaced to the tenant — but never invisible either.
    console.error("[feedback] alert email failed", feedbackId, err);
  }
}
