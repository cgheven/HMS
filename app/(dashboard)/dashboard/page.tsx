import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { getAuthContext, getDashboardData } from "@/lib/data";
import { getWelcomeStatus } from "@/app/actions/onboarding-welcome";
import { DashboardClient } from "@/components/modules/dashboard/dashboard-client";

export default async function DashboardPage() {
  const ctx = await getAuthContext();

  // The welcome flow targets the SELF-REGISTRATION cohort only. Self-serve trial
  // owners are exactly the accounts with trial_ends_at set (it is NULL for every
  // non-self-serve owner), so this both scopes the feature and keeps the hot
  // dashboard path free of any extra query for existing/manual clients.
  const p = ctx?.profile;
  const isSelfRegOwner = p?.role === "owner" && !!p?.trial_ends_at;

  // First login: send them to the checklist once. onboarding_dismissed_at is set
  // on Skip/Finish; existing accounts were backfilled as dismissed (migration
  // 262), so nobody is pulled in retroactively.
  if (isSelfRegOwner && !p?.onboarding_dismissed_at) redirect("/welcome");

  // After dismissing, a slim resume card nudges them back until the account is
  // actually usable (required steps done) — not until every optional step is,
  // which would nag forever. Fanned out with the dashboard fetch (rule #1).
  const [status, data] = await Promise.all([
    isSelfRegOwner ? getWelcomeStatus() : Promise.resolve(null),
    getDashboardData(),
  ]);

  return (
    <div className="space-y-4">
      {status && !status.requiredDone && (
        <Link
          href="/welcome"
          className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Finish setting up your account</p>
            <p className="text-xs text-muted-foreground">
              {status.doneCount} of {status.total} steps done — pick up where you left off.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
        </Link>
      )}
      <DashboardClient data={data} />
    </div>
  );
}
