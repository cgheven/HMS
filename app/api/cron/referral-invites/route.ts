import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryUndeliveredInvites, type RetrySummary } from "@/lib/referral-invite-retry";

// Same ceiling as the reminder cron: this walks every entitled branch and sends
// sequentially, and Meta paces marketing bursts.
export const maxDuration = 300;

/**
 * Daily retry of referral invites Meta accepted but never delivered.
 *
 * Runs 05:30 UTC — 10:30 PKT. Vercel crons are UTC, and every schedule in
 * vercel.json is written in it; the 90 minutes after the 04:00 UTC block keep a
 * retry from competing with the payment-reminder run for the same WhatsApp
 * number's send pacing.
 *
 * The gap this closes: hms_referral_codes.link_sent_at records that Meta took
 * the message, not that a tenant received it. Delivery failures arrive later on
 * the webhook, at which point the code already reads as sent, is excluded from
 * the pending count, and no screen offers a way to try again. On the first real
 * blast that left 10 of 52 tenants stranded — 8 unreachable on WhatsApp, and 2
 * withheld by Meta as part of a marketing holdout experiment, which is
 * temporary and would have succeeded on any later attempt.
 *
 * Recovering that by hand meant an owner reading Meta error codes off a table
 * and re-sending one by one, which is not something owners do — so it has to be
 * unattended, or it does not happen.
 *
 * Deliberately narrow. It only touches branches that are entitled AND have
 * WhatsApp granted AND have a campaign actively running: a paused campaign
 * means stop outbound, and that has to hold for automated sends first of all,
 * since nobody is watching. Attempts are capped at 3 per code and spaced 24
 * hours apart, so an unreachable number costs two extra messages in total
 * rather than one per day forever.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Manual-run overrides, reachable only with the cron secret. The scheduled
  // invocation passes none of them and behaves exactly as before.
  const params = request.nextUrl.searchParams;
  const backoffRaw = params.get("backoffHours");
  const backoffHours = backoffRaw === null ? undefined : Number(backoffRaw);
  const onlyHostel = params.get("hostelId");

  let query = admin
    .from("hms_hostels")
    .select("id, name")
    .eq("referral_enabled", true)
    .eq("whatsapp_enabled", true)
    .eq("referral_campaign", "active");
  if (onlyHostel) query = query.eq("id", onlyHostel);

  const { data: hostels, error } = await query;

  if (error) {
    console.error("[cron/referral-invites] branch lookup failed:", error.code ?? "unknown");
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }

  const results: RetrySummary[] = [];
  for (const h of hostels ?? []) {
    results.push(
      await retryUndeliveredInvites(admin, h.id as string, (h.name as string) ?? "", {
        backoffHours: Number.isFinite(backoffHours) ? backoffHours : undefined,
      })
    );
  }

  const totals = results.reduce(
    (a, r) => ({
      eligible: a.eligible + r.eligible,
      sent: a.sent + r.sent,
      stillFailing: a.stillFailing + r.stillFailing,
    }),
    { eligible: 0, sent: 0, stillFailing: 0 }
  );

  return NextResponse.json({
    ok: true,
    branches: results.length,
    ...totals,
    // Per-branch, so a single branch failing every retry is visible rather than
    // averaged away into a healthy-looking total.
    detail: results.filter((r) => r.eligible > 0),
  });
}
