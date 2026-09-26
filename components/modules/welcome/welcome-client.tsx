"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2, BedDouble, Receipt, Wifi, Clock, UtensilsCrossed, Gift, Banknote, Users, CreditCard,
  Check, ChevronRight, Loader2, ArrowRight, Sparkles, Plus, Trash2, Globe, CalendarClock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { floorToken, roomToken } from "@/lib/wifi-coverage";
import { getCountryConfig } from "@/lib/country-config";
import { saveWelcomeSettings } from "@/app/actions/settings";
import { updateReferralPercentages, startReferralCampaign } from "@/app/actions/referrals";
import { dismissWelcome, type WelcomeStatus, type WelcomeStep } from "@/app/actions/onboarding-welcome";
import { loadSampleData } from "@/app/actions/demo-data";
import { PackagePricingForm } from "@/components/modules/settings/package-pricing-form";
import { PaymentMethodsForm } from "@/components/modules/settings/payment-methods-form";
import { BillingDateForm } from "@/components/modules/settings/billing-date-form";
import { HostelInfoForm } from "@/components/modules/settings/hostel-info-form";
import { MealTimesFields } from "@/components/modules/settings/meal-times-fields";
import type { WifiNetwork, MealTimes, PaymentMethodAccount } from "@/types";

type StepKey = WelcomeStep["key"];
const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];

export function WelcomeClient({
  hostelId, branchName, country, status,
  initialWifi, initialMeals, welcomeTemplate,
  initialReferrerPct, initialReferredPct, initialCampaign,
  initialPaymentMethods, initialReminderTemplate, whatsappEnabled,
  initialBillingAnchorDay, initialBillLeftoverSeparately,
}: {
  hostelId: string;
  branchName: string;
  country: string;
  status: WelcomeStatus;
  initialWifi: WifiNetwork[];
  initialMeals: MealTimes;
  welcomeTemplate: string;
  initialReferrerPct: number;
  initialReferredPct: number;
  initialCampaign: string;
  initialPaymentMethods: PaymentMethodAccount[];
  initialReminderTemplate: string | null;
  whatsappEnabled: boolean;
  initialBillingAnchorDay: number | null;
  initialBillLeftoverSeparately: boolean;
}) {
  const router = useRouter();
  const cfg = getCountryConfig(country);
  const t = cfg.terms;
  const cur = cfg.currencySymbol;

  const [doneKeys, setDoneKeys] = useState<Set<StepKey>>(
    () => new Set(status.steps.filter((s) => s.done).map((s) => s.key))
  );
  const [open, setOpen] = useState<StepKey | null>(null);
  const [leaving, startLeaving] = useTransition();
  const [seeding, setSeeding] = useState(false);

  async function exploreDemo() {
    setSeeding(true);
    const res = await loadSampleData();
    if (res.success) {
      // Full navigation (not router.refresh) so the new active-branch cookie the
      // seeder set is committed before the dashboard renders — same reason branch
      // switching uses window.location.
      window.location.href = "/dashboard";
    } else {
      toast({ title: res.error ?? "Could not load sample data", variant: "destructive" });
      setSeeding(false);
    }
  }

  // Shared state — WiFi and meals persist through one action (saveWelcomeSettings
  // writes both together, so each save must resend the other untouched).
  const [wifi, setWifi] = useState<WifiNetwork[]>(initialWifi);
  const [meals, setMeals] = useState<MealTimes>(initialMeals ?? {});
  const [referrer, setReferrer] = useState(String(initialReferrerPct || ""));
  const [referred, setReferred] = useState(String(initialReferredPct || ""));

  const meta: Record<StepKey, { icon: typeof Wifi; title: string; desc: string; href?: string }> = {
    details:    { icon: Building2,       title: "Property details", desc: "Name, address, contact, capacity and who can live here." },
    charges:    { icon: Receipt,         title: "Package pricing & charges", desc: `Package rents, seater pricing, deposit, ${t.acBilling.toLowerCase()} & food rates (${cur}).` },
    paymethods: { icon: Banknote,        title: "Payment methods", desc: "Bank accounts / JazzCash / EasyPaisa shown in rent reminders." },
    billing:    { icon: CalendarClock,   title: "Billing date (optional)", desc: `Bill every ${t.tenant.toLowerCase()} on one fixed day of the month, with mid-month joiners prorated — or skip to bill each on their own join date.` },
    wifi:       { icon: Wifi,            title: "WiFi password", desc: `Shared in every ${t.tenant.toLowerCase()}'s welcome email.` },
    meals:      { icon: Clock,           title: "Meal timings", desc: `Breakfast, lunch and dinner hours. Shared in every ${t.tenant.toLowerCase()}'s welcome email.` },
    menu:       { icon: UtensilsCrossed, title: "Food menu (7-day plan)", desc: `Your weekly meal plan (repeats weekly). Shared in every ${t.tenant.toLowerCase()}'s welcome email.` },
    referral:   { icon: Gift,            title: "Referral rewards", desc: `Reward ${t.tenants.toLowerCase()} who bring a friend. Shared in every ${t.tenant.toLowerCase()}'s welcome email.` },
    website:    { icon: Globe,           title: "Your web address", desc: "Claim your own address (yourname.hostels.yourpulse.io) for your public page — free.", href: "/website" },
    rooms:      { icon: BedDouble,       title: "Add your first room", desc: "Create rooms on the Spaces page — ticks once you add one.", href: "/spaces" },
    tenant:     { icon: Users,           title: `Add your first ${t.tenant.toLowerCase()}`, desc: `Admit a ${t.tenant.toLowerCase()} on the ${t.tenants} page — this is how you fill a room.`, href: "/tenants" },
    payment:    { icon: CreditCard,      title: "Record a payment", desc: `Collect rent on the Payments page — completes the cycle.`, href: "/payments" },
  };

  const total = status.total;
  const done = doneKeys.size;
  const pct = Math.round((done / total) * 100);

  function markDone(key: StepKey) {
    setDoneKeys((prev) => new Set(prev).add(key));
    setOpen(null);
  }

  function finish() {
    startLeaving(async () => {
      const res = await dismissWelcome();
      if (!res.success) {
        toast({ title: res.error ?? "Couldn't save — please try again", variant: "destructive" });
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="quick-setup mx-auto max-w-2xl space-y-6 pb-10">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-primary">
          <Sparkles className="h-4 w-4" />
          <span>Quick Setup</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up {branchName}</h1>
        <p className="text-sm text-muted-foreground">
          Everything in one place — changes save as you go.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{done} of {total} done</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        {status.steps.map((s) => {
          const m = meta[s.key];
          const Icon = m.icon;
          const isDone = doneKeys.has(s.key);
          const isOpen = open === s.key;
          const header = (
            <>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isDone ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-tight">{m.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{m.desc}</p>
              </div>
              <div className="flex flex-col items-end justify-between self-stretch shrink-0 gap-2">
                <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform group-hover:text-foreground ${!m.href && isOpen ? "rotate-90" : ""}`} />
                <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap ${s.required ? "bg-amber-500/15 text-amber-500" : "bg-muted text-muted-foreground"}`}>
                  {s.required ? "Required" : "Optional"}
                </span>
              </div>
            </>
          );
          return (
            <Card key={s.key} className={isDone ? "border-primary/30" : ""}>
              <CardContent className="p-4">
                {m.href ? (
                  <Link href={m.href} className="flex w-full items-start gap-3 group">{header}</Link>
                ) : (
                  <button type="button" onClick={() => setOpen(isOpen ? null : s.key)} className="flex w-full items-start gap-3 text-left group">{header}</button>
                )}

                {isOpen && s.key === "details" && (
                  <div className="mt-4 border-t pt-4">
                    <HostelInfoForm bare hostelId={hostelId} country={country} onSaved={() => setDoneKeys((prev) => new Set(prev).add("details"))} />
                  </div>
                )}
                {isOpen && s.key === "charges" && (
                  <div className="mt-4 border-t pt-4">
                    <PackagePricingForm bare hostelId={hostelId} country={country} hideTiers={["space_meals_cooler"]} onSaved={() => setDoneKeys((prev) => new Set(prev).add("charges"))} />
                  </div>
                )}
                {isOpen && s.key === "paymethods" && (
                  <div className="mt-4 border-t pt-4">
                    <PaymentMethodsForm
                      bare
                      initialPaymentMethods={initialPaymentMethods}
                      initialReminderTemplate={initialReminderTemplate}
                      hostelName={branchName}
                      country={country}
                      whatsappEnabled={whatsappEnabled}
                      onSaved={() => setDoneKeys((prev) => new Set(prev).add("paymethods"))}
                    />
                  </div>
                )}
                {isOpen && s.key === "billing" && (
                  <div className="mt-4 border-t pt-4">
                    <BillingDateForm
                      simple
                      initialAnchorDay={initialBillingAnchorDay}
                      initialSeparate={initialBillLeftoverSeparately}
                      onSaved={() => setDoneKeys((prev) => new Set(prev).add("billing"))}
                    />
                  </div>
                )}
                {isOpen && s.key === "wifi" && (
                  <WifiForm hostelId={hostelId} wifi={wifi} setWifi={setWifi} meals={meals} welcomeTemplate={welcomeTemplate} onDone={() => markDone("wifi")} />
                )}
                {isOpen && s.key === "meals" && (
                  <MealsForm meals={meals} setMeals={setMeals} wifi={wifi} welcomeTemplate={welcomeTemplate} onDone={() => markDone("meals")} />
                )}
                {isOpen && s.key === "menu" && (
                  <WeeklyMenuForm hostelId={hostelId} onSaved={() => setDoneKeys((prev) => new Set(prev).add("menu"))} />
                )}
                {isOpen && s.key === "referral" && (
                  <ReferralForm
                    referrer={referrer} setReferrer={setReferrer}
                    referred={referred} setReferred={setReferred}
                    tenantsWord={t.tenants} campaign={initialCampaign} onDone={() => markDone("referral")}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-tight">Want to see Pulse in action first?</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Load a fully-populated sample branch — rooms, {t.tenants.toLowerCase()}, payments, expenses and more. Remove it anytime in one click.
          </p>
        </div>
        <Button variant="outline" onClick={exploreDemo} disabled={seeding} className="shrink-0">
          {seeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {seeding ? "Loading…" : "Explore with sample data"}
        </Button>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button onClick={finish} disabled={leaving} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          Skip for now
        </button>
        <Button onClick={finish} disabled={leaving}>
          {leaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Go to dashboard <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function WifiForm({
  hostelId, wifi, setWifi, meals, welcomeTemplate, onDone,
}: {
  hostelId: string;
  wifi: WifiNetwork[]; setWifi: (w: WifiNetwork[]) => void;
  meals: MealTimes; welcomeTemplate: string; onDone: () => void;
}) {
  const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [nets, setNets] = useState<WifiNetwork[]>(() =>
    (wifi.length ? wifi : [{ id: uid(), name: "", password: "", coverage: [] }]).map((w) => ({
      ...w, id: w.id || uid(), coverage: w.coverage ?? [],
    })),
  );
  const [rooms, setRooms] = useState<{ room_number: string; floor: number | null }[]>([]);
  const [saving, start] = useTransition();

  // The branch's rooms, so a network can be scoped to specific floors/rooms —
  // only possible once rooms exist, hence the disclaimer when there are none.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("hms_rooms")
        .select("room_number, floor")
        .eq("hostel_id", hostelId)
        .order("floor", { ascending: true })
        .order("room_number", { ascending: true });
      if (!cancelled) setRooms((data as { room_number: string; floor: number | null }[] | null) ?? []);
    })();
    return () => { cancelled = true; };
  }, [hostelId]);

  const floors = Array.from(new Set(rooms.map((r) => r.floor).filter((f): f is number => f != null))).sort((a, b) => a - b);
  const roomNumbers = Array.from(new Set(rooms.map((r) => (r.room_number ?? "").trim()).filter(Boolean)));
  const hasRooms = rooms.length > 0;

  function update(id: string, patch: Partial<WifiNetwork>) {
    setNets((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }
  function toggle(id: string, token: string) {
    setNets((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const cur = n.coverage ?? [];
        return { ...n, coverage: cur.includes(token) ? cur.filter((t) => t !== token) : [...cur, token] };
      }),
    );
  }
  function addNet() {
    setNets((prev) => [...prev, { id: uid(), name: "", password: "", coverage: [] }]);
  }
  function removeNet(id: string) {
    setNets((prev) => prev.filter((n) => n.id !== id));
  }
  const chipCls = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs transition-colors ${active ? "bg-primary/15 text-primary border-primary/30" : "bg-white/5 text-muted-foreground border-white/10 hover:text-foreground"}`;

  function save() {
    const valid = nets.filter((n) => n.name.trim() && (n.password ?? "").trim());
    if (valid.length === 0) {
      toast({ title: "Add at least one network with a name and password", variant: "destructive" });
      return;
    }
    // saveWelcomeSettings sanitises coverage (keeps only floor:/room: tokens).
    const next: WifiNetwork[] = valid.map((n) => ({ ...n, name: n.name.trim(), password: (n.password ?? "").trim() }));
    start(async () => {
      const res = await saveWelcomeSettings({ wifi_networks: next, welcome_message_template: welcomeTemplate, meal_times: meals });
      if (res.success) { setNets(next); setWifi(next); toast({ title: "WiFi saved" }); onDone(); }
      else toast({ title: res.error ?? "Could not save", variant: "destructive" });
    });
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        Add every WiFi device in this branch — each with its own name and password. New joiners get all of them (or only the ones bound to their floor/room).
      </p>

      {nets.map((n, idx) => (
        <div key={n.id} className="space-y-2.5 rounded-lg border border-sidebar-border bg-white/[0.02] p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">WiFi device {idx + 1}</span>
            {nets.length > 1 && (
              <button
                type="button"
                onClick={() => removeNet(n.id)}
                className="text-muted-foreground transition-colors hover:text-rose-400"
                aria-label="Remove this WiFi device"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`wifi-name-${n.id}`}>Network name</Label>
              <Input id={`wifi-name-${n.id}`} value={n.name} onChange={(e) => update(n.id, { name: e.target.value })} placeholder="e.g. Pulse-Guest" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`wifi-pass-${n.id}`}>Password</Label>
              <Input id={`wifi-pass-${n.id}`} value={n.password ?? ""} onChange={(e) => update(n.id, { password: e.target.value })} placeholder="WiFi password" />
            </div>
          </div>

          {hasRooms && (
            <div className="space-y-2 rounded-lg border border-sidebar-border bg-white/[0.02] p-2.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Bind to floors or rooms</span> (optional) — a network bound to specific floors/rooms is shared automatically only with new joiners there. Leave everything off and it&apos;s sent to everyone.
              </p>
              {floors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {floors.map((f) => (
                    <button key={`f-${f}`} type="button" onClick={() => toggle(n.id, floorToken(f))} className={chipCls((n.coverage ?? []).includes(floorToken(f)))}>
                      Floor {f}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {roomNumbers.map((rn) => (
                  <button key={`r-${rn}`} type="button" onClick={() => toggle(n.id, roomToken(rn))} className={chipCls((n.coverage ?? []).includes(roomToken(rn)))}>
                    Room {rn}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {!hasRooms && (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-sidebar-border p-2.5">
          Every WiFi here is shared automatically with all new joiners. Want to bind a network to specific floors or rooms instead? <span className="text-foreground">Add your rooms first</span> — you&apos;ll then be able to bind each one here.
        </p>
      )}

      <button
        type="button"
        onClick={addNet}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-sidebar-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Add another WiFi device
      </button>

      <div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save WiFi
        </Button>
      </div>
    </div>
  );
}

function MealsForm({
  meals, setMeals, wifi, welcomeTemplate, onDone,
}: {
  meals: MealTimes; setMeals: (m: MealTimes) => void;
  wifi: WifiNetwork[]; welcomeTemplate: string; onDone: () => void;
}) {
  const [local, setLocal] = useState<MealTimes>(meals ?? {});
  const [saving, start] = useTransition();

  function setRange(meal: Meal, side: "from" | "to", value: string) {
    setLocal((prev) => ({ ...prev, [meal]: { from: prev[meal]?.from ?? "", to: prev[meal]?.to ?? "", [side]: value } }));
  }

  function save() {
    start(async () => {
      const res = await saveWelcomeSettings({ wifi_networks: wifi, welcome_message_template: welcomeTemplate, meal_times: local });
      if (res.success) { setMeals(local); toast({ title: "Meal timings saved" }); onDone(); }
      else toast({ title: res.error ?? "Could not save", variant: "destructive" });
    });
  }

  const anySet = MEALS.some((m) => local[m]?.from?.trim() && local[m]?.to?.trim());

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <MealTimesFields value={local} onChange={setRange} />
      <Button size="sm" onClick={save} disabled={saving || !anySet}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save timings
      </Button>
    </div>
  );
}

const WEEKDAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "Mon" }, { dow: 2, label: "Tue" }, { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" }, { dow: 5, label: "Fri" }, { dow: 6, label: "Sat" }, { dow: 7, label: "Sun" },
];
const MENU_MEALS: { key: Meal; label: string }[] = [
  { key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" }, { key: "dinner", label: "Dinner" },
];

// Inline weekly meal planner — same model as the Food page: one hms_food_items
// row per item, day_of_week 1–7 (ISO, Mon–Sun), date null, sort_order. Cells
// are comma-separated. Save REPLACES this hostel's weekly rows (a clean "set
// your weekly plan"), and prefills from existing rows so a re-save preserves them.
function WeeklyMenuForm({ hostelId, onSaved }: { hostelId: string; onSaved: () => void }) {
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("hms_food_items")
        .select("day_of_week, meal_type, item_name, sort_order")
        .eq("hostel_id", hostelId)
        .not("day_of_week", "is", null)
        .order("day_of_week").order("meal_type").order("sort_order");
      if (cancelled) return;
      const g: Record<string, Record<string, string>> = {};
      for (const it of (data ?? []) as { day_of_week: number; meal_type: string; item_name: string }[]) {
        const d = String(it.day_of_week);
        g[d] = g[d] ?? {};
        g[d][it.meal_type] = g[d][it.meal_type] ? `${g[d][it.meal_type]}, ${it.item_name}` : it.item_name;
      }
      setGrid(g);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [hostelId]);

  function setCell(dow: number, meal: Meal, val: string) {
    setGrid((prev) => ({ ...prev, [dow]: { ...prev[dow], [meal]: val } }));
  }

  function save() {
    start(async () => {
      const supabase = createClient();
      const { error: delErr } = await supabase
        .from("hms_food_items").delete().eq("hostel_id", hostelId).not("day_of_week", "is", null);
      if (delErr) { toast({ title: delErr.message, variant: "destructive" }); return; }
      const rows: { hostel_id: string; date: null; day_of_week: number; meal_type: Meal; item_name: string; sort_order: number }[] = [];
      for (const { dow } of WEEKDAYS) {
        for (const { key: meal } of MENU_MEALS) {
          const csv = (grid[dow]?.[meal] ?? "").trim();
          if (!csv) continue;
          csv.split(",").map((s) => s.trim()).filter(Boolean).forEach((name, idx) => {
            rows.push({ hostel_id: hostelId, date: null, day_of_week: dow, meal_type: meal, item_name: name, sort_order: idx });
          });
        }
      }
      if (rows.length > 0) {
        const { error } = await supabase.from("hms_food_items").insert(rows);
        if (error) { toast({ title: error.message, variant: "destructive" }); return; }
      }
      toast({ title: "Weekly menu saved" });
      if (rows.length > 0) onSaved();
    });
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="overflow-x-auto">
        <div className="min-w-[520px] space-y-1.5">
          <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-2 px-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Day</span>
            {MENU_MEALS.map((m) => (
              <span key={m.key} className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</span>
            ))}
          </div>
          {WEEKDAYS.map((w) => (
            <div key={w.dow} className="grid grid-cols-[48px_1fr_1fr_1fr] items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">{w.label}</span>
              {MENU_MEALS.map((m) => (
                <Input
                  key={m.key}
                  value={grid[w.dow]?.[m.key] ?? ""}
                  onChange={(e) => setCell(w.dow, m.key, e.target.value)}
                  placeholder="e.g. Paratha, Chai"
                  disabled={!loaded}
                  className="h-8 text-xs"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Comma-separate items. Leave a cell blank if there&apos;s nothing that meal.</p>
      <Button size="sm" onClick={save} disabled={saving || !loaded}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save weekly menu
      </Button>
    </div>
  );
}

function ReferralForm({
  referrer, setReferrer, referred, setReferred, tenantsWord, campaign, onDone,
}: {
  referrer: string; setReferrer: (v: string) => void;
  referred: string; setReferred: (v: string) => void;
  tenantsWord: string; campaign: string; onDone: () => void;
}) {
  const [saving, start] = useTransition();
  const [startNow, setStartNow] = useState(false);
  const [running, setRunning] = useState(campaign === "active");
  const residents = tenantsWord.toLowerCase();
  const resident = residents.replace(/s$/, "");

  function save() {
    const r = Math.trunc(Number(referrer) || 0);
    const rr = Math.trunc(Number(referred) || 0);
    if (r < 1 || rr < 1) {
      toast({ title: "Enter a percentage of at least 1 for both", variant: "destructive" });
      return;
    }
    start(async () => {
      const res = await updateReferralPercentages(r, rr);
      if (res.error) { toast({ title: res.error, variant: "destructive" }); return; }
      if (startNow && !running) {
        const c = await startReferralCampaign();
        if (c.error) {
          toast({ title: "Rewards saved — but the campaign didn't start", description: c.error, variant: "destructive" });
          onDone();
          return;
        }
        setRunning(true);
        toast({
          title: "Referral campaign started",
          description: (c.queued ?? 0) > 0
            ? `Invited ${c.sent ?? 0} of ${c.queued} ${residents}. New ${residents} are invited automatically as they join.`
            : `New ${residents} will be invited automatically as they join.`,
        });
      } else {
        toast({ title: "Referral rewards saved" });
      }
      onDone();
    });
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        When a {resident} refers a friend who joins, both get this % off.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ref-referrer">Referrer discount %</Label>
          <Input id="ref-referrer" type="number" min={1} max={100} value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder="e.g. 10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref-referred">Friend discount %</Label>
          <Input id="ref-referred" type="number" min={1} max={100} value={referred} onChange={(e) => setReferred(e.target.value)} placeholder="e.g. 10" />
        </div>
      </div>

      {running ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-2.5 text-xs text-emerald-500">
          ✓ Your referral campaign is running — new {residents} are invited automatically. Pause or manage it anytime from Marketing.
        </div>
      ) : (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-sidebar-border bg-white/[0.02] p-2.5">
          <input
            type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-amber cursor-pointer"
          />
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Start the campaign now</span> <span className="text-muted-foreground/70">(optional)</span> — begin inviting your {residents} to refer friends. Each current {resident} gets an email invite, and anyone who joins later is invited automatically on admission. Leave this unchecked to just set the reward and start later from Marketing.
          </span>
        </label>
      )}

      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {startNow && !running ? "Save & start campaign" : "Save rewards"}
      </Button>
    </div>
  );
}
