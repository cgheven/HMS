import { requireOwnerOrAbove } from "@/lib/auth";
import { getPortfolioSummary } from "@/app/actions/portfolio";
import { OverviewClient } from "@/components/modules/overview/overview-client";

export default async function OverviewPage() {
  // getProfile is React cache()d, so this guard and the one inside the action
  // share a single round trip. It stays here anyway: a partner must never load
  // a cross-branch page, and the page must not depend on the action for that.
  await requireOwnerOrAbove();
  const summary = await getPortfolioSummary();

  // Deliberate departure from CLAUDE.md rule 8: keyed on the branch SET, not on
  // hostelId. This page ignores hms_active_hostel entirely, so keying on the
  // active branch would remount on a switch that changes nothing on screen,
  // while failing to remount when a branch is actually added or removed.
  return <OverviewClient key={summary.branches.map((b) => b.id).join(",")} summary={summary} />;
}
