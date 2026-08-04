"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Home, Building2, Sparkles, Wallet, BedDouble, Users2, Plus, Trash2,
  Check, ChevronLeft, ChevronRight, Loader2, Cloud, CloudOff, PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SEATER_CAPACITIES, SEATER_LABELS } from "@/lib/seater-pricing";
import type { SeaterRate } from "@/lib/seater-pricing";
import { saveOnboardingDraft, submitOnboardingDraft } from "@/app/actions/onboarding-intake";
import { EMPTY_ONBOARDING_BRANCH, EMPTY_ONBOARDING_CONFIG } from "@/types";
import type {
  HostelType, OnboardingBranchConfig, OnboardingData, PartnerTier, PaymentMethodAccount,
} from "@/types";
import { OnboardingDone } from "./onboarding-done";

const HOSTEL_TYPES: { value: HostelType; label: string }[] = [
  { value: "boys",   label: "Boys Only" },
  { value: "girls",  label: "Girls Only" },
];

const ALL_AMENITIES = [
  "WiFi", "AC", "Generator / UPS", "Meals Included", "Laundry", "Parking",
  "CCTV", "Hot Water", "Study Room", "Attached Bath", "Security Guard", "Cupboard",
];

const TIERS: { value: PartnerTier; label: string; hint: string }[] = [
  { value: "read_only", label: "Read-only", hint: "Can view, cannot change anything" },
  { value: "standard",  label: "Standard",  hint: "Day-to-day: tenants, payments, expenses" },
  { value: "full",      label: "Full",      hint: "Equal to you on that branch" },
];

const STEPS = [
  { key: "branches", title: "Your branches",  icon: Building2, blurb: "Who you are and where you operate." },
  { key: "profile",  title: "Hostel profile", icon: Sparkles,  blurb: "What kind of hostel, and what you offer." },
  { key: "pricing",  title: "Charges",        icon: Wallet,    blurb: "AC, deposit, notice period and meals." },
  { key: "seater",   title: "Room pricing",   icon: BedDouble, blurb: "Rent by room size — set once, applies everywhere." },
  { key: "people",   title: "Partners & payments", icon: Users2, blurb: "Anyone who helps run it, and where rent lands." },
];

type Scope = "all" | number;

export function OnboardingWizard({
  token,
  initialData,
}: {
  token: string;
  initialData: OnboardingData;
}) {
  const [data, setData] = useState<OnboardingData>(initialData);
  const [step, setStep] = useState(Math.min(initialData.furthestStep ?? 0, STEPS.length - 1));
  const [scope, setScope] = useState<Scope>("all");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autosave on a debounce. The first render is skipped so simply opening the
  // link doesn't write; only real edits do.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const result = await saveOnboardingDraft(token, data);
      setSaveState(result.error ? "error" : "saved");
    }, 700);
    return () => clearTimeout(t);
  }, [data, token]);

  const patch = useCallback((fn: (d: OnboardingData) => OnboardingData) => {
    dirty.current = true;
    setData(fn);
  }, []);

  // --- config scoping -------------------------------------------------------
  // The shared config is filled once and applied to every branch. Selecting a
  // specific branch edits an override for that branch only; fields the override
  // doesn't mention keep inheriting from shared, so "customise one thing" stays
  // one click rather than a full re-entry.
  const effective: OnboardingBranchConfig = useMemo(() => {
    if (scope === "all") return data.config;
    return { ...data.config, ...(data.branches[scope]?.overrides ?? {}) };
  }, [scope, data.config, data.branches]);

  const setConfig = useCallback(<K extends keyof OnboardingBranchConfig>(
    key: K,
    value: OnboardingBranchConfig[K],
  ) => {
    patch((d) => {
      if (scope === "all") return { ...d, config: { ...d.config, [key]: value } };
      const branches = [...d.branches];
      const b = branches[scope];
      branches[scope] = { ...b, overrides: { ...(b.overrides ?? {}), [key]: value } };
      return { ...d, branches };
    });
  }, [patch, scope]);

  const resetBranchOverrides = useCallback((idx: number) => {
    patch((d) => {
      const branches = [...d.branches];
      const { overrides: _drop, ...rest } = branches[idx];
      branches[idx] = rest;
      return { ...d, branches };
    });
  }, [patch]);

  // --- branches -------------------------------------------------------------
  const setBranchCount = (n: number) => {
    const next = Math.max(1, Math.min(25, n));
    patch((d) => {
      const branches = [...d.branches];
      while (branches.length < next) branches.push({ ...EMPTY_ONBOARDING_BRANCH });
      branches.length = next;
      return { ...d, branches };
    });
    if (typeof scope === "number" && scope >= next) setScope("all");
  };

  const setBranch = (idx: number, key: keyof typeof EMPTY_ONBOARDING_BRANCH, value: string) => {
    patch((d) => {
      const branches = [...d.branches];
      branches[idx] = { ...branches[idx], [key]: value };
      return { ...d, branches };
    });
  };

  // --- validation -----------------------------------------------------------
  const step0Valid =
    data.owner.name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.owner.email.trim()) &&
    data.branches.every((b) => b.name.trim().length > 0);

  const canAdvance = step === 0 ? step0Valid : true;

  const go = (next: number) => {
    const target = Math.max(0, Math.min(STEPS.length - 1, next));
    setStep(target);
    setScope("all");
    patch((d) => ({ ...d, furthestStep: Math.max(d.furthestStep ?? 0, target) }));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const result = await submitOnboardingDraft(token, data);
    setSubmitting(false);
    if (result.error) { setError(result.error); return; }
    setSubmitted(true);
  }

  if (submitted) return <OnboardingDone ownerName={data.owner.name} />;

  const multiBranch = data.branches.length > 1;
  const scopedStep = step >= 1 && step <= 4;

  return (
    <main className="min-h-screen bg-background">
      {/* Header + progress */}
      {/* Solid, not backdrop-blur: this bar and the fixed footer are both on
          screen for the whole scroll, and two full-width backdrop-filter layers
          make the compositor re-blur everything behind them every frame. At 95%
          opacity the blur was invisible anyway. */}
      <div className="sticky top-0 z-20 bg-background border-b border-sidebar-border">
        <div className="max-w-3xl mx-auto px-5 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center">
                <Home className="w-4 h-4 text-amber" />
              </div>
              <div className="leading-none">
                <p className="text-sm font-bold text-foreground">Pulse</p>
                <p className="text-[10px] text-amber/70 font-semibold tracking-[0.15em] uppercase mt-0.5">Set up</p>
              </div>
            </div>
            <SaveIndicator state={saveState} />
          </div>

          <div className="pb-3 space-y-2">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-amber transition-[width] duration-500 ease-out"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Step {step + 1} of {STEPS.length} · <span className="text-foreground">{STEPS[step].title}</span>
              </p>
              <p className="text-[11px] text-muted-foreground/60 hidden sm:block">
                Progress saves automatically
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 py-8 pb-32">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
            {STEPS[step].title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">{STEPS[step].blurb}</p>
        </div>

        {/* Which branch am I editing? Only meaningful once there's more than one. */}
        {scopedStep && multiBranch && (
          <div className="mb-6 rounded-xl border border-sidebar-border bg-card p-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Applying to
            </p>
            <div className="flex flex-wrap gap-1.5">
              <ScopeChip active={scope === "all"} onClick={() => setScope("all")}>
                All branches
              </ScopeChip>
              {data.branches.map((b, i) => (
                <ScopeChip
                  key={i}
                  active={scope === i}
                  customised={!!b.overrides && Object.keys(b.overrides).length > 0}
                  onClick={() => setScope(i)}
                >
                  {b.name.trim() || `Branch ${i + 1}`}
                </ScopeChip>
              ))}
            </div>
            {typeof scope === "number" && (
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Changes here apply to this branch only. Anything you don&apos;t change keeps using
                  the shared values.
                </p>
                {!!data.branches[scope]?.overrides && (
                  <button
                    type="button"
                    onClick={() => resetBranchOverrides(scope)}
                    className="text-xs text-amber hover:text-amber/80 shrink-0 font-medium"
                  >
                    Reset to shared
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {step === 0 && (
          <StepBranches
            data={data}
            setOwner={(k, v) => patch((d) => ({ ...d, owner: { ...d.owner, [k]: v } }))}
            setBranchCount={setBranchCount}
            setBranch={setBranch}
          />
        )}
        {step === 1 && <StepProfile config={effective} setConfig={setConfig} />}
        {step === 2 && <StepCharges config={effective} setConfig={setConfig} />}
        {step === 3 && <StepSeater config={effective} setConfig={setConfig} />}
        {step === 4 && (
          <StepPeople
            data={data}
            config={effective}
            setConfig={setConfig}
            patch={patch}
          />
        )}

        {error && (
          <div className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3">
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="fixed bottom-0 inset-x-0 z-20 bg-background border-t border-sidebar-border">
        <div className="max-w-3xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => go(step - 1)}
            disabled={step === 0 || submitting}
            className="gap-1.5"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>

          <div className="flex items-center gap-2">
            {step > 0 && step < STEPS.length - 1 && (
              <Button variant="ghost" onClick={() => go(step + 1)} className="text-muted-foreground">
                Skip
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => go(step + 1)} disabled={!canAdvance} className="gap-1.5 min-w-[120px]">
                Continue <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting || !step0Valid} className="gap-2 min-w-[150px]">
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><PartyPopper className="w-4 h-4" /> Finish setup</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — owner + branches
// ---------------------------------------------------------------------------

function StepBranches({
  data, setOwner, setBranchCount, setBranch,
}: {
  data: OnboardingData;
  setOwner: (k: "name" | "email" | "phone", v: string) => void;
  setBranchCount: (n: number) => void;
  setBranch: (idx: number, key: keyof typeof EMPTY_ONBOARDING_BRANCH, value: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Section title="About you">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Your name" required>
            <Input
              placeholder="Ahmed Khan"
              value={data.owner.name}
              onChange={(e) => setOwner("name", e.target.value)}
            />
          </Field>
          <Field label="Email" required hint="We'll send your login here.">
            <Input
              type="email"
              placeholder="you@example.com"
              value={data.owner.email}
              onChange={(e) => setOwner("email", e.target.value)}
            />
          </Field>
          <Field label="WhatsApp number" className="sm:col-span-2">
            <Input
              placeholder="+92 300 0000000"
              value={data.owner.phone}
              onChange={(e) => setOwner("phone", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="How many branches?"
        subtitle="Each branch gets its own dashboard, tenants and reports. You can add more later."
      >
        <div className="flex items-center gap-3">
          <Button
            type="button" variant="outline" size="icon"
            onClick={() => setBranchCount(data.branches.length - 1)}
            disabled={data.branches.length <= 1}
            className="h-10 w-10 shrink-0"
          >
            <span className="text-lg leading-none">−</span>
          </Button>
          <div className="w-16 h-10 rounded-lg border border-sidebar-border bg-card flex items-center justify-center">
            <span className="text-lg font-semibold text-foreground">{data.branches.length}</span>
          </div>
          <Button
            type="button" variant="outline" size="icon"
            onClick={() => setBranchCount(data.branches.length + 1)}
            className="h-10 w-10 shrink-0"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <p className="text-xs text-muted-foreground ml-1">
            {data.branches.length === 1 ? "Single branch" : `${data.branches.length} branches`}
          </p>
        </div>
      </Section>

      <div className="space-y-3">
        {data.branches.map((b, i) => (
          <div key={i} className="rounded-xl border border-sidebar-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-amber/10 border border-amber/20 text-amber text-xs font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <p className="text-sm font-medium text-foreground">
                {data.branches.length === 1 ? "Your hostel" : `Branch ${i + 1}`}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Branch name" required className="sm:col-span-2">
                <Input
                  placeholder="Al Rasheed Boys Hostel"
                  value={b.name}
                  onChange={(e) => setBranch(i, "name", e.target.value)}
                />
              </Field>
              <Field label="City">
                <Input placeholder="Karachi" value={b.city} onChange={(e) => setBranch(i, "city", e.target.value)} />
              </Field>
              <Field label="Area / Neighbourhood">
                <Input placeholder="Gulistan e Johar" value={b.area} onChange={(e) => setBranch(i, "area", e.target.value)} />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Input placeholder="Street, block, landmark" value={b.address} onChange={(e) => setBranch(i, "address", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input placeholder="03000000000" value={b.phone} onChange={(e) => setBranch(i, "phone", e.target.value)} />
              </Field>
              <Field label="Total beds" hint="Rough number is fine.">
                <Input
                  type="number" min={0} placeholder="40"
                  value={b.total_capacity}
                  onChange={(e) => setBranch(i, "total_capacity", e.target.value)}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — type + amenities
// ---------------------------------------------------------------------------

function StepProfile({
  config, setConfig,
}: {
  config: OnboardingBranchConfig;
  setConfig: <K extends keyof OnboardingBranchConfig>(k: K, v: OnboardingBranchConfig[K]) => void;
}) {
  const toggleAmenity = (a: string) => {
    const has = config.amenities.includes(a);
    setConfig("amenities", has ? config.amenities.filter((x) => x !== a) : [...config.amenities, a]);
  };

  return (
    <div className="space-y-6">
      <Section title="Who is it for?">
        <div className="flex flex-wrap gap-2">
          {HOSTEL_TYPES.map((t) => (
            <Chip key={t.value} active={config.hostel_type === t.value} onClick={() => setConfig("hostel_type", t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="What do you offer?" subtitle="Tap everything that applies — this is what tenants see on your public page.">
        <div className="flex flex-wrap gap-2">
          {ALL_AMENITIES.map((a) => (
            <Chip key={a} active={config.amenities.includes(a)} tone="emerald" onClick={() => toggleAmenity(a)}>
              {a}
            </Chip>
          ))}
        </div>
      </Section>

      <button
        type="button"
        onClick={() => setConfig("food_closed_on_sundays", !config.food_closed_on_sundays)}
        className="w-full rounded-xl border border-sidebar-border bg-card p-4 flex items-center justify-between gap-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div>
          <p className="text-sm font-medium text-foreground">Kitchen closed on Sundays</p>
          <p className="text-xs text-muted-foreground mt-0.5">Turn on if you don&apos;t serve meals on Sunday.</p>
        </div>
        <Toggle on={config.food_closed_on_sundays} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — charges + food add-ons
// ---------------------------------------------------------------------------

function StepCharges({
  config, setConfig,
}: {
  config: OnboardingBranchConfig;
  setConfig: <K extends keyof OnboardingBranchConfig>(k: K, v: OnboardingBranchConfig[K]) => void;
}) {
  return (
    <div className="space-y-6">
      <Section title="Standard charges">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="AC per unit (Rs.)" hint="Billed on top of rent for AC rooms.">
            <Input type="number" min={0} placeholder="120" value={config.ac_per_unit_rate}
              onChange={(e) => setConfig("ac_per_unit_rate", e.target.value)} />
          </Field>
          <Field label="Security deposit (Rs.)" hint="Default when a room has none set.">
            <Input type="number" min={0} placeholder="8000" value={config.security_deposit}
              onChange={(e) => setConfig("security_deposit", e.target.value)} />
          </Field>
          <Field label="Notice period (days)" hint="Before a tenant checks out.">
            <Input type="number" min={0} placeholder="30" value={config.notice_period_days}
              onChange={(e) => setConfig("notice_period_days", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="Meal pricing"
        subtitle="Optional — only if tenants can add meals on top of their room. Leave blank if meals are always included or not offered."
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Breakfast (Rs. / month)">
            <Input type="number" min={0} placeholder="5000" value={config.food_breakfast_rate}
              onChange={(e) => setConfig("food_breakfast_rate", e.target.value)} />
          </Field>
          <Field label="Lunch (Rs. / month)">
            <Input type="number" min={0} placeholder="5000" value={config.food_lunch_rate}
              onChange={(e) => setConfig("food_lunch_rate", e.target.value)} />
          </Field>
          <Field label="Dinner (Rs. / month)">
            <Input type="number" min={0} placeholder="5000" value={config.food_dinner_rate}
              onChange={(e) => setConfig("food_dinner_rate", e.target.value)} />
          </Field>
          <Field label="All 3 meals bundle (Rs. / month)" hint="Usually cheaper than the three added up.">
            <Input type="number" min={0} placeholder="15000" value={config.food_all_meals_rate}
              onChange={(e) => setConfig("food_all_meals_rate", e.target.value)} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — seater pricing
// ---------------------------------------------------------------------------

function StepSeater({
  config, setConfig,
}: {
  config: OnboardingBranchConfig;
  setConfig: <K extends keyof OnboardingBranchConfig>(k: K, v: OnboardingBranchConfig[K]) => void;
}) {
  const set = (cap: string, field: keyof SeaterRate, value: string) => {
    const n = value === "" ? undefined : Number(value);
    const current: SeaterRate = { no_ac: 0, ac: 0, ...(config.seater_prices[cap] ?? {}) };
    const next: SeaterRate = { ...current, [field]: n ?? 0 };
    setConfig("seater_prices", { ...config.seater_prices, [cap]: next });
  };

  const val = (cap: string, field: keyof SeaterRate) => {
    const v = config.seater_prices[cap]?.[field];
    return v === undefined || v === 0 ? "" : String(v);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-sidebar-border bg-card p-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Set rent by room size and every room prices itself automatically — no need to price rooms
          one by one. <span className="text-foreground">Only fill the sizes you actually have</span>;
          leave the rest blank.
        </p>
        <p className="text-xs text-muted-foreground/80 leading-relaxed mt-2">
          Fill <span className="text-foreground">Non-AC</span> for ordinary rooms and{" "}
          <span className="text-foreground">AC</span> for air-conditioned ones. If you don&apos;t
          offer one of them, leave that column empty.
        </p>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-card overflow-hidden">
        {/* Two-row header. A single "Rent" / "Deposit" column left owners
            guessing which one was the non-AC price, so each pair is grouped and
            both halves are labelled outright. */}
        <div className="border-b border-sidebar-border/50">
          <div className="grid grid-cols-[1fr_repeat(4,minmax(64px,1fr))] pt-2.5">
            <div />
            <div className="col-span-2 text-center text-[10px] font-semibold text-foreground/80 uppercase tracking-wide">
              Monthly rent
            </div>
            <div className="col-span-2 text-center text-[10px] font-semibold text-foreground/80 uppercase tracking-wide">
              Security deposit
            </div>
          </div>
          <div className="grid grid-cols-[1fr_repeat(4,minmax(64px,1fr))] pb-2 pt-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            <div className="px-3">Room</div>
            <div className="text-center">Non-AC</div>
            <div className="text-center">AC</div>
            <div className="text-center">Non-AC</div>
            <div className="text-center">AC</div>
          </div>
        </div>
        {SEATER_CAPACITIES.map((cap) => (
          <div key={cap} className="grid grid-cols-[1fr_repeat(4,minmax(64px,1fr))] gap-px bg-sidebar-border/50">
            <div className="bg-card px-3 py-2 flex items-center">
              <span className="text-sm text-foreground">{SEATER_LABELS[cap]}</span>
            </div>
            {(["no_ac", "ac", "deposit_no_ac", "deposit_ac"] as (keyof SeaterRate)[]).map((f) => (
              <div key={f} className="bg-card p-1.5">
                <Input
                  type="number" min={0} placeholder="—"
                  value={val(cap, f)}
                  onChange={(e) => set(cap, f, e.target.value)}
                  className="h-9 text-center text-sm px-1"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — partners + payment methods
// ---------------------------------------------------------------------------

function StepPeople({
  data, config, setConfig, patch,
}: {
  data: OnboardingData;
  config: OnboardingBranchConfig;
  setConfig: <K extends keyof OnboardingBranchConfig>(k: K, v: OnboardingBranchConfig[K]) => void;
  patch: (fn: (d: OnboardingData) => OnboardingData) => void;
}) {
  const addPartner = () => patch((d) => ({
    ...d,
    partners: [...d.partners, { name: "", email: "", phone: "", tier: "standard", branchIndexes: [] }],
  }));

  const setPartner = (i: number, key: string, value: unknown) => patch((d) => {
    const partners = [...d.partners];
    partners[i] = { ...partners[i], [key]: value };
    return { ...d, partners };
  });

  const removePartner = (i: number) => patch((d) => ({
    ...d, partners: d.partners.filter((_, x) => x !== i),
  }));

  const methods = config.payment_methods;
  const addMethod = () => setConfig("payment_methods", [
    ...methods,
    { id: crypto.randomUUID(), label: "", account_title: "", account_number: "", iban: "" },
  ]);
  const setMethod = (i: number, key: keyof PaymentMethodAccount, value: string) => {
    const next = [...methods];
    next[i] = { ...next[i], [key]: value };
    setConfig("payment_methods", next);
  };
  const removeMethod = (i: number) =>
    setConfig("payment_methods", methods.filter((_, x) => x !== i));

  return (
    <div className="space-y-8">
      <Section
        title="Partners"
        subtitle="Optional. Anyone who co-runs a branch and needs their own login. You can add them later too."
        action={<Button type="button" variant="outline" size="sm" onClick={addPartner} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add partner</Button>}
      >
        {data.partners.length === 0 ? (
          <EmptyHint>No partners — it&apos;s just you for now.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {data.partners.map((p, i) => (
              <div key={i} className="rounded-xl border border-sidebar-border bg-card p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                    <Input placeholder="Full name" value={p.name} onChange={(e) => setPartner(i, "name", e.target.value)} />
                    <Input placeholder="partner@example.com" value={p.email} onChange={(e) => setPartner(i, "email", e.target.value)} />
                    <Input placeholder="+92 300 0000000" value={p.phone} onChange={(e) => setPartner(i, "phone", e.target.value)} />
                  </div>
                  <button type="button" onClick={() => removePartner(i)} className="p-2 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Access level</Label>
                  <Select value={p.tier} onValueChange={(v) => setPartner(i, "tier", v as PartnerTier)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIERS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label} — {t.hint}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {data.branches.length > 1 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Which branches?</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {data.branches.map((b, bi) => {
                        const on = p.branchIndexes.includes(bi);
                        return (
                          <Chip
                            key={bi} active={on} size="sm"
                            onClick={() => setPartner(i, "branchIndexes", on
                              ? p.branchIndexes.filter((x) => x !== bi)
                              : [...p.branchIndexes, bi])}
                          >
                            {b.name.trim() || `Branch ${bi + 1}`}
                          </Chip>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Where should rent be sent?"
        subtitle="Bank accounts, JazzCash or EasyPaisa. These appear in the payment reminders your tenants receive."
        action={<Button type="button" variant="outline" size="sm" onClick={addMethod} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add account</Button>}
      >
        {methods.length === 0 ? (
          <EmptyHint>No accounts added yet.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {methods.map((m, i) => (
              <div key={m.id} className="rounded-xl border border-sidebar-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    <Field label="Bank / method"><Input placeholder="HBL" value={m.label} onChange={(e) => setMethod(i, "label", e.target.value)} /></Field>
                    <Field label="Account title"><Input placeholder="AL RASHEED HOSTEL" value={m.account_title ?? ""} onChange={(e) => setMethod(i, "account_title", e.target.value)} /></Field>
                    <Field label="Account number"><Input placeholder="0000111199992222" value={m.account_number ?? ""} onChange={(e) => setMethod(i, "account_number", e.target.value)} /></Field>
                    <Field label="IBAN" hint="Optional"><Input placeholder="PK00XXXX..." value={m.iban ?? ""} onChange={(e) => setMethod(i, "iban", e.target.value)} /></Field>
                  </div>
                  <button type="button" onClick={() => removeMethod(i)} className="p-2 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="rounded-xl border border-amber/20 bg-amber/[0.04] p-4">
        <p className="text-sm text-foreground font-medium">Almost done</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Hit <span className="text-foreground">Finish setup</span> and we&apos;ll build your account —
          {" "}{data.branches.length === 1 ? "your branch" : `all ${data.branches.length} branches`}, pricing and
          everything above. Anything you skipped can be set later in Settings.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function Section({ title, subtitle, action, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xl">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, hint, className, children }: {
  label: string; required?: boolean; hint?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs">
        {label}{required && <span className="text-amber ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function Chip({ active, tone = "amber", size = "md", onClick, children }: {
  active: boolean; tone?: "amber" | "emerald"; size?: "sm" | "md";
  onClick: () => void; children: React.ReactNode;
}) {
  const activeCls = tone === "emerald"
    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
    : "bg-amber/10 border-amber/30 text-amber";
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        "rounded-full border transition-colors font-medium",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        active ? activeCls : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-white/20"
      )}
    >
      {children}
    </button>
  );
}

function ScopeChip({ active, customised, onClick, children }: {
  active: boolean; customised?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5",
        active ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      {customised && <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0" />}
    </button>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={cn(
      "w-11 h-6 rounded-full flex items-center px-0.5 transition-colors shrink-0",
      on ? "bg-amber justify-end" : "bg-white/10 justify-start"
    )}>
      <span className="w-5 h-5 rounded-full bg-white shadow" />
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sidebar-border py-7 text-center">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  const map = {
    saving: { icon: <Loader2 className="w-3 h-3 animate-spin" />, text: "Saving", cls: "text-muted-foreground" },
    saved:  { icon: <Cloud className="w-3 h-3" />,                text: "Saved",  cls: "text-emerald-400/80" },
    error:  { icon: <CloudOff className="w-3 h-3" />,             text: "Not saved", cls: "text-rose-400" },
  } as const;
  const s = map[state];
  return (
    <div className={cn("flex items-center gap-1.5 text-[11px] font-medium", s.cls)}>
      {s.icon}<span>{s.text}</span>
    </div>
  );
}
