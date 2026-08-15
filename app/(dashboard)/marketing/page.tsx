import { requireOwnerOrAbove } from "@/lib/auth";
import { getReferralOverview } from "@/app/actions/referrals";
import { ReferralsClient } from "@/components/modules/marketing/referrals-client";

export default async function MarketingPage() {
  // Owner-level, not branch-level: referral links carry the account's own name
  // to people who are not customers yet. Partners are kept out here AND by the
  // guard inside every action in app/actions/referrals.ts.
  await requireOwnerOrAbove();

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
