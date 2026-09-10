"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Star } from "lucide-react";
import { submitDemoRequest } from "@/app/actions/demo-request";
import { LegalFooter } from "@/components/legal/legal-footer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Pricing data ──────────────────────────────────────────────────────────────
// Priced PER BRANCH. Annual = pay for 10 months, get 12 (2 months free).

type BillingPeriod = "monthly" | "annual";

const BASIC_FEATURES = [
  "Tenant management & profiles",
  "Package pricing & AC metered billing",
  "Payment tracking & security deposits",
  "Public listing page & online applications",
  "Food menu, expenses & reports",
  "Multi-branch dashboard",
  "RedFlag defaulter database",
  "Hotel Eye — police verification sync",
  "WhatsApp payment reminders",
];

const STANDARD_EXTRAS = [
  "Branded subdomain (your-name.hostel.yourpulse.io)",
  "Email payment reminders",
  "Referral & rewards engine",
];

const PLANS = [
  {
    key:        "basic",
    name:       "Basic",
    tagline:    "Everything you need to run your hostel.",
    monthly:    6000,
    annual:     60000,
    highlight:  false,
    features:   BASIC_FEATURES,
    extrasNote: "",
  },
  {
    key:        "standard",
    name:       "Standard",
    tagline:    "Basic, plus the tools to grow.",
    monthly:    8000,
    annual:     80000,
    highlight:  true,
    badge:      "Most Popular",
    features:   STANDARD_EXTRAS,
    extrasNote: "Everything in Basic, plus:",
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-PK");
}

function monthsFree(plan: (typeof PLANS)[number]) {
  return Math.round(12 - plan.annual / plan.monthly);
}

// ── Plan Card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  period,
  onGetStarted,
}: {
  plan: (typeof PLANS)[number];
  period: BillingPeriod;
  onGetStarted: () => void;
}) {
  const price = period === "monthly" ? plan.monthly : plan.annual;
  const free  = monthsFree(plan);

  return (
    <div
      className={`group/card relative flex flex-col gap-5 overflow-hidden rounded-2xl border p-7 transition-all duration-300 hover:-translate-y-1 ${
        plan.highlight
          ? "border-primary/40 bg-gradient-to-b from-primary/[0.07] to-transparent shadow-[0_0_60px_-10px] shadow-primary/20 hover:shadow-[0_0_70px_-8px] hover:shadow-primary/30"
          : "border-sidebar-border bg-card hover:border-primary/25 hover:shadow-xl hover:shadow-black/20"
      }`}
    >
      {plan.highlight && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary/30 via-primary to-primary/30" />
      )}

      {"badge" in plan && plan.badge ? (
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider shadow-md shadow-primary/30">
            <Star className="w-3 h-3 fill-current" /> {plan.badge}
          </span>
        </div>
      ) : (
        <div className="h-6" />
      )}

      {/* Header */}
      <div>
        <p className="text-lg font-bold text-foreground tracking-tight">{plan.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{plan.tagline}</p>

        <div className="mt-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm text-muted-foreground">PKR</span>
            <span className="text-4xl font-black text-foreground tabular-nums tracking-tight leading-none">
              {fmt(price)}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            per branch · {period === "monthly" ? "per month" : "per year"}
          </span>
        </div>

        {period === "annual" && (
          <p className="text-xs text-muted-foreground mt-2">
            <span className="font-semibold text-primary">{free} months free</span> vs. monthly
          </p>
        )}
      </div>

      {/* Features */}
      <div className="space-y-2.5">
        {plan.extrasNote && (
          <p className="text-xs font-semibold text-foreground/80">{plan.extrasNote}</p>
        )}
        {plan.features.map((f) => (
          <div key={f} className="flex items-start gap-2.5">
            <div className="mt-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-primary/10 shrink-0">
              <Check className="w-2.5 h-2.5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">{f}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-auto pt-2">
        <button
          onClick={onGetStarted}
          className={`group flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
            plan.highlight
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20"
              : "border border-sidebar-border hover:border-primary/40 hover:bg-primary/5 text-foreground"
          }`}
        >
          Get Started
          <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

// ── Get Started Form ──────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full h-11 rounded-lg border border-sidebar-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:ring-2 focus:ring-primary/30 focus:border-primary";

const PLAN_LABELS: Record<string, string> = {
  basic:    "Basic",
  standard: "Standard",
};

function GetStartedForm({ initialPlan = "" }: { initialPlan?: string }) {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess]        = useState(false);
  const [error, setError]            = useState<string | null>(null);
  const [form, setForm]              = useState({
    contact_name: "",
    hostel_name:  "",
    phone:        "",
    city:         "",
    plan_interest: initialPlan,
    message:      "",
  });

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitDemoRequest(form);
      if (result.error) setError(result.error);
      else setSuccess(true);
    });
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-foreground text-lg">We&apos;ll be in touch!</p>
          <p className="text-sm text-muted-foreground mt-1">
            Our team will contact you within 24 hours to get you set up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <input
            className={INPUT_CLS}
            placeholder="Your name *"
            value={form.contact_name}
            onChange={field("contact_name")}
            required
          />
        </div>
        <input
          className={INPUT_CLS}
          placeholder="Hostel / business name *"
          value={form.hostel_name}
          onChange={field("hostel_name")}
          required
        />
        <input
          className={INPUT_CLS}
          placeholder="Phone number *"
          value={form.phone}
          onChange={field("phone")}
          required
        />
        <input
          className={INPUT_CLS}
          placeholder="City"
          value={form.city}
          onChange={field("city")}
        />
        <select
          className={INPUT_CLS}
          value={form.plan_interest}
          onChange={field("plan_interest")}
        >
          <option value="">Interested plan (optional)</option>
          {Object.entries(PLAN_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div className="col-span-2">
          <textarea
            className={`${INPUT_CLS} h-20 resize-none py-2.5`}
            placeholder="Anything else we should know? (optional)"
            value={form.message}
            onChange={field("message")}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all shadow-md shadow-primary/20"
      >
        {isPending ? "Sending…" : "Send Request"}
      </button>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [period, setPeriod]             = useState<BillingPeriod>("monthly");
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("");

  function openDialog(planKey: string) {
    setSelectedPlan(planKey);
    setDialogOpen(true);
  }

  return (
    <div className="relative min-h-screen">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.06] blur-[120px] rounded-full" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link href="/" className="font-serif text-2xl text-foreground tracking-tight">
          HMS
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
          <button
            onClick={() => openDialog("")}
            className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative z-10 text-center px-4 pt-12 pb-10 max-w-2xl mx-auto">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-4">Pricing</p>
        <h1 className="font-serif text-4xl sm:text-5xl text-foreground tracking-tight leading-tight text-balance mb-4">
          Simple pricing, priced per branch
        </h1>
        <p className="text-muted-foreground text-base">
          Pay only for the branches you run. Every plan includes full setup, training, and support.
        </p>
      </div>

      {/* Billing toggle */}
      <div className="relative z-10 flex justify-center mb-10">
        <div className="flex items-center gap-1 p-1 rounded-xl border border-sidebar-border bg-card">
          {(["monthly", "annual"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                period === p
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "monthly" ? "Monthly" : "Annual"}
              {p === "annual" && (
                <span className="ml-2 text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">
                  2 months free
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="relative z-10 max-w-3xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              period={period}
              onGetStarted={() => openDialog(plan.key)}
            />
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground/70 mt-8">
          Prices are per branch. A 3-branch hostel on Basic pays PKR {fmt(6000 * 3)}/month.
          <br className="hidden sm:block" />
          Full setup, training, and support are included in every plan.
        </p>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8">
        <LegalFooter />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8">
        <LegalFooter />
      </div>

      {/* Get Started dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-normal tracking-tight">
              Get started with HMS
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Our team will reach out within 24 hours to set everything up for you.
            </p>
          </DialogHeader>
          <GetStartedForm initialPlan={selectedPlan} key={selectedPlan} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
