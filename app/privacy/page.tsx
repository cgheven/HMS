import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = { title: "Privacy Notice — Pulse" };

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-base font-semibold text-foreground">{children}</h2>;
}

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Notice" updated="September 2026">
      <p>
        This notice explains how <strong>PulseHub Private Limited</strong> (&ldquo;PulseHub&rdquo;,
        &ldquo;we&rdquo;) handles personal data in connection with Pulse, our hostel-management software.
      </p>

      <H>1. Data we collect</H>
      <p>
        <strong>Account data</strong> you provide when signing up — name, email, phone, business name,
        and login credentials. <strong>Operational data</strong> you enter to run your business —
        including information about your rooms, staff, and residents (such as names and contact details).
        <strong> Usage data</strong> — logs and analytics about how the service is used, to keep it
        secure and working.
      </p>

      <H>2. Payment data</H>
      <p>
        Card payments are handled by our payment provider, <strong>Paddle</strong>, who acts as Merchant
        of Record. <strong>We do not collect or store your card details</strong> — Paddle processes them
        under its own privacy terms. For bank-transfer billing we record only that an invoice was issued
        and settled.
      </p>

      <H>3. How we use data</H>
      <p>
        To provide and operate the service, authenticate users, process and record payments, send
        service and billing communications, provide support, prevent abuse, and comply with legal
        obligations.
      </p>

      <H>4. Roles: controller and processor</H>
      <p>
        For your own account information, we are the data controller. For information you enter about
        your residents and staff, <strong>you are the controller and we act as a processor</strong> on
        your behalf — you are responsible for having a lawful basis to collect it and for informing those
        individuals as required by law.
      </p>

      <H>5. Sharing</H>
      <p>
        We share data only with service providers who help us run Pulse — including Paddle (payments),
        our hosting and database infrastructure, and email/messaging providers used to deliver
        notifications — and where required by law. We do not sell personal data.
      </p>

      <H>6. Retention</H>
      <p>
        We keep data for as long as your account is active and as needed to provide the service, then for
        any period required to meet legal, tax, or accounting obligations, after which it is deleted or
        anonymised.
      </p>

      <H>7. Security</H>
      <p>
        We use technical and organisational measures — including encryption in transit, access controls,
        and role-based permissions — to protect data. No system is perfectly secure, but we work to
        protect your information and to respond promptly to any incident.
      </p>

      <H>8. Your rights</H>
      <p>
        Subject to applicable law, you may request access to, correction of, or deletion of your personal
        data, and may object to or restrict certain processing. To make a request, contact us at the
        address below. For resident data held on behalf of a hostel operator, please contact that
        operator, who is the controller.
      </p>

      <H>9. International transfers</H>
      <p>
        Our providers may process data in other countries. Where data is transferred internationally, we
        rely on appropriate safeguards as required by applicable law.
      </p>

      <H>10. Changes</H>
      <p>
        We may update this notice; the &ldquo;last updated&rdquo; date reflects the current version.
      </p>

      <H>11. Contact</H>
      <p>
        Privacy questions or requests: <a href="mailto:hello@yourpulse.io" className="underline">hello@yourpulse.io</a>.
      </p>
    </LegalShell>
  );
}
