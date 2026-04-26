"use client";
import dynamic from "next/dynamic";
import { BarChart3, TrendingUp, Users, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { RevenueMonth, AgingBucket } from "@/types";

const RevenueChart = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse bg-white/5 rounded-xl" />,
});
const CollectionChart = dynamic(() => import("./collection-chart").then((m) => m.CollectionChart), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse bg-white/5 rounded-xl" />,
});

interface Props {
  data: {
    hostelId: string;
    revenueByMonth: RevenueMonth[];
    aging: { d30: AgingBucket; d60: AgingBucket; d90: AgingBucket; d90plus: AgingBucket };
  } | null;
}

export function ReportsClient({ data }: Props) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-2 text-muted-foreground">
        <BarChart3 className="w-10 h-10 opacity-20" />
        <p className="text-sm">No data available. Add tenants and payments to see reports.</p>
      </div>
    );
  }

  const { revenueByMonth, aging } = data;

  const totalCollected = revenueByMonth.reduce((s, m) => s + m.collected, 0);
  const totalExpenses = revenueByMonth.reduce((s, m) => s + m.expenses, 0);
  const avgOccupancy = revenueByMonth.length > 0
    ? Math.round(revenueByMonth.reduce((s, m) => s + m.occupancyRate, 0) / revenueByMonth.length)
    : 0;
  const avgCollection = revenueByMonth.filter(m => m.due > 0).length > 0
    ? Math.round(revenueByMonth.filter(m => m.due > 0).reduce((s, m) => s + m.collectionRate, 0) / revenueByMonth.filter(m => m.due > 0).length)
    : 0;

  const agingRows = [
    { label: "0–30 days", bucket: aging.d30, color: "text-amber" },
    { label: "31–60 days", bucket: aging.d60, color: "text-orange-400" },
    { label: "61–90 days", bucket: aging.d90, color: "text-rose-400" },
    { label: "90+ days", bucket: aging.d90plus, color: "text-rose-600" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">6-month analytics overview</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "6-Mo Revenue", value: formatCurrency(totalCollected), icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "6-Mo Expenses", value: formatCurrency(totalExpenses), icon: BarChart3, color: "text-rose-400", bg: "bg-rose-500/10 border border-rose-500/20" },
          { label: "Avg Occupancy", value: `${avgOccupancy}%`, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
          { label: "Avg Collection", value: `${avgCollection}%`, icon: TrendingUp, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-sidebar-border bg-card p-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">Revenue vs Expenses</h2>
          <p className="text-xs text-muted-foreground mb-4">Collected rent vs total operating costs</p>
          <RevenueChart data={revenueByMonth} />
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">Collection Rate</h2>
          <p className="text-xs text-muted-foreground mb-4">% of rent collected per month</p>
          <CollectionChart data={revenueByMonth} />
        </div>
      </div>

      {/* Turnover + Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tenant Turnover */}
        <div className="rounded-2xl border border-sidebar-border bg-card p-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">Tenant Turnover</h2>
          <p className="text-xs text-muted-foreground mb-4">Move-ins and move-outs per month</p>
          <div className="space-y-2">
            <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium border-b border-sidebar-border pb-2">
              <span>Month</span><span className="text-center">Move-ins</span><span className="text-right">Move-outs</span>
            </div>
            {revenueByMonth.map((m) => (
              <div key={m.monthKey} className="grid grid-cols-3 text-sm py-1.5">
                <span className="text-muted-foreground">{m.month}</span>
                <span className={`text-center font-medium ${m.moveIns > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {m.moveIns > 0 ? `+${m.moveIns}` : "—"}
                </span>
                <span className={`text-right font-medium ${m.moveOuts > 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                  {m.moveOuts > 0 ? `-${m.moveOuts}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Overdue Aging */}
        <div className="rounded-2xl border border-sidebar-border bg-card p-6">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-semibold text-foreground">Overdue Aging</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Pending payments by age</p>
          <div className="space-y-3">
            {agingRows.map(({ label, bucket, color }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className={`text-xs font-medium ${color}`}>{bucket.count} tenant{bucket.count !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bucket.count > 0 ? "bg-current" : ""} ${color}`}
                      style={{ width: bucket.count > 0 ? `${Math.min(100, (bucket.count / Math.max(1, aging.d30.count + aging.d60.count + aging.d90.count + aging.d90plus.count)) * 100)}%` : "0%" }}
                    />
                  </div>
                </div>
                <span className="text-sm font-semibold text-foreground shrink-0 w-24 text-right">{formatCurrency(bucket.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Occupancy trend table */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground mb-1">Occupancy Trend</h2>
        <p className="text-xs text-muted-foreground mb-4">Bed occupancy rate over 6 months</p>
        <div className="grid grid-cols-6 gap-2">
          {revenueByMonth.map((m) => (
            <div key={m.monthKey} className="text-center">
              <div className="relative h-24 bg-white/5 rounded-lg overflow-hidden">
                <div
                  className="absolute bottom-0 left-0 right-0 bg-amber/30 transition-all"
                  style={{ height: `${m.occupancyRate}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold text-foreground">{m.occupancyRate}%</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{m.month}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
