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
  const { data, error } = await admin.rpc("hms_freeze_overdue_accounts");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const frozen = (data ?? []) as string[];
  return NextResponse.json({ frozen: frozen.length, owners: frozen });
}
