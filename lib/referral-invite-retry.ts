import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendReferralInvite } from "@/lib/whatsapp-referral-invite";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * Three, not more.
 *
 * The two failure classes seen in production behave differently. 130472 is Meta
 * withholding a marketing message as part of a holdout experiment — temporary,
 * and a later attempt succeeds. 131026 is the number not being reachable on
 * WhatsApp, which usually does not change, though it can: the same code covers
 * a recipient who has not accepted WhatsApp's terms yet.
 *
 * So both are worth retrying and neither is worth retrying forever. Three
 * attempts spread over three days converts the first class, gives the second
 * two genuine chances, and bounds the waste at two extra messages per tenant.
 */
const MAX_ATTEMPTS = 3;

/** A day apart. Meta's experiment holdout is measured in days, not minutes, and
 *  a tighter loop would burn the attempt cap inside an hour on a condition that
 *  had no opportunity to change. */
const BACKOFF_HOURS = 24;

export type RetrySummary = {
  hostelId: string;
  hostelName: string;
  eligible: number;
  sent: number;
  stillFailing: number;
};

/**
 * Re-sends referral invites that Meta accepted but never delivered.
 *
 * Exists because link_sent_at records ACCEPTANCE, not arrival. A delivery
 * failure arrives later on the webhook, by which point the code counts as sent,
 * drops out of the pending list, and no screen offers a way to try again — on
 * the first real blast that stranded 10 of 52 tenants with no recovery path
 * short of an owner reading Meta error codes off a table.
 *
 * Every gate that governs a first send still applies: the eligibility query
 * checks the campaign's branch, the tenant is still a resident with a phone,
 * and sendReferralInvite re-checks entitlement, WhatsApp grant and campaign
 * state at the moment of sending. A campaign paused between the query and the
 * send does not go out.
 */
export async function retryUndeliveredInvites(
  admin: Admin,
  hostelId: string,
  hostelName: string
): Promise<RetrySummary> {
  const summary: RetrySummary = {
    hostelId,
    hostelName,
    eligible: 0,
    sent: 0,
    stillFailing: 0,
  };

  const { data: rows, error } = await admin.rpc("hms_referral_invites_to_retry", {
    p_hostel_id: hostelId,
    p_max_attempts: MAX_ATTEMPTS,
    p_backoff_hours: BACKOFF_HOURS,
  });
  if (error) {
    console.error("[retryUndeliveredInvites] lookup failed:", error.code ?? "unknown");
    return summary;
  }

  const list = (rows ?? []) as { code_id: string; error_code: number | null }[];
  summary.eligible = list.length;

  for (const row of list) {
    const res = await sendReferralInvite(admin, row.code_id, { retry: true });
    if (res.sent) summary.sent += 1;
    else summary.stillFailing += 1;

    // Same reasoning as the campaign blast: a fault that rejects the first
    // several rejects all of them, and a retry pass that discovers this once a
    // day is still a pass that fills a client's log with red every day.
    if (!res.sent && res.reason === "send_failed" && summary.sent === 0 && summary.stillFailing >= 5) {
      break;
    }
  }

  return summary;
}
