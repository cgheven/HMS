"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Utensils, Plus, X, Save, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCountryConfig } from "@/lib/country-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { SEATER_CAPACITIES, SEATER_LABELS } from "@/lib/seater-pricing";
import { PACKAGE_TIER_CONFIGS, emptyPriceForm, type PkgPriceForm } from "@/lib/package-pricing";

export function PackagePricingForm({
  hostelId, country, readOnly = false, readOnlyNote, onSaved, bare = false, hideTiers = [],
}: {
  hostelId: string;
  country?: string | null;
  readOnly?: boolean;
  readOnlyNote?: ReactNode;
  onSaved?: () => void;
  /** Render just the form, without the outer Card/header (for embedding, e.g. the welcome wizard). */
  bare?: boolean;
  /** Predefined package tiers to hide from the UI (e.g. in onboarding). Their
   *  existing saved values are still preserved on save — only the row is hidden. */
  hideTiers?: string[];
}) {
  const curCfg = getCountryConfig(country);
  const t = curCfg.terms;
  const curSym = curCfg.currency === "PKR" ? "Rs." : curCfg.currencySymbol;
  const isPk = (country ?? "PK").toUpperCase() === "PK";

  const [meterAllRooms, setMeterAllRooms] = useState(false);
  const [packageForm, setPackageForm] = useState<{ ac_charge_label: string; ac_per_unit_rate: string; security_deposit: string; registration_fee: string; ac_maintenance_rate: string; notice_period_days: string; washroom_premium: string; prices: PkgPriceForm }>({
    ac_charge_label: "", ac_per_unit_rate: "", security_deposit: "", registration_fee: "", ac_maintenance_rate: "", notice_period_days: "30", washroom_premium: "", prices: emptyPriceForm(),
  });
  const [foodAddonForm, setFoodAddonForm] = useState<{ breakfast: string; lunch: string; dinner: string; allMeals: string }>({
    breakfast: "", lunch: "", dinner: "", allMeals: "",
  });
  const [seaterForm, setSeaterForm] = useState<Record<string, { no_ac: string; ac: string; deposit_no_ac: string; deposit_ac: string }>>(
    Object.fromEntries(SEATER_CAPACITIES.map((c) => [c, { no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "" }]))
  );
  const [customRows, setCustomRows] = useState<Array<{ id: string; name: string; no_ac: string; ac: string; deposit_no_ac: string; deposit_ac: string; includes_food: boolean }>>([]);
  const [savingPackage, setSavingPackage] = useState(false);
  const [packageLoaded, setPackageLoaded] = useState(false);

  useEffect(() => {
    if (!hostelId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [cfgRes, hostelRes] = await Promise.all([
        supabase
          .from("hms_package_configs")
          .select("ac_charge_label, ac_per_unit_rate, security_deposit, registration_fee, ac_maintenance_rate, notice_period_days, package_prices, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, seater_prices, washroom_premium")
          .eq("hostel_id", hostelId)
          .maybeSingle(),
        supabase.from("hms_hostels").select("meter_all_rooms").eq("id", hostelId).maybeSingle(),
      ]);
      if (cancelled) return;
      setMeterAllRooms(!!(hostelRes.data as { meter_all_rooms?: boolean } | null)?.meter_all_rooms);
      const data = cfgRes.data;
      if (data) {
        const raw = (data.package_prices ?? {}) as Record<string, unknown>;
        const prices = emptyPriceForm();
        for (const cfg of PACKAGE_TIER_CONFIGS) {
          const s = raw[cfg.tier] as { no_ac: number; ac: number; deposit_no_ac?: number; deposit_ac?: number } | undefined;
          if (s) {
            prices[cfg.tier] = {
              no_ac:         s.no_ac > 0               ? String(s.no_ac)         : "",
              ac:            s.ac    > 0               ? String(s.ac)            : "",
              deposit_no_ac: (s.deposit_no_ac ?? 0) > 0 ? String(s.deposit_no_ac) : "",
              deposit_ac:    (s.deposit_ac    ?? 0) > 0 ? String(s.deposit_ac)    : "",
            };
          }
        }
        setPackageForm({
          ac_charge_label: data.ac_charge_label ?? "",
          ac_per_unit_rate: data.ac_per_unit_rate?.toString() ?? "0",
          security_deposit: data.security_deposit > 0 ? String(data.security_deposit) : "",
          registration_fee: (data.registration_fee ?? 0) > 0 ? String(data.registration_fee) : "",
          ac_maintenance_rate: (data.ac_maintenance_rate ?? 0) > 0 ? String(data.ac_maintenance_rate) : "",
          notice_period_days: data.notice_period_days != null ? String(data.notice_period_days) : "30",
          washroom_premium: (data.washroom_premium ?? 0) > 0 ? String(data.washroom_premium) : "",
          prices,
        });
        const customData = (raw._custom ?? []) as Array<{
          id: string; name: string; no_ac: number; ac: number;
          deposit_no_ac?: number; deposit_ac?: number; includes_food?: boolean;
        }>;
        setCustomRows(customData.map((c) => ({
          id: c.id || crypto.randomUUID(),
          name: c.name ?? "",
          no_ac: c.no_ac > 0 ? String(c.no_ac) : "",
          ac: c.ac > 0 ? String(c.ac) : "",
          deposit_no_ac: (c.deposit_no_ac ?? 0) > 0 ? String(c.deposit_no_ac) : "",
          deposit_ac: (c.deposit_ac ?? 0) > 0 ? String(c.deposit_ac) : "",
          includes_food: c.includes_food === true,
        })));
        setFoodAddonForm({
          breakfast: data.food_breakfast_rate > 0 ? String(data.food_breakfast_rate) : "",
          lunch: data.food_lunch_rate > 0 ? String(data.food_lunch_rate) : "",
          dinner: data.food_dinner_rate > 0 ? String(data.food_dinner_rate) : "",
          allMeals: data.food_all_meals_rate > 0 ? String(data.food_all_meals_rate) : "",
        });
        const rawSeater = (data.seater_prices ?? {}) as Record<string, { no_ac?: number; ac?: number; deposit_no_ac?: number; deposit_ac?: number }>;
        setSeaterForm(Object.fromEntries(SEATER_CAPACITIES.map((c) => [
          c,
          {
            no_ac: (rawSeater[c]?.no_ac ?? 0) > 0 ? String(rawSeater[c]!.no_ac) : "",
            ac: (rawSeater[c]?.ac ?? 0) > 0 ? String(rawSeater[c]!.ac) : "",
            deposit_no_ac: (rawSeater[c]?.deposit_no_ac ?? 0) > 0 ? String(rawSeater[c]!.deposit_no_ac) : "",
            deposit_ac: (rawSeater[c]?.deposit_ac ?? 0) > 0 ? String(rawSeater[c]!.deposit_ac) : "",
          },
        ])));
      }
      setPackageLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [hostelId]);

  async function savePackageConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!hostelId) return;
    setSavingPackage(true);
    const supabase = createClient();
    const dbPayload: Record<string, unknown> = {};
    for (const cfg of PACKAGE_TIER_CONFIGS) {
      const p = packageForm.prices[cfg.tier];
      dbPayload[cfg.tier] = {
        no_ac:         parseFloat(p.no_ac)         || 0,
        ac:            parseFloat(p.ac)            || 0,
        deposit_no_ac: parseFloat(p.deposit_no_ac) || 0,
        deposit_ac:    parseFloat(p.deposit_ac)    || 0,
      };
    }
    const validCustom = customRows.filter((c) => c.name.trim());
    if (validCustom.length > 0) {
      dbPayload._custom = validCustom.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        no_ac: parseFloat(c.no_ac) || 0,
        ac: parseFloat(c.ac) || 0,
        deposit_no_ac: parseFloat(c.deposit_no_ac) || 0,
        deposit_ac: parseFloat(c.deposit_ac) || 0,
        includes_food: c.includes_food,
      }));
    }
    const seaterPayload: Record<string, { no_ac: number; ac: number; deposit_no_ac: number; deposit_ac: number }> = {};
    for (const c of SEATER_CAPACITIES) {
      const no_ac = parseFloat(seaterForm[c]?.no_ac) || 0;
      const ac = parseFloat(seaterForm[c]?.ac) || 0;
      const deposit_no_ac = parseFloat(seaterForm[c]?.deposit_no_ac) || 0;
      const deposit_ac = parseFloat(seaterForm[c]?.deposit_ac) || 0;
      if (no_ac > 0 || ac > 0 || deposit_no_ac > 0 || deposit_ac > 0) {
        seaterPayload[c] = { no_ac, ac, deposit_no_ac, deposit_ac };
      }
    }

    // Written first and separately: it is a hms_hostels column, not part of the
    // package config. Failing here must not silently save the rest, so its error
    // aborts before the upsert rather than after.
    const { error: meterErr } = await supabase
      .from("hms_hostels")
      .update({ meter_all_rooms: meterAllRooms })
      .eq("id", hostelId);
    if (meterErr) {
      setSavingPackage(false);
      toast({ title: "Error", description: meterErr.message, variant: "destructive" });
      return;
    }

    const { data, error } = await supabase
      .from("hms_package_configs")
      .upsert(
        {
          hostel_id:            hostelId,
          ac_charge_label:      packageForm.ac_charge_label.trim() || null,
          ac_per_unit_rate:     parseFloat(packageForm.ac_per_unit_rate) || 0,
          security_deposit:     parseFloat(packageForm.security_deposit) || 0,
          registration_fee:     parseFloat(packageForm.registration_fee) || 0,
          ac_maintenance_rate:  parseFloat(packageForm.ac_maintenance_rate) || 0,
          notice_period_days:   parseInt(packageForm.notice_period_days, 10) || 30,
          washroom_premium:     parseFloat(packageForm.washroom_premium) || 0,
          package_prices:       dbPayload,
          food_breakfast_rate:  parseFloat(foodAddonForm.breakfast) || 0,
          food_lunch_rate:      parseFloat(foodAddonForm.lunch) || 0,
          food_dinner_rate:     parseFloat(foodAddonForm.dinner) || 0,
          food_all_meals_rate:  parseFloat(foodAddonForm.allMeals) || 0,
          seater_prices:        seaterPayload,
          updated_at:           new Date().toISOString(),
        },
        { onConflict: "hostel_id" }
      )
      .select("hostel_id");
    setSavingPackage(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Package pricing saved" });
    onSaved?.();
  }

  const formEl = (
          <form onSubmit={savePackageConfig} className="space-y-6">
            <fieldset disabled={readOnly} className="space-y-6 min-w-0">

            <p className="text-xs text-muted-foreground -mb-2">
              STD = standard (non-AC) room · AC = air-conditioned room · DEP = security deposit · Meals = included in the package.
            </p>
            {/* Per-package price table — horizontally scrollable on small screens */}
            <div className="rounded-lg border border-border overflow-x-auto">
              <div className="grid grid-cols-[1fr_90px_90px_90px_90px_64px_32px] gap-px bg-border min-w-[640px]">
                <div className="bg-card px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Package</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (Std)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (AC)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (Std)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (AC)</span>
                </div>
                <div className="bg-card px-2 py-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Meals</span>
                </div>
                <div className="bg-card" />
              </div>
              {PACKAGE_TIER_CONFIGS.filter((cfg) => !hideTiers.includes(cfg.tier)).map((cfg) => (
                <div key={cfg.tier} className="grid grid-cols-[1fr_90px_90px_90px_90px_64px_32px] gap-px bg-border min-w-[640px]">
                  <div className="bg-card px-3 py-2.5">
                    <p className="text-sm font-medium leading-tight">{cfg.label}</p>
                    <p className="text-xs text-muted-foreground">{cfg.desc}</p>
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="0"
                      value={packageForm.prices[cfg.tier].no_ac}
                      onChange={(e) => setPackageForm({
                        ...packageForm,
                        prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], no_ac: e.target.value } },
                      })}
                      disabled={!packageLoaded}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    {cfg.hasAcVariant ? (
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={packageForm.prices[cfg.tier].ac}
                        onChange={(e) => setPackageForm({
                          ...packageForm,
                          prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], ac: e.target.value } },
                        })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground w-full text-center">metered</span>
                    )}
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="—"
                      value={packageForm.prices[cfg.tier].deposit_no_ac}
                      onChange={(e) => setPackageForm({
                        ...packageForm,
                        prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], deposit_no_ac: e.target.value } },
                      })}
                      disabled={!packageLoaded}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    {cfg.hasAcVariant ? (
                      <Input
                        type="number" min="0" step="1" placeholder="—"
                        value={packageForm.prices[cfg.tier].deposit_ac}
                        onChange={(e) => setPackageForm({
                          ...packageForm,
                          prices: { ...packageForm.prices, [cfg.tier]: { ...packageForm.prices[cfg.tier], deposit_ac: e.target.value } },
                        })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground w-full text-center">—</span>
                    )}
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center justify-center">
                    <span className={`text-xs ${cfg.tier === "space_only" ? "text-muted-foreground" : "text-emerald-400"}`}>
                      {cfg.tier === "space_only" ? "—" : "✓"}
                    </span>
                  </div>
                  <div className="bg-card" />
                </div>
              ))}
              {customRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_90px_90px_90px_90px_64px_32px] gap-px bg-border min-w-[640px]">
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      placeholder="Package name"
                      value={row.name}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, name: e.target.value } : r))}
                      className="h-7 text-xs px-2"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="0"
                      value={row.no_ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, no_ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="0"
                      value={row.ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="—"
                      value={row.deposit_no_ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, deposit_no_ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center">
                    <Input
                      type="number" min="0" step="1" placeholder="—"
                      value={row.deposit_ac}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, deposit_ac: e.target.value } : r))}
                      className="h-7 text-xs text-center px-1"
                    />
                  </div>
                  <div className="bg-card px-2 py-2 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={row.includes_food}
                      onChange={(e) => setCustomRows((prev) => prev.map((r) => r.id === row.id ? { ...r, includes_food: e.target.checked } : r))}
                      className="w-4 h-4 accent-emerald-500 cursor-pointer"
                      title="This package includes meals"
                    />
                  </div>
                  <div className="bg-card flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => setCustomRows((prev) => prev.filter((r) => r.id !== row.id))}
                      className="text-muted-foreground hover:text-rose-400 transition-colors p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="bg-card border-t border-border min-w-[640px]">
                <button
                  type="button"
                  onClick={() => setCustomRows((prev) => [...prev, { id: crypto.randomUUID(), name: "", no_ac: "", ac: "", deposit_no_ac: "", deposit_ac: "", includes_food: false }])}
                  disabled={!packageLoaded}
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.02] transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Package
                </button>
              </div>
            </div>

            {/* AC rate + Security Deposit */}
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1.5">
                {isPk ? <>
                <Label className="text-xs">AC Per Unit Rate (Rs. / unit consumed)</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="e.g. 80"
                  value={packageForm.ac_per_unit_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_per_unit_rate: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></> : <>
                <Label className="text-xs">{t.acShort} Per Unit Rate (per unit consumed)</Label>
                <MoneyInput symbol={curSym}
                  type="number" min="0" step="0.01" placeholder="e.g. 80"
                  value={packageForm.ac_per_unit_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_per_unit_rate: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></>}
                <p className="text-xs text-muted-foreground">Billed on top of the monthly rate for {isPk ? "AC rooms" : "metered rooms"}.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Receipt Label for {t.acCharges}</Label>
                <Input
                  type="text" maxLength={24} placeholder={t.acCharges}
                  value={packageForm.ac_charge_label}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_charge_label: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[220px]"
                />
                <p className="text-xs text-muted-foreground">
                  Receipt label only — billing is unchanged. Blank prints &quot;{t.acCharges}&quot;{isPk ? <>; set &quot;Electricity Charges&quot; if that fits.</> : "."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bill electricity to every room</Label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={meterAllRooms}
                    onChange={(e) => setMeterAllRooms(e.target.checked)}
                    disabled={!packageLoaded}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-amber cursor-pointer"
                  />
                  <span className="text-xs text-muted-foreground">
                    Record meter readings for <strong className="text-foreground">every</strong> room, not just AC ones — turn on if the whole building is metered. Doesn&apos;t affect which rooms show &quot;AC&quot; publicly.
                  </span>
                </label>
              </div>
              <div className="space-y-1.5">
                {isPk ? <>
                <Label className="text-xs">Attached Washroom Premium (Rs. / month)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 3000"
                  value={packageForm.washroom_premium}
                  onChange={(e) => setPackageForm({ ...packageForm, washroom_premium: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></> : <>
                <Label className="text-xs">Attached Washroom Premium (per month)</Label>
                <MoneyInput symbol={curSym}
                  type="number" min="0" step="1" placeholder="e.g. 3000"
                  value={packageForm.washroom_premium}
                  onChange={(e) => setPackageForm({ ...packageForm, washroom_premium: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></>}
                <p className="text-xs text-muted-foreground">Added on top of the seater rate for rooms with an attached washroom.</p>
              </div>
              <div className="space-y-1.5">
                {isPk ? <>
                <Label className="text-xs">Default Security Deposit (Rs.)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 10000"
                  value={packageForm.security_deposit}
                  onChange={(e) => setPackageForm({ ...packageForm, security_deposit: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></> : <>
                <Label className="text-xs">Default Security Deposit</Label>
                <MoneyInput symbol={curSym}
                  type="number" min="0" step="1" placeholder="e.g. 10000"
                  value={packageForm.security_deposit}
                  onChange={(e) => setPackageForm({ ...packageForm, security_deposit: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></>}
                <p className="text-xs text-muted-foreground">Fallback when no per-package deposit is set above. Shown on the public hostel page.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Required Notice Period (days)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 30"
                  value={packageForm.notice_period_days}
                  onChange={(e) => setPackageForm({ ...packageForm, notice_period_days: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                />
                <p className="text-xs text-muted-foreground">Minimum notice a tenant should give before checking out.</p>
              </div>
              <div className="space-y-1.5">
                {isPk ? <>
                <Label className="text-xs">Default Registration Fee (Rs.)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 2000"
                  value={packageForm.registration_fee}
                  onChange={(e) => setPackageForm({ ...packageForm, registration_fee: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></> : <>
                <Label className="text-xs">Default Registration Fee</Label>
                <MoneyInput symbol={curSym}
                  type="number" min="0" step="1" placeholder="e.g. 2000"
                  value={packageForm.registration_fee}
                  onChange={(e) => setPackageForm({ ...packageForm, registration_fee: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></>}
                <p className="text-xs text-muted-foreground">One-time, non-refundable, billed only in the tenant&apos;s first month. Hidden on the Tenants page unless set here.</p>
              </div>
              <div className="space-y-1.5">
                {isPk ? <>
                <Label className="text-xs">{t.acMaintenance} Rate (Rs. / month)</Label>
                <Input
                  type="number" min="0" step="1" placeholder="e.g. 500"
                  value={packageForm.ac_maintenance_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_maintenance_rate: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></> : <>
                <Label className="text-xs">{t.acMaintenance} Rate (per month)</Label>
                <MoneyInput symbol={curSym}
                  type="number" min="0" step="1" placeholder="e.g. 500"
                  value={packageForm.ac_maintenance_rate}
                  onChange={(e) => setPackageForm({ ...packageForm, ac_maintenance_rate: e.target.value })}
                  disabled={!packageLoaded}
                  className="max-w-[180px]"
                /></>}
                <p className="text-xs text-muted-foreground">Flat monthly charge automatically applied to every tenant in {isPk ? "an AC room" : "a metered room"}, regardless of package.</p>
              </div>
            </div>

            {/* Food Add-on Pricing — independent of package tiers */}
            <div className="space-y-3 pt-2 border-t border-sidebar-border">
              <div>
                <Label className="text-xs font-semibold">Food Add-on Pricing <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Let tenants add specific meals on top of any room package, priced independently — separate from the bundled packages above. Leave blank if you don&apos;t offer this.
                </p>
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="space-y-1.5">
                  {isPk ? <>
                  <Label className="text-xs">Breakfast (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.breakfast}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, breakfast: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></> : <>
                  <Label className="text-xs">Breakfast (per month)</Label>
                  <MoneyInput symbol={curSym}
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.breakfast}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, breakfast: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></>}
                </div>
                <div className="space-y-1.5">
                  {isPk ? <>
                  <Label className="text-xs">Lunch (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.lunch}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, lunch: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></> : <>
                  <Label className="text-xs">Lunch (per month)</Label>
                  <MoneyInput symbol={curSym}
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.lunch}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, lunch: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></>}
                </div>
                <div className="space-y-1.5">
                  {isPk ? <>
                  <Label className="text-xs">Dinner (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.dinner}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, dinner: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></> : <>
                  <Label className="text-xs">Dinner (per month)</Label>
                  <MoneyInput symbol={curSym}
                    type="number" min="0" step="1" placeholder="e.g. 5000"
                    value={foodAddonForm.dinner}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, dinner: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></>}
                </div>
                <div className="space-y-1.5">
                  {isPk ? <>
                  <Label className="text-xs">All 3 Meals Bundle (Rs. / month)</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="e.g. 15000"
                    value={foodAddonForm.allMeals}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, allMeals: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></> : <>
                  <Label className="text-xs">All 3 Meals Bundle (per month)</Label>
                  <MoneyInput symbol={curSym}
                    type="number" min="0" step="1" placeholder="e.g. 15000"
                    value={foodAddonForm.allMeals}
                    onChange={(e) => setFoodAddonForm({ ...foodAddonForm, allMeals: e.target.value })}
                    disabled={!packageLoaded}
                    className="max-w-[160px]"
                  /></>}
                  <p className="text-xs text-muted-foreground">Used automatically when cheaper than the sum of all 3.</p>
                </div>
              </div>
            </div>

            {/* Seater Pricing — automatic per-room pricing by capacity */}
            <div className="space-y-3 pt-2 border-t border-sidebar-border">
              <div>
                <Label className="text-xs font-semibold">Seater Pricing <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Set a rent and deposit by seat count and every room on your public page prices itself automatically, based on its own capacity — no need to price each room by hand. Leave blank to keep using the pricing above.
                </p>
              </div>
              <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-[92px_1fr_1fr_1fr_1fr] gap-px bg-border min-w-[380px]">
                  <div className="bg-card px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Seater</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (Non-AC)</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent (AC)</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (Non-AC)</span>
                  </div>
                  <div className="bg-card px-2 py-2 text-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dep (AC)</span>
                  </div>
                </div>
                {SEATER_CAPACITIES.map((c) => (
                  <div key={c} className="grid grid-cols-[92px_1fr_1fr_1fr_1fr] gap-px bg-border min-w-[380px]">
                    <div className="bg-card px-3 py-2.5 flex items-center">
                      <p className="text-sm font-medium">{SEATER_LABELS[c]}</p>
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={seaterForm[c]?.no_ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], no_ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={seaterForm[c]?.ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="—"
                        value={seaterForm[c]?.deposit_no_ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], deposit_no_ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                    <div className="bg-card px-2 py-2 flex items-center">
                      <Input
                        type="number" min="0" step="1" placeholder="—"
                        value={seaterForm[c]?.deposit_ac ?? ""}
                        onChange={(e) => setSeaterForm({ ...seaterForm, [c]: { ...seaterForm[c], deposit_ac: e.target.value } })}
                        disabled={!packageLoaded}
                        className="h-7 text-xs text-center px-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Leave a deposit blank to fall back to the Default Security Deposit set in the charges above.</p>
            </div>

            </fieldset>
            {!readOnly ? (
              <Button type="submit" disabled={savingPackage || !packageLoaded} className="gap-2">
                {savingPackage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Package Pricing
              </Button>
            ) : readOnlyNote}
          </form>
  );
  if (bare) return <div className="min-w-0">{formEl}</div>;
  return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Utensils className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Package Pricing</CardTitle>
          </div>
          <CardDescription>
            Set the monthly rent for each package. Selecting a package when adding a tenant will auto-fill the rent. Food charges are added on top automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>{formEl}</CardContent>
      </Card>
  );
}
