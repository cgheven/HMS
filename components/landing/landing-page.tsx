import Link from "next/link";
import { ArrowRight, Building2, CreditCard, Users, Bell, ShieldCheck, BarChart3, Mail, Phone } from "lucide-react";
import { LegalFooter } from "@/components/legal/legal-footer";

const FEATURES = [
  { icon: Users, title: "Resident management", body: "Onboard residents, track profiles, rooms, deposits and check-outs in one place." },
  { icon: CreditCard, title: "Billing & payments", body: "Per-branch package pricing, metered AC billing, monthly payment tracking and receipts." },
  { icon: Bell, title: "Automated reminders", body: "WhatsApp and email payment reminders so rent gets collected without the chasing." },
  { icon: ShieldCheck, title: "RedFlag & Hotel Eye", body: "A shared defaulter database and automated police-verification sync for every resident." },
  { icon: BarChart3, title: "Reports & multi-branch", body: "Live dashboards, expenses and reporting across every branch from a single account." },
  { icon: Building2, title: "Public listing page", body: "A branded page for your hostel with online applications and a waitlist." },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="font-serif text-2xl tracking-tight">Pulse</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
          <Link href="/pricing" className="h-9 inline-flex items-center px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">Get Started</Link>
        </div>
      </nav>

      {/* Hero — clear product description */}
      <header className="text-center px-4 pt-16 pb-14 max-w-3xl mx-auto">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-4">Hostel Management Software</p>
        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight leading-tight text-balance mb-5">
          Run your entire hostel from one dashboard
        </h1>
        <p className="text-muted-foreground text-lg leading-relaxed">
          Pulse is a subscription software platform for hostel and accommodation operators. Manage residents,
          rooms, billing, payments, expenses and reporting across every branch — with automated payment
          reminders, a defaulter database and police-verification sync built in.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/pricing" className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
            View pricing <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/login" className="inline-flex items-center h-11 px-5 rounded-xl border border-sidebar-border text-sm font-semibold hover:bg-white/5 transition-colors">
            Sign in
          </Link>
        </div>
      </header>

      {/* Features — what the product does */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-sidebar-border bg-card p-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="font-semibold">{f.title}</p>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing pointer */}
      <section className="max-w-3xl mx-auto px-4 pb-16 text-center">
        <div className="rounded-2xl border border-sidebar-border bg-gradient-to-b from-primary/[0.06] to-transparent p-8">
          <h2 className="font-serif text-2xl tracking-tight">Simple pricing, per branch</h2>
          <p className="text-muted-foreground mt-2">Two plans — Basic and Standard — billed per branch, monthly or annually.</p>
          <Link href="/pricing" className="mt-5 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
            See plans & pricing <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Contact — email + phone */}
      <section id="contact" className="max-w-3xl mx-auto px-4 pb-16">
        <div className="rounded-2xl border border-sidebar-border bg-card p-8 text-center">
          <h2 className="font-serif text-2xl tracking-tight">Get in touch</h2>
          <p className="text-muted-foreground mt-2">Questions or want a walkthrough? We usually reply within one business day.</p>
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm">
            <a href="mailto:hello@yourpulse.io" className="inline-flex items-center gap-2 hover:text-primary transition-colors">
              <Mail className="w-4 h-4 text-primary" /> hello@yourpulse.io
            </a>
            <a href="tel:+923336673553" className="inline-flex items-center gap-2 hover:text-primary transition-colors">
              <Phone className="w-4 h-4 text-primary" /> +92 333 66 73553
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            PulseHub Private Limited · Karachi, Pakistan · <Link href="/contact" className="underline">Contact page</Link>
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 pb-8">
        <LegalFooter />
      </div>
    </div>
  );
}
