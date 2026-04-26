"use client";
import { useState, useMemo } from "react";
import {
  CreditCard, CheckCircle2, Clock, AlertTriangle, Wallet,
  TrendingUp, Plus, Edit2, Banknote,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { Payment, PaymentMethod, PaymentStatus, Tenant, Room } from "@/types";

interface TenantRow { id: string; full_name: string; monthly_rent: number; room_id: string | null; is_active: boolean; }
interface RoomRow { id: string; room_number: string; floor: number | null; }

interface Props {
  hostelId: string | null;
  payments: Payment[];
  tenants: TenantRow[];
  rooms: RoomRow[];
  initialMonth: string;
}

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Cash", bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash", easypaisa: "Easypaisa",
  sadapay: "SadaPay", other: "Other",
};

const statusConfig: Record<PaymentStatus, { label: string; color: string }> = {
  paid: { label: "Paid", color: "text-emerald-400" },
  pending: { label: "Pending", color: "text-amber" },
  overdue: { label: "Overdue", color: "text-rose-400" },
  waived: { label: "Waived", color: "text-muted-foreground" },
};

function genReceipt(tenantName: string, month: string) {
  const initials = tenantName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `HMS-${month.replace("-", "")}-${initials}-${rand}`;
}

export function PaymentsClient({ hostelId, payments: initialPayments, tenants, rooms, initialMonth }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [allHistory, setAllHistory] = useState<Payment[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [tab, setTab] = useState("monthly");
  const [markDialog, setMarkDialog] = useState<Payment | null>(null);
  const [markForm, setMarkForm] = useState({ method: "cash" as PaymentMethod, date: formatDateInput(new Date()), late_fee: "0", notes: "", receipt_number: "" });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

  async function loadMonth(month: string) {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id)")
      .eq("hostel_id", hostelId).eq("for_month", month)
      .order("created_at", { ascending: false });
    setPayments((data ?? []) as Payment[]);
  }

  async function loadHistory() {
    if (!hostelId || historyLoaded) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_payments")
      .select("*, tenant:hms_tenants(full_name, room_id)")
      .eq("hostel_id", hostelId)
      .order("for_month", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    setAllHistory((data ?? []) as Payment[]);
    setHistoryLoaded(true);
  }

  async function handleMonthChange(month: string) {
    setSelectedMonth(month);
    await loadMonth(month);
  }

  async function generatePayments() {
    if (!hostelId) return;
    const activeTenants = tenants.filter((t) => t.is_active);
    if (activeTenants.length === 0) { toast({ title: "No active tenants" }); return; }
    setGenerating(true);
    const supabase = createClient();
    const rows = activeTenants.map((t) => ({
      hostel_id: hostelId,
      tenant_id: t.id,
      for_month: selectedMonth,
      amount: t.monthly_rent,
      status: "pending" as PaymentStatus,
    }));
    const { error } = await supabase.from("hms_payments").upsert(rows, { onConflict: "tenant_id,for_month", ignoreDuplicates: true });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: `Generated ${rows.length} payment records` }); await loadMonth(selectedMonth); }
    setGenerating(false);
  }

  function openMarkPaid(p: Payment) {
    const tenantName = p.tenant?.full_name ?? "";
    setMarkDialog(p);
    setMarkForm({
      method: "cash",
      date: formatDateInput(new Date()),
      late_fee: p.late_fee?.toString() ?? "0",
      notes: "",
      receipt_number: genReceipt(tenantName, p.for_month),
    });
  }

  async function handleMarkPaid() {
    if (!markDialog) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_payments").update({
      status: "paid",
      payment_method: markForm.method,
      payment_date: markForm.date,
      late_fee: parseFloat(markForm.late_fee) || 0,
      notes: markForm.notes || null,
      receipt_number: markForm.receipt_number,
    }).eq("id", markDialog.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Payment recorded" }); setMarkDialog(null); await loadMonth(selectedMonth); }
    setSaving(false);
  }

  async function markWaived(p: Payment) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_payments").update({ status: "waived" }).eq("id", p.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Payment waived" });
    await loadMonth(selectedMonth);
  }

  async function markOverdue(p: Payment) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_payments").update({ status: "overdue" }).eq("id", p.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Marked as overdue" });
    await loadMonth(selectedMonth);
  }

  const stats = useMemo(() => {
    const due = payments.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);
    const collected = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);
    const pending = payments.filter((p) => p.status === "pending" || p.status === "overdue").reduce((s, p) => s + Number(p.amount), 0);
    return { due, collected, pending, rate: due > 0 ? Math.round((collected / due) * 100) : 0 };
  }, [payments]);

  // Tenants without a payment record for selected month (for display in the "missing" hint)
  const tenantPaymentMap = useMemo(() => Object.fromEntries(payments.map((p) => [p.tenant_id, p])), [payments]);
  const activeTenants = tenants.filter((t) => t.is_active);
  const missingCount = activeTenants.filter((t) => !tenantPaymentMap[t.id]).length;

  function PaymentRow({ p }: { p: Payment }) {
    const room = p.tenant?.room_id ? roomMap[p.tenant.room_id] : null;
    const cfg = statusConfig[p.status];
    const isLate = (p.status === "pending" || p.status === "overdue") && p.for_month < selectedMonth;
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{p.tenant?.full_name ?? "—"}</p>
            {room && <span className="text-xs text-muted-foreground">Rm {room.room_number}</span>}
            {isLate && <span className="text-xs text-rose-400 font-medium">Late</span>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {p.payment_date && <span className="text-xs text-muted-foreground">Paid: {formatDate(p.payment_date)}</span>}
            {p.payment_method && <span className="text-xs text-muted-foreground">{methodLabels[p.payment_method]}</span>}
            {p.receipt_number && <span className="text-xs text-muted-foreground">{p.receipt_number}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(p.amount) + Number(p.late_fee || 0))}</p>
          {Number(p.late_fee) > 0 && <p className="text-xs text-rose-400">+{formatCurrency(p.late_fee)} late</p>}
          <p className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {p.status !== "paid" && p.status !== "waived" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20" onClick={() => openMarkPaid(p)}>
                <CheckCircle2 className="w-3 h-3" /> Pay
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => markOverdue(p)}>
                <AlertTriangle className="w-3 h-3" />
              </Button>
            </>
          )}
          {p.status === "pending" && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => markWaived(p)}>
              <Edit2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Payments</h1>
          <p className="text-muted-foreground text-sm mt-1">Monthly rent collection</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="month" value={selectedMonth} onChange={(e) => handleMonthChange(e.target.value)} className="w-auto" />
          <Button onClick={generatePayments} disabled={generating} variant="outline" className="gap-2 border-amber/30 text-amber hover:bg-amber/10">
            <Plus className="w-4 h-4" /> {generating ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Due", value: formatCurrency(stats.due), icon: CreditCard, color: "text-foreground", bg: "bg-white/5 border border-white/10" },
          { label: "Collected", value: formatCurrency(stats.collected), icon: Wallet, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Pending", value: formatCurrency(stats.pending), icon: Clock, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
          { label: "Collection Rate", value: `${stats.rate}%`, icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${bg} shrink-0`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold text-foreground leading-none mt-0.5">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {missingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber/20 bg-amber/5 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber shrink-0" />
          <p className="text-sm text-amber">{missingCount} active tenant{missingCount > 1 ? "s" : ""} have no payment record for this month. Click <strong>Generate</strong> to create them.</p>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v === "history") loadHistory(); }}>
        <TabsList>
          <TabsTrigger value="monthly"><Banknote className="w-3.5 h-3.5" /> Monthly View</TabsTrigger>
          <TabsTrigger value="history"><Clock className="w-3.5 h-3.5" /> All History</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <CreditCard className="w-10 h-10 opacity-20" />
                <p className="text-sm">No payment records for this month</p>
                <p className="text-xs">Click Generate to create records for all active tenants</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {payments.map((p) => <PaymentRow key={p.id} p={p} />)}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {!historyLoaded ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading history…</div>
            ) : allHistory.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">No payment history yet</div>
            ) : (
              <div className="p-2 space-y-1">
                {allHistory.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-white/[0.03]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.tenant?.full_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{p.for_month}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                      <p className={`text-xs ${statusConfig[p.status].color}`}>{statusConfig[p.status].label}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Mark Paid Dialog */}
      <Dialog open={!!markDialog} onOpenChange={(o) => !o && setMarkDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <p className="text-xs text-muted-foreground">Tenant</p>
              <p className="text-sm font-medium">{markDialog?.tenant?.full_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{markDialog?.for_month} · {formatCurrency(markDialog?.amount ?? 0)}</p>
            </div>
            <div className="space-y-1.5"><Label>Payment Method</Label>
              <Select value={markForm.method} onValueChange={(v) => setMarkForm({ ...markForm, method: v as PaymentMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Payment Date</Label><Input type="date" value={markForm.date} onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Late Fee (PKR)</Label><Input type="number" placeholder="0" value={markForm.late_fee} onChange={(e) => setMarkForm({ ...markForm, late_fee: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Receipt No.</Label><Input value={markForm.receipt_number} onChange={(e) => setMarkForm({ ...markForm, receipt_number: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Input placeholder="Optional" value={markForm.notes} onChange={(e) => setMarkForm({ ...markForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDialog(null)}>Cancel</Button>
            <Button onClick={handleMarkPaid} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving ? "Saving…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
