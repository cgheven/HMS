import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pktTodayDateString } from "@/lib/pkt-time";
import { buildReminderMessage } from "@/lib/whatsapp-reminder";
import { sendWhatsAppMessage } from "@/lib/wasender";
import { ensureMonthlyPaymentRows } from "@/lib/monthly-payment-sync";
import { tenantDueDay, shouldRemindToday } from "@/lib/payment-calc";
import type { PaymentMethodAccount } from "@/types";

// Vercel default (10s Hobby / 60s Pro) isn't enough once more branches are
// granted and a day's due-tenant count grows — request the platform's max;
// harmless if the plan caps it lower than this.
export const maxDuration = 300;

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as the
// other cron routes. Auto-sends a WhatsApp reminder — via the single shared
// Wasender platform session — to any tenant still pending/overdue/partially
// paid for the current month, on THEIR OWN due day (the day-of-month they
// checked in) — not a single fixed day for the whole hostel, since tenants in
// the same branch can each have joined on a different date. If still unpaid
// past that day, it repeats every 3 days (due day, +3, +6, ...) instead of
// waiting a full month for the next anniversary. A tenant who has checked out
// (is_active = false) is never reminded, even if a balance is still
// outstanding. This is a curated feature, not self-service: none of this runs
// for a branch unless Super Admin has explicitly granted it
// (hms_hostels.auto_reminder_enabled — pinned against owner self-grant by a
// DB trigger, migration 106).

interface ReminderPaymentRow {
  id: string;
  amount: number;
  late_fee: number | null;
  for_month: string;
  ac_charge: number | null;
  ac_units_consumed: number | null;
  last_reminder_sent_at: string | null;
  tenant: { full_name: string; phone: string | null; security_deposit: number | null; check_in: string; is_active: boolean } | null;
  hostel: { name: string; payment_methods: PaymentMethodAccount[]; reminder_template: string | null; auto_reminder_enabled: boolean } | null;
}

// Wasender is a single shared session — a handful of tenants at once is fine,
// but sending to hundreds of simultaneously-due tenants with zero concurrency
// limit risks tripping the provider's own rate limit. Small batches keep this
// bounded without serializing everything one at a time.
const SEND_CONCURRENCY = 5;

async function processInBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = pktTodayDateString();
  const dayOfMonth = Number(today.slice(8, 10));

  const admin = createAdminClient();
  const forMonth = today.slice(0, 7);

  // A tenant's rent row for this month only exists once someone opens Monthly
  // View for it — guarantee it exists for every branch Super Admin has
  // actually granted this feature to (only those; every other branch is left
  // exactly as before) so the scan below never silently finds nothing just
  // because no one has visited the Payments page yet this month. Every
  // tenant in a granted branch could have their due day fall on any day of
  // the month, so this runs daily, not just on specific configured days.
  const { data: grantedHostels } = await admin
    .from("hms_hostels")
    .select("id")
    .eq("auto_reminder_enabled", true);

  await Promise.all(
    (grantedHostels ?? []).map((h) => ensureMonthlyPaymentRows(admin, h.id, forMonth))
  );

  const { data: payments, error } = await admin
    .from("hms_payments")
    .select(
      "id, amount, late_fee, for_month, ac_charge, ac_units_consumed, last_reminder_sent_at, " +
      "tenant:hms_tenants(full_name, phone, security_deposit, check_in, is_active), " +
      "hostel:hms_hostels(name, payment_methods, reminder_template, auto_reminder_enabled)"
    )
    .eq("for_month", forMonth)
    .in("status", ["pending", "overdue", "partially_paid"])
    .returns<ReminderPaymentRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due: ReminderPaymentRow[] = [];
  let skipped = 0;

  for (const p of payments ?? []) {
    // Not granted by Super Admin.
    if (!p.hostel?.auto_reminder_enabled) {
      skipped++;
      continue;
    }

    // Checked out — never remind, even if a balance is still outstanding.
    if (!p.tenant?.is_active) {
      skipped++;
      continue;
    }

    // Not a reminder day for this tenant (due day itself, or a multiple of 3
    // days past it).
    if (!p.tenant.check_in || !shouldRemindToday(tenantDueDay(p.tenant.check_in, p.for_month), dayOfMonth)) {
      skipped++;
      continue;
    }

    // Already reminded today (cron retry) — never double-send within the same
    // day. Compared in PKT on both sides (today already is), rather than a
    // raw UTC slice, so this stays correct regardless of what time of day the
    // cron schedule ever runs at.
    if (p.last_reminder_sent_at && pktTodayDateString(new Date(p.last_reminder_sent_at)) === today) {
      skipped++;
      continue;
    }

    const rawPhone = p.tenant?.phone ?? "";
    const digits = rawPhone.replace(/\D/g, "").replace(/^0/, "92");
    if (!digits) {
      skipped++;
      continue;
    }

    due.push(p);
  }

  let sent = 0;
  let failed = 0;
  let markFailed = 0;

  await processInBatches(due, SEND_CONCURRENCY, async (p) => {
    const digits = (p.tenant?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    const total = Number(p.amount) + Number(p.late_fee ?? 0);
    const message = buildReminderMessage({
      template: p.hostel?.reminder_template,
      tenantName: p.tenant?.full_name ?? "Tenant",
      amount: total,
      month: p.for_month,
      hostelName: p.hostel?.name ?? "",
      accounts: p.hostel?.payment_methods ?? [],
      ac_charge: (p.ac_charge ?? 0) > 0 ? Number(p.ac_charge) : undefined,
      ac_units: (p.ac_units_consumed ?? 0) > 0 ? Number(p.ac_units_consumed) : undefined,
      security_deposit: p.tenant?.security_deposit && p.tenant.security_deposit > 0 ? p.tenant.security_deposit : undefined,
    });

    const result = await sendWhatsAppMessage(digits, message);
    if (!result.ok) {
      failed++;
      return;
    }

    // The message is already delivered at this point — if this write fails,
    // do NOT silently count it as a clean "sent": surface it separately so
    // it's visible (a retry today would otherwise re-send a real duplicate
    // message, since the "already reminded today" guard above would find
    // nothing to skip on).
    const { error: markErr } = await admin
      .from("hms_payments")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", p.id);

    if (markErr) {
      markFailed++;
      console.error(`[payment-reminders] sent to payment ${p.id} but failed to record last_reminder_sent_at:`, markErr.message);
    } else {
      sent++;
    }
  });

  return NextResponse.json({ checked: payments?.length ?? 0, sent, skipped, failed, markFailed });
}
