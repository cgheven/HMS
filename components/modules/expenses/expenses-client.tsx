"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Receipt, Search, Edit2, Trash2, TrendingDown, Filter, Download, X } from "lucide-react";
import { addExpenseAsManager, updateExpenseAsManager } from "@/app/actions/managers";
import * as XLSX from "xlsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import type { Expense, ExpenseCategory, PartnerTier, StaffPermission } from "@/types";

const categories: ExpenseCategory[] = ["furniture", "repairs", "cleaning", "security", "utilities", "other"];
const categoryColors: Record<ExpenseCategory, "info" | "warning" | "success" | "secondary" | "default" | "outline"> = { furniture: "info", repairs: "warning", cleaning: "success", security: "secondary", utilities: "default", other: "outline" };
const emptyForm = { title: "", amount: "", category: "other" as ExpenseCategory, date: formatDateInput(new Date()), notes: "" };

const QUICK_ITEMS: { label: string; category: ExpenseCategory }[] = [
  // Furniture
  { label: "Chair",         category: "furniture" },
  { label: "Table",         category: "furniture" },
  { label: "Bed / Mattress", category: "furniture" },
  { label: "Almirah",       category: "furniture" },
  { label: "Curtains",      category: "furniture" },
  { label: "Shelf / Rack",  category: "furniture" },
  // Repairs
  { label: "Plumbing",      category: "repairs"   },
  { label: "Electrical",    category: "repairs"   },
  { label: "Paint / Whitewash", category: "repairs" },
  { label: "AC Repair",     category: "repairs"   },
  { label: "Fan Repair",    category: "repairs"   },
  { label: "Door / Lock",   category: "repairs"   },
  { label: "Tile / Floor",  category: "repairs"   },
  // Cleaning
  { label: "Cleaning Supplies", category: "cleaning" },
  { label: "Phenyl",        category: "cleaning"  },
  { label: "Detergent",     category: "cleaning"  },
  { label: "Dustbin",       category: "cleaning"  },
  // Security
  { label: "Lock / Keys",   category: "security"  },
  { label: "CCTV",          category: "security"  },
  // Utilities
  { label: "Generator Fuel", category: "utilities" },
  { label: "Gas Cylinder",  category: "utilities" },
  { label: "UPS Battery",   category: "utilities" },
  { label: "Water Filter",  category: "utilities" },
  // Other
  { label: "Miscellaneous", category: "other"     },
];

const CHIP_STYLES: Record<ExpenseCategory, string> = {
  furniture: "bg-blue-500/10  border-blue-500/25  text-blue-400  hover:bg-blue-500/20",
  repairs:   "bg-amber-500/10 border-amber-500/25 text-amber-400 hover:bg-amber-500/20",
  cleaning:  "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20",
  security:  "bg-slate-500/10  border-slate-500/25  text-slate-400  hover:bg-slate-500/20",
  utilities: "bg-purple-500/10 border-purple-500/25 text-purple-400 hover:bg-purple-500/20",
  other:     "bg-white/5       border-white/10      text-muted-foreground hover:bg-white/10",
};

interface Props { hostelId: string | null; initialExpenses: Expense[]; defaultMonth: string; partnerTier?: PartnerTier | null; managerPermissions?: StaffPermission[] | null; }

// Module-level cache — persists across month switches within the session
const expenseCache = new Map<string, Expense[]>();

export function ExpensesClient({ hostelId, initialExpenses, defaultMonth, partnerTier = null, managerPermissions = null }: Props) {
  const router = useRouter();
  const canStandardTier = !partnerTier || partnerTier !== "read_only";
  const isManager = !!managerPermissions;
  const canAddExpense = managerPermissions?.includes("add_expenses") ?? false;
  const canEditExpense = managerPermissions?.includes("edit_expenses") ?? false;
  const canAdd = isManager ? canAddExpense : canStandardTier;
  const canEdit = isManager ? canEditExpense : canStandardTier;
  // Delete is never available to a manager — no delete permission exists for expenses.
  const canDelete = canStandardTier && !isManager;
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = expenses;
    if (customFrom) list = list.filter((e) => e.date >= customFrom);
    if (customTo) list = list.filter((e) => e.date <= customTo);
    if (search) list = list.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()));
    if (filterCat !== "all") list = list.filter((e) => e.category === filterCat);
    return list;
  }, [search, filterCat, customFrom, customTo, expenses]);

  // Managers have no RLS read access — the browser client returns nothing for
  // them, so their list is refetched server-side and arrives as a new prop.
  useEffect(() => {
    if (isManager) setExpenses(initialExpenses);
  }, [isManager, initialExpenses]);

  async function loadMonth(month: string) {
    if (isManager) {
      const params = new URLSearchParams(window.location.search);
      params.set("month", month);
      router.replace(`${window.location.pathname}?${params.toString()}`);
      router.refresh();
      return;
    }
    if (!hostelId) return;
    const cacheKey = `${hostelId}:${month}`;
    if (expenseCache.has(cacheKey)) {
      setExpenses(expenseCache.get(cacheKey)!);
      return;
    }
    setLoadingMonth(true);
    const supabase = createClient();
    const [year, m] = month.split("-");
    const start = `${year}-${m}-01`;
    const end = formatDateInput(new Date(parseInt(year), parseInt(m), 0));
    const { data, error } = await supabase.from("hms_expenses").select("*").eq("hostel_id", hostelId).gte("date", start).lte("date", end).order("date", { ascending: false }).order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else {
      const rows = (data as Expense[]) ?? [];
      expenseCache.set(cacheKey, rows);
      setExpenses(rows);
    }
    setLoadingMonth(false);
  }

  async function reload() {
    if (isManager) { router.refresh(); return; }
    if (!hostelId) return;
    // Invalidate cache for current month so mutations reflect immediately
    expenseCache.delete(`${hostelId}:${monthFilter}`);
    await loadMonth(monthFilter);
  }

  async function handleSave() {
    if (!form.title || !form.amount) return;

    if (isManager) {
      // The write goes through the admin-client action, which resolves the
      // hostel id server-side from the manager's active branch.
      setSaving(true);
      const result = editing
        ? await updateExpenseAsManager(editing.id, form.category, parseFloat(form.amount), form.title, form.date, form.notes)
        : await addExpenseAsManager(form.category, parseFloat(form.amount), form.title, form.date, form.notes);
      if (result.error) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        setSaving(false);
        return;
      }
      toast({ title: editing ? "Updated" : "Added" });
      setDialogOpen(false);
      await reload();
      setSaving(false);
      return;
    }

    if (!hostelId) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, title: form.title, amount: parseFloat(form.amount), category: form.category, date: form.date, notes: form.notes || null };
    if (editing) {
      const { data, error } = await supabase.from("hms_expenses").update(payload).eq("id", editing.id).select("id");
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
      if (!data || data.length === 0) {
        toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
        setSaving(false);
        return;
      }
      toast({ title: "Updated" });
      setDialogOpen(false);
      reload();
    } else {
      const { error } = await supabase.from("hms_expenses").insert(payload);
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
      else { toast({ title: "Added" }); setDialogOpen(false); reload(); }
    }
    setSaving(false);
  }

  function quickAdd(item: { label: string; category: ExpenseCategory }) {
    setEditing(null);
    setForm({ ...emptyForm, title: item.label, category: item.category });
    setDialogOpen(true);
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_expenses").delete().eq("id", id).select("id");
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) {
      toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" });
      return;
    }
    toast({ title: "Deleted" });
    reload();
  }

  function exportToExcel() {
    const rows = filtered.map((e) => ({
      Date: e.date,
      Title: e.title,
      Category: e.category,
      "Amount (PKR)": e.amount,
      Notes: e.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expenses");
    const label = customFrom ? `${customFrom}_to_${customTo || customFrom}` : monthFilter;
    XLSX.writeFile(wb, `expenses-${label}.xlsx`);
  }

  const total = useMemo(() => filtered.reduce((s, e) => s + Number(e.amount), 0), [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-serif font-normal tracking-tight">Expenses</h1><p className="text-muted-foreground text-sm mt-1">Track hostel expenditures</p></div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={exportToExcel} disabled={filtered.length === 0} className="gap-2 flex-1 sm:flex-none"><Download className="w-4 h-4" /> Export Excel</Button>
          {canAdd && (
            <Button onClick={() => { setEditing(null); setForm(emptyForm); setDialogOpen(true); }} className="gap-2 flex-1 sm:flex-none"><Plus className="w-4 h-4" /> Add Expense</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: customFrom ? "Total (Range)" : "Total This Month", value: formatCurrency(total), icon: TrendingDown, color: "text-rose-400", bg: "bg-rose-500/10 border border-rose-500/20" },
          { label: "Total Entries", value: filtered.length, icon: Receipt, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
          { label: "Average", value: filtered.length ? formatCurrency(total / filtered.length) : "—", icon: Filter, color: "text-purple-400", bg: "bg-purple-500/10 border border-purple-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}><CardContent className="p-4 flex items-center gap-3"><div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>
        ))}
      </div>

      {/* Quick Add */}
      {canAdd && (
      <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick Add</p>
          <span className="text-xs text-muted-foreground/50">— tap to pre-fill the form</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => quickAdd(item)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${CHIP_STYLES[item.category]}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="space-y-3">
        {/* Row 1: search + month + category */}
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
          <Input type="month" value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setCustomFrom(""); setCustomTo(""); loadMonth(e.target.value); }} className="w-auto" />
          <Select value={filterCat} onValueChange={setFilterCat}><SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent></Select>
        </div>

        {/* Row 2: date range */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Date range:</span>
          <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs w-36" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs w-36" />
          {(customFrom || customTo) && (
            <button type="button" onClick={() => { setCustomFrom(""); setCustomTo(""); }} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
                <thead><tr className="border-b bg-muted/30"><th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Title</th><th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Category</th><th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Date</th><th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Amount</th><th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">{(canEdit || canDelete) ? "Actions" : ""}</th></tr></thead>
                <tbody className="divide-y">
                  {filtered.map((exp) => (
                    <tr key={exp.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3"><p className="font-medium text-sm">{exp.title}</p>{exp.notes && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{exp.notes}</p>}</td>
                      <td className="px-4 py-3 hidden sm:table-cell"><Badge variant={categoryColors[exp.category]} className="capitalize text-xs">{exp.category}</Badge></td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{formatDate(exp.date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-sm">{formatCurrency(exp.amount)}</td>
                      <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(exp); setForm({ title: exp.title, amount: exp.amount.toString(), category: exp.category, date: exp.date, notes: exp.notes ?? "" }); setDialogOpen(true); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(exp.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        )}
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

      <ConfirmDialog
        open={!!deleteId}
        description="This expense entry will be permanently deleted."
        onConfirm={() => { handleDelete(deleteId!); setDeleteId(null); }}
        onCancel={() => setDeleteId(null)}
      />

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
