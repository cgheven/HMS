"use client";
import { useState, useEffect } from "react";
import { Plus, FileText, Search, Edit2, Trash2, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
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
import { formatCurrency, formatDate, formatDateInput, capitalize } from "@/lib/utils";
import type { Bill, BillCategory, BillStatus } from "@/types";

const categories: BillCategory[] = ["electricity", "water", "internet", "gas", "maintenance", "other"];
const categoryIcons: Record<BillCategory, string> = { electricity: "⚡", water: "💧", internet: "🌐", gas: "🔥", maintenance: "🔧", other: "📋" };
const statusConfig: Record<BillStatus, { label: string; icon: typeof CheckCircle2; badge: "success" | "warning" | "destructive" }> = {
  paid: { label: "Paid", icon: CheckCircle2, badge: "success" },
  unpaid: { label: "Unpaid", icon: Clock, badge: "warning" },
  overdue: { label: "Overdue", icon: AlertTriangle, badge: "destructive" },
};
const emptyForm = { title: "", category: "electricity" as BillCategory, amount: "", due_date: formatDateInput(new Date()), paid_date: "", status: "unpaid" as BillStatus, notes: "" };

interface Props { hostelId: string | null; initialBills: Bill[]; }

export function BillsClient({ hostelId, initialBills }: Props) {
  const [bills, setBills] = useState<Bill[]>(initialBills);
  const [filtered, setFiltered] = useState<Bill[]>(initialBills);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let list = bills;
    if (search) list = list.filter((b) => b.title.toLowerCase().includes(search.toLowerCase()) || b.category.includes(search.toLowerCase()));
    if (statusFilter !== "all") list = list.filter((b) => b.status === statusFilter);
    setFiltered(list);
  }, [search, statusFilter, bills]);

  async function reload() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_bills").select("*").eq("hostel_id", hostelId).order("due_date", { ascending: false });
    setBills((data as Bill[]) ?? []);
  }

  async function handleSave() {
    if (!hostelId || !form.title || !form.amount) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, title: form.title, category: form.category, amount: parseFloat(form.amount), due_date: form.due_date, paid_date: form.paid_date || null, status: form.status, notes: form.notes || null };
    const { error } = editing ? await supabase.from("hms_bills").update(payload).eq("id", editing.id) : await supabase.from("hms_bills").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editing ? "Bill updated" : "Bill added" }); setDialogOpen(false); reload(); }
    setSaving(false);
  }

  async function markPaid(bill: Bill) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_bills").update({ status: "paid", paid_date: formatDateInput(new Date()) }).eq("id", bill.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Marked as paid" }); reload(); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this bill?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_bills").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); reload(); }
  }

  const totals = {
    unpaid: bills.filter((b) => b.status !== "paid").reduce((s, b) => s + Number(b.amount), 0),
    paid: bills.filter((b) => b.status === "paid").reduce((s, b) => s + Number(b.amount), 0),
    overdue: bills.filter((b) => b.status === "overdue").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Bills</h1><p className="text-muted-foreground text-sm mt-1">Track utility and other bills</p></div>
        <Button onClick={() => { setEditing(null); setForm(emptyForm); setDialogOpen(true); }} className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add Bill</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Pending Amount", value: formatCurrency(totals.unpaid), icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50" },
          { label: "Paid This Period", value: formatCurrency(totals.paid), icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
          { label: "Overdue Bills", value: totals.overdue, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}><CardContent className="p-4 flex items-center gap-3"><div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search bills..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem></SelectContent></Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><FileText className="w-10 h-10 mb-3 opacity-30" /><p className="font-medium">No bills found</p></div>
          ) : (
            <div className="divide-y">
              {filtered.map((bill) => {
                const cfg = statusConfig[bill.status];
                return (
                  <div key={bill.id} className="flex items-center gap-3 px-4 py-4 hover:bg-muted/20 transition-colors">
                    <div className="text-2xl shrink-0">{categoryIcons[bill.category]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-sm">{bill.title}</p><Badge variant={cfg.badge} className="text-xs">{cfg.label}</Badge></div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5"><span className="text-xs text-muted-foreground capitalize">{bill.category}</span><span className="text-xs text-muted-foreground">Due: {formatDate(bill.due_date)}</span>{bill.paid_date && <span className="text-xs text-muted-foreground">Paid: {formatDate(bill.paid_date)}</span>}</div>
                    </div>
                    <div className="text-right shrink-0"><p className="font-bold text-sm">{formatCurrency(bill.amount)}</p></div>
                    <div className="flex items-center gap-1 shrink-0">
                      {bill.status !== "paid" && <Button variant="outline" size="sm" className="h-8 text-xs gap-1 text-green-600 hover:text-green-700 border-green-200" onClick={() => markPaid(bill)}><CheckCircle2 className="w-3 h-3" /> Pay</Button>}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(bill); setForm({ title: bill.title, category: bill.category, amount: bill.amount.toString(), due_date: bill.due_date, paid_date: bill.paid_date ?? "", status: bill.status, notes: bill.notes ?? "" }); setDialogOpen(true); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(bill.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Bill" : "Add Bill"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5"><Label>Title *</Label><Input placeholder="e.g. Electricity Bill" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Category</Label><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as BillCategory })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{categoryIcons[c]} {capitalize(c)}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Amount (PKR) *</Label><Input type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as BillStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem></SelectContent></Select></div>
            </div>
            {form.status === "paid" && <div className="space-y-1.5"><Label>Paid Date</Label><Input type="date" value={form.paid_date} onChange={(e) => setForm({ ...form, paid_date: e.target.value })} /></div>}
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
