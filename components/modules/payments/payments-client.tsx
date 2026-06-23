"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  CreditCard, CheckCircle2, Clock, AlertTriangle, Wallet,
  TrendingUp, Edit2, Banknote, RefreshCw, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { Payment, PaymentMethod, PaymentStatus, PackageTier, PackageConfig } from "@/types";
import {
  syncMonthAction,
  markPaymentPaidAction,
  markPaymentWaivedAction,
  markPaymentOverdueAction,
  loadHistoryAction,
} from "@/app/actions/payments";
import { createInvoiceLink } from "@/app/actions/tenants";

interface TenantRow {
  id: string;
  full_name: string;
  billing_type: "monthly" | "daily";
  monthly_rent: number;
  daily_rate: number;
  check_in: string;
  check_out: string | null;
  room_id: string | null;
  is_active: boolean;
  package_tier: PackageTier;
}

interface RoomRow { id: string; room_number: string; floor: number | null; }

interface Props {
  hostelId: string | null;
  hostelName?: string;
  hostelPhone?: string;
  payments: Payment[];
  tenants: TenantRow[];
  rooms: RoomRow[];
  initialMonth: string;
  packageConfig: PackageConfig | null;
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

// Maximum AC units allowed in the UI (matches DB constraint in migration 022)
const MAX_AC_UNITS = 10_000;

export function PaymentsClient({ hostelId, hostelName = "Hostel", hostelPhone, payments: initialPayments, tenants, rooms, initialMonth, packageConfig }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [allHistory, setAllHistory] = useState<Payment[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [tab, setTab] = useState("monthly");
  const [markDialog, setMarkDialog] = useState<Payment | null>(null);
  const [markForm, setMarkForm] = useState({
    method: "cash" as PaymentMethod,
    date: formatDateInput(new Date()),
    late_fee: "0",
    notes: "",
    receipt_number: "",
    ac_units_consumed: "0",
  });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sendingWa, setSendingWa] = useState<string | null>(null); // paymentId

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

  // All payment mutations go through Server Actions — not the browser Supabase client
  const syncMonth = useCallback(async (month: string) => {
    setSyncing(true);
    const result = await syncMonthAction(month);
    if (result.error) {
      toast({ title: "Failed to sync payments", description: result.error, variant: "destructive" });
    } else if (result.payments) {
      setPayments(result.payments);
    }
    setSyncing(false);
  }, []);

  // Auto-sync on mount
  useEffect(() => {
    syncMonth(initialMonth).catch((err) => {
      toast({ title: "Failed to load payments", description: err?.message, variant: "destructive" });
    });
  }, []);

  async function loadHistory() {
    if (historyLoaded) return;
    const result = await loadHistoryAction();
    if (result.error) {
      toast({ title: "Failed to load history", description: result.error, variant: "destructive" });
      return;
    }
    setAllHistory(result.payments ?? []);
    setHistoryLoaded(true);
  }

  async function handleMonthChange(month: string) {
    setSelectedMonth(month);
    await syncMonth(month);
  }

  function openMarkPaid(p: Payment) {
    const tenantName = p.tenant?.full_name ?? "";
    setMarkDialog(p);
    setMarkForm({
      method: "cash",
      date: formatDateInput(new Date()),
      late_fee: "0",
      notes: "",
      receipt_number: genReceipt(tenantName, p.for_month),
      ac_units_consumed: "0",
    });
  }

  async function handleMarkPaid() {
    if (!markDialog) return;

    // --- Client-side input validation (F-004, F-005) ---
    const tier = markDialog.payment_package_tier as PackageTier | undefined;
    const isAcTier = tier === "space_food_ac";

    if (isAcTier) {
      const rawAc = markForm.ac_units_consumed.trim();
      const parsedAc = parseInt(rawAc, 10);
      if (!Number.isInteger(parsedAc) || parsedAc < 0 || parsedAc > MAX_AC_UNITS || String(parsedAc) !== rawAc) {
        toast({
          title: "Invalid AC units",
          description: `AC units consumed must be a whole number between 0 and ${MAX_AC_UNITS}.`,
          variant: "destructive",
        });
        return;
      }
    }

    const lateFee = parseFloat(markForm.late_fee);
    if (!Number.isFinite(lateFee) || lateFee < 0) {
      toast({
        title: "Invalid late fee",
        description: "Late fee must be a non-negative number.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const result = await markPaymentPaidAction({
      paymentId: markDialog.id,
      method: markForm.method,
      date: markForm.date,
      lateFee: markForm.late_fee,
      notes: markForm.notes,
      receiptNumber: markForm.receipt_number,
      acUnitsConsumed: markForm.ac_units_consumed,
    });

    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Payment recorded" });
      setMarkDialog(null);
      await syncMonth(selectedMonth);
    }
    setSaving(false);
  }

  async function markWaived(p: Payment) {
    const result = await markPaymentWaivedAction(p.id);
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Payment waived" });
    await syncMonth(selectedMonth);
  }

  async function markOverdue(p: Payment) {
    const result = await markPaymentOverdueAction(p.id);
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Marked as overdue" });
    await syncMonth(selectedMonth);
  }

  async function sendWhatsAppReceipt(p: Payment) {
    setSendingWa(p.id);
    try {
      const result = await createInvoiceLink(p.id);
      if (result.error) {
        toast({ title: "Failed to create receipt link", description: result.error, variant: "destructive" });
        return;
      }
      const token = result.token!;
      const origin = window.location.origin;
      const receiptUrl = `${origin}/r/${token}`;

      // Normalise Pakistan phone: 03XX... -> 923XX...
      const rawPhone = (p.tenant as unknown as { phone?: string })?.phone ?? "";
      const normPhone = rawPhone.replace(/\D/g, "").replace(/^0/, "92");

      const firstName = p.tenant?.full_name?.split(" ")[0] ?? "there";
      const total = Number(p.amount) + Number(p.late_fee ?? 0);
      const totalFormatted = `Rs. ${total.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

      const message =
        `Assalam o Alaikum ${firstName},\n\n` +
        `Your payment of *${totalFormatted}* for ${p.for_month} has been received.\n\n` +
        `Download your receipt: ${receiptUrl}\n\n` +
        `Link expires in 7 days.\n\n` +
        `Thank you - ${hostelName}`;

      const waUrl = normPhone
        ? `https://wa.me/${normPhone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;

      window.open(waUrl, "_blank", "noopener,noreferrer");
      toast({ title: "WhatsApp opened", description: "Receipt link copied into the chat." });
    } finally {
      setSendingWa(null);
    }
  }

  const stats = useMemo(() => {
    const due = payments.reduce((s, p) => s + Math.max(0, Number(p.amount)) + Math.max(0, Number(p.late_fee || 0)), 0);
    const collected = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Math.max(0, Number(p.amount)) + Math.max(0, Number(p.late_fee || 0)), 0);
    const pending = payments.filter((p) => p.status === "pending" || p.status === "overdue").reduce((s, p) => s + Math.max(0, Number(p.amount)), 0);
    return { due, collected, pending, rate: due > 0 ? Math.round((collected / due) * 100) : 0 };
  }, [payments]);

  const TIER_LABEL: Record<string, string> = {
    space_only: "Space",
    space_food: "Space+Food",
    space_food_ac: "Space+Food+AC",
  };

  function PaymentRow({ p }: { p: Payment }) {
    const room = p.tenant?.room_id ? roomMap[p.tenant.room_id] : null;
    const cfg = statusConfig[p.status];
    const isLate = (p.status === "pending" || p.status === "overdue") && p.for_month < selectedMonth;
    const tierLabel = p.payment_package_tier ? TIER_LABEL[p.payment_package_tier] : null;
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{p.tenant?.full_name ?? "—"}</p>
            {room && <span className="text-xs text-muted-foreground">Rm {room.room_number}</span>}
            {tierLabel && tierLabel !== "Space" && (
              <span className="text-xs text-blue-400 font-medium">{tierLabel}</span>
            )}
            {isLate && <span className="text-xs text-rose-400 font-medium">Late</span>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {p.payment_date && <span className="text-xs text-muted-foreground">Paid: {formatDate(p.payment_date)}</span>}
            {p.payment_method && <span className="text-xs text-muted-foreground">{methodLabels[p.payment_method]}</span>}
            {p.receipt_number && <span className="text-xs text-muted-foreground">{p.receipt_number}</span>}
            {p.food_charge != null && Number(p.food_charge) > 0 && (
              <span className="text-xs text-muted-foreground">Food: {formatCurrency(p.food_charge)}</span>
            )}
            {p.ac_charge != null && Number(p.ac_charge) > 0 && (
              <span className="text-xs text-muted-foreground">AC: {formatCurrency(p.ac_charge)}</span>
            )}
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
          {p.status === "paid" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[#25D366] hover:bg-[#25D366]/10"
              title="Send WhatsApp receipt"
              disabled={sendingWa === p.id}
              onClick={() => sendWhatsAppReceipt(p)}
            >
              <MessageCircle className="w-3.5 h-3.5" />
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
          <Button onClick={() => syncMonth(selectedMonth)} disabled={syncing} variant="ghost" size="icon" title="Sync payments">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
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
                <p className="text-xs">Add active tenants to start tracking payments</p>
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
            <div className="rounded-lg bg-white/5 px-3 py-2 space-y-0.5">
              <p className="text-xs text-muted-foreground">Tenant</p>
              <p className="text-sm font-medium">{markDialog?.tenant?.full_name}</p>
              <p className="text-xs text-muted-foreground">{markDialog?.for_month}</p>
              {/* Package tier charge breakdown */}
              {markDialog?.payment_package_tier && markDialog.payment_package_tier !== "space_only" && (
                <div className="mt-1.5 pt-1.5 border-t border-white/10 space-y-0.5">
                  {(markDialog.payment_package_tier === "space_food" || markDialog.payment_package_tier === "space_food_ac") && (
                    <p className="text-xs text-muted-foreground">Food: {formatCurrency(markDialog.food_charge ?? 0)}</p>
                  )}
                  {markDialog.payment_package_tier === "space_food_ac" && (
                    <p className="text-xs text-muted-foreground">AC: {formatCurrency(markDialog.ac_charge ?? 0)}</p>
                  )}
                  <p className="text-xs font-medium text-foreground">Total: {formatCurrency(markDialog.amount ?? 0)}</p>
                </div>
              )}
              {(!markDialog?.payment_package_tier || markDialog.payment_package_tier === "space_only") && (
                <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(markDialog?.amount ?? 0)}</p>
              )}
            </div>

            {/* AC units consumed — only for space_food_ac (F-003, F-004) */}
            {markDialog?.payment_package_tier === "space_food_ac" && (
              <div className="space-y-1.5">
                <Label>AC Units Consumed (kWh)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  max={String(MAX_AC_UNITS)}
                  step="1"
                  value={markForm.ac_units_consumed}
                  onChange={(e) => setMarkForm({ ...markForm, ac_units_consumed: e.target.value })}
                />
                {packageConfig && (
                  <p className="text-xs text-muted-foreground">
                    Rate: {formatCurrency(packageConfig.ac_per_unit_rate)}/unit ·
                    Est. Charge: {formatCurrency((parseInt(markForm.ac_units_consumed, 10) || 0) * packageConfig.ac_per_unit_rate)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground/60">Final amount is calculated server-side using the current rate.</p>
              </div>
            )}

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
              {/* F-005: min="0" prevents negative late fees in the UI */}
              <div className="space-y-1.5"><Label>Late Fee (PKR)</Label><Input type="number" placeholder="0" min="0" step="0.01" value={markForm.late_fee} onChange={(e) => setMarkForm({ ...markForm, late_fee: e.target.value })} /></div>
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
