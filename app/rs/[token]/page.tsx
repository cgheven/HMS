import type { Metadata } from "next";
import { ReferralStatusClient } from "./referral-status-client";

// The path segment is a live credential, so this page must never be indexed and
// never cached by a shared proxy. Same posture as /fb and /r.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  title: "My referrals",
};

// The token is NOT resolved here. Nothing is looked up until the visitor proves
// they also know the phone number — so a stray URL renders the same empty form
// for everybody, and the page reveals nothing by loading.
export default async function ReferralStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ReferralStatusClient token={token} />;
}
