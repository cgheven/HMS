"use client";
import { useState, useMemo, useRef } from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDateInput } from "@/lib/utils";
import { useHostelContext } from "@/contexts/hostel-context";
import { getCountryConfig } from "@/lib/country-config";
import type { FoodItem, MealType, PartnerTier, FoodMenuType } from "@/types";

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner"];
const mealLabel: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const mealIcons: Record<MealType, string> = { breakfast: "☀️", lunch: "🌤️", dinner: "🌙" };
const mealHeaderColor: Record<MealType, string> = {
  breakfast: "text-amber",
  lunch:     "text-emerald-400",
  dinner:    "text-blue-400",
};

// ISO 8601 numbering (1=Monday...7=Sunday) — matches the day_of_week column
// and migration 113's EXTRACT(ISODOW ...) precedent.
const WEEKDAYS: { dow: number; label: string; short: string }[] = [
  { dow: 1, label: "Monday",    short: "Mon" },
  { dow: 2, label: "Tuesday",   short: "Tue" },
  { dow: 3, label: "Wednesday", short: "Wed" },
  { dow: 4, label: "Thursday",  short: "Thu" },
  { dow: 5, label: "Friday",    short: "Fri" },
  { dow: 6, label: "Saturday",  short: "Sat" },
  { dow: 7, label: "Sunday",    short: "Sun" },
];
function isoDow(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1; // JS Sun=0 → ISO 7
}

function formatMonthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getDaysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(y, m, 0).getDate();
  return Array.from({ length: total }, (_, i) => {
    const d = i + 1;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

function parseDateLocal(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

const emptyForm = () => ({
  date: formatDateInput(new Date()),
  day_of_week: 1,
  meal_type: "breakfast" as MealType,
  item_name: "",
  quantity: "",
  unit_cost: "",
  notes: "",
});

interface Props {
  hostelId: string | null;
  initialItems: FoodItem[];
  initialMonth: string;
  initialMenuType: FoodMenuType;
  partnerTier?: PartnerTier | null;
}

const monthCache = new Map<string, FoodItem[]>();
const weeklyCache = new Map<string, FoodItem[]>();

export function FoodClient({ hostelId, initialItems, initialMonth, initialMenuType, partnerTier = null }: Props) {
  const curCode = getCountryConfig(useHostelContext().hostel?.country).currency; // ISO code for "(PKR)"-style caption
  const canStandardTier = !partnerTier || partnerTier !== "read_only";
  // Menu-type lives on hms_hostels, whose RLS update policy requires full
  // tier for partners (same reason the Settings "Save Listing" button — the
  // other hms_hostels writer — is full-tier gated too).
  const canFullTier = !partnerTier || partnerTier === "full";
  const [menuType, setMenuType] = useState<FoodMenuType>(initialMenuType);
  const [switchingMenu, setSwitchingMenu] = useState(false);
  const [items, setItems] = useState<FoodItem[]>(initialItems);
  const [monthFilter, setMonthFilter] = useState(initialMonth);
  const [loadingItems, setLoadingItems] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Suggestions for the dish inputs — distinct dish names already in this menu, so
  // recurring dishes are one keystroke and spelling stays consistent (fewer dupes
  // like "Chicken Karahi" vs "chicken karahi"). Derived from loaded items (no
  // extra fetch — respects the no-sync-on-mount rule); a native <datalist> keeps
  // it a plain text input that still accepts brand-new dishes.
  const dishSuggestions = useMemo(
    () => Array.from(new Set(items.map((i) => i.item_name?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const today = formatDateInput(new Date());
  const todayDow = isoDow(new Date());
  const isWeekly = menuType === "weekly";

  // Seed cache with SSR data
  if (hostelId && isWeekly && !weeklyCache.has(hostelId)) {
    weeklyCache.set(hostelId, initialItems);
  }
  if (hostelId && !isWeekly && !monthCache.has(`${hostelId}:${initialMonth}`)) {
    monthCache.set(`${hostelId}:${initialMonth}`, initialItems);
  }

  async function loadMonth(month: string) {
    if (!hostelId) return;
    const key = `${hostelId}:${month}`;
    if (monthCache.has(key)) { setItems(monthCache.get(key)!); return; }
    setLoadingItems(true);
    const [y, m] = month.split("-").map(Number);
    const end = new Date(y, m, 0).toISOString().slice(0, 10);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_food_items").select("*").eq("hostel_id", hostelId)
      .gte("date", `${month}-01`).lte("date", end)
      .order("date").order("meal_type").order("sort_order");
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else { const rows = (data as FoodItem[]) ?? []; monthCache.set(key, rows); setItems(rows); }
    setLoadingItems(false);
  }

  async function loadWeekly(force = false) {
    if (!hostelId) return;
    if (!force && weeklyCache.has(hostelId)) { setItems(weeklyCache.get(hostelId)!); return; }
    setLoadingItems(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_food_items").select("*").eq("hostel_id", hostelId)
      .not("day_of_week", "is", null)
      .order("day_of_week").order("meal_type").order("sort_order");
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else { const rows = (data as FoodItem[]) ?? []; weeklyCache.set(hostelId, rows); setItems(rows); }
    setLoadingItems(false);
  }

  function invalidateMonthCache() {
    if (hostelId) monthCache.delete(`${hostelId}:${monthFilter}`);
  }

  function invalidateWeeklyCache() {
    if (hostelId) weeklyCache.delete(hostelId);
  }

  function changeMonth(delta: number) {
    const [y, m] = monthFilter.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    setMonthFilter(next);
    loadMonth(next);
  }

  // Never touches hms_food_items — old entries from the other mode just stop
  // being queried, they're not deleted, so switching back restores them.
  async function switchMenuType(next: FoodMenuType) {
    if (next === menuType || !hostelId || switchingMenu) return;
    setSwitchingMenu(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_hostels").update({ food_menu_type: next }).eq("id", hostelId).select("id");
    if (error || !data?.length) {
      toast({ title: "Error", description: error?.message ?? "Your access level does not allow changing the menu type.", variant: "destructive" });
      setSwitchingMenu(false);
      return;
    }
    setMenuType(next);
    if (next === "weekly") await loadWeekly();
    else await loadMonth(monthFilter);
    setSwitchingMenu(false);
  }

  async function saveCell(row: string, meal: MealType, existing: FoodItem[]) {
    if (!hostelId) return;
    const key = `${row}|${meal}`;
    const draft = drafts[key];
    setDrafts((prev) => { const n = { ...prev }; delete n[key]; return n; });
    if (draft === undefined) return;
    const lines = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    const current = [...existing]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at))
      .map((i) => i.item_name);
    if (lines.length === current.length && lines.every((l, i) => l === current[i])) return;
    // Preserve any per-dish quantity/cost/notes by name across the rewrite, so
    // the Add-Item dialog's kitchen-cost data isn't lost when a cell is edited.
    const meta = new Map<string, { quantity: string | null; unit_cost: number | null; notes: string | null }>();
    for (const e of existing) if (!meta.has(e.item_name)) meta.set(e.item_name, { quantity: e.quantity ?? null, unit_cost: e.unit_cost ?? null, notes: e.notes ?? null });
    const supabase = createClient();
    // Insert the new rows FIRST, delete the old ones only after that succeeds. A
    // failed insert then leaves the cell's original dishes (and their kitchen-cost
    // data) untouched; a failed delete leaves recoverable duplicates, never data loss.
    let inserted: FoodItem[] = [];
    if (lines.length > 0) {
      const payloads = lines.map((item_name, idx) => ({
        hostel_id: hostelId,
        date: isWeekly ? null : row,
        day_of_week: isWeekly ? Number(row) : null,
        meal_type: meal,
        item_name,
        sort_order: idx,
        quantity: meta.get(item_name)?.quantity ?? null,
        unit_cost: meta.get(item_name)?.unit_cost ?? null,
        notes: meta.get(item_name)?.notes ?? null,
      }));
      const { data, error } = await supabase.from("hms_food_items").insert(payloads).select();
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      inserted = (data as FoodItem[]) ?? [];
    }
    if (existing.length > 0) {
      const { error } = await supabase.from("hms_food_items").delete().in("id", existing.map((e) => e.id));
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    setItems((prev) => [...prev.filter((i) => !existing.some((e) => e.id === i.id)), ...inserted]);
    if (isWeekly) invalidateWeeklyCache(); else invalidateMonthCache();
  }

  async function handleSave() {
    if (!hostelId || !form.item_name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const payload = isWeekly
      ? {
          hostel_id: hostelId, date: null, day_of_week: form.day_of_week, meal_type: form.meal_type,
          item_name: form.item_name.trim(), quantity: form.quantity || null,
          unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
          notes: form.notes || null,
        }
      : {
          hostel_id: hostelId, date: form.date, day_of_week: null, meal_type: form.meal_type,
          item_name: form.item_name.trim(), quantity: form.quantity || null,
          unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
          notes: form.notes || null,
        };
    if (editing) {
      const { data, error } = await supabase.from("hms_food_items").update(payload).eq("id", editing.id).select("id");
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
      if (!data || data.length === 0) {
        toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("hms_food_items").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
    }
    toast({ title: editing ? "Updated" : "Added" });
    setDialogOpen(false);
    if (isWeekly) { invalidateWeeklyCache(); await loadWeekly(true); }
    else { invalidateMonthCache(); if (form.date.startsWith(monthFilter)) loadMonth(monthFilter); }
    setSaving(false);
  }

  const groupedByRow = useMemo(() => {
    if (isWeekly) {
      return items.reduce<Record<string, Record<MealType, FoodItem[]>>>((acc, item) => {
        if (item.day_of_week == null) return acc;
        const key = String(item.day_of_week);
        if (!acc[key]) acc[key] = { breakfast: [], lunch: [], dinner: [] };
        acc[key][item.meal_type].push(item);
        return acc;
      }, {});
    }
    return items.reduce<Record<string, Record<MealType, FoodItem[]>>>((acc, item) => {
      if (!item.date) return acc;
      if (!acc[item.date]) acc[item.date] = { breakfast: [], lunch: [], dinner: [] };
      acc[item.date][item.meal_type].push(item);
      return acc;
    }, {});
  }, [items, isWeekly]);

  const daysInMonth = useMemo(() => getDaysInMonth(monthFilter), [monthFilter]);
  const rows = isWeekly ? WEEKDAYS.map((w) => String(w.dow)) : daysInMonth;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Food List</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isWeekly ? "Weekly meal planner — repeats every week" : "Monthly meal planner"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canFullTier && (
            <div className="inline-flex rounded-lg border border-sidebar-border p-0.5 shrink-0">
              {(["monthly", "weekly"] as FoodMenuType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={switchingMenu}
                  onClick={() => switchMenuType(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
                    menuType === t ? "bg-amber/15 text-amber" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "monthly" ? "30 Days" : "7 Days"}
                </button>
              ))}
            </div>
          )}
          {canStandardTier && (
            <Button
              onClick={() => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); }}
              className="gap-2 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          )}
        </div>
      </div>

      {/* Month navigation — monthly mode only; weekly repeats forever, nothing to navigate */}
      {isWeekly ? (
        <p className="text-xs text-muted-foreground">Repeats every week — no month-to-month re-entry needed.</p>
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-base font-semibold min-w-[150px] text-center">{formatMonthTitle(monthFilter)}</span>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => { const m = today.slice(0, 7); if (m !== monthFilter) { setMonthFilter(m); loadMonth(m); } }}
          >
            This Month
          </Button>
        </div>
      )}

      {/* Grid */}
      {loadingItems ? (
        <div className="space-y-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-9 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sidebar-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-sidebar-border bg-white/[0.015]">
                <th className={`px-3 py-2.5 text-left sticky left-0 bg-sidebar z-10 border-r border-sidebar-border ${isWeekly ? "w-[104px]" : "w-[72px]"}`}>
                  <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest">Day</span>
                </th>
                {mealTypes.map((meal) => (
                  <th key={meal} className="px-4 py-2.5 text-left w-[33%]">
                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${mealHeaderColor[meal]}`}>
                      {mealIcons[meal]} {mealLabel[meal]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const dayData = groupedByRow[row] ?? { breakfast: [], lunch: [], dinner: [] };
                const isToday = isWeekly ? Number(row) === todayDow : row === today;

                let smallLabel: string;
                let bigLabel: string;
                if (isWeekly) {
                  const w = WEEKDAYS.find((w) => String(w.dow) === row)!;
                  smallLabel = "";
                  bigLabel = w.label;
                } else {
                  const d = parseDateLocal(row);
                  smallLabel = d.toLocaleDateString("en-US", { weekday: "short" });
                  bigLabel = String(d.getDate());
                }

                return (
                  <tr key={row} className={`border-b border-sidebar-border/40 transition-colors ${isToday ? "bg-amber/[0.04]" : "hover:bg-white/[0.01]"}`}>

                    {/* Day label */}
                    <td className={`px-3 py-2 sticky left-0 z-10 border-r border-sidebar-border/50 ${isToday ? "bg-amber/[0.08]" : "bg-sidebar"}`}>
                      <div className="leading-tight select-none">
                        {smallLabel && <div className={`text-[10px] font-medium ${isToday ? "text-amber/70" : "text-muted-foreground/40"}`}>{smallLabel}</div>}
                        <div className={`text-sm font-bold tabular-nums ${isToday ? "text-amber" : "text-foreground/80"}`}>{bigLabel}</div>
                      </div>
                    </td>

                    {/* Meal cells — a plain text field: one dish per line */}
                    {mealTypes.map((meal) => {
                      const cellItems = [...(dayData[meal] ?? [])].sort(
                        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at)
                      );
                      const key = `${row}|${meal}`;
                      const saved = cellItems.map((i) => i.item_name).join("\n");
                      const value = drafts[key] ?? saved;
                      return (
                        <td key={meal} className="px-2 py-1.5 align-top">
                          <textarea
                            value={value}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                            onBlur={() => saveCell(row, meal, cellItems)}
                            disabled={!canStandardTier}
                            placeholder="Add dishes…"
                            rows={Math.max(1, value ? value.split("\n").length : 1)}
                            className="w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-foreground/90 placeholder:text-muted-foreground/35 outline-none rounded-md px-2 py-1 focus:bg-white/[0.04] focus:ring-1 focus:ring-amber/30 transition-colors disabled:cursor-default"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Shared dish suggestions for every dish input (add dialog, quick-add,
          inline edit). Native datalist: suggests past dishes but still accepts new. */}
      <datalist id="dish-suggestions">
        {dishSuggestions.map((d) => <option key={d} value={d} />)}
      </datalist>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Item" : "Add Food Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{isWeekly ? "Day" : "Date"}</Label>
                {isWeekly ? (
                  <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((w) => (
                        <SelectItem key={w.dow} value={String(w.dow)}>{w.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Meal</Label>
                <Select value={form.meal_type} onValueChange={(v) => setForm({ ...form, meal_type: v as MealType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {mealTypes.map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">
                        {mealIcons[m]} {mealLabel[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Item Name *</Label>
              <Input
                placeholder="e.g. Rice, Dal, Chicken..."
                value={form.item_name}
                onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && form.item_name.trim()) handleSave(); }}
                list="dish-suggestions"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">Quantity <span className="text-muted-foreground/50 font-normal text-xs">optional</span></Label>
                <Input placeholder="e.g. 2 kg" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">Cost ({curCode}) <span className="text-muted-foreground/50 font-normal text-xs">optional</span></Label>
                <Input type="number" placeholder="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">Notes <span className="text-muted-foreground/50 font-normal text-xs">optional</span></Label>
              <Textarea placeholder="Optional..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.item_name.trim()}>
              {saving ? "Saving..." : editing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
