"use client";
import { useState, useEffect } from "react";
import { CreditCard, RefreshCw, Wallet, Clock, TrendingUp } from "lucide-react";
import { getPartnerPayments } from "@/app/actions/partner";
import type { PartnerPayment } from "@/app/actions/partner";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash", easypaisa: "Easypaisa",
  sadapay: "SadaPay", other: "Other",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  paid:    { label: "Paid",    color: "text-emerald-400" },
  pending: { label: "Pending", color: "text-amber" },
  overdue: { label: "Overdue", color: "text-rose-400" },
  waived:  { label: "Waived",  color: "text-muted-foreground" },
};

export default function PartnerPaymentsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [payments, setPayments] = useState<PartnerPayment[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(month: string) {
    setLoading(true);
    const result = await getPartnerPayments(month);
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    } else {
      setPayments(result.payments ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(selectedMonth); }, []);

  const collected = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount + p.late_fee, 0);
  const pending = payments
    .filter((p) => p.status === "pending" || p.status === "overdue")
    .reduce((s, p) => s + p.amount, 0);
  const total = payments.reduce((s, p) => s + p.amount + p.late_fee, 0);
  const rate = total > 0 ? Math.min(100, Math.round((collected / total) * 100)) : 0;

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
            Payments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monthly rent collection — read-only view
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              load(e.target.value);
            }}
            className="w-auto"
          />
          <Button
            onClick={() => load(selectedMonth)}
            disabled={loading}
            variant="ghost"
            size="icon"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Due", value: formatCurrency(total), icon: CreditCard, color: "text-foreground", bg: "bg-white/5 border border-white/10" },
          { label: "Collected", value: formatCurrency(collected), icon: Wallet, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Pending", value: formatCurrency(pending), icon: Clock, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
          { label: "Collection Rate", value: `${rate}%`, icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
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

      {/* Payment list */}
      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading payments…</span>
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <CreditCard className="w-10 h-10 opacity-20" />
            <p className="text-sm">No payment records for this month</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {payments.map((p) => {
              const cfg = STATUS_CONFIG[p.status] ?? { label: p.status, color: "text-foreground" };
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{p.tenantName}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {p.payment_date && (
                        <span className="text-xs text-muted-foreground">
                          Paid: {formatDate(p.payment_date)}
                        </span>
                      )}
                      {p.payment_method && (
                        <span className="text-xs text-muted-foreground">
                          {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                        </span>
                      )}
                      {p.receipt_number && (
                        <span className="text-xs text-muted-foreground">{p.receipt_number}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(p.amount + p.late_fee)}
                    </p>
                    {p.late_fee > 0 && (
                      <p className="text-xs text-rose-400">+{formatCurrency(p.late_fee)} late</p>
                    )}
                    <p className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
