import { requirePageOwnerOrPartnerTier } from "@/lib/auth";
import { getReferralOverview } from "@/app/actions/referrals";
import { ReferralsClient } from "@/components/modules/marketing/referrals-client";

export default async function MarketingPage() {
  // Partners belong here: a partner owns their branch, and rewardScopeIds() in
  // app/actions/referrals.ts already confines every reward query to the
  // branches their partnership actually grants them — it was written that way
  // before the page would let them in.
  //
  // read_only is the floor for LOOKING. Each action re-checks its own tier
  // server-side, and the account-level ones — the commission percentages, the
  // campaign, stop-all — stay owner-only and are hidden in the client.
  await requirePageOwnerOrPartnerTier("read_only");

  // Current month by default; the client swaps months in place through the same
  // action, matching how Payments and Expenses already work.
  const { data, error } = await getReferralOverview();

  if (!data) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-3xl font-serif font-normal tracking-tight">Marketing</h1>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error ?? "Could not load referrals."}
        </div>
      </div>
    );
  }

  return <ReferralsClient key={data.hostelId ?? ""} overview={data} />;
}
