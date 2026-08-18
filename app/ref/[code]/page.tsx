import { Link2Off, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import { getReferralTarget } from "@/lib/referrals-server";
import { ReferralFormClient } from "./referral-form-client";

// The code in the path is a live credential — an indexed copy of this URL is a
// working referral link in a search result.
//
// The OpenGraph block is what a messenger renders when a tenant pastes their
// link into a chat. Without it the page inherited the root metadata, whose copy
// sells the product to hostel OWNERS — "manage your hostel, expenses, kitchen
// and bills" — shown to a prospective tenant being offered a discount.
//
// Deliberately STATIC: resolving the code here would mean getReferralTarget()
// runs twice per request, double-counting both the per-IP rate limiter and the
// link-open counter. It also keeps the branch name out of the card, which a
// forwarded screenshot would otherwise carry.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  title: "You have been invited",
  description: "A friend has invited you. Open to see your discount and reserve your place.",
  openGraph: {
    title: "You have been invited",
    description: "A friend has invited you. Open to see your discount and reserve your place.",
    images: ["/opengraph-image.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "You have been invited",
    description: "A friend has invited you. Open to see your discount and reserve your place.",
    images: ["/opengraph-image.jpg"],
  },
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

  // Paused: the offer is genuinely this tenant's and returns when the owner
  // resumes, so a stranger is invited back rather than turned away. Submitting
  // now would create a referral the branch has decided not to honour yet.
  if (target.kind === "paused") {
    return (
      <Notice
        icon={<RefreshCw className="w-8 h-8 text-muted-foreground" />}
        title={`${target.hostelName} isn't taking new referrals right now`}
        body="Please check back soon, or contact the hostel directly if you're looking for a room."
      />
    );
  }

  return <ReferralFormClient
      code={code}
      hostelName={target.hostelName}
      referredPercent={target.referredPercent}
    />;
}
