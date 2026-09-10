import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = { title: "Terms of Service — Pulse" };

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-base font-semibold text-foreground">{children}</h2>;
}

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="September 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Pulse, the hostel-management
        software provided by <strong>PulseHub Private Limited</strong> (&ldquo;PulseHub&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By creating an account or using the service, you agree to these Terms. If you do
        not agree, do not use the service.
      </p>

      <H>1. The service</H>
      <p>
        Pulse is a subscription software platform that helps hostel and accommodation operators manage
        rooms, residents, payments, expenses, reporting, and related operations. We may add, change, or
        remove features over time.
      </p>

      <H>2. Accounts</H>
      <p>
        You are responsible for the accuracy of your account information, for keeping your credentials
        secure, and for all activity under your account and any staff or partner logins you create. You
        must be authorised to act for the business you register.
      </p>

      <H>3. Subscriptions, billing &amp; payment</H>
      <p>
        Pulse is billed on a recurring subscription, priced per branch, in the currency shown at
        checkout. Card payments are processed by our payment provider, <strong>Paddle</strong>, who acts
        as the Merchant of Record for those transactions and issues the corresponding tax invoice. Where
        offered (currently Pakistan), you may instead pay by bank transfer against an invoice we issue.
      </p>
      <p>
        Subscriptions renew automatically each billing cycle until cancelled. Prices are inclusive or
        exclusive of taxes as indicated at checkout; you are responsible for any taxes not collected by
        the payment provider. Failure to pay may result in suspension of write access to your account
        until the outstanding balance is cleared.
      </p>

      <H>4. Cancellation &amp; refunds</H>
      <p>
        You may cancel at any time. On cancellation you keep access until the end of the period you have
        already paid for, after which the subscription ends. Subscription fees are non-refundable, as
        described in our <a href="/refund" className="underline">Refund Policy</a>.
      </p>

      <H>5. Your data</H>
      <p>
        You retain ownership of the data you enter into Pulse, including information about your business
        and residents. You are responsible for having a lawful basis to collect and process that
        information and for complying with applicable laws. We process it on your behalf to provide the
        service, as described in our <a href="/privacy" className="underline">Privacy Notice</a>.
      </p>

      <H>6. Acceptable use</H>
      <p>
        You agree not to misuse the service: no unlawful activity, no attempts to breach security or
        access data you are not authorised to, no reverse engineering, no reselling the service without
        our consent, and no use that harms the service or other users.
      </p>

      <H>7. Intellectual property</H>
      <p>
        The Pulse software, brand, and content are owned by PulseHub and its licensors. These Terms grant
        you a limited, non-exclusive, non-transferable right to use the service for your business while
        your subscription is active.
      </p>

      <H>8. Availability &amp; warranties</H>
      <p>
        We work to keep Pulse available and reliable but provide it &ldquo;as is&rdquo; without warranties
        of any kind, to the extent permitted by law. We do not guarantee uninterrupted or error-free
        operation.
      </p>

      <H>9. Limitation of liability</H>
      <p>
        To the maximum extent permitted by law, PulseHub is not liable for indirect, incidental, or
        consequential damages, or for loss of data or profits. Our total liability for any claim relating
        to the service is limited to the amount you paid us for the service in the three months before
        the claim.
      </p>

      <H>10. Suspension &amp; termination</H>
      <p>
        We may suspend or terminate access for non-payment, breach of these Terms, or to comply with
        law. You may stop using the service and cancel at any time.
      </p>

      <H>11. Changes</H>
      <p>
        We may update these Terms; material changes will be reflected by the &ldquo;last updated&rdquo;
        date and, where appropriate, notified to you. Continued use after changes means you accept them.
      </p>

      <H>12. Governing law</H>
      <p>
        These Terms are governed by the laws of the Islamic Republic of Pakistan, and the courts of
        Pakistan have jurisdiction, without prejudice to any mandatory consumer rights in your country of
        residence.
      </p>

      <H>13. Contact</H>
      <p>
        Questions about these Terms: <a href="mailto:hello@yourpulse.io" className="underline">hello@yourpulse.io</a>.
      </p>
    </LegalShell>
  );
}
