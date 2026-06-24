"use client";
import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  BarChart3, TrendingUp, Users, AlertTriangle, Banknote, BedDouble,
  TrendingDown, Download, FileSpreadsheet, RefreshCw, Zap, Package,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { getReportData, type ReportData } from "@/app/actions/reports";
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
  if (preset === "last_3") {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { from: getMonthKey(d), to: currentMk, label: "Last 3 Months" };
  }
  if (preset === "last_6") {
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { from: getMonthKey(d), to: currentMk, label: "Last 6 Months" };
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
// One distinct color per plan tier
const PLAN_COLORS = ["#f5a623", "#10b981", "#3b82f6", "#a855f7", "#06b6d4"];

// ── Main component ────────────────────────────────────────────────────────────
export function ReportsClient(props: Props) {
  const [tab, setTab] = useState("overview");
  const [preset, setPreset] = useState("last_6");
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

  const revenueDonutData = d ? [
    { name: "Rent", value: d.revenueByMonth.reduce((s, m) => s + m.rentRevenue, 0) },
    { name: "Food", value: d.revenueByMonth.reduce((s, m) => s + m.foodRevenue, 0) },
    { name: "AC", value: d.revenueByMonth.reduce((s, m) => s + m.acRevenue, 0) },
  ].filter((x) => x.value > 0) : [];

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
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { id: "this_month", label: "This Month" },
            { id: "last_month", label: "Last Month" },
            { id: "last_3", label: "3 Months" },
            { id: "last_6", label: "6 Months" },
            { id: "last_12", label: "12 Months" },
            { id: "custom", label: "Custom" },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => {
                if (p.id === "custom") { setShowCustom(true); return; }
                handlePreset(p.id);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                (p.id !== "custom" && preset === p.id && !showCustom) || (p.id === "custom" && showCustom)
                  ? "bg-amber text-background border-amber"
                  : "border-sidebar-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
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
            <TabsTrigger value="overview"><BarChart3 className="w-3.5 h-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="revenue"><TrendingUp className="w-3.5 h-3.5" /> Revenue</TabsTrigger>
            <TabsTrigger value="occupancy"><BedDouble className="w-3.5 h-3.5" /> Occupancy</TabsTrigger>
            <TabsTrigger value="ac"><Zap className="w-3.5 h-3.5" /> AC Analytics</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            {/* 4 KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Revenue", value: formatCurrency(d.totalRevenue), icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                { label: "Pending Collections", value: formatCurrency(d.pendingCollections), icon: AlertTriangle, color: "text-amber", bg: "bg-amber/10 border-amber/20" },
                { label: "Occupancy Rate", value: `${d.occupancyRate}%`, icon: BedDouble, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
                { label: "New Tenants", value: String(d.newTenants), icon: Users, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-9 h-9 rounded-xl border ${bg} shrink-0`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-xl font-bold leading-none mt-0.5">{value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bar chart: Revenue vs Expenses */}
            <div className="rounded-2xl border border-sidebar-border bg-card p-6">
              <h2 className="text-sm font-semibold mb-1">Revenue vs Expenses by Month</h2>
              <p className="text-xs text-muted-foreground mb-4">Last {d.monthlyExpenses.length} months</p>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.monthlyExpenses} barGap={2}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip content={currencyTooltip as never} />
                    <Bar dataKey="collected" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="General Exp" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="kitchen" name="Kitchen" fill="#f5a623" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="salaries" name="Salaries" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-3 mt-3 justify-center">
                {[
                  { label: "Revenue", color: "bg-emerald-400" },
                  { label: "General Exp", color: "bg-rose-400" },
                  { label: "Kitchen", color: "bg-amber" },
                  { label: "Salaries", color: "bg-purple-400" },
                ].map(({ label, color }) => (
                  <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Revenue donut + Top tenants */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {revenueDonutData.length > 0 && (
                <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                  <h2 className="text-sm font-semibold mb-1">Revenue Breakdown</h2>
                  <p className="text-xs text-muted-foreground mb-4">Rent / Food / AC share</p>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={revenueDonutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {revenueDonutData.map((_, index) => (
                            <Cell key={index} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {d.topTenants.length > 0 && (
                <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                  <h2 className="text-sm font-semibold mb-4">Top Tenants by Payment</h2>
                  <div className="space-y-3">
                    {d.topTenants.map((t, i) => (
                      <div key={t.id} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                          <div className="h-1.5 bg-white/5 rounded-full mt-1 overflow-hidden">
                            <div
                              className="h-full bg-amber rounded-full"
                              style={{ width: `${Math.round((t.totalPaid / (d.topTenants[0]?.totalPaid || 1)) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-foreground shrink-0">{formatCurrency(t.totalPaid)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Plan Distribution */}
            {d.planDistribution.length > 0 && (
              <div className="rounded-2xl border border-sidebar-border bg-card p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Plan Distribution</h2>
                </div>
                <p className="text-xs text-muted-foreground mb-5">Active tenants by package · most to least preferred</p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Donut chart */}
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={d.planDistribution}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={3}
                        >
                          {d.planDistribution.map((_, idx) => (
                            <Cell key={idx} fill={PLAN_COLORS[idx % PLAN_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [`${value} tenant${value !== 1 ? "s" : ""}`, name]}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--sidebar-border))", borderRadius: 12, fontSize: 12 }}
                        />
                        <Legend
                          formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                          wrapperStyle={{ fontSize: 11 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Ranked list */}
                  <div className="space-y-3 self-center">
                    {d.planDistribution.map((plan, idx) => (
                      <div key={plan.tier}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ background: PLAN_COLORS[idx % PLAN_COLORS.length] }}
                            />
                            <span className="text-sm font-medium text-foreground truncate">{plan.label}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-2">
                            <span className="text-xs text-muted-foreground">{plan.count} tenant{plan.count !== 1 ? "s" : ""}</span>
                            <span className="text-xs font-semibold text-foreground w-8 text-right">{plan.percentage}%</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${plan.percentage}%`,
                              background: PLAN_COLORS[idx % PLAN_COLORS.length],
                            }}
                          />
                        </div>
                        {plan.revenue > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5 text-right">{formatCurrency(plan.revenue)} collected</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Summary insight strip */}
                {d.planDistribution.length >= 2 && (
                  <div className="mt-5 pt-4 border-t border-sidebar-border/60 flex flex-wrap gap-x-6 gap-y-1">
                    <p className="text-xs text-muted-foreground">
                      Most preferred: <span className="text-foreground font-medium">{d.planDistribution[0].label}</span>
                      {" "}({d.planDistribution[0].percentage}%)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Least preferred: <span className="text-foreground font-medium">{d.planDistribution[d.planDistribution.length - 1].label}</span>
                      {" "}({d.planDistribution[d.planDistribution.length - 1].percentage}%)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total active tenants: <span className="text-foreground font-medium">{d.planDistribution.reduce((s, p) => s + p.count, 0)}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
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
                      <BarChart data={d.acByRoom.slice(0, 10)} layout="vertical">
                        <XAxis type="number" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="roomNumber" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={50} />
                        <Tooltip formatter={(v: number) => `${v} kWh`} />
                        <Bar dataKey="unitsConsumed" name="Units (kWh)" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                          {d.acByRoom.slice(0, 10).map((_, idx) => (
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
        </Tabs>
      )}
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
