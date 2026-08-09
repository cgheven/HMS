import type { Metadata } from "next";
import Link from "next/link";
import { Home } from "lucide-react";

export const metadata: Metadata = {
  title: "User Guide — Pulse",
  description:
    "A practical, step-by-step guide to setting up and running your hostel on Pulse — settings, rooms, tenants, payments, team, and reports.",
};

const TOC = [
  { href: "#start", label: "Before you start" },
  { href: "#settings", label: "1. Set up your hostel" },
  { href: "#spaces", label: "2. Add your rooms" },
  { href: "#tenants", label: "3. Add your tenants" },
  { href: "#payments", label: "4. Collect rent" },
  { href: "#team", label: "5. Your team" },
  { href: "#daily", label: "6. Daily operations" },
  { href: "#reports", label: "7. Reports" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[0.86em] bg-secondary text-foreground/90 px-1.5 py-0.5 rounded whitespace-nowrap">
      {children}
    </span>
  );
}

function Section({
  id,
  eyebrow,
  title,
  dek,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  dek: string;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 pt-10 mt-10 border-t border-border first:border-t-0 first:pt-0 first:mt-12">
      <div className="flex items-center gap-2 text-amber text-xs font-semibold uppercase tracking-[0.06em] mb-2">
        {eyebrow}
      </div>
      <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground mb-2">{title}</h2>
      <p className="text-muted-foreground max-w-[62ch] mb-6">{dek}</p>
      {children}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg px-5 py-4 mb-3.5">
      <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
      <div className="text-muted-foreground space-y-2 [&_strong]:text-foreground">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-3.5 py-3.5 border-t border-border first:border-t-0 first:pt-0">
      <div className="font-mono text-xs text-amber pt-0.5">{n}</div>
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
        <p className="text-muted-foreground max-w-[60ch]">{children}</p>
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-amber bg-amber/5 rounded-r-lg px-4 py-3 my-4 text-sm text-foreground/90">
      {children}
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-sidebar-border bg-sidebar/60 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber/10 border border-amber/20">
              <Home className="w-4 h-4 text-amber" />
            </div>
            <div>
              <p className="text-foreground font-bold text-sm tracking-tight leading-none">Pulse</p>
              <p className="text-amber/70 text-[10px] mt-0.5 font-semibold tracking-[0.15em] uppercase">
                Pulse of Your Business
              </p>
            </div>
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Already have an account? <span className="text-amber">Sign in</span>
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 lg:py-16 lg:grid lg:grid-cols-[220px_1fr] lg:gap-14 items-start">
        <nav className="hidden lg:flex flex-col gap-0.5 sticky top-24 text-sm">
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground mb-2.5">
            On this page
          </div>
          {TOC.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md px-2.5 py-1.5 transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Mobile TOC */}
        <nav className="flex lg:hidden gap-1.5 overflow-x-auto pb-2 mb-6 -mx-1 px-1">
          {TOC.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="shrink-0 text-xs text-muted-foreground border border-border rounded-full px-3 py-1.5 whitespace-nowrap"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <main className="min-w-0">
          <div className="mb-2">
            <h1 className="text-4xl font-serif font-normal tracking-tight text-foreground mb-3">
              Getting started with Pulse
            </h1>
            <p className="text-muted-foreground max-w-[62ch]">
              A practical, step-by-step guide — no fluff. Follow the sections in order the first time; after
              setup, jump to whichever one you need.
            </p>
          </div>

          <Section
            id="start"
            eyebrow="Before you start"
            title="Get your account"
            dek="Pulse accounts aren't self-signup — a real person sets up your first branch so nothing is misconfigured on day one."
          >
            <Step n="01" title="Submit your details">
              Go to the onboarding page and fill in your hostel name, your name, WhatsApp number, city, and how
              many branches you run. Tap <Kbd>Get Started Free</Kbd>.
            </Step>
            <Step n="02" title="We set you up">
              The Pulse team reaches out on WhatsApp, creates your account, and configures your first branch.
            </Step>
            <Step n="03" title="Log in">
              You&apos;ll receive login credentials. Sign in at <Kbd>/login</Kbd> — you&apos;ll land on your
              Dashboard.
            </Step>
          </Section>

          <Section
            id="settings"
            eyebrow="1. Setup"
            title="Set up your hostel"
            dek="Do this first. Everything else — room pricing, tenant forms, payments — reads its defaults from here."
          >
            <Card title="Hostel Information">
              <p>
                Enter your Hostel Name, Address, City, Area, Phone, WhatsApp, Email, and Total Capacity, then
                tap <Kbd>Save Hostel</Kbd>.
              </p>
            </Card>
            <Card title="Package Pricing — the most important step">
              <p>
                Set your price grid for each package tier (Space Only, Space + Breakfast &amp; Dinner, Space +
                3 Meals, Space + Meals + Cooler): Rent and Deposit for both standard and AC rooms.
              </p>
              <p>
                Also set your <strong>AC Per Unit Rate</strong>, <strong>Default Security Deposit</strong>, and{" "}
                <strong>Required Notice Period (days)</strong> — the policy tenants are held to when they give
                notice. Tap <Kbd>Save Package Pricing</Kbd>.
              </p>
            </Card>
            <Card title="Application Form Fields">
              <p>
                Choose which fields appear on your public tenant application form: Email, CNIC, Type, Room
                Selection, Preferred Move-in Date, Emergency Contact, Message. Full Name and WhatsApp always
                show. Tap <Kbd>Save Form Fields</Kbd>.
              </p>
            </Card>
            <Card title="Public Listing (optional)">
              <p>
                On the <Kbd>Website</Kbd> page, turn on &quot;Listed publicly&quot; to get a shareable page at{" "}
                <Kbd>/find</Kbd> — add a cover photo, description, hostel type, and amenities. Your own web
                address, business name, logo and social links live on the same page.
              </p>
            </Card>
            <Card title="Payment Recovery (optional)">
              <p>
                Add your bank/JazzCash/EasyPaisa details and edit the WhatsApp reminder template — this powers
                the <Kbd>Remind</Kbd> button you&apos;ll use later in Payments.
              </p>
            </Card>
            <Note>
              <strong className="text-amber">Order matters:</strong> set Package Pricing before you add rooms
              or tenants — both screens auto-fill rent and deposit from it.
            </Note>
          </Section>

          <Section
            id="spaces"
            eyebrow="2. Inventory"
            title="Add your rooms"
            dek={"Go to Spaces. You need at least one room here before you can activate a tenant."}
          >
            <Step n="01" title="Tap Add Room">
              Enter Room Number, Floor, Type, Capacity, and up to 5 photos.
            </Step>
            <Step n="02" title="Flag AC / Cooler">
              Toggle <Kbd>AC Available</Kbd> or <Kbd>Cooler Available</Kbd> if the room has one — this decides
              whether meter-reading and AC billing fields show up later for tenants in this room.
            </Step>
            <Step n="03" title="Set status">
              Mark the room Available, Occupied, or Maintenance. Tap <Kbd>Add Room</Kbd> to save.
            </Step>
          </Section>

          <Section
            id="tenants"
            eyebrow="3. People"
            title="Add your tenants"
            dek="Go to Tenants. Four tabs: Active, Waiting, Checked Out, Applications."
          >
            <Card title="Bring tenants in two ways">
              <p>
                <strong>Share the form:</strong> tap <Kbd>Share Application Form</Kbd> to send your public apply
                link over WhatsApp — people apply themselves and land in the Applications tab.
              </p>
              <p>
                <strong>Add manually:</strong> tap <Kbd>Add Tenant</Kbd> to enter someone directly without them
                applying.
              </p>
            </Card>
            <Card title="Approve an application">
              <p>
                On the Applications tab, tap <Kbd>Approve</Kbd>. Choose Active Resident or Waiting List, pick a
                Room and Bed, set the Package Tier (rent/deposit auto-fill), Billing type, and Check-in Date,
                then tap <Kbd>Activate Tenant</Kbd> or <Kbd>Add to Waitlist</Kbd>.
              </p>
            </Card>
            <Card title="When a tenant is leaving">
              <p>
                On the Active tab, tap <Kbd>Give Notice</Kbd> and enter the intended checkout date — Pulse
                tells you instantly if it meets your Notice Period policy.
              </p>
              <p>
                When move-out day comes, tap <Kbd>Check Out</Kbd>: record the AC meter reading, settle any
                outstanding balance, decide how much of the security deposit to return, then confirm. You can
                share the final receipt over WhatsApp immediately after.
              </p>
            </Card>
          </Section>

          <Section
            id="payments"
            eyebrow="4. Money in"
            title="Collect rent"
            dek="Go to Payments. Once tenants are active, their monthly bills generate automatically — this screen is where you record what's actually been paid."
          >
            <div className="grid sm:grid-cols-2 gap-3.5 mb-3.5">
              <Card title="Chasing a payment">
                <p>
                  On an unpaid row, tap <Kbd>Remind</Kbd> to send your WhatsApp reminder template, or{" "}
                  <Kbd>Pay</Kbd> to record what came in.
                </p>
              </Card>
              <Card title="Recording a payment">
                <p>
                  Enter the <Kbd>Amount Received</Kbd>. Paying less than the full balance is fine — it&apos;s
                  saved as a partial payment automatically, and the remaining balance carries forward.
                </p>
              </Card>
            </div>
            <Card title="AC billing">
              <p>
                If any rooms have AC, an <Kbd>AC Billing</Kbd> tab appears. Enter each room&apos;s current meter
                reading and tap <Kbd>Apply</Kbd> — Pulse splits the usage charge across everyone in that room
                automatically, including anyone who joined mid-month.
              </p>
            </Card>
          </Section>

          <Section
            id="team"
            eyebrow="5. Delegating"
            title="Your team"
            dek="Two different things live under two different screens — pick the one that matches what you actually need."
          >
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary text-muted-foreground text-xs uppercase tracking-[0.04em]">
                    <th className="text-left px-4 py-2.5 font-semibold">Need</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Go to</th>
                    <th className="text-left px-4 py-2.5 font-semibold">What it does</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:px-4 [&_td]:py-3 [&_td]:border-t [&_td]:border-border [&_td]:align-top">
                  <tr>
                    <td>Pay your cooks, guards, cleaners</td>
                    <td>
                      <Kbd>Staff</Kbd>
                    </td>
                    <td className="text-muted-foreground">
                      Track employees and generate/mark their monthly salaries as paid. No dashboard login
                      involved.
                    </td>
                  </tr>
                  <tr>
                    <td>Let a trusted person help run the dashboard</td>
                    <td>
                      <Kbd>Managers</Kbd>
                    </td>
                    <td className="text-muted-foreground">
                      Create a limited login. Grant only what they need: Add Members, Collect Payments, and/or
                      Add Expenses, scoped to specific branches.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            id="daily"
            eyebrow="6. Day to day"
            title="Daily operations"
            dek="Use these as needed — no set order."
          >
            <Card title="Food vs Kitchen">
              <p>
                <Kbd>Food</Kbd> is your meal-planning calendar — what&apos;s being served each day.{" "}
                <Kbd>Kitchen</Kbd> is your grocery spending log — what you bought to cook it.
              </p>
            </Card>
            <Card title="Expenses & Bills">
              <p>
                <Kbd>Expenses</Kbd> logs general costs like repairs and cleaning. <Kbd>Bills</Kbd> tracks
                recurring utilities (electricity, water, internet, gas) with due dates and a <Kbd>Pay</Kbd>{" "}
                button.
              </p>
            </Card>
            <Card title="Complaints & Announcements">
              <p>
                <Kbd>Complaints</Kbd> logs maintenance issues and tracks them through Open → In Progress →
                Resolved. <Kbd>Announcements</Kbd> is your notice board for residents — pin anything important
                to the top.
              </p>
            </Card>
          </Section>

          <Section
            id="reports"
            eyebrow="7. Overview"
            title="Reports"
            dek="Go to Reports any time to see the bigger picture: Overview, Revenue, Reconciliation, Occupancy, AC Analytics, Expenses, and Member Ledger (each tenant's running balance, including deposits returned at checkout). Every tab can be exported to PDF or Excel."
          />


          <footer className="mt-16 pt-6 border-t border-border text-sm text-muted-foreground">
            Pulse User Guide — share this page with anyone who needs to learn the system.
          </footer>
        </main>
      </div>
    </div>
  );
}
