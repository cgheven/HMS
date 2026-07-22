import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInvoiceForOwner } from "@/lib/invoice-generation";
import { pktTodayDateString } from "@/lib/pkt-time";

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as
// /api/cron/lead-followups. Generates the next invoice for any client whose
// next_invoice_date has arrived — does NOT mark anything paid (manual, over WhatsApp).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = pktTodayDateString();

  const { data: due, error } = await admin
    .from("hms_client_billing")
    .select("owner_id")
    .not("monthly_rate", "is", null)
    .not("next_invoice_date", "is", null)
    .lte("next_invoice_date", today);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let generated = 0;
  let skipped = 0;
  for (const row of due ?? []) {
    try {
      const result = await generateInvoiceForOwner(admin, row.owner_id);
      if (result.generated) generated++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ checked: due?.length ?? 0, generated, skipped });
}
