"use client";
import { useState, useMemo, useRef } from "react";
import {
  Plus, ChefHat, Search, Edit2, Trash2, TrendingDown,
  CalendarDays, X, ShoppingBasket, Pencil, Check, ShoppingCart,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { KitchenExpense } from "@/types";

// ── Presets ───────────────────────────────────────────────
const DAILY_PRESETS = [
  "Rice (Chawal)", "Flour (Atta)", "Bread / Naan",
  "Dal (Lentils)", "Masoor Dal", "Chana Dal", "Mash Dal",
  "Chicken", "Beef (Gosht)", "Mutton", "Fish (Machli)", "Eggs (Anda)",
  "Vegetables (Sabzi)", "Potatoes (Aloo)", "Onions (Pyaz)", "Tomatoes",
  "Garlic & Ginger", "Green Chilli", "Coriander (Dhaniya)", "Lemon",
  "Cooking Oil", "Ghee / Butter", "Milk (Doodh)", "Yogurt (Dahi)",
  "Sugar (Cheeni)", "Salt (Namak)", "Tea Leaves (Chai Patti)",
  "Spices / Masala", "Biryani Rice (Basmati)", "Chickpeas (Chana)",
];

const GROCERY_PRESETS = [
  "Rice (Chawal)", "Basmati Rice", "Flour (Atta)", "Semolina (Sooji)",
  "Cooking Oil", "Ghee", "Sugar (Cheeni)", "Salt (Namak)",
  "Tea Leaves (Chai Patti)", "Milk Powder",
  "Dal Masoor", "Dal Chana", "Dal Mash", "Chickpeas (Chana)",
  "Spices / Masala", "Red Chilli Powder", "Turmeric (Haldi)", "Coriander Powder",
  "Tomato Paste", "Vinegar", "Soy Sauce",
  "Matches / Lighter", "Dish Soap", "Washing Powder", "Toilet Paper",
  "Plastic Bags", "Aluminium Foil",
];

// ── Breakfast bundle ──────────────────────────────────────
const BREAKFAST_STORAGE_KEY = "hms_breakfast_defaults";
const BREAKFAST_FALLBACK = ["Anda Paratha", "Chai"];
function loadBreakfastDefaults(): string[] {
  if (typeof window === "undefined") return BREAKFAST_FALLBACK;
  try { const r = localStorage.getItem(BREAKFAST_STORAGE_KEY); return r ? JSON.parse(r) : BREAKFAST_FALLBACK; }
  catch { return BREAKFAST_FALLBACK; }
}
function saveBreakfastDefaults(items: string[]) {
  localStorage.setItem(BREAKFAST_STORAGE_KEY, JSON.stringify(items));
}

type SelectedItem = { id: string; title: string; quantity: string; amount: string };

const emptyGroceryForm = { title: "", quantity: "", amount: "", notes: "" };

interface Props { hostelId: string | null; initialItems: KitchenExpense[]; defaultMonth: string; }

const kitchenCache = new Map<string, KitchenExpense[]>();

export function KitchenClient({ hostelId, initialItems, defaultMonth }: Props) {
  const [items, setItems]           = useState<KitchenExpense[]>(initialItems);
  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [search, setSearch]         = useState("");
  const [activeTab, setActiveTab]   = useState<"daily" | "grocery">("daily");

  // ── Daily multi-add state ─────────────────────────────
  const [addOpen, setAddOpen]           = useState(false);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [addDate, setAddDate]           = useState(formatDateInput(new Date()));
  const [itemSearch, setItemSearch]     = useState("");
  const [customInput, setCustomInput]   = useState("");
  const [savingMulti, setSavingMulti]   = useState(false);
  const amountRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // ── Breakfast bundle state ────────────────────────────
  const [breakfastItems, setBreakfastItems] = useState<string[]>(() => loadBreakfastDefaults());
  const [editingBreakfast, setEditingBreakfast] = useState(false);
  const [newBreakfastInput, setNewBreakfastInput] = useState("");

  // ── Grocery add/edit state ────────────────────────────
  const [groceryOpen, setGroceryOpen]     = useState(false);
  const [groceryEditing, setGroceryEditing] = useState<KitchenExpense | null>(null);
  const [groceryForm, setGroceryForm]     = useState(emptyGroceryForm);
  const [grocerySearch, setGrocerySearch] = useState("");
  const [savingGrocery, setSavingGrocery] = useState(false);

  // ── Shared edit dialog state ──────────────────────────
  const [editOpen, setEditOpen]   = useState(false);
  const [editing, setEditing]     = useState<KitchenExpense | null>(null);
  const [editForm, setEditForm]   = useState({ title: "", quantity: "", amount: "", date: "", notes: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Data loading ──────────────────────────────────────
  async function loadMonth(month: string) {
    if (!hostelId) return;
    const key = `${hostelId}:${month}`;
    if (kitchenCache.has(key)) { setItems(kitchenCache.get(key)!); return; }
    setLoadingMonth(true);
    const supabase = createClient();
    const [year, m] = month.split("-");
    const start = `${year}-${m}-01`;
    const end = formatDateInput(new Date(parseInt(year), parseInt(m), 0));
    const { data, error } = await supabase.from("hms_kitchen_expenses").select("*")
      .eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else { const rows = (data as KitchenExpense[]) ?? []; kitchenCache.set(key, rows); setItems(rows); }
    setLoadingMonth(false);
  }

  async function reload() {
    if (!hostelId) return;
    kitchenCache.delete(`${hostelId}:${monthFilter}`);
    await loadMonth(monthFilter);
  }

  // ── Daily multi-add actions ───────────────────────────
  function openAdd() {
    setSelectedItems([]); setAddDate(formatDateInput(new Date()));
    setItemSearch(""); setCustomInput("");
    setEditingBreakfast(false); setNewBreakfastInput("");
    setAddOpen(true);
  }

  function selectItem(title: string) {
    if (selectedItems.find((i) => i.title === title)) return;
    const id = `${Date.now()}-${Math.random()}`;
    setSelectedItems((prev) => [...prev, { id, title, quantity: "", amount: "" }]);
    setTimeout(() => amountRefs.current.get(id)?.focus(), 40);
  }

  function addBreakfastBundle() {
    const toAdd = breakfastItems.filter((t) => !selectedItems.find((i) => i.title === t));
    if (!toAdd.length) return;
    const newRows: SelectedItem[] = toAdd.map((title, idx) => ({ id: `${Date.now()}-${idx}-${Math.random()}`, title, quantity: "", amount: "" }));
    setSelectedItems((prev) => [...prev, ...newRows]);
    setTimeout(() => amountRefs.current.get(newRows[0].id)?.focus(), 40);
  }

  function addCustomItem() {
    const title = customInput.trim();
    if (!title) return;
    selectItem(title);
    setCustomInput("");
  }

  function updateSelected(id: string, field: "quantity" | "amount", value: string) {
    setSelectedItems((prev) => prev.map((i) => i.id === id ? { ...i, [field]: value } : i));
  }

  function removeSelected(id: string) {
    setSelectedItems((prev) => prev.filter((i) => i.id !== id));
    amountRefs.current.delete(id);
  }

  async function handleMultiSave() {
    const valid = selectedItems.filter((i) => i.amount && parseFloat(i.amount) > 0);
    if (!valid.length || !hostelId) return;
    setSavingMulti(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_kitchen_expenses").insert(
      valid.map((i) => ({ hostel_id: hostelId, title: i.title, quantity: i.quantity || null, amount: parseFloat(i.amount), date: addDate, type: "daily", notes: null }))
    );
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `${valid.length} item${valid.length > 1 ? "s" : ""} added` }); setAddOpen(false); reload(); }
    setSavingMulti(false);
  }

  // ── Breakfast editing ─────────────────────────────────
  function addBreakfastItem() {
    const title = newBreakfastInput.trim();
    if (!title || breakfastItems.includes(title)) return;
    const updated = [...breakfastItems, title];
    setBreakfastItems(updated); saveBreakfastDefaults(updated); setNewBreakfastInput("");
  }
  function removeBreakfastItem(title: string) {
    const updated = breakfastItems.filter((t) => t !== title);
    setBreakfastItems(updated); saveBreakfastDefaults(updated);
  }

  // ── Grocery actions ───────────────────────────────────
  function openGroceryAdd() {
    setGroceryEditing(null);
    setGroceryForm(emptyGroceryForm);
    setGrocerySearch("");
    setGroceryOpen(true);
  }

  function openGroceryEdit(item: KitchenExpense) {
    setGroceryEditing(item);
    setGroceryForm({ title: item.title, quantity: item.quantity ?? "", amount: item.amount.toString(), notes: item.notes ?? "" });
    setGrocerySearch("");
    setGroceryOpen(true);
  }

  async function handleGrocerySave() {
    if (!hostelId || !groceryForm.title || !groceryForm.amount) return;
    setSavingGrocery(true);
    const supabase = createClient();
    const [year, m] = monthFilter.split("-");
    const date = `${year}-${m}-01`;
    const payload = {
      hostel_id: hostelId,
      title: groceryForm.title,
      quantity: groceryForm.quantity || null,
      amount: parseFloat(groceryForm.amount),
      date,
      type: "monthly_grocery",
      notes: groceryForm.notes || null,
    };
    const { error } = groceryEditing
      ? await supabase.from("hms_kitchen_expenses").update(payload).eq("id", groceryEditing.id)
      : await supabase.from("hms_kitchen_expenses").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: groceryEditing ? "Updated" : "Grocery item added" }); setGroceryOpen(false); reload(); }
    setSavingGrocery(false);
  }

  // ── Shared edit (daily) ───────────────────────────────
  function openEdit(item: KitchenExpense) {
    setEditing(item);
    setEditForm({ title: item.title, quantity: item.quantity ?? "", amount: item.amount.toString(), date: item.date, notes: item.notes ?? "" });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!hostelId || !editing || !editForm.title || !editForm.amount) return;
    setSavingEdit(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_kitchen_expenses").update({
      title: editForm.title, quantity: editForm.quantity || null,
      amount: parseFloat(editForm.amount), date: editForm.date, notes: editForm.notes || null,
    }).eq("id", editing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Updated" }); setEditOpen(false); reload(); }
    setSavingEdit(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this entry?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_kitchen_expenses").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); reload(); }
  }

  // ── Derived data ──────────────────────────────────────
  const dailyItems    = useMemo(() => items.filter((i) => i.type !== "monthly_grocery"), [items]);
  const groceryItems  = useMemo(() => items.filter((i) => i.type === "monthly_grocery"), [items]);

  const dailyTotal    = useMemo(() => dailyItems.reduce((s, i) => s + Number(i.amount), 0), [dailyItems]);
  const groceryTotal  = useMemo(() => groceryItems.reduce((s, i) => s + Number(i.amount), 0), [groceryItems]);
  const grandTotal    = dailyTotal + groceryTotal;

  const filteredDaily = useMemo(() => {
    const q = search.toLowerCase();
    return dailyItems.filter((i) => i.title.toLowerCase().includes(q));
  }, [search, dailyItems]);

  const filteredGrocery = useMemo(() => {
    const q = search.toLowerCase();
    return groceryItems.filter((i) => i.title.toLowerCase().includes(q));
  }, [search, groceryItems]);

  const dailyAvg = useMemo(() => {
    if (!filteredDaily.length) return 0;
    const days = new Set(filteredDaily.map((i) => i.date)).size;
    return filteredDaily.reduce((s, i) => s + Number(i.amount), 0) / days;
  }, [filteredDaily]);

  const grouped = useMemo(() => filteredDaily.reduce<Record<string, KitchenExpense[]>>((acc, item) => {
    (acc[item.date] = acc[item.date] ?? []).push(item);
    return acc;
  }, {}), [filteredDaily]);

  const filteredPresets = useMemo(() => {
    const q = itemSearch.toLowerCase();
    return q ? DAILY_PRESETS.filter((p) => p.toLowerCase().includes(q)) : DAILY_PRESETS;
  }, [itemSearch]);

  const filteredGroceryPresets = useMemo(() => {
    const q = grocerySearch.toLowerCase();
    return q ? GROCERY_PRESETS.filter((p) => p.toLowerCase().includes(q)) : GROCERY_PRESETS;
  }, [grocerySearch]);

  const selectedTitles  = new Set(selectedItems.map((i) => i.title));
  const validCount      = selectedItems.filter((i) => i.amount && parseFloat(i.amount) > 0).length;
  const allBreakfastAdded = breakfastItems.length > 0 && breakfastItems.every((t) => selectedTitles.has(t));

  // ── Render ────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Kitchen</h1>
          <p className="text-muted-foreground text-sm mt-1">Track daily and monthly grocery expenses</p>
        </div>
        <div className="flex gap-2">
          {activeTab === "daily" ? (
            <Button onClick={openAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
              <Plus className="w-4 h-4" /> Add Daily Entry
            </Button>
          ) : (
            <Button onClick={openGroceryAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
              <Plus className="w-4 h-4" /> Add Grocery Item
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total This Month",    value: formatCurrency(grandTotal),   icon: TrendingDown,  color: "text-amber",        bg: "bg-amber/10 border border-amber/20" },
          { label: "Daily Kitchen",       value: formatCurrency(dailyTotal),   icon: ChefHat,       color: "text-emerald-400",  bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Monthly Grocery",     value: formatCurrency(groceryTotal), icon: ShoppingCart,  color: "text-blue-400",     bg: "bg-blue-500/10 border border-blue-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div>
              <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Input type="month" value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); loadMonth(e.target.value); }} className="w-auto" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "daily" | "grocery")} className="space-y-4">
        <TabsList>
          <TabsTrigger value="daily"><ChefHat className="w-3.5 h-3.5 mr-1.5" />Daily Kitchen</TabsTrigger>
          <TabsTrigger value="grocery"><ShoppingCart className="w-3.5 h-3.5 mr-1.5" />Monthly Grocery</TabsTrigger>
        </TabsList>

        {/* ── Daily tab ────────────────────────────────── */}
        <TabsContent value="daily">
          {loadingMonth ? (
            <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />)}</div>
          ) : filteredDaily.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <ChefHat className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No daily entries for this month</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, dayItems]) => (
                <Card key={date}>
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border bg-white/[0.02]">
                      <span className="text-sm font-semibold">{formatDate(date)}</span>
                      <span className="text-sm font-bold text-amber">{formatCurrency(dayItems.reduce((s, i) => s + Number(i.amount), 0))}</span>
                    </div>
                    <div className="divide-y divide-sidebar-border">
                      {dayItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.title}</p>
                            {item.quantity && <p className="text-xs text-muted-foreground">{item.quantity}</p>}
                          </div>
                          <span className="font-semibold text-sm shrink-0">{formatCurrency(item.amount)}</span>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Monthly Grocery tab ───────────────────────── */}
        <TabsContent value="grocery">
          {loadingMonth ? (
            <div className="h-40 bg-white/5 rounded-xl animate-pulse" />
          ) : filteredGrocery.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <ShoppingCart className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No grocery items this month</p>
                <p className="text-sm mt-1">Add bulk items like rice, flour, oil, sugar…</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border bg-white/[0.02]">
                  <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider text-xs">Monthly Grocery List</span>
                  <span className="text-sm font-bold text-blue-400">{formatCurrency(groceryTotal)}</span>
                </div>
                <div className="divide-y divide-sidebar-border">
                  {filteredGrocery.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0">
                        <ShoppingCart className="w-3.5 h-3.5 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.title}</p>
                        {item.quantity && <p className="text-xs text-muted-foreground">{item.quantity}</p>}
                        {item.notes && <p className="text-xs text-muted-foreground italic">{item.notes}</p>}
                      </div>
                      <span className="font-bold text-sm text-blue-400 shrink-0">{formatCurrency(item.amount)}</span>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openGroceryEdit(item)}><Edit2 className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Daily Multi-add Dialog ────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-sidebar-border shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle>Add Daily Entries</DialogTitle>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className="h-8 w-36 text-sm" />
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Selected items */}
            <div className="px-6 pt-4 pb-3">
              {selectedItems.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-muted-foreground/50 text-sm">
                  <ShoppingBasket className="w-4 h-4" /><span>Tap items below to add them here</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_88px_100px_20px] gap-2 px-1">
                    <span className="text-xs text-muted-foreground">Item</span>
                    <span className="text-xs text-muted-foreground">Qty</span>
                    <span className="text-xs text-muted-foreground">Amount (PKR) *</span>
                    <span />
                  </div>
                  {selectedItems.map((item, idx) => (
                    <div key={item.id} className="grid grid-cols-[1fr_88px_100px_20px] gap-2 items-center">
                      <span className="text-sm font-medium truncate" title={item.title}>{item.title}</span>
                      <Input placeholder="e.g. 2kg" value={item.quantity} onChange={(e) => updateSelected(item.id, "quantity", e.target.value)} className="h-8 text-sm" />
                      <Input
                        ref={(el) => { if (el) amountRefs.current.set(item.id, el); else amountRefs.current.delete(item.id); }}
                        type="number" placeholder="0" value={item.amount}
                        onChange={(e) => updateSelected(item.id, "amount", e.target.value)}
                        className="h-8 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") { const next = selectedItems[idx + 1]; if (next) amountRefs.current.get(next.id)?.focus(); } }}
                      />
                      <button onClick={() => removeSelected(item.id)} className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mx-6 border-t border-sidebar-border" />

            {/* Breakfast bundle */}
            <div className="px-6 py-3">
              <div className="rounded-xl border border-amber/20 bg-amber/[0.04] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber tracking-wide">☀️ Breakfast</span>
                  <button onClick={() => { setEditingBreakfast((v) => !v); setNewBreakfastInput(""); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {editingBreakfast ? <><Check className="w-3 h-3" /> Done</> : <><Pencil className="w-3 h-3" /> Edit</>}
                  </button>
                </div>
                {editingBreakfast ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {breakfastItems.map((item) => (
                        <span key={item} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-white/5 border border-sidebar-border text-foreground/80">
                          {item}
                          <button onClick={() => removeBreakfastItem(item)} className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"><X className="w-2.5 h-2.5" /></button>
                        </span>
                      ))}
                      {breakfastItems.length === 0 && <span className="text-xs text-muted-foreground/50">No items — add below</span>}
                    </div>
                    <div className="flex gap-2">
                      <Input placeholder="Add breakfast item…" value={newBreakfastInput} onChange={(e) => setNewBreakfastInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addBreakfastItem(); }} className="h-7 text-xs" />
                      <Button variant="outline" size="sm" onClick={addBreakfastItem} disabled={!newBreakfastInput.trim()} className="h-7 text-xs shrink-0">Add</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {breakfastItems.map((item) => (
                      <span key={item} className={`text-xs px-2 py-0.5 rounded-lg border transition-colors ${selectedTitles.has(item) ? "border-amber/50 bg-amber/15 text-amber" : "border-amber/20 bg-amber/5 text-amber/70"}`}>{item}</span>
                    ))}
                    {breakfastItems.length > 0 && (
                      <button onClick={addBreakfastBundle} disabled={allBreakfastAdded} className="ml-auto text-xs font-semibold text-amber hover:text-amber/80 disabled:opacity-40 disabled:cursor-default transition-colors">
                        {allBreakfastAdded ? "✓ Added" : "+ Add all"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mx-6 border-t border-sidebar-border" />

            {/* Preset grid */}
            <div className="px-6 py-3 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search items…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} className="pl-8 h-8 text-sm" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {filteredPresets.map((preset) => {
                  const selected = selectedTitles.has(preset);
                  return (
                    <button key={preset} onClick={() => selectItem(preset)} className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${selected ? "border-amber/50 bg-amber/15 text-amber font-medium cursor-default" : "border-sidebar-border text-foreground/70 hover:border-amber/30 hover:bg-white/[0.05] hover:text-foreground"}`}>
                      {selected && <span className="mr-1">✓</span>}{preset}
                    </button>
                  );
                })}
                {filteredPresets.length === 0 && <p className="text-xs text-muted-foreground py-1">No items match</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <Input placeholder="Custom item name…" value={customInput} onChange={(e) => setCustomInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCustomItem(); }} className="h-8 text-sm" />
                <Button variant="outline" size="sm" onClick={addCustomItem} disabled={!customInput.trim()} className="shrink-0 h-8">+ Add</Button>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-sidebar-border shrink-0">
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleMultiSave} disabled={savingMulti || validCount === 0} className="bg-amber text-background hover:bg-amber/90 font-semibold">
              {savingMulti ? "Saving…" : validCount > 0 ? `Add ${validCount} Entr${validCount > 1 ? "ies" : "y"}` : "Add Entries"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Monthly Grocery Add/Edit Dialog ──────────── */}
      <Dialog open={groceryOpen} onOpenChange={setGroceryOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-sidebar-border shrink-0">
            <DialogTitle>{groceryEditing ? "Edit Grocery Item" : "Add Grocery Item"}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Quick presets */}
            {!groceryEditing && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Quick select</Label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="Search grocery items…" value={grocerySearch} onChange={(e) => setGrocerySearch(e.target.value)} className="pl-8 h-8 text-sm" />
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto scrollbar-hide">
                  {filteredGroceryPresets.map((p) => (
                    <button key={p} onClick={() => setGroceryForm((f) => ({ ...f, title: p }))}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${groceryForm.title === p ? "border-blue-500/50 bg-blue-500/15 text-blue-400 font-medium" : "border-sidebar-border text-foreground/70 hover:border-blue-500/30 hover:text-foreground"}`}>
                      {p}
                    </button>
                  ))}
                </div>
                <div className="border-t border-sidebar-border pt-3" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Item Name *</Label>
              <Input placeholder="e.g. Rice (Chawal)" value={groceryForm.title} onChange={(e) => setGroceryForm({ ...groceryForm, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input placeholder="e.g. 50kg, 10L" value={groceryForm.quantity} onChange={(e) => setGroceryForm({ ...groceryForm, quantity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (PKR) *</Label>
                <Input type="number" placeholder="0" value={groceryForm.amount} onChange={(e) => setGroceryForm({ ...groceryForm, amount: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Optional…" value={groceryForm.notes} onChange={(e) => setGroceryForm({ ...groceryForm, notes: e.target.value })} rows={2} />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-sidebar-border shrink-0">
            <Button variant="outline" onClick={() => setGroceryOpen(false)}>Cancel</Button>
            <Button onClick={handleGrocerySave} disabled={savingGrocery || !groceryForm.title || !groceryForm.amount} className="bg-blue-500/90 hover:bg-blue-500 text-white">
              {savingGrocery ? "Saving…" : groceryEditing ? "Update" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Daily Edit Dialog ─────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Kitchen Entry</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5"><Label>Item Name *</Label><Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5"><Label>Quantity</Label><Input placeholder="e.g. 2 kg" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Amount (PKR) *</Label><Input type="number" placeholder="0" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Optional…" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={savingEdit || !editForm.title || !editForm.amount}>{savingEdit ? "Saving…" : "Update"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
