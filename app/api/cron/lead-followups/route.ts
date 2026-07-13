import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendGroupedFollowUpDigests } from "@/lib/email";
import { pktTodayDateString } from "@/lib/pkt-time";
import type { PlatformLead } from "@/types";

type LeadWithRepEmail = PlatformLead & {
  sales_rep: { id: string; name: string; email: string | null; is_active: boolean } | null;
};

// Invoked daily by Vercel Cron (see vercel.json, 0 4 * * * UTC = 9 AM PKT).
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when
// CRON_SECRET is set as a project env var — this route rejects anything else.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  // Guard on an unset secret explicitly — otherwise `undefined` on both sides
  // would let `Authorization: Bearer undefined` sail through the check below.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminEmail = process.env.LEADS_FOLLOWUP_DIGEST_EMAIL;
  if (!adminEmail) {
    return NextResponse.json({ error: "LEADS_FOLLOWUP_DIGEST_EMAIL not configured" }, { status: 500 });
  }

  const admin = createAdminClient();
  const today = pktTodayDateString();

  const { data, error } = await admin
    .from("hms_platform_leads")
    .select("*, sales_rep:hms_sales_reps(id,name,email,is_active)")
    .not("next_follow_up_date", "is", null)
    .lte("next_follow_up_date", today)
    .order("next_follow_up_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Terminal-stage leads don't need a follow-up nudge even if a stale date lingers.
  const leads = (data ?? []).filter(
    (l) => l.status !== "converted" && l.status !== "rejected"
  ) as LeadWithRepEmail[];

  if (leads.length === 0) {
    return NextResponse.json({ sent: false, count: 0 });
  }

  // Each ACTIVE rep with pending leads gets their own email (admin CC'd for
  // confirmation); unassigned leads, and any deactivated rep or one with no
  // login email on file, roll up to the admin instead.
  const { sentCount, recipientCount } = await sendGroupedFollowUpDigests(leads, adminEmail);
  return NextResponse.json({ sent: true, count: sentCount, recipients: recipientCount });
}
