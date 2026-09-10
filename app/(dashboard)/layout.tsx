import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { HostelProvider } from "@/contexts/hostel-context";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // F-002: require authenticated user with owner, partner, or super_admin role.
  if (!ctx?.user) redirect("/login");
  if (ctx.profile?.role === "super_admin") redirect("/super-admin");

  const admin = createAdminClient();

  // Defense-in-depth: an auth user linked to hms_sales_reps must never reach the
  // owner dashboard, independent of hms_profiles.role — this closes the gap even
  // if a future signup-trigger regression again mislabels a staff account as 'owner'.
  const { data: salesRep } = await admin
    .from("hms_sales_reps")
    .select("id")
    .eq("supabase_user_id", ctx.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (salesRep) redirect("/sales");

  if (!["owner", "partner"].includes(ctx.profile?.role ?? "")) redirect("/login");
  // A partner with no active branch (all partnerships removed) has nothing to see here.
  if (ctx.profile?.role === "partner" && !ctx.hostel) redirect("/login");

  // Billing status is account-level. owner = self; partner = the account owner.
  const accountOwnerId = ctx.profile?.role === "owner" ? ctx.user.id : (ctx.hostel?.owner_id ?? null);

  // Account suspension (unpaid dues): reads still work; the banner explains why
  // writes are blocked.
  let accountFrozen = false;
  if (ctx.profile?.role === "owner") {
    accountFrozen = !!ctx.profile.frozen;
  } else if (accountOwnerId) {
    const { data } = await admin.from("hms_profiles").select("frozen").eq("id", accountOwnerId).maybeSingle();
    accountFrozen = !!(data as { frozen?: boolean } | null)?.frozen;
  }

  // Advance warning: an unpaid invoice due within the next 7 days (or already
  // overdue) — shown as a "please pay" strip so a freeze is never a surprise.
  // Suppressed once frozen (the suspension banner takes over).
  let dueSoon: { due_date: string; freeze_date: string; overdue: boolean } | null = null;
  if (!accountFrozen && accountOwnerId) {
    // Don't nudge owners on Paddle card billing — Paddle charges them and handles
    // its own card dunning; the manual "please pay" strip is for bank clients.
    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions").select("status").eq("owner_id", accountOwnerId).maybeSingle();
    const onPaddle = ["active", "trialing", "past_due", "paused"].includes(
      (subRow as { status?: string } | null)?.status ?? ""
    );
    if (!onPaddle) {
      const { data } = await admin
        .from("hms_platform_invoices")
        .select("due_date, first_sent_at")
        .eq("owner_id", accountOwnerId)
        .eq("status", "unpaid")
        // Only warn about invoices that can actually trigger a freeze: the
        // account-freeze cron only suspends for a SENT unpaid invoice, so an
        // unsent one must not claim a suspension date it won't cause.
        .not("first_sent_at", "is", null)
        .order("due_date", { ascending: true })
        .limit(1);
      if (data && data.length > 0) {
        const inv = data[0] as { due_date: string; first_sent_at: string };
        // Effective freeze date mirrors hms_freeze_overdue_accounts(): the LATER
        // of the due date and 7 days after the invoice was sent (the grace floor
        // that protects a back-dated / catch-up invoice). Showing due_date alone
        // would name a suspension date that has already passed for such invoices.
        const dueMs = new Date(`${inv.due_date}T00:00:00Z`).getTime();
        const sentPlus7Ms = new Date(inv.first_sent_at).getTime() + 7 * 24 * 60 * 60 * 1000;
        const freezeMs = Math.max(dueMs, sentPlus7Ms);
        // Surface it only within a week of the freeze (or once overdue) — a
        // timely warning, not a month-out nag.
        if (freezeMs <= Date.now() + 7 * 24 * 60 * 60 * 1000) {
          dueSoon = {
            due_date: inv.due_date,
            freeze_date: new Date(freezeMs).toISOString().slice(0, 10),
            overdue: freezeMs < Date.now(),
          };
        }
      }
    }
  }

  return (
    <HostelProvider profile={ctx.profile} hostel={ctx.hostel} hostels={ctx.hostels ?? []} partnerTier={ctx.partnerTier}>
      <DashboardShell>
        {accountFrozen ? (
          <div className="mb-4 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm">
            <span className="font-semibold text-amber">Account suspended.</span>{" "}
            Your account has unpaid dues, so changes are disabled — you can still view everything.
            Clear your balance to restore full access.
          </div>
        ) : dueSoon ? (
          <Link
            href="/billing"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber/10 px-4 py-2.5 text-sm transition-colors hover:bg-amber/15"
          >
            <span>
              {dueSoon.overdue ? (
                <>
                  <span className="font-semibold text-amber">Payment overdue.</span>{" "}
                  Pay now to avoid suspension of your account.
                </>
              ) : (
                <>
                  <span className="font-semibold text-amber">Payment due {formatDate(dueSoon.due_date)}.</span>{" "}
                  Pay before then — your account will be suspended on {formatDate(dueSoon.freeze_date)} if it stays unpaid.
                </>
              )}
            </span>
            <span className="whitespace-nowrap font-semibold text-amber">Pay now →</span>
          </Link>
        ) : null}
        {children}
      </DashboardShell>
    </HostelProvider>
  );
}
