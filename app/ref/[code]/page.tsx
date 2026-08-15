import { Link2Off, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import { getReferralTarget } from "@/lib/referrals-server";
import { ReferralFormClient } from "./referral-form-client";

// The code in the path is a live credential — an indexed copy of this URL is a
// working referral link in a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-5 animate-fade-in">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-white/5 border border-white/10 mx-auto">
          {icon}
        </div>
        <div>
          <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

export default async function ReferralPage({ params }: Props) {
  const { code } = await params;
  const target = await getReferralTarget(code);

  // ONE page for every dead link — unknown code, rotated code, referrer who has
  // checked out, branch without the feature. HTTP 200 rather than 404: a
  // differing status is the easiest oracle in the world to script, and the
  // resolver hands this component no reason code to branch on anyway.
  if (target.kind === "dead") {
    return (
      <Notice
        icon={<Link2Off className="w-8 h-8 text-muted-foreground" />}
        title="This link is no longer active"
        body="Ask the person who shared it with you for a current one."
      />
    );
  }

  // A dropped connection is not a dead code. Telling a real prospect their
  // friend's link is broken loses the lead permanently; inviting a retry leaks
  // nothing, because this outcome does not depend on whether the code exists.
  if (target.kind === "unavailable") {
    return (
      <Notice
        icon={<RefreshCw className="w-8 h-8 text-muted-foreground" />}
        title="This page is temporarily unavailable"
        body="Please refresh in a moment — the link itself is fine."
      />
    );
  }

  return <ReferralFormClient
      code={code}
      hostelName={target.hostelName}
      referredPercent={target.referredPercent}
    />;
}
