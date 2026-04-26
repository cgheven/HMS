"use client";
import { useState, useMemo } from "react";
import { Plus, ChefHat, Search, Edit2, Trash2, TrendingDown, CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { KitchenExpense } from "@/types";

// Predefined grocery/kitchen items common in Pakistani hostels
const KITCHEN_PRESETS = [
  "Rice (Chawal)", "Flour (Atta)", "Bread / Naan",
  "Dal (Lentils)", "Masoor Dal", "Chana Dal", "Mash Dal",
  "Chicken", "Beef (Gosht)", "Mutton", "Fish (Machli)", "Eggs (Anda)",
  "Vegetables (Sabzi)", "Potatoes (Aloo)", "Onions (Pyaz)", "Tomatoes",
  "Garlic & Ginger", "Green Chilli", "Coriander (Dhaniya)", "Lemon",
  "Cooking Oil", "Ghee / Butter", "Milk (Doodh)", "Yogurt (Dahi)",
  "Sugar (Cheeni)", "Salt (Namak)", "Tea Leaves (Chai Patti)",
  "Spices / Masala", "Biryani Rice (Basmati)", "Chickpeas (Chana)",
  "Other (Custom)",
];

const CUSTOM = "Other (Custom)";

const emptyForm = {
  preset: "",
  customTitle: "",
  quantity: "",
  amount: "",
  date: formatDateInput(new Date()),
  notes: "",
};

interface Props { hostelId: string | null; initialItems: KitchenExpense[]; defaultMonth: string; }

const kitchenCache = new Map<string, KitchenExpense[]>();

export function KitchenClient({ hostelId, initialItems, defaultMonth }: Props) {
  const [items, setItems] = useState<KitchenExpense[]>(initialItems);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KitchenExpense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Resolve actual title from form
  const resolvedTitle = form.preset === CUSTOM ? form.customTitle.trim() : form.preset;
  const canSave = !!resolvedTitle && !!form.amount;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [search, items]);

  async function loadMonth(month: string) {
    if (!hostelId) return;
    const cacheKey = `${hostelId}:${month}`;
    if (kitchenCache.has(cacheKey)) { setItems(kitchenCache.get(cacheKey)!); return; }
    setLoadingMonth(true);
    const supabase = createClient();
    const [year, m] = month.split("-");
    const start = `${year}-${m}-01`;
    const end = formatDateInput(new Date(parseInt(year), parseInt(m), 0));
    const { data, error } = await supabase.from("hms_kitchen_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else { const rows = (data as KitchenExpense[]) ?? []; kitchenCache.set(cacheKey, rows); setItems(rows); }
    setLoadingMonth(false);
  }

  async function reload() {
    if (!hostelId) return;
    kitchenCache.delete(`${hostelId}:${monthFilter}`);
    await loadMonth(monthFilter);
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, date: formatDateInput(new Date()) });
    setDialogOpen(true);
  }

  function openEdit(item: KitchenExpense) {
    setEditing(item);
    const isPreset = KITCHEN_PRESETS.includes(item.title);
    setForm({
      preset: isPreset ? item.title : CUSTOM,
      customTitle: isPreset ? "" : item.title,
      quantity: item.quantity ?? "",
      amount: item.amount.toString(),
      date: item.date,
      notes: item.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!hostelId || !canSave) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, title: resolvedTitle, quantity: form.quantity || null, amount: parseFloat(form.amount), date: form.date, notes: form.notes || null };
    const { error } = editing
      ? await supabase.from("hms_kitchen_expenses").update(payload).eq("id", editing.id)
      : await supabase.from("hms_kitchen_expenses").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editing ? "Updated" : "Added" }); setDialogOpen(false); reload(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this entry?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_kitchen_expenses").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); reload(); }
  }

  const { total, dailyAvg, grouped } = useMemo(() => {
    const total = filtered.reduce((s, i) => s + Number(i.amount), 0);
    const dailyAvg = filtered.length ? total / new Set(filtered.map((i) => i.date)).size : 0;
    const grouped = filtered.reduce<Record<string, KitchenExpense[]>>((acc, item) => {
      (acc[item.date] = acc[item.date] ?? []).push(item);
      return acc;
    }, {});
    return { total, dailyAvg, grouped };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Kitchen</h1>
          <p className="text-muted-foreground text-sm mt-1">Track daily kitchen expenditures</p>
        </div>
        <Button onClick={openAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Add Entry
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total This Month", value: formatCurrency(total), icon: TrendingDown, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
          { label: "Daily Average", value: formatCurrency(dailyAvg), icon: CalendarDays, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
          { label: "Total Entries", value: filtered.length, icon: ChefHat, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
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

      {/* List */}
      {loadingMonth ? (
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ChefHat className="w-10 h-10 mb-3 opacity-30" /><p className="font-medium">No kitchen entries found</p>
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
                        <div className="flex flex-wrap gap-x-2 mt-0.5">
                          {item.quantity && <span className="text-xs text-muted-foreground">{item.quantity}</span>}
                          {item.notes && <span className="text-xs text-muted-foreground italic">{item.notes}</span>}
                        </div>
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

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Kitchen Entry" : "Add Kitchen Entry"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">

            {/* Item dropdown */}
            <div className="space-y-1.5">
              <Label>Item *</Label>
              <Select value={form.preset} onValueChange={(v) => setForm({ ...form, preset: v, customTitle: "" })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an item…" />
                </SelectTrigger>
                <SelectContent>
                  {KITCHEN_PRESETS.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom title — only shown if "Other (Custom)" is selected */}
            {form.preset === CUSTOM && (
              <div className="space-y-1.5">
                <Label>Custom Item Name *</Label>
                <Input
                  placeholder="Enter item name…"
                  value={form.customTitle}
                  onChange={(e) => setForm({ ...form, customTitle: e.target.value })}
                  autoFocus
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input placeholder="e.g. 2 kg" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (PKR) *</Label>
                <Input type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Optional…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !canSave}>
              {saving ? "Saving…" : editing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
