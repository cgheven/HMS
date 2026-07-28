"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  BarChart3, TrendingUp, Users, AlertTriangle, Banknote, BedDouble,
  Download, FileSpreadsheet, RefreshCw, Zap, CreditCard,
  Receipt, BookOpen, Search, ExternalLink, Loader2, ShieldCheck, CalendarClock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { getReportData, getLedgerTenants, type ReportData, type LedgerTenantRow } from "@/app/actions/reports";
import { getTenantTimeline, createInvoiceLink, createInstallmentReceiptLink, type TimelineEvent } from "@/app/actions/tenants";
import { EventIcon, eventDotColor } from "@/components/modules/tenants/tenant-timeline";
import { DailyExpensesSection } from "./daily-expenses-section";
import type { RevenueMonth, AgingBucket } from "@/types";

const RevenueChart = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), {
  ssr: false, loading: () => <div className="h-[220px] animate-pulse bg-white/5 rounded-xl" />,
});
const ExpenseBreakdownChart = dynamic(() => import("./expense-breakdown-chart").then((m) => m.ExpenseBreakdownChart), {
  ssr: false, loading: () => <div className="h-[220px] animate-pulse bg-white/5 rounded-xl" />,
});

// ── Date range helpers ──────────────────────────────────────────────────────
function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getPreset(preset: string): { from: string; to: string; label: string } {
  const now = new Date();
  const currentMk = getMonthKey(now);

  if (preset === "this_month") {
    return { from: currentMk, to: currentMk, label: "This Month" };
  }
  if (preset === "last_month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const mk = getMonthKey(d);
    return { from: mk, to: mk, label: "Last Month" };
  }
  if (preset === "last_12") {
    const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { from: getMonthKey(d), to: currentMk, label: "Last 12 Months" };
  }
  return { from: currentMk, to: currentMk, label: "This Month" };
}

// ── Legacy props (kept for backward compat with old page.tsx) ─────────────
interface LegacyProps {
  data: {
    hostelId: string;
    revenueByMonth: RevenueMonth[];
    aging: { d30: AgingBucket; d60: AgingBucket; d90: AgingBucket; d90plus: AgingBucket };
    totalCapacity: number;
  } | null;
}

// ── New props ────────────────────────────────────────────────────────────────
interface NewProps {
  hostelId: string;
  initialData: ReportData | null;
  initialFrom: string;
  initialTo: string;
}

type Props = LegacyProps | NewProps;

function isNewProps(p: Props): p is NewProps {
  return "hostelId" in p;
}

// ── Tooltip formatter ────────────────────────────────────────────────────────
const currencyTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-sidebar-border bg-card px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-muted-foreground">{p.name}: <span className="text-foreground font-medium">{formatCurrency(p.value)}</span></p>
      ))}
    </div>
  );
};

const COLORS = ["#f5a623", "#10b981", "#3b82f6", "#a855f7", "#ef4444"];

// ── Main component ────────────────────────────────────────────────────────────
export function ReportsClient(props: Props) {
  const [tab, setTab] = useState("today");
  const [preset, setPreset] = useState("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(
    isNewProps(props) ? props.initialData : null
  );
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Legacy mode (old data shape): just show the classic reports view
  if (!isNewProps(props)) {
    return <LegacyReportsView data={props.data} />;
  }

  const { hostelId } = props;

  const currentRange = useMemo(() => {
    if (showCustom && customFrom && customTo) {
      return { from: customFrom, to: customTo, label: `${customFrom} to ${customTo}` };
    }
    return getPreset(preset);
  }, [preset, showCustom, customFrom, customTo]);

  const fetchData = useCallback(async (from: string, to: string, label: string) => {
    setLoading(true);
    try {
      const result = await getReportData(hostelId, from, to, label);
      if (result.error) {
        toast({ title: "Error loading report", description: result.error, variant: "destructive" });
      } else {
        setReportData(result.data);
      }
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [hostelId]);

  async function handlePreset(p: string) {
    setShowCustom(false);
    setPreset(p);
    const range = getPreset(p);
    await fetchData(range.from, range.to, range.label);
  }

  async function handleCustomApply() {
    if (!customFrom || !customTo) return;
    const label = `${customFrom} to ${customTo}`;
    await fetchData(customFrom, customTo, label);
  }

  async function handleExportPDF() {
    if (!reportData) return;
    setExporting("pdf");
    try {
      const { exportReportPDF } = await import("@/lib/report-export");
      await exportReportPDF(reportData, currentRange.label);
      toast({ title: "PDF downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  async function handleExportExcel() {
    if (!reportData) return;
    setExporting("xlsx");
    try {
      const { exportReportExcel } = await import("@/lib/report-export");
      await exportReportExcel(reportData, currentRange.label);
      toast({ title: "Excel downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  const d = reportData;

  // Deposits are refundable, so they are cash collected but never profit — the
  // same exclusion getDashboardData applies, so the two screens agree.
  const totalNetProfit = d
    ? d.monthlyExpenses.reduce(
        (s, m) => s + (m.collected - (m.depositsCollected ?? 0) - m.expenses - m.kitchen - m.salaries),
        0,
      )
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">Professional financial & operational analytics</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Export buttons */}
          {d && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPDF}
                disabled={!!exporting}
                className="gap-1.5 h-8 text-xs"
              >
                {exporting === "pdf" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={!!exporting}
                className="gap-1.5 h-8 text-xs"
              >
                {exporting === "xlsx" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
                Excel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Date range selector */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
        <div className="relative max-w-full">
          <div className="flex items-center gap-1 flex-nowrap overflow-x-auto scrollbar-hide">
            {[
              { id: "this_month", label: "This Month" },
              { id: "last_month", label: "Last Month" },
              { id: "last_12", label: "12 Months" },
              { id: "custom", label: "Custom" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.id === "custom") { setShowCustom(true); return; }
                  handlePreset(p.id);
                }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  (p.id !== "custom" && preset === p.id && !showCustom) || (p.id === "custom" && showCustom)
                    ? "bg-amber text-background border-amber"
                    : "border-sidebar-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-card to-transparent" />
        </div>

        {showCustom && (
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="month"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-auto h-8 text-xs"
              placeholder="From"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="month"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-auto h-8 text-xs"
              placeholder="To"
            />
            <Button size="sm" onClick={handleCustomApply} disabled={!customFrom || !customTo} className="h-8 text-xs bg-amber text-background hover:bg-amber/90">
              Apply
            </Button>
          </div>
        )}

        {loading && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin" /> Loading report data…
          </p>
        )}
      </div>

      {!d ? (
        <div className="flex flex-col items-center justify-center py-32 gap-2 text-muted-foreground">
          <BarChart3 className="w-10 h-10 opacity-20" />
          <p className="text-sm">No data available. Add tenants and payments to see reports.</p>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="today"><CalendarClock className="w-3.5 h-3.5" /> Today</TabsTrigger>
            <TabsTrigger value="overview"><BarChart3 className="w-3.5 h-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="revenue"><TrendingUp className="w-3.5 h-3.5" /> Revenue</TabsTrigger>
            <TabsTrigger value="reconciliation"><CreditCard className="w-3.5 h-3.5" /> Reconciliation</TabsTrigger>
            <TabsTrigger value="occupancy"><BedDouble className="w-3.5 h-3.5" /> Occupancy</TabsTrigger>
            <TabsTrigger value="ac"><Zap className="w-3.5 h-3.5" /> AC Analytics</TabsTrigger>
            <TabsTrigger value="expenses"><Receipt className="w-3.5 h-3.5" /> Expenses</TabsTrigger>
            <TabsTrigger value="ledger"><BookOpen className="w-3.5 h-3.5" /> Member Ledger</TabsTrigger>
          </TabsList>

          {/* ── TODAY TAB ────────────────────────────────────────────────── */}
          {/* Deliberately scoped to the CURRENT calendar month/day, independent
              of whatever range is selected above (a "Last Month" or "12 Months"
              view wouldn't make "today" meaningful) — its own tab rather than
              pinned above every other tab regardless of context. */}
          <TabsContent value="today" className="space-y-6 mt-4">
            <DailyExpensesSection dailyDetails={d.dailyExpenseDetails} />
          </TabsContent>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            {/* 4 KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Collected", value: formatCurrency(d.totalRevenue), icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                { label: "Net Profit", value: formatCurrency(totalNetProfit), icon: Banknote, color: totalNetProfit >= 0 ? "text-emerald-400" : "text-rose-400", bg: totalNetProfit >= 0 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-rose-500/10 border-rose-500/20" },
                { label: "Pending (this period)", value: formatCurrency(d.pendingCollections), icon: AlertTriangle, color: "text-amber", bg: "bg-amber/10 border-amber/20" },
                { label: "New Tenants", value: String(d.newTenants), icon: Users, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl border ${bg} shrink-0`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground truncate">{label}</p>
                      <p className="text-base sm:text-xl font-bold leading-tight mt-0.5 break-words">{value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* New Members — the filterable list behind the "New Tenants" count
                above, respecting whatever period is selected at the top of the
                page (This Month / Last Month / 12 Months / Custom). */}
            {d.joinedTenantsList.length > 0 && (
              <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4 border-b border-sidebar-border">
                  <div>
                    <p className="text-sm font-semibold">New Members</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Who joined during {d.label}</p>
                  </div>
                  <span className="text-sm font-semibold text-purple-400">{d.joinedTenantsList.length}</span>
                </div>
                <div className="max-h-[320px] overflow-auto scrollbar-hide">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                        <th className="text-left px-5 py-2">Name</th>
                        <th className="text-left px-5 py-2">Room</th>
                        <th className="text-left px-5 py-2">Phone</th>
                        <th className="text-left px-5 py-2">Type</th>
                        <th className="text-right px-5 py-2">Check-in</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sidebar-border/50">
                      {d.joinedTenantsList.map((t) => (
                        <tr key={t.id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-2.5 font-medium">{t.name}</td>
                          <td className="px-5 py-2.5 text-muted-foreground">{t.roomNumber ? `Rm ${t.roomNumber}` : "—"}</td>
                          <td className="px-5 py-2.5 text-muted-foreground">{t.phone ?? "—"}</td>
                          <td className="px-5 py-2.5 text-muted-foreground capitalize">{t.type}</td>
                          <td className="px-5 py-2.5 text-right text-muted-foreground whitespace-nowrap">{formatDate(t.checkIn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Money Owed — ignores the date filter on purpose, so debt older
                than the selected range can't hide. */}
            {d.receivablesAging && d.receivablesAging.totalOwed > 0 && (() => {
              const a = d.receivablesAging;
              const buckets = [
                { label: "This month", sub: "Not late yet", amount: a.current, tone: "text-foreground", bar: "bg-muted-foreground/30" },
                { label: "1 month late", sub: "", amount: a.late1Month, tone: "text-amber", bar: "bg-amber" },
                { label: "2 months late", sub: "", amount: a.late2Months, tone: "text-orange-400", bar: "bg-orange-400" },
                { label: "3+ months late", sub: "At risk", amount: a.late3PlusMonths, tone: "text-rose-400", bar: "bg-rose-400" },
              ];
              const max = Math.max(...buckets.map((b) => b.amount), 1);
              return (
                <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4 border-b border-sidebar-border">
                    <div>
                      <p className="text-sm font-semibold">Money Owed To You</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        All unpaid rent, across every month — not just the selected period
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold leading-tight">{formatCurrency(a.totalOwed)}</p>
                      {a.totalLate > 0 && (
                        <p className="text-xs text-rose-400 mt-0.5">{formatCurrency(a.totalLate)} is late</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-5 p-5 lg:grid-cols-2">
                    <div className="space-y-2.5">
                      {buckets.map((b) => (
                        <div key={b.label}>
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">
                              {b.label}
                              {b.sub && <span className="ml-1.5 opacity-60">{b.sub}</span>}
                            </span>
                            <span className={cn("text-sm font-semibold tabular-nums", b.tone)}>
                              {formatCurrency(b.amount)}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                            <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${(b.amount / max) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground pt-1.5">
                        <span className="text-foreground font-medium">{a.activeDebtors}</span> of {a.activeTenants} current tenants owe you money
                      </p>
                      {a.formerDebtors > 0 && (
                        <p className="text-xs text-rose-400">
                          {a.formerDebtors} former {a.formerDebtors === 1 ? "tenant has" : "tenants have"} checked out still owing{" "}
                          <span className="font-semibold">{formatCurrency(a.formerDebtorsOwed)}</span>
                        </p>
                      )}
                    </div>

                    {a.topDebtors.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Who to chase first</p>
                        <div className="space-y-1.5">
                          {a.topDebtors.map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-sidebar-border px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-sm truncate flex items-center gap-1.5">
                                  {t.name}
                                  {!t.isActive && (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium border text-rose-400 bg-rose-500/10 border-rose-500/20">
                                      Left
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t.monthsUnpaid} unpaid {t.monthsUnpaid === 1 ? "month" : "months"} · since {t.oldestMonth}
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-rose-400 tabular-nums shrink-0">
                                {formatCurrency(t.owed)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </TabsContent>

          {/* ── REVENUE TAB ──────────────────────────────────────────────── */}
          <TabsContent value="revenue" className="space-y-6 mt-4">
            {/* Monthly revenue table */}
            <div className="rounded-2xl border border-sidebar-border bg-card p-6">
              <h2 className="text-sm font-semibold mb-4">Revenue by Month</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                      <th className="text-left pb-2 pr-3">Month</th>
                      <th className="text-right pb-2 pr-3">Rent</th>
                      <th className="text-right pb-2 pr-3">Food</th>
                      <th className="text-right pb-2 pr-3">AC</th>
                      <th className="text-right pb-2 pr-3">Reg. Fee</th>
                      <th className="text-right pb-2 pr-3">AC Maint.</th>
                      <th className="text-right pb-2 pr-3">Total</th>
                      <th className="text-right pb-2 pr-3">Collected</th>
                      <th className="text-right pb-2">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sidebar-border/50">
                    {d.revenueByMonth.map((m) => (
                      <tr key={m.monthKey} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 pr-3 text-muted-foreground">{m.month}</td>
                        <td className="py-2.5 pr-3 text-right">{formatCurrency(m.rentRevenue)}</td>
                        <td className="py-2.5 pr-3 text-right text-amber">{m.foodRevenue > 0 ? formatCurrency(m.foodRevenue) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right text-blue-400">{m.acRevenue > 0 ? formatCurrency(m.acRevenue) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right text-violet-400">{m.registrationFeeRevenue > 0 ? formatCurrency(m.registrationFeeRevenue) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right text-cyan-400">{m.acMaintenanceRevenue > 0 ? formatCurrency(m.acMaintenanceRevenue) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold">{formatCurrency(m.total)}</td>
                        <td className="py-2.5 pr-3 text-right text-emerald-400">{formatCurrency(m.collected)}</td>
                        <td className={`py-2.5 text-right ${m.pending > 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                          {m.pending > 0 ? formatCurrency(m.pending) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-sidebar-border font-semibold">
                      <td className="pt-2.5 text-muted-foreground">Total</td>
                      <td className="pt-2.5 pr-3 text-right">{formatCurrency(d.revenueByMonth.reduce((s, m) => s + m.rentRevenue, 0))}</td>
                      <td className="pt-2.5 pr-3 text-right text-amber">{formatCurrency(d.revenueByMonth.reduce((s, m) => s + m.foodRevenue, 0))}</td>
                      <td className="pt-2.5 pr-3 text-right text-blue-400">{formatCurrency(d.revenueByMonth.reduce((s, m) => s + m.acRevenue, 0))}</td>
                      <td className="pt-2.5 pr-3 text-right text-violet-400">{formatCurrency(d.revenueByMonth.reduce((s, m) => s + m.registrationFeeRevenue, 0))}</td>
                      <td className="pt-2.5 pr-3 text-right text-cyan-400">{formatCurrency(d.revenueByMonth.reduce((s, m) => s + m.acMaintenanceRevenue, 0))}</td>
                      <td className="pt-2.5 pr-3 text-right">{formatCurrency(d.totalRevenue)}</td>
                      <td className="pt-2.5 pr-3 text-right text-emerald-400">{formatCurrency(d.totalRevenue)}</td>
                      <td className="pt-2.5 text-right text-rose-400">{formatCurrency(d.pendingCollections)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Top tenants */}
            {d.topTenants.length > 0 && (
              <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                <h2 className="text-sm font-semibold mb-4">Top 5 Tenants by Total Paid</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                        <th className="text-left pb-2 pr-3">#</th>
                        <th className="text-left pb-2 pr-3">Tenant</th>
                        <th className="text-right pb-2">Total Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sidebar-border/50">
                      {d.topTenants.map((t, i) => (
                        <tr key={t.id} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-3 text-muted-foreground font-medium">{i + 1}</td>
                          <td className="py-2.5 pr-3 font-medium">{t.name}</td>
                          <td className="py-2.5 text-right text-emerald-400 font-semibold">{formatCurrency(t.totalPaid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Overdue payments */}
            {d.overduePayments.length > 0 && (
              <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <h2 className="text-sm font-semibold">Overdue / Pending Payments</h2>
                  <Badge variant="destructive" className="ml-auto text-xs">{d.overduePayments.length}</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                        <th className="text-left pb-2 pr-3">Tenant</th>
                        <th className="text-left pb-2 pr-3">Month</th>
                        <th className="text-right pb-2 pr-3">Amount</th>
                        <th className="text-right pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sidebar-border/50">
                      {d.overduePayments.map((p) => (
                        <tr key={p.id} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-3 font-medium">{p.tenantName}</td>
                          <td className="py-2.5 pr-3 text-muted-foreground">{p.forMonth}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold">{formatCurrency(p.amount)}</td>
                          <td className="py-2.5 text-right">
                            <span className={`text-xs font-medium capitalize ${p.status === "overdue" ? "text-rose-400" : "text-amber"}`}>
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── RECONCILIATION TAB ───────────────────────────────────────── */}
          <TabsContent value="reconciliation" className="space-y-6 mt-4">
            <ReconciliationTab data={d} period={currentRange.label} />
          </TabsContent>

          {/* ── OCCUPANCY TAB ────────────────────────────────────────────── */}
          <TabsContent value="occupancy" className="space-y-6 mt-4">
            {/* Summary cards by type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {d.occupancyByType.map((o) => (
                <div key={o.type} className="rounded-2xl border border-sidebar-border bg-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold capitalize">{o.type} Rooms</p>
                    <span className="text-xs text-muted-foreground">{o.occupied}/{o.total} beds</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-amber rounded-full transition-all" style={{ width: `${o.rate}%` }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold text-foreground">{o.rate}%</span>
                    <span className="text-xs text-muted-foreground">{o.total - o.occupied} vacant</span>
                  </div>
                </div>
              ))}

              {/* Total */}
              <div className="rounded-2xl border border-amber/20 bg-amber/[0.05] p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-amber">All Rooms</p>
                  <span className="text-xs text-muted-foreground">{d.totalOccupied}/{d.totalCapacity} beds</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-amber rounded-full" style={{ width: `${d.occupancyRate}%` }} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-amber">{d.occupancyRate}%</span>
                  <span className="text-xs text-muted-foreground">{d.totalCapacity - d.totalOccupied} vacant</span>
                </div>
              </div>
            </div>

            {/* Occupancy bar chart */}
            {d.monthlyExpenses.length > 0 && (
              <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                <h2 className="text-sm font-semibold mb-1">Monthly Revenue vs Expenses</h2>
                <p className="text-xs text-muted-foreground mb-4">Financial trend over selected period</p>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.monthlyExpenses}>
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <Tooltip content={currencyTooltip as never} />
                      <Bar dataKey="collected" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── AC ANALYTICS TAB ─────────────────────────────────────────── */}
          <TabsContent value="ac" className="space-y-6 mt-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Avg Units/Tenant", value: `${d.acStats.avgUnitsPerTenant} kWh`, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
                { label: "Total AC Revenue", value: formatCurrency(d.acStats.totalAcRevenue), color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                { label: "AC Tenants", value: String(d.acStats.totalAcTenants), color: "text-amber", bg: "bg-amber/10 border-amber/20" },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-5">
                  <div className={`flex items-center justify-center w-9 h-9 rounded-xl border ${bg} mb-3`}>
                    <Zap className={`w-4 h-4 ${color}`} />
                  </div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-xl font-bold mt-0.5 ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {d.acByRoom.length > 0 ? (
              <>
                {/* Bar chart: top rooms by AC units */}
                <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                  <h2 className="text-sm font-semibold mb-1">Top Rooms by AC Units Consumed</h2>
                  <p className="text-xs text-muted-foreground mb-4">kWh usage</p>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.acTopRooms} layout="vertical">
                        <XAxis type="number" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="roomNumber" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={50} />
                        <Tooltip formatter={(v: number) => `${v} kWh`} />
                        <Bar dataKey="unitsConsumed" name="Units (kWh)" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                          {d.acTopRooms.map((_, idx) => (
                            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Table */}
                <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                  <h2 className="text-sm font-semibold mb-4">AC Usage Details</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                          <th className="text-left pb-2 pr-3">Room</th>
                          <th className="text-left pb-2 pr-3">Tenant</th>
                          <th className="text-right pb-2 pr-3">Units (kWh)</th>
                          <th className="text-right pb-2 pr-3">AC Charge</th>
                          <th className="text-right pb-2">Month</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sidebar-border/50">
                        {d.acByRoom.map((r, i) => (
                          <tr key={i} className="hover:bg-white/[0.02]">
                            <td className="py-2.5 pr-3 font-medium">Rm {r.roomNumber}</td>
                            <td className="py-2.5 pr-3 text-muted-foreground">{r.tenantName}</td>
                            <td className="py-2.5 pr-3 text-right text-blue-400 font-medium">{r.unitsConsumed}</td>
                            <td className="py-2.5 pr-3 text-right font-semibold">{formatCurrency(r.acCharge)}</td>
                            <td className="py-2.5 text-right text-muted-foreground">{r.forMonth}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
                <Zap className="w-10 h-10 opacity-20" />
                <p className="text-sm">No AC usage data for this period</p>
                <p className="text-xs">Mark payments for Space+Food+AC tenants to see AC analytics</p>
              </div>
            )}
          </TabsContent>

          {/* ── EXPENSES TAB ─────────────────────────────────────────────── */}
          <TabsContent value="expenses" className="space-y-6 mt-4">
            <ExpenseReportTab data={d} period={currentRange.label} />
          </TabsContent>

          {/* ── MEMBER LEDGER TAB ────────────────────────────────────────── */}
          <TabsContent value="ledger" className="space-y-6 mt-4">
            <MemberLedgerTab hostelId={hostelId} hostelName={d.hostelName} roomOptions={d.roomOptions} from={currentRange.from} to={currentRange.to} period={currentRange.label} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ── Method colors ────────────────────────────────────────────────────────────
const METHOD_COLORS: Record<string, string> = {
  cash: "#10b981",
  bank_transfer: "#3b82f6",
  jazzcash: "#f5a623",
  easypaisa: "#a855f7",
  cheque: "#06b6d4",
  online: "#ef4444",
};

function methodColor(method: string) {
  return METHOD_COLORS[method] ?? "#888";
}

// ── Reconciliation tab ────────────────────────────────────────────────────────
function ReconciliationTab({ data: d, period }: { data: ReportData; period: string }) {
  const [methodFilter, setMethodFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const filteredList = useMemo(() => {
    return d.paidPaymentsList.filter((p) => {
      if (methodFilter !== "all" && p.method !== methodFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.tenantName.toLowerCase().includes(q) || p.forMonth.includes(q) || (p.receiptNumber ?? "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [d.paidPaymentsList, methodFilter, search]);

  const filteredTotal = filteredList.reduce((s, p) => s + p.amount, 0);

  const activeMethodLabel = methodFilter === "all"
    ? "All Methods"
    : (d.paymentMethodBreakdown.find(m => m.method === methodFilter)?.label ?? methodFilter);

  async function handleExportPDF() {
    setExporting("pdf");
    try {
      const { exportReconciliationPDF } = await import("@/lib/report-export");
      await exportReconciliationPDF(filteredList, d.hostelName, period, activeMethodLabel);
      toast({ title: "PDF downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  async function handleExportExcel() {
    setExporting("xlsx");
    try {
      const { exportReconciliationExcel } = await import("@/lib/report-export");
      await exportReconciliationExcel(filteredList, d.hostelName, period, activeMethodLabel);
      toast({ title: "Excel downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  if (d.paymentMethodBreakdown.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
        <CreditCard className="w-10 h-10 opacity-20" />
        <p className="text-sm">No paid payments in this period</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Method summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {d.paymentMethodBreakdown.map((m) => (
          <div key={m.method} className="rounded-2xl border border-sidebar-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: methodColor(m.method) }} />
              <p className="text-xs text-muted-foreground font-medium">{m.label}</p>
            </div>
            <p className="text-lg font-bold text-foreground">{formatCurrency(m.amount)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{m.count} payment{m.count !== 1 ? "s" : ""}</p>
          </div>
        ))}
      </div>

      {/* Payment list */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-6">
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">Payment Transactions</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {filteredList.length} transaction{filteredList.length !== 1 ? "s" : ""} · {formatCurrency(filteredTotal)}
                {methodFilter !== "all" && <span className="ml-1 text-amber">· {activeMethodLabel}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPDF}
                disabled={!!exporting || filteredList.length === 0}
                className="gap-1.5 h-8 text-xs"
              >
                {exporting === "pdf" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={!!exporting || filteredList.length === 0}
                className="gap-1.5 h-8 text-xs"
              >
                {exporting === "xlsx" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
                Excel
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue placeholder="All Methods" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {d.paymentMethodBreakdown.map((m) => (
                  <SelectItem key={m.method} value={m.method}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0 inline-block" style={{ background: methodColor(m.method) }} />
                      {m.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="text"
              placeholder="Search tenant, month, receipt…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border border-sidebar-border bg-white/5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/50 w-52"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                <th className="text-left pb-2 pr-3">Tenant</th>
                <th className="text-left pb-2 pr-3">Mobile</th>
                <th className="text-left pb-2 pr-3">Room</th>
                <th className="text-left pb-2 pr-3">Period</th>
                <th className="text-left pb-2 pr-3">Receipt #</th>
                <th className="text-left pb-2 pr-3">Method</th>
                <th className="text-left pb-2 pr-3">Date</th>
                <th className="text-right pb-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sidebar-border/50">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-muted-foreground">No transactions match</td>
                </tr>
              ) : (
                filteredList.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-3 font-medium">{p.tenantName}</td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">{p.phone ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">{p.roomNumber ? `Rm ${p.roomNumber}` : "—"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{p.forMonth}</td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground font-mono">{p.receiptNumber ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: methodColor(p.method) }} />
                        {d.paymentMethodBreakdown.find(m => m.method === p.method)?.label ?? p.method}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="py-2.5 text-right font-semibold text-emerald-400">{formatCurrency(p.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredList.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-sidebar-border font-semibold">
                  <td colSpan={7} className="pt-2.5 text-xs text-muted-foreground">Total</td>
                  <td className="pt-2.5 text-right text-emerald-400">{formatCurrency(filteredTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Expense report tab ───────────────────────────────────────────────────────
const SOURCE_COLORS: Record<string, string> = {
  bill: "#ef4444",
  salary: "#a855f7",
  expense: "#3b82f6",
  kitchen: "#f5a623",
};

function sourceColor(source: string) {
  return SOURCE_COLORS[source] ?? "#888";
}

const SOURCE_LABELS: Record<string, string> = {
  bill: "Bills",
  salary: "Staff Salaries",
  expense: "General Expenses",
  kitchen: "Kitchen",
};

function ExpenseReportTab({ data: d, period }: { data: ReportData; period: string }) {
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const filteredList = useMemo(() => {
    return d.expenseReport.rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
      }
      return true;
    });
  }, [d.expenseReport.rows, sourceFilter, search]);

  const filteredTotal = filteredList.reduce((s, r) => s + r.amount, 0);
  const activeSourceLabel = sourceFilter === "all" ? "All Sources" : (SOURCE_LABELS[sourceFilter] ?? sourceFilter);

  async function handleExportPDF() {
    setExporting("pdf");
    try {
      const { exportExpenseReportPDF } = await import("@/lib/report-export");
      await exportExpenseReportPDF(filteredList, d.hostelName, period, activeSourceLabel);
      toast({ title: "PDF downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  async function handleExportExcel() {
    setExporting("xlsx");
    try {
      const { exportExpenseReportExcel } = await import("@/lib/report-export");
      await exportExpenseReportExcel(filteredList, d.hostelName, period, activeSourceLabel);
      toast({ title: "Excel downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  if (d.expenseReport.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
        <Receipt className="w-10 h-10 opacity-20" />
        <p className="text-sm">No expenses recorded in this period</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards by source */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="rounded-2xl border border-sidebar-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sourceColor("bill") }} />
            <p className="text-xs text-muted-foreground font-medium">Bills</p>
          </div>
          <p className="text-lg font-bold text-foreground">{formatCurrency(d.expenseReport.totalsBySource.bills)}</p>
          {d.expenseReport.unpaidBillsTotal > 0 && (
            <p className="text-xs text-rose-400 mt-0.5">{formatCurrency(d.expenseReport.unpaidBillsTotal)} unpaid</p>
          )}
        </div>
        <div className="rounded-2xl border border-sidebar-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sourceColor("salary") }} />
            <p className="text-xs text-muted-foreground font-medium">Staff Salaries</p>
          </div>
          <p className="text-lg font-bold text-foreground">{formatCurrency(d.expenseReport.totalsBySource.staff)}</p>
          {d.expenseReport.pendingSalariesTotal > 0 && (
            <p className="text-xs text-amber mt-0.5">{formatCurrency(d.expenseReport.pendingSalariesTotal)} pending</p>
          )}
        </div>
        <div className="rounded-2xl border border-sidebar-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sourceColor("expense") }} />
            <p className="text-xs text-muted-foreground font-medium">General Expenses</p>
          </div>
          <p className="text-lg font-bold text-foreground">{formatCurrency(d.expenseReport.totalsBySource.expenses)}</p>
        </div>
        <div className="rounded-2xl border border-sidebar-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sourceColor("kitchen") }} />
            <p className="text-xs text-muted-foreground font-medium">Kitchen</p>
          </div>
          <p className="text-lg font-bold text-foreground">{formatCurrency(d.expenseReport.totalsBySource.kitchen)}</p>
        </div>
        <div className="rounded-2xl border border-amber/20 bg-amber/[0.05] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-3 h-3 text-amber shrink-0" />
            <p className="text-xs text-amber font-medium">Grand Total</p>
          </div>
          <p className="text-lg font-bold text-amber">{formatCurrency(d.expenseReport.grandTotal)}</p>
        </div>
      </div>

      {/* Itemized list */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-6">
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">Expense Line Items</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {filteredList.length} item{filteredList.length !== 1 ? "s" : ""} · {formatCurrency(filteredTotal)}
                {sourceFilter !== "all" && <span className="ml-1 text-amber">· {activeSourceLabel}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPDF}
                disabled={!!exporting || filteredList.length === 0}
                className="gap-1.5 h-8 text-xs"
              >
                {exporting === "pdf" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={!!exporting || filteredList.length === 0}
                className="gap-1.5 h-8 text-xs"
              >
                {exporting === "xlsx" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
                Excel
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([source, label]) => (
                  <SelectItem key={source} value={source}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0 inline-block" style={{ background: sourceColor(source) }} />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="text"
              placeholder="Search title, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border border-sidebar-border bg-white/5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/50 w-52"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                <th className="text-left pb-2 pr-3">Date</th>
                <th className="text-left pb-2 pr-3">Source</th>
                <th className="text-left pb-2 pr-3">Title</th>
                <th className="text-left pb-2 pr-3">Category</th>
                <th className="text-left pb-2 pr-3">Status</th>
                <th className="text-right pb-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sidebar-border/50">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">No expenses match</td>
                </tr>
              ) : (
                filteredList.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {new Date(r.date).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sourceColor(r.source) }} />
                        {r.sourceLabel}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium">{r.title}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.category}</td>
                    <td className="py-2.5 pr-3">
                      {r.status ? (
                        <span className={`text-xs font-medium capitalize ${r.status === "paid" ? "text-emerald-400" : r.status === "overdue" ? "text-rose-400" : "text-amber"}`}>
                          {r.status}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-semibold">{formatCurrency(r.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredList.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-sidebar-border font-semibold">
                  <td colSpan={5} className="pt-2.5 text-xs text-muted-foreground">Total</td>
                  <td className="pt-2.5 text-right">{formatCurrency(filteredTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Member Ledger tab ────────────────────────────────────────────────────────
const LEDGER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  waiting: "Waiting",
  checked_out: "Checked Out",
};

function ledgerPackagePriceLabel(r: { packagePrice: number; billingType: "monthly" | "daily" }): string {
  if (r.packagePrice <= 0) return "—";
  return `${formatCurrency(r.packagePrice)}/${r.billingType === "daily" ? "day" : "mo"}`;
}

const LEDGER_PACKAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "space_only", label: "Space Only" },
  { value: "space_food", label: "Space + 2 Meals" },
  { value: "space_3meals", label: "Space + 3 Meals" },
  { value: "space_food_ac", label: "Space + Meals + AC" },
  { value: "space_meals_cooler", label: "Space + Meals + Cooler" },
  { value: "custom", label: "Custom Package" },
];

function MemberLedgerTab({
  hostelId, hostelName, roomOptions, from, to, period,
}: {
  hostelId: string;
  hostelName: string;
  roomOptions: { id: string; roomNumber: string }[];
  from: string;
  to: string;
  period: string;
}) {
  const [rows, setRows] = useState<LedgerTenantRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomFilter, setRoomFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "waiting" | "checked_out" | "all">("active");
  const [packageFilter, setPackageFilter] = useState("all");
  const [depositFilter, setDepositFilter] = useState(false);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const [drillIn, setDrillIn] = useState<LedgerTenantRow | null>(null);
  const [drillInEvents, setDrillInEvents] = useState<TimelineEvent[] | null>(null);
  const [drillInLoading, setDrillInLoading] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null);

  const fetchRows = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    const result = await getLedgerTenants(hostelId, from, to, {
      roomId: roomFilter !== "all" ? roomFilter : undefined,
      status: statusFilter,
      packageTier: packageFilter !== "all" ? packageFilter : undefined,
      hasDeposit: depositFilter || undefined,
    });
    if (signal?.cancelled) return;
    if (result.error) {
      toast({ title: "Error loading ledger", description: result.error, variant: "destructive" });
      setRows([]);
    } else {
      setRows(result.data ?? []);
    }
    setLoading(false);
  }, [hostelId, from, to, roomFilter, statusFilter, packageFilter, depositFilter]);

  useEffect(() => {
    const signal = { cancelled: false };
    fetchRows(signal);
    return () => { signal.cancelled = true; };
  }, [fetchRows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => r.fullName.toLowerCase().includes(q) || (r.phone ?? "").toLowerCase().includes(q))
      : rows;
    // Sort by room number ascending (numeric-aware, e.g. Rm 2 before Rm 10); tenants
    // with no room assigned (waiting list) sort to the end.
    return [...filtered].sort((a, b) => {
      if (!a.roomNumber && !b.roomNumber) return 0;
      if (!a.roomNumber) return 1;
      if (!b.roomNumber) return -1;
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [rows, search]);

  const roomFilterLabel = roomFilter === "all" ? "All Rooms" : `Rm ${roomOptions.find((r) => r.id === roomFilter)?.roomNumber ?? roomFilter}`;
  const statusFilterLabel = statusFilter === "all" ? "All Statuses" : LEDGER_STATUS_LABELS[statusFilter];
  const packageFilterLabel = packageFilter === "all" ? null : LEDGER_PACKAGE_OPTIONS.find((p) => p.value === packageFilter)?.label ?? packageFilter;
  const exportFilterLabel = [statusFilterLabel, roomFilterLabel, packageFilterLabel, depositFilter ? "With Deposit" : null]
    .filter(Boolean)
    .join(" · ");

  async function handleExportPDF() {
    setExporting("pdf");
    try {
      const { exportLedgerPDF } = await import("@/lib/report-export");
      await exportLedgerPDF(filteredRows, hostelName, period, exportFilterLabel);
      toast({ title: "PDF downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  async function handleExportExcel() {
    setExporting("xlsx");
    try {
      const { exportLedgerExcel } = await import("@/lib/report-export");
      await exportLedgerExcel(filteredRows, hostelName, period, exportFilterLabel);
      toast({ title: "Excel downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  async function openDrillIn(row: LedgerTenantRow) {
    setDrillIn(row);
    setDrillInLoading(true);
    setDrillInEvents(null);
    const result = await getTenantTimeline(row.id);
    if (result.error) {
      toast({ title: "Failed to load history", description: result.error, variant: "destructive" });
    } else {
      setDrillInEvents(result.events ?? []);
    }
    setDrillInLoading(false);
  }

  async function openReceipt(paymentId: string, installmentId?: string) {
    const key = installmentId ?? paymentId;
    setGeneratingReceipt(key);
    const result = installmentId
      ? await createInstallmentReceiptLink(installmentId)
      : await createInvoiceLink(paymentId);
    setGeneratingReceipt(null);
    if (result.error) {
      toast({ title: "Failed to open receipt", description: result.error, variant: "destructive" });
      return;
    }
    window.open(`/r/${result.token}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={roomFilter} onValueChange={setRoomFilter}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue placeholder="All Rooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Rooms</SelectItem>
              {roomOptions.map((r) => (
                <SelectItem key={r.id} value={r.id}>Rm {r.roomNumber}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="checked_out">Checked Out</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
            </SelectContent>
          </Select>

          <Select value={packageFilter} onValueChange={setPackageFilter}>
            <SelectTrigger className="h-8 text-xs w-40">
              <SelectValue placeholder="All Packages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Packages</SelectItem>
              {LEDGER_PACKAGE_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => setDepositFilter((v) => !v)}
            className={cn(
              "h-8 px-3 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
              depositFilter
                ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
                : "border-sidebar-border text-muted-foreground hover:text-foreground"
            )}
          >
            <ShieldCheck className="w-3 h-3 shrink-0" />
            With Deposit
          </button>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-lg border border-sidebar-border bg-white/5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/50 w-52"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchRows()} disabled={loading} className="gap-1.5 h-8 text-xs" title="Reload — payments recorded elsewhere while this tab was open won't appear until refreshed">
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!!exporting || filteredRows.length === 0} className="gap-1.5 h-8 text-xs">
              {exporting === "pdf" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!!exporting || filteredRows.length === 0} className="gap-1.5 h-8 text-xs">
              {exporting === "xlsx" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
              Excel
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Room filter reflects each tenant&apos;s current room only — room history before this feature shipped isn&apos;t recoverable.
        </p>
      </div>

      {/* Landing table */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading ledger…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <BookOpen className="w-10 h-10 opacity-20" />
            <p className="text-sm">No members match these filters</p>
          </div>
        ) : (
          <>
            {/* ── Mobile cards (< md) ─────────────────────────────── */}
            <div className="md:hidden space-y-2.5">
              {filteredRows.map((r) => (
                <div
                  key={r.id}
                  onClick={() => openDrillIn(r)}
                  className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-2.5 active:bg-white/[0.04] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground leading-tight">{r.fullName}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {r.phone && <span className="text-xs text-muted-foreground">{r.phone}</span>}
                        {r.roomNumber && <span className="text-xs text-muted-foreground">Rm {r.roomNumber}</span>}
                      </div>
                      <p className="text-xs text-blue-400 mt-0.5">
                        {r.packageLabel}
                        {r.packagePrice > 0 && <span className="text-muted-foreground"> · {ledgerPackagePriceLabel(r)}</span>}
                      </p>
                    </div>
                    <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs capitalize shrink-0">
                      {LEDGER_STATUS_LABELS[r.status]}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Charged</p>
                      <p className="text-xs font-semibold">{formatCurrency(r.totalCharged)}</p>
                      {r.totalFoodCharge > 0 && <p className="text-[9px] text-amber">incl. {formatCurrency(r.totalFoodCharge)} food</p>}
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Paid</p>
                      <p className="text-xs font-semibold text-emerald-400">{formatCurrency(r.totalPaid)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Due</p>
                      <p className={`text-xs font-semibold ${r.totalOwed > 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                        {r.totalOwed > 0 ? formatCurrency(r.totalOwed) : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {r.securityDeposit > 0 ? (
                      <span className="text-xs text-violet-400 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {formatCurrency(r.securityDeposit)} deposit held</span>
                    ) : <span />}
                    {r.lastPaymentDate && (
                      <p className="text-xs text-muted-foreground">Last paid {formatDate(r.lastPaymentDate)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop table (≥ md) ────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                    <th className="text-left pb-2 pr-3">Tenant</th>
                    <th className="text-left pb-2 pr-3">Room</th>
                    <th className="text-left pb-2 pr-3">Plan</th>
                    <th className="text-right pb-2 pr-3">Package Price</th>
                    <th className="text-left pb-2 pr-3">Status</th>
                    <th className="text-right pb-2 pr-3">Charged</th>
                    <th className="text-right pb-2 pr-3">Paid</th>
                    <th className="text-right pb-2 pr-3">Due</th>
                    <th className="text-right pb-2 pr-3">Deposit</th>
                    <th className="text-left pb-2 pr-3">Last Payment</th>
                    <th className="text-right pb-2">&nbsp;</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sidebar-border/50">
                  {filteredRows.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02] cursor-pointer" onClick={() => openDrillIn(r)}>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">{r.fullName}</p>
                        {r.phone && <p className="text-xs text-muted-foreground">{r.phone}</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.roomNumber ? `Rm ${r.roomNumber}` : "—"}</td>
                      <td className="py-2.5 pr-3 text-blue-400">{r.packageLabel}</td>
                      <td className="py-2.5 pr-3 text-right text-muted-foreground">{ledgerPackagePriceLabel(r)}</td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs capitalize">
                          {LEDGER_STATUS_LABELS[r.status]}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        {formatCurrency(r.totalCharged)}
                        {r.totalFoodCharge > 0 && <p className="text-[10px] text-amber font-normal">incl. {formatCurrency(r.totalFoodCharge)} food</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-emerald-400">{formatCurrency(r.totalPaid)}</td>
                      <td className={`py-2.5 pr-3 text-right ${r.totalOwed > 0 ? "text-rose-400 font-semibold" : "text-muted-foreground"}`}>
                        {r.totalOwed > 0 ? formatCurrency(r.totalOwed) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-violet-400">{r.securityDeposit > 0 ? formatCurrency(r.securityDeposit) : "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.lastPaymentDate ? formatDate(r.lastPaymentDate) : "—"}</td>
                      <td className="py-2.5 text-right">
                        <Button variant="ghost" size="sm" className="h-7 text-xs">View</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Drill-in dialog */}
      <Dialog open={!!drillIn} onOpenChange={(open) => { if (!open) { setDrillIn(null); setDrillInEvents(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{drillIn?.fullName}</DialogTitle>
          </DialogHeader>

          {drillIn && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {drillIn.phone && <span>{drillIn.phone}</span>}
                {drillIn.roomNumber && <span>Room {drillIn.roomNumber}</span>}
                <span className="text-blue-400">
                  {drillIn.packageLabel}
                  {drillIn.packagePrice > 0 && ` · ${ledgerPackagePriceLabel(drillIn)}`}
                </span>
                <Badge variant={drillIn.status === "active" ? "default" : "secondary"} className="text-xs capitalize">
                  {LEDGER_STATUS_LABELS[drillIn.status]}
                </Badge>
              </div>

              <div className="rounded-xl bg-sidebar-accent/30 px-3 py-2.5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Charged</p>
                  <p className="text-sm font-semibold">{formatCurrency(drillIn.totalCharged)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid</p>
                  <p className="text-sm font-semibold text-emerald-400">{formatCurrency(drillIn.totalPaid)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Due</p>
                  <p className={`text-sm font-semibold ${drillIn.totalOwed > 0 ? "text-rose-400" : ""}`}>{formatCurrency(drillIn.totalOwed)}</p>
                </div>
              </div>

              {drillIn.securityDeposit > 0 && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] px-3 py-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0" />
                  <p className="text-sm">
                    <span className="font-semibold text-violet-400">{formatCurrency(drillIn.securityDeposit)}</span>
                    <span className="text-muted-foreground"> security deposit held</span>
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Timeline</p>

                {drillInLoading && (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                    Loading history…
                  </div>
                )}

                {!drillInLoading && drillInEvents !== null && drillInEvents.length === 0 && (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                    No history events yet.
                  </div>
                )}

                {!drillInLoading && (drillInEvents?.length ?? 0) > 0 && (
                  <div className="relative">
                    <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/10" />
                    <div className="space-y-4 pl-8">
                      {drillInEvents!.map((event) => (
                        <div key={event.id} className="relative">
                          <div className={`absolute -left-[21px] top-0.5 w-3 h-3 rounded-full border-2 flex items-center justify-center ${eventDotColor(event.type)}`}>
                            <span className="sr-only">{event.type}</span>
                          </div>

                          <div className="flex items-start justify-between gap-2 min-w-0">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <EventIcon type={event.type} />
                                <p className="text-sm font-medium text-foreground leading-snug">{event.label}</p>
                              </div>
                              {event.sub && <p className="text-xs text-muted-foreground mt-0.5">{event.sub}</p>}
                              {event.type === "payment" && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Rent: {formatCurrency(event.rentCharge ?? 0)}
                                  {(event.foodCharge ?? 0) > 0 && <> · Food: {formatCurrency(event.foodCharge!)}</>}
                                  {(event.acCharge ?? 0) > 0 && (
                                    <> · AC: {event.acUnitsConsumed != null ? `${event.acUnitsConsumed} units → ` : ""}{formatCurrency(event.acCharge!)}</>
                                  )}
                                  {(event.depositCharge ?? 0) > 0 && <> · Deposit: {formatCurrency(event.depositCharge!)}</>}
                                  {(event.lateFee ?? 0) > 0 && <> · Late Fee: {formatCurrency(event.lateFee!)}</>}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <p className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(event.date)}</p>
                              {(event.type === "payment" || event.type === "partially_paid") && event.paymentId && (
                                <button
                                  type="button"
                                  title="View Receipt"
                                  disabled={generatingReceipt === (event.installmentId ?? event.paymentId)}
                                  onClick={() => openReceipt(event.paymentId!, event.installmentId)}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                                >
                                  {generatingReceipt === (event.installmentId ?? event.paymentId)
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <ExternalLink className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Legacy view (backward compat) ────────────────────────────────────────────
function LegacyReportsView({ data }: { data: LegacyProps["data"] }) {
  const [period, setPeriod] = useState<3 | 6 | 12>(6);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-2 text-muted-foreground">
        <BarChart3 className="w-10 h-10 opacity-20" />
        <p className="text-sm">No data available. Add tenants and payments to see reports.</p>
      </div>
    );
  }

  const { revenueByMonth, aging, totalCapacity } = data;
  const months = revenueByMonth.slice(-period);

  const totalCollected = months.reduce((s, m) => s + m.collected, 0);
  const totalExpenses = months.reduce((s, m) => s + m.expenses, 0);
  const totalProfit = months.reduce((s, m) => s + m.profit, 0);
  const totalKitchen = months.reduce((s, m) => s + m.kitchen, 0);
  const totalSalaries = months.reduce((s, m) => s + m.salaries, 0);
  const totalGenExp = totalExpenses - totalKitchen - totalSalaries;
  const profitMargin = totalCollected > 0 ? Math.round((totalProfit / totalCollected) * 100) : 0;
  const avgOccupancy = months.length > 0 ? Math.round(months.reduce((s, m) => s + m.occupancyRate, 0) / months.length) : 0;
  const avgCollectionRate = (() => {
    const withDue = months.filter((m) => m.due > 0);
    return withDue.length > 0 ? Math.round(withDue.reduce((s, m) => s + m.collectionRate, 0) / withDue.length) : 0;
  })();
  const revPerBed = totalCapacity > 0 && months.length > 0 ? Math.round(totalCollected / (totalCapacity * months.length)) : 0;
  const bestMonth = months.length > 1 ? months.reduce((b, m) => m.profit > b.profit ? m : b, months[0]) : null;
  const worstMonth = months.length > 1 ? months.reduce((w, m) => m.profit < w.profit ? m : w, months[0]) : null;

  const agingRows = [
    { label: "0–30 days", bucket: aging.d30, color: "text-amber" },
    { label: "31–60 days", bucket: aging.d60, color: "text-orange-400" },
    { label: "61–90 days", bucket: aging.d90, color: "text-rose-400" },
    { label: "90+ days", bucket: aging.d90plus, color: "text-rose-600" },
  ];
  const totalAgingCount = aging.d30.count + aging.d60.count + aging.d90.count + aging.d90plus.count;

  const RevenueChart = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), { ssr: false });
  const ExpenseBreakdownChart = dynamic(() => import("./expense-breakdown-chart").then((m) => m.ExpenseBreakdownChart), { ssr: false });

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">Financial and operational analytics</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-sidebar-border bg-card p-1 self-start sm:self-auto">
          {([3, 6, 12] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === p ? "bg-amber text-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {p}M
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: `${period}-Mo Revenue`, value: formatCurrency(totalCollected), sub: `${avgCollectionRate}% collection rate`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: `${period}-Mo Expenses`, value: formatCurrency(totalExpenses), sub: `${formatCurrency(Math.round(totalExpenses / Math.max(1, period)))}/mo avg`, icon: BarChart3, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
          { label: `${period}-Mo Net Profit`, value: formatCurrency(totalProfit), sub: `${profitMargin >= 0 ? "+" : ""}${profitMargin}% margin`, icon: Banknote, color: totalProfit >= 0 ? "text-yellow-400" : "text-red-400", bg: totalProfit >= 0 ? "bg-yellow-500/10 border-yellow-500/20" : "bg-red-500/10 border-red-500/20" },
          { label: "Avg Occupancy", value: `${avgOccupancy}%`, sub: revPerBed > 0 ? `${formatCurrency(revPerBed)}/bed/mo` : "", icon: BedDouble, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-9 h-9 rounded-xl border ${bg} shrink-0`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-xl font-bold leading-none mt-0.5 ${color}`}>{value}</p>
                {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-sidebar-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Revenue vs Expenses</h2>
          <RevenueChart data={months} />
        </div>
        <div className="rounded-2xl border border-sidebar-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Expense Breakdown</h2>
          <ExpenseBreakdownChart data={months} />
        </div>
      </div>
    </div>
  );
}
