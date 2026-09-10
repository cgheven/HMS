import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = { title: "Refund Policy — Pulse" };

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-base font-semibold text-foreground">{children}</h2>;
}

export default function RefundPage() {
  return (
    <LegalShell title="Refund Policy" updated="September 2026">
      <p>
        This policy explains how refunds work for Pulse subscriptions provided by
        <strong> PulseHub Private Limited</strong>.
      </p>

      <H>1. Subscription fees are non-refundable</H>
      <p>
        Pulse is a recurring subscription. Payments already made — including the current billing period —
        are <strong>non-refundable</strong>. We do not provide partial or pro-rated refunds for unused
        time within a billing period.
      </p>

      <H>2. Cancel anytime, keep access to the period end</H>
      <p>
        You can cancel your subscription at any time. When you cancel, you keep full access until the end
        of the period you have already paid for; the subscription then ends and you are not charged
        again. Cancelling does not trigger a refund of the current or past periods.
      </p>

      <H>3. How to cancel</H>
      <p>
        Cancel from your billing page in the app, or contact us at
        <a href="mailto:hello@yourpulse.io" className="underline"> hello@yourpulse.io</a> and we will help
        you.
      </p>

      <H>4. Billing errors</H>
      <p>
        If you believe you were charged in error — for example a duplicate charge — contact us within 14
        days and we will investigate and correct any genuine billing mistake. Card payments are processed
        by <strong>Paddle</strong> as Merchant of Record; where a correction is due, it is issued through
        Paddle.
      </p>

      <H>5. Contact</H>
      <p>
        Questions about billing or this policy: <a href="mailto:hello@yourpulse.io" className="underline">hello@yourpulse.io</a>.
      </p>
    </LegalShell>
  );
}
