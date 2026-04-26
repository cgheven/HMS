"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { Plus, UtensilsCrossed, Edit2, Trash2, ChevronLeft, ChevronRight,
         CalendarDays, ChevronDown, ChevronUp, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDate, formatDateInput } from "@/lib/utils";
import type { FoodItem, MealType } from "@/types";

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const mealColors: Record<MealType, string> = {
  breakfast: "bg-amber/10 text-amber border-amber/20",
  lunch: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  dinner: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  snack: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};
const mealAccent: Record<MealType, string> = {
  breakfast: "text-amber",
  lunch: "text-emerald-400",
  dinner: "text-blue-400",
  snack: "text-purple-400",
};
const mealIcons: Record<MealType, string> = { breakfast: "☀️", lunch: "🌤️", dinner: "🌙", snack: "🍎" };

const emptyForm = {
  date: formatDateInput(new Date()),
  meal_type: "lunch" as MealType,
  item_name: "",
  quantity: "",
  unit_cost: "",
  notes: "",
};

function parseDateLocal(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function formatDayHeader(date: string) {
  return parseDateLocal(date).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
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

interface Props { hostelId: string | null; initialItems: FoodItem[]; initialDate: string; }

const monthCache = new Map<string, FoodItem[]>();

export function FoodClient({ hostelId, initialItems, initialDate }: Props) {
  // ── Daily view state ──────────────────────────────────────
  const [items, setItems] = useState<FoodItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // ── Monthly menu state ────────────────────────────────────
  const [monthItems, setMonthItems] = useState<FoodItem[]>([]);
  const [monthFilter, setMonthFilter] = useState(initialDate.slice(0, 7));
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [addingMeal, setAddingMeal] = useState<{ date: string; meal: MealType } | null>(null);
  const [addingText, setAddingText] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const today = formatDateInput(new Date());

  // ── Auto-expand days that have items + today ──────────────
  useEffect(() => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (today.startsWith(monthFilter)) next.add(today);
      monthItems.forEach((i) => next.add(i.date));
      return next;
    });
  }, [monthItems, monthFilter, today]);

  // ── Data loading ──────────────────────────────────────────
  async function loadDate(date: string) {
    if (!hostelId) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("hms_food_items").select("*").eq("hostel_id", hostelId)
      .eq("date", date).order("meal_type").order("sort_order");
    setItems((data as FoodItem[]) ?? []);
    setLoading(false);
  }

  async function loadMonth(month: string) {
    if (!hostelId) return;
    const key = `${hostelId}:${month}`;
    if (monthCache.has(key)) { setMonthItems(monthCache.get(key)!); return; }
    setLoadingMonth(true);
    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const end = formatDateInput(new Date(y, m, 0));
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_food_items").select("*").eq("hostel_id", hostelId)
      .gte("date", start).lte("date", end)
      .order("date").order("meal_type").order("sort_order");
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else { const rows = (data as FoodItem[]) ?? []; monthCache.set(key, rows); setMonthItems(rows); }
    setLoadingMonth(false);
  }

  function invalidateMonthCache() {
    if (hostelId) monthCache.delete(`${hostelId}:${monthFilter}`);
  }

  // ── Daily view actions ────────────────────────────────────
  function changeDate(delta: number) {
    const d = new Date(selectedDate); d.setDate(d.getDate() + delta);
    const next = formatDateInput(d);
    setSelectedDate(next); loadDate(next);
  }

  function goToDate(date: string) { setSelectedDate(date); loadDate(date); }

  async function handleSave() {
    if (!hostelId || !form.item_name) return;
    setSaving(true);
    const supabase = createClient();
    const payload = {
      hostel_id: hostelId, date: form.date, meal_type: form.meal_type,
      item_name: form.item_name, quantity: form.quantity || null,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      notes: form.notes || null,
    };
    const { error } = editing
      ? await supabase.from("hms_food_items").update(payload).eq("id", editing.id)
      : await supabase.from("hms_food_items").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: editing ? "Updated" : "Added" });
      setDialogOpen(false);
      loadDate(selectedDate);
      invalidateMonthCache();
      if (form.date.startsWith(monthFilter)) loadMonth(monthFilter);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_food_items").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); loadDate(selectedDate); invalidateMonthCache(); }
  }

  // ── Monthly menu actions ──────────────────────────────────
  function toggleDate(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  function changeMonth(delta: number) {
    const [y, m] = monthFilter.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    setMonthFilter(newMonth);
    setExpandedDates(new Set()); // reset; auto-expand will re-populate
    loadMonth(newMonth);
  }

  async function quickAdd(date: string, meal: MealType) {
    const text = addingText.trim();
    if (!text || !hostelId) return;
    const siblings = monthItems.filter((i) => i.date === date && i.meal_type === meal);
    const maxOrder = siblings.length ? Math.max(...siblings.map((i) => i.sort_order ?? 0)) : -1;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_food_items")
      .insert({ hostel_id: hostelId, date, meal_type: meal, item_name: text, sort_order: maxOrder + 1 })
      .select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setMonthItems((prev) => [...prev, data as FoodItem]);
    invalidateMonthCache();
    setAddingText("");
    // keep addingMeal open for rapid consecutive adds
    setTimeout(() => addInputRef.current?.focus(), 50);
  }

  async function saveInlineEdit(item: FoodItem) {
    const text = editingText.trim();
    setEditingItemId(null);
    if (!text || text === item.item_name) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_food_items").update({ item_name: text }).eq("id", item.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setMonthItems((prev) => prev.map((i) => i.id === item.id ? { ...i, item_name: text } : i));
    invalidateMonthCache();
  }

  async function deleteMonthItem(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_food_items").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setMonthItems((prev) => prev.filter((i) => i.id !== id));
    invalidateMonthCache();
  }

  async function moveItem(item: FoodItem, dir: "up" | "down") {
    const siblings = [...monthItems.filter((i) => i.date === item.date && i.meal_type === item.meal_type)]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at));
    const idx = siblings.findIndex((i) => i.id === item.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    // Normalize all sort_orders then swap the two
    const orders = siblings.map((s, i) => ({ id: s.id, sort_order: i }));
    [orders[idx].sort_order, orders[swapIdx].sort_order] = [orders[swapIdx].sort_order, orders[idx].sort_order];
    const supabase = createClient();
    await Promise.all(orders.map(({ id, sort_order }) =>
      supabase.from("hms_food_items").update({ sort_order }).eq("id", id)
    ));
    const orderMap = new Map(orders.map((o) => [o.id, o.sort_order]));
    setMonthItems((prev) => prev.map((i) => orderMap.has(i.id) ? { ...i, sort_order: orderMap.get(i.id)! } : i));
    invalidateMonthCache();
  }

  function openFullEdit(item: FoodItem) {
    setEditing(item);
    setForm({
      date: item.date, meal_type: item.meal_type, item_name: item.item_name,
      quantity: item.quantity ?? "", unit_cost: item.unit_cost?.toString() ?? "", notes: item.notes ?? "",
    });
    setDialogOpen(true);
  }

  // ── Derived data ──────────────────────────────────────────
  const grouped = mealTypes.reduce<Record<MealType, FoodItem[]>>((acc, m) => {
    acc[m] = items.filter((i) => i.meal_type === m);
    return acc;
  }, { breakfast: [], lunch: [], dinner: [], snack: [] });

  const groupedByDate = useMemo(() => {
    return monthItems.reduce<Record<string, Record<MealType, FoodItem[]>>>((acc, item) => {
      if (!acc[item.date]) acc[item.date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
      acc[item.date][item.meal_type].push(item);
      return acc;
    }, {});
  }, [monthItems]);

  const daysInMonth = useMemo(() => getDaysInMonth(monthFilter), [monthFilter]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Food List</h1>
          <p className="text-muted-foreground text-sm mt-1">Daily meals &amp; monthly menu planner</p>
        </div>
        <Button
          onClick={() => { setEditing(null); setForm({ ...emptyForm, date: selectedDate }); setDialogOpen(true); }}
          className="gap-2 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" /> Add Item
        </Button>
      </div>

      <Tabs defaultValue="monthly" className="space-y-6">
        <TabsList>
          <TabsTrigger value="daily">Daily View</TabsTrigger>
          <TabsTrigger value="monthly" onClick={() => { if (monthItems.length === 0) loadMonth(monthFilter); }}>
            <CalendarDays className="w-3.5 h-3.5 mr-1.5" />Monthly Menu
          </TabsTrigger>
        </TabsList>

        {/* ── Daily View ──────────────────────────────────── */}
        <TabsContent value="daily" className="space-y-6">
          <div className="flex items-center gap-3 justify-center sm:justify-start">
            <Button variant="outline" size="icon" onClick={() => changeDate(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="flex items-center gap-2">
              <Input type="date" value={selectedDate} onChange={(e) => goToDate(e.target.value)} className="w-auto" />
              <span className="text-sm text-muted-foreground hidden sm:block">{formatDate(selectedDate)}</span>
            </div>
            <Button variant="outline" size="icon" onClick={() => changeDate(1)}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => goToDate(formatDateInput(new Date()))}>Today</Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mealTypes.map((meal) => (
                <Card key={meal} className="overflow-hidden">
                  <CardHeader className={`py-3 px-4 border-b border-sidebar-border ${mealColors[meal]}`}>
                    <CardTitle className="text-sm flex items-center gap-2 capitalize">
                      <span>{mealIcons[meal]}</span> {meal}
                      <Badge variant="secondary" className="ml-auto text-xs">{grouped[meal].length} items</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-2 min-h-[80px]">
                    {grouped[meal].length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No items added</p>
                    ) : (
                      grouped[meal].map((item) => (
                        <div key={item.id} className="flex items-start gap-2 p-2 rounded-md hover:bg-white/[0.03] group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.item_name}</p>
                            <div className="flex flex-wrap gap-2 mt-0.5">
                              {item.quantity && <span className="text-xs text-muted-foreground">{item.quantity}</span>}
                              {item.unit_cost && <span className="text-xs text-muted-foreground">PKR {item.unit_cost}</span>}
                              {item.notes && <span className="text-xs text-muted-foreground italic">{item.notes}</span>}
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openFullEdit(item)}><Edit2 className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {items.length === 0 && !loading && (
            <div className="flex flex-col items-center py-4 text-muted-foreground">
              <UtensilsCrossed className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No food items for this date.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Monthly Menu ─────────────────────────────────── */}
        <TabsContent value="monthly" className="space-y-4">
          {/* Month navigation */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-base font-semibold min-w-[140px] text-center">{formatMonthTitle(monthFilter)}</span>
            <Button variant="outline" size="icon" onClick={() => changeMonth(1)}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => { const m = today.slice(0, 7); setMonthFilter(m); setExpandedDates(new Set()); loadMonth(m); }}>
              This Month
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">{monthItems.length} items total</span>
          </div>

          {loadingMonth ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-12 bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {daysInMonth.map((date) => {
                const dayData = groupedByDate[date] ?? { breakfast: [], lunch: [], dinner: [], snack: [] };
                const totalItems = mealTypes.reduce((s, m) => s + dayData[m].length, 0);
                const isToday = date === today;
                const expanded = expandedDates.has(date);

                return (
                  <div
                    key={date}
                    className={`rounded-xl border overflow-hidden transition-colors ${
                      isToday
                        ? "border-amber/40 bg-amber/[0.03]"
                        : "border-sidebar-border bg-card"
                    }`}
                  >
                    {/* Day header */}
                    <button
                      onClick={() => toggleDate(date)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-semibold ${isToday ? "text-amber" : ""}`}>
                          {formatDayHeader(date)}
                        </span>
                        {isToday && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber/20 text-amber font-medium">Today</span>
                        )}
                        {totalItems > 0 && (
                          <span className="text-xs text-muted-foreground">{totalItems} item{totalItems !== 1 ? "s" : ""}</span>
                        )}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                    </button>

                    {/* Expanded content */}
                    {expanded && (
                      <div className="border-t border-sidebar-border divide-y divide-sidebar-border/60">
                        {mealTypes.map((meal) => {
                          const mealItems = [...dayData[meal]].sort(
                            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at)
                          );
                          const isAddingHere = addingMeal?.date === date && addingMeal.meal === meal;

                          return (
                            <div key={meal} className="px-4 py-2.5">
                              {/* Meal section header */}
                              <div className="flex items-center justify-between mb-1.5">
                                <span className={`text-xs font-semibold capitalize ${mealAccent[meal]}`}>
                                  {mealIcons[meal]} {meal}
                                </span>
                                <button
                                  onClick={() => { setAddingMeal({ date, meal }); setAddingText(""); setTimeout(() => addInputRef.current?.focus(), 50); }}
                                  className="p-0.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                                  title="Add item"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Item rows */}
                              <div className="space-y-0.5">
                                {mealItems.map((item, idx) => (
                                  <div key={item.id} className="flex items-center gap-1 py-0.5 rounded group/item hover:bg-white/[0.02] px-1 -mx-1">
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
                                        className="flex-1 text-sm bg-white/5 border border-amber/40 rounded px-2 py-0.5 outline-none text-foreground"
                                      />
                                    ) : (
                                      <span
                                        className="flex-1 text-sm cursor-text hover:text-foreground text-foreground/90 leading-relaxed"
                                        onClick={() => { setEditingItemId(item.id); setEditingText(item.item_name); }}
                                        title="Click to edit"
                                      >
                                        {item.item_name}
                                        {item.quantity && <span className="text-muted-foreground text-xs ml-1">({item.quantity})</span>}
                                      </span>
                                    )}

                                    {/* Controls — visible on hover */}
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0">
                                      <button
                                        onClick={() => moveItem(item, "up")}
                                        disabled={idx === 0}
                                        className="p-0.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                                        title="Move up"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => moveItem(item, "down")}
                                        disabled={idx === mealItems.length - 1}
                                        className="p-0.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                                        title="Move down"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => openFullEdit(item)}
                                        className="p-0.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
                                        title="Edit details"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => deleteMonthItem(item.id)}
                                        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                        title="Delete"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                ))}

                                {/* Empty placeholder */}
                                {mealItems.length === 0 && !isAddingHere && (
                                  <button
                                    onClick={() => { setAddingMeal({ date, meal }); setAddingText(""); setTimeout(() => addInputRef.current?.focus(), 50); }}
                                    className="w-full text-left text-xs text-muted-foreground/40 hover:text-muted-foreground py-0.5 transition-colors"
                                  >
                                    + Add {meal} item
                                  </button>
                                )}

                                {/* Inline add input */}
                                {isAddingHere && (
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <input
                                      ref={addInputRef}
                                      value={addingText}
                                      onChange={(e) => setAddingText(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") quickAdd(date, meal);
                                        if (e.key === "Escape") setAddingMeal(null);
                                      }}
                                      placeholder="Item name… (Enter to add, Esc to close)"
                                      className="flex-1 text-sm bg-white/5 border border-sidebar-border focus:border-amber/40 rounded-lg px-3 py-1.5 outline-none text-foreground placeholder:text-muted-foreground/40 transition-colors"
                                    />
                                    <button
                                      onClick={() => quickAdd(date, meal)}
                                      disabled={!addingText.trim()}
                                      className="text-xs font-medium text-amber hover:text-amber/80 disabled:opacity-40"
                                    >
                                      Add
                                    </button>
                                    <button onClick={() => setAddingMeal(null)} className="text-muted-foreground hover:text-foreground">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Full edit/add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Food Item" : "Add Food Item"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Meal Type</Label>
                <Select value={form.meal_type} onValueChange={(v) => setForm({ ...form, meal_type: v as MealType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {mealTypes.map((m) => <SelectItem key={m} value={m} className="capitalize">{mealIcons[m]} {m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Item Name *</Label>
              <Input placeholder="e.g. Rice, Dal, Chicken..." value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input placeholder="e.g. 2 kg" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Cost (PKR)</Label>
                <Input type="number" placeholder="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Optional..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.item_name}>
              {saving ? "Saving..." : editing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
