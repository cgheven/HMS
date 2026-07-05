"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, Building2, CheckCircle2 } from "lucide-react";
import { submitDemoRequest } from "@/app/actions/demo-request";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Pricing data ──────────────────────────────────────────────────────────────

type BillingPeriod = "monthly" | "annual";

const PLANS = [
  {
    key:         "single",
    name:        "Single Branch",
    limit:       1,
    tagline:     "One hostel, fully managed.",
    monthly:     5000,
    annual:      50000,
    highlight:   false,
  },
  {
    key:         "small",
    name:        "Up to 3 Branches",
    limit:       3,
    tagline:     "Grow across multiple locations.",
    monthly:     10000,
    annual:      100000,
    highlight:   false,
  },
  {
    key:         "medium",
    name:        "Up to 6 Branches",
    limit:       6,
    tagline:     "The sweet spot for growing networks.",
    monthly:     18000,
    annual:      180000,
    highlight:   true,
    badge:       "Most Popular",
  },
  {
    key:         "large",
    name:        "Up to 16 Branches",
    limit:       16,
    tagline:     "Enterprise-scale hostel management.",
    monthly:     40000,
    annual:      400000,
    highlight:   false,
  },
] as const;

const FEATURES = [
  "Tenant management & profiles",
  "Package-based pricing & billing",
  "AC unit metered billing",
  "Monthly payment tracking",
  "Security deposit management",
  "Public hostel listing page",
  "Online applications & waitlist",
  "Partner portal access",
  "Food menu management",
  "Reports & analytics",
  "Multi-branch dashboard",
  "WhatsApp payment reminders",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-PK");
}

function annualSavings(plan: (typeof PLANS)[number]) {
  return plan.monthly * 12 - plan.annual;
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
  const price    = period === "monthly" ? plan.monthly : plan.annual;
  const saved    = annualSavings(plan);
  const perMonth = Math.round(plan.annual / 12);

  return (
    <div
      className={`flex flex-col gap-5 rounded-2xl border p-6 transition-all ${
        plan.highlight
          ? "border-primary/40 bg-primary/[0.04] shadow-[0_0_60px_-10px] shadow-primary/20"
          : "border-sidebar-border bg-card"
      }`}
    >
      {/* Badge — inline so it never overlaps adjacent cards */}
      {"badge" in plan && plan.badge ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider shadow-md">
            ⭐ {plan.badge}
          </span>
        </div>
      ) : (
        <div className="h-6" /> /* spacer keeps all cards the same top alignment */
      )}

      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          {Array.from({ length: Math.min(plan.limit, 4) }).map((_, i) => (
            <Building2 key={i} className="w-3 h-3 text-primary/60" />
          ))}
          {plan.limit > 4 && (
            <span className="text-[10px] text-primary/60 font-semibold">+{plan.limit - 4}</span>
          )}
        </div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">
          {plan.name}
        </p>

        {/* Price — suffix on its own line to prevent overflow on 6-digit annual numbers */}
        <div className="mt-3 mb-1">
          <div className="flex items-end gap-1">
            <span className="text-sm text-muted-foreground mb-1">PKR</span>
            <span className="text-4xl font-black text-foreground tabular-nums leading-none">
              {fmt(price)}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            {period === "monthly" ? "/ month" : "/ year"}
          </span>
        </div>

        {period === "annual" ? (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">PKR {fmt(perMonth)}/mo</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-[11px] font-bold text-primary">
              Save PKR {fmt(saved)}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-1.5">{plan.tagline}</p>
        )}
      </div>

      {/* Annual equivalent shown in monthly view */}
      {period === "monthly" && (
        <div className="rounded-xl border border-sidebar-border bg-sidebar/50 px-3 py-2.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Annual plan</span>
          <span className="font-semibold text-foreground tabular-nums">
            PKR {fmt(plan.annual)}/yr
          </span>
        </div>
      )}

      {/* CTA */}
      <div className="mt-auto">
        <button
          onClick={onGetStarted}
          className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
            plan.highlight
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20"
              : "border border-sidebar-border hover:border-primary/40 hover:bg-primary/5 text-foreground"
          }`}
        >
          Get Started
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Get Started Form ──────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full h-11 rounded-lg border border-sidebar-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition focus:ring-2 focus:ring-primary/30 focus:border-primary";

const PLAN_LABELS: Record<string, string> = {
  single: "Single Branch",
  small:  "Up to 3 Branches",
  medium: "Up to 6 Branches",
  large:  "Up to 16 Branches",
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
          Simple pricing for every hostel
        </h1>
        <p className="text-muted-foreground text-base">
          All plans include full setup, training, and support.
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
                  Save ~16%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              period={period}
              onGetStarted={() => openDialog(plan.key)}
            />
          ))}
        </div>

        {/* Tagline */}
        <p className="text-center text-sm text-muted-foreground/60 mt-8">
          All plans include full setup, training, and support
        </p>

        {/* Features grid */}
        <div className="mt-16 rounded-2xl border border-sidebar-border bg-card p-8">
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-6 text-center">
            Everything included in every plan
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2.5">
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-sm text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
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
