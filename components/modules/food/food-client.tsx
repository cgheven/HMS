"use client";
import { useState, useMemo, useRef } from "react";
import { Plus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDateInput } from "@/lib/utils";
import type { FoodItem, MealType, PartnerTier, FoodMenuType } from "@/types";

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner"];
const mealLabel: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const mealIcons: Record<MealType, string> = { breakfast: "☀️", lunch: "🌤️", dinner: "🌙" };
const mealHeaderColor: Record<MealType, string> = {
  breakfast: "text-amber",
  lunch:     "text-emerald-400",
  dinner:    "text-blue-400",
};
const mealInputFocus: Record<MealType, string> = {
  breakfast: "focus:border-amber/50",
  lunch:     "focus:border-emerald-400/50",
  dinner:    "focus:border-blue-400/50",
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
  const [addingMeal, setAddingMeal] = useState<{ row: string; meal: MealType } | null>(null);
  const [addingText, setAddingText] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

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

  async function quickAdd(row: string, meal: MealType) {
    const text = addingText.trim();
    if (!text || !hostelId) return;
    const siblings = items.filter((i) =>
      (isWeekly ? i.day_of_week === Number(row) : i.date === row) && i.meal_type === meal
    );
    const maxOrder = siblings.length ? Math.max(...siblings.map((i) => i.sort_order ?? 0)) : -1;
    const payload = isWeekly
      ? { hostel_id: hostelId, date: null, day_of_week: Number(row), meal_type: meal, item_name: text, sort_order: maxOrder + 1 }
      : { hostel_id: hostelId, date: row, day_of_week: null, meal_type: meal, item_name: text, sort_order: maxOrder + 1 };
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_food_items")
      .insert(payload)
      .select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setItems((prev) => [...prev, data as FoodItem]);
    if (isWeekly) invalidateWeeklyCache(); else invalidateMonthCache();
    setAddingText("");
    setTimeout(() => addInputRef.current?.focus(), 50);
  }

  async function saveInlineEdit(item: FoodItem) {
    const text = editingText.trim();
    setEditingItemId(null);
    if (!text || text === item.item_name) return;
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_food_items").update({ item_name: text }).eq("id", item.id).select("id");
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, item_name: text } : i));
    if (isWeekly) invalidateWeeklyCache(); else invalidateMonthCache();
  }

  async function deleteItem(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_food_items").delete().eq("id", id).select("id");
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
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

                    {/* Meal cells */}
                    {mealTypes.map((meal) => {
                      const cellItems = [...(dayData[meal] ?? [])].sort(
                        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at)
                      );
                      const isAddingHere = addingMeal?.row === row && addingMeal.meal === meal;

                      return (
                        <td
                          key={meal}
                          className={`px-3 py-2 align-top group/cell ${canStandardTier ? "cursor-pointer" : ""}`}
                          onClick={() => {
                            if (canStandardTier && !isAddingHere && !editingItemId) {
                              setAddingMeal({ row, meal });
                              setAddingText("");
                              setTimeout(() => addInputRef.current?.focus(), 40);
                            }
                          }}
                        >
                          <div className="space-y-0.5 min-h-[22px]">
                            {cellItems.map((item) => (
                              <div key={item.id} className="flex items-center gap-1 group/item" onClick={(e) => e.stopPropagation()}>
                                {editingItemId === item.id ? (
                                  <input
                                    autoFocus
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    onBlur={() => saveInlineEdit(item)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveInlineEdit(item);
                                      if (e.key === "Escape") setEditingItemId(null);
                                    }}
                                    className="flex-1 text-xs bg-white/5 border border-amber/40 rounded px-1.5 py-0.5 outline-none text-foreground w-full"
                                  />
                                ) : (
                                  <span
                                    className={`flex-1 text-xs text-foreground/80 leading-relaxed ${canStandardTier ? "hover:text-foreground cursor-text" : ""}`}
                                    onClick={() => { if (canStandardTier) { setEditingItemId(item.id); setEditingText(item.item_name); } }}
                                    title={item.item_name}
                                  >
                                    {item.item_name}
                                  </span>
                                )}
                                {canStandardTier && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                                    className="opacity-0 group-hover/item:opacity-100 shrink-0 p-0.5 rounded hover:bg-rose-500/10 text-muted-foreground/30 hover:text-rose-400 transition-all"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                )}
                              </div>
                            ))}

                            {isAddingHere ? (
                              <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  ref={addInputRef}
                                  value={addingText}
                                  onChange={(e) => setAddingText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") quickAdd(row, meal);
                                    if (e.key === "Escape") setAddingMeal(null);
                                  }}
                                  onBlur={() => { if (!addingText.trim()) setAddingMeal(null); }}
                                  placeholder="Type & press Enter…"
                                  className={`w-full text-xs bg-white/5 border border-sidebar-border rounded px-2 py-1 outline-none text-foreground placeholder:text-muted-foreground/25 transition-colors ${mealInputFocus[meal]}`}
                                />
                              </div>
                            ) : (
                              canStandardTier && cellItems.length === 0 && (
                                <span className="text-[10px] text-transparent group-hover/cell:text-muted-foreground/30 transition-colors select-none pointer-events-none">
                                  + add
                                </span>
                              )
                            )}
                          </div>
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
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">Quantity <span className="text-muted-foreground/50 font-normal text-xs">optional</span></Label>
                <Input placeholder="e.g. 2 kg" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">Cost (PKR) <span className="text-muted-foreground/50 font-normal text-xs">optional</span></Label>
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
