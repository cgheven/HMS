"use client";
import { useState, useEffect } from "react";
import { Plus, ChefHat, Search, Edit2, Trash2, TrendingDown, CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { KitchenExpense } from "@/types";

const emptyForm = { title: "", amount: "", date: formatDateInput(new Date()), notes: "" };

interface Props { hostelId: string | null; initialItems: KitchenExpense[]; defaultMonth: string; }

export function KitchenClient({ hostelId, initialItems, defaultMonth }: Props) {
  const [items, setItems] = useState<KitchenExpense[]>(initialItems);
  const [filtered, setFiltered] = useState<KitchenExpense[]>(initialItems);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KitchenExpense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(items.filter((i) => i.title.toLowerCase().includes(q)));
  }, [search, items]);

  async function loadMonth(month: string) {
    if (!hostelId) return;
    setLoadingMonth(true);
    const supabase = createClient();
    const [year, m] = month.split("-");
    const start = `${year}-${m}-01`;
    const end = formatDateInput(new Date(parseInt(year), parseInt(m), 0));
    const { data, error } = await supabase.from("hms_kitchen_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else setItems((data as KitchenExpense[]) ?? []);
    setLoadingMonth(false);
  }

  async function reload() { await loadMonth(monthFilter); }

  async function handleSave() {
    if (!hostelId || !form.title || !form.amount) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, title: form.title, amount: parseFloat(form.amount), date: form.date, notes: form.notes || null };
    const { error } = editing ? await supabase.from("hms_kitchen_expenses").update(payload).eq("id", editing.id) : await supabase.from("hms_kitchen_expenses").insert(payload);
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

  const total = filtered.reduce((s, i) => s + Number(i.amount), 0);
  const dailyAvg = filtered.length ? total / new Set(filtered.map((i) => i.date)).size : 0;
  const grouped = filtered.reduce<Record<string, KitchenExpense[]>>((acc, item) => { (acc[item.date] = acc[item.date] ?? []).push(item); return acc; }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Kitchen</h1><p className="text-muted-foreground text-sm mt-1">Track daily kitchen expenditures</p></div>
        <Button onClick={() => { setEditing(null); setForm(emptyForm); setDialogOpen(true); }} className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add Entry</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total This Month", value: formatCurrency(total), icon: TrendingDown, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Daily Average", value: formatCurrency(dailyAvg), icon: CalendarDays, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Total Entries", value: filtered.length, icon: ChefHat, color: "text-green-600", bg: "bg-green-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}><CardContent className="p-4 flex items-center gap-3"><div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <Input type="month" value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); loadMonth(e.target.value); }} className="w-auto" />
      </div>

      {loadingMonth ? (
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground"><ChefHat className="w-10 h-10 mb-3 opacity-30" /><p className="font-medium">No kitchen entries found</p></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, dayItems]) => (
            <Card key={date}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                  <span className="text-sm font-semibold">{formatDate(date)}</span>
                  <span className="text-sm font-bold text-amber-600">{formatCurrency(dayItems.reduce((s, i) => s + Number(i.amount), 0))}</span>
                </div>
                <div className="divide-y">
                  {dayItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium">{item.title}</p>{item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}</div>
                      <span className="font-semibold text-sm shrink-0">{formatCurrency(item.amount)}</span>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(item); setForm({ title: item.title, amount: item.amount.toString(), date: item.date, notes: item.notes ?? "" }); setDialogOpen(true); }}><Edit2 className="w-3 h-3" /></Button>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Entry" : "Add Kitchen Entry"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5"><Label>Item / Title *</Label><Input placeholder="e.g. Vegetables" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Amount (PKR) *</Label><Input type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Optional..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title || !form.amount}>{saving ? "Saving..." : editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
