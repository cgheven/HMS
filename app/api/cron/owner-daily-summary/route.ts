import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pktTodayDateString } from "@/lib/pkt-time";
import {
  computeDailyFigures,
  sendOwnerDailySummaries,
  sendOwnerDailySummaryEmails,
} from "@/lib/owner-daily-summary";

export const maxDuration = 300;

/**
 * Daily summary to each hostel OWNER, one message per branch, so they can see
 * the day's collection, expenses and net without opening the app.
 *
 * Two channels off one computation. EMAIL goes to every branch. WhatsApp keeps
 * the hms_hostels.whatsapp_enabled gate — a branch without WhatsApp granted
 * sends no WhatsApp, but still gets the email.
 *
 * Same CRON_SECRET auth as the other cron routes.
 *
 * Scheduled 18:30 UTC = 23:30 PKT (Pakistan is UTC+5, no daylight saving), so
 * it reports TODAY: collections are entered through the evening, and by half
 * past eleven the day is effectively closed. Running it in the morning would
 * have meant reporting yesterday to avoid quoting a figure that keeps moving.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Explicit ?date=YYYY-MM-DD for testing a specific day; otherwise the
  // current Pakistan calendar day, which at 23:30 PKT is the day just ending.
  const requested = request.nextUrl.searchParams.get("date");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "")
    ? (requested as string)
    : pktTodayDateString();

  try {
    const admin = createAdminClient();
    // Figures once, two channels — so the two can never quote different numbers.
    const figures = await computeDailyFigures(admin, date);
    // allSettled, not all: a Meta outage must not discard the email result.
    const [whatsapp, email] = await Promise.allSettled([
      sendOwnerDailySummaries(figures, date),
      sendOwnerDailySummaryEmails(admin, figures, date),
    ]);
    return NextResponse.json({
      date,
      branches: figures.length,
      whatsapp: whatsapp.status === "fulfilled" ? whatsapp.value : { error: String(whatsapp.reason) },
      email: email.status === "fulfilled" ? email.value : { error: String(email.reason) },
    });
  } catch (err) {
    console.error("[owner-daily-summary] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
