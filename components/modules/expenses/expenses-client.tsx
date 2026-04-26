"use client";
import { useState, useEffect } from "react";
import { Plus, Receipt, Search, Edit2, Trash2, TrendingDown, Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { Expense, ExpenseCategory } from "@/types";

const categories: ExpenseCategory[] = ["furniture", "repairs", "cleaning", "security", "utilities", "other"];
const categoryColors: Record<ExpenseCategory, "info" | "warning" | "success" | "secondary" | "default" | "outline"> = { furniture: "info", repairs: "warning", cleaning: "success", security: "secondary", utilities: "default", other: "outline" };
const emptyForm = { title: "", amount: "", category: "other" as ExpenseCategory, date: formatDateInput(new Date()), notes: "" };

interface Props { hostelId: string | null; initialExpenses: Expense[]; defaultMonth: string; }

export function ExpensesClient({ hostelId, initialExpenses, defaultMonth }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [filtered, setFiltered] = useState<Expense[]>(initialExpenses);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let list = expenses;
    if (search) list = list.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()));
    if (filterCat !== "all") list = list.filter((e) => e.category === filterCat);
    setFiltered(list);
  }, [search, filterCat, expenses]);

  async function loadMonth(month: string) {
    if (!hostelId) return;
    setLoadingMonth(true);
    const supabase = createClient();
    const [year, m] = month.split("-");
    const start = `${year}-${m}-01`;
    const end = formatDateInput(new Date(parseInt(year), parseInt(m), 0));
    const { data, error } = await supabase.from("hms_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else setExpenses((data as Expense[]) ?? []);
    setLoadingMonth(false);
  }

  async function reload() { await loadMonth(monthFilter); }

  async function handleSave() {
    if (!hostelId || !form.title || !form.amount) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, title: form.title, amount: parseFloat(form.amount), category: form.category, date: form.date, notes: form.notes || null };
    const { error } = editing ? await supabase.from("hms_expenses").update(payload).eq("id", editing.id) : await supabase.from("hms_expenses").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editing ? "Updated" : "Added" }); setDialogOpen(false); reload(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_expenses").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); reload(); }
  }

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Expenses</h1><p className="text-muted-foreground text-sm mt-1">Track hostel expenditures</p></div>
        <Button onClick={() => { setEditing(null); setForm(emptyForm); setDialogOpen(true); }} className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add Expense</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total This Month", value: formatCurrency(total), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
          { label: "Total Entries", value: filtered.length, icon: Receipt, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Average", value: filtered.length ? formatCurrency(total / filtered.length) : "—", icon: Filter, color: "text-purple-600", bg: "bg-purple-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}><CardContent className="p-4 flex items-center gap-3"><div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <Input type="month" value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); loadMonth(e.target.value); }} className="w-auto" />
        <Select value={filterCat} onValueChange={setFilterCat}><SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent></Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loadingMonth ? (
            <div className="p-8 space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><Receipt className="w-10 h-10 mb-3 opacity-30" /><p className="font-medium">No expenses found</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b bg-muted/30"><th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Title</th><th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Category</th><th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Date</th><th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Amount</th><th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th></tr></thead>
                <tbody className="divide-y">
                  {filtered.map((exp) => (
                    <tr key={exp.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3"><p className="font-medium text-sm">{exp.title}</p>{exp.notes && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{exp.notes}</p>}</td>
                      <td className="px-4 py-3 hidden sm:table-cell"><Badge variant={categoryColors[exp.category]} className="capitalize text-xs">{exp.category}</Badge></td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{formatDate(exp.date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-sm">{formatCurrency(exp.amount)}</td>
                      <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(exp); setForm({ title: exp.title, amount: exp.amount.toString(), category: exp.category, date: exp.date, notes: exp.notes ?? "" }); setDialogOpen(true); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(exp.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t bg-muted/30"><td colSpan={3} className="px-4 py-3 text-sm font-semibold">Total</td><td className="px-4 py-3 text-right font-bold">{formatCurrency(total)}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Expense" : "Add Expense"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5"><Label>Title *</Label><Input placeholder="e.g. Chair purchase" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Amount (PKR) *</Label><Input type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Category</Label><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as ExpenseCategory })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
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
