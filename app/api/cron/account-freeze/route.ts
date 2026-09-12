import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Invoked daily by Vercel Cron (see vercel.json), after generate-invoices +
// reminders. Same CRON_SECRET auth as the other jobs.
//
// Suspends a BANK/manual account when a platform invoice is unpaid past its due
// date AND the client has had it (been sent it) for a full 7 days. All the logic
// — the grace floor, the Paddle/super-admin/already-frozen exclusions — lives in
// the hms_freeze_overdue_accounts() SQL function (migration 232) so the whole
// decision is one atomic statement: a payment landing mid-run can't get a
// just-paid client re-frozen. The function is service-role only. Unfreeze is not
// done here — payment clears `frozen` (Paddle webhook / markInvoiceStatus).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Two independent freeze reasons, both service-role-only atomic statements:
  // unpaid bank/manual platform invoices (migration 232), and lapsed self-serve
  // free trials (migration 241). A trial owner has no platform invoice, so the
  // two never overlap. Run both; report each set.
  const [overdue, trials] = await Promise.all([
    admin.rpc("hms_freeze_overdue_accounts"),
    admin.rpc("hms_freeze_expired_trials"),
  ]);
  if (overdue.error) {
    return NextResponse.json({ error: overdue.error.message }, { status: 500 });
  }
  if (trials.error) {
    return NextResponse.json({ error: trials.error.message }, { status: 500 });
  }

  const frozen = (overdue.data ?? []) as string[];
  const trialsFrozen = (trials.data ?? []) as string[];
  return NextResponse.json({
    frozen: frozen.length,
    owners: frozen,
    trialsFrozen: trialsFrozen.length,
    trialOwners: trialsFrozen,
  });
}
