"use client";
import dynamic from "next/dynamic";
import {
  BedDouble, Wallet, TrendingDown, Banknote,
  Clock, CheckCircle2, FileWarning, ChefHat, Users, UserCog, ShieldCheck,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { DashboardStats, Bill, Defaulter } from "@/types";

const ExpenseChart = dynamic(
  () => import("./expense-chart").then((m) => m.ExpenseChart),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-white/5" /> }
);

interface Props {
  data: {
    hostelId: string;
    stats: DashboardStats;
    upcomingBills: Bill[];
    monthlyData: { month: string; expenses: number; kitchen: number; collected: number }[];
    defaulters: Defaulter[];
  } | null;
}

export function DashboardClient({ data }: Props) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
        <BedDouble className="w-10 h-10 opacity-20" />
        <p className="text-sm">No hostel data. Complete setup in Settings.</p>
      </div>
    );
  }

  const { stats, upcomingBills, monthlyData, defaulters } = data;
  const isProfit = stats.net_profit >= 0;
  const monthlyExpected = stats.monthly_collected + stats.monthly_uncollected;
  const collectionRate = monthlyExpected > 0
    ? Math.min(100, Math.round((stats.monthly_collected / monthlyExpected) * 100))
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} overview
        </p>
      </div>

      {/* ── 4 Hero KPI Cards ─────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Net Profit — most prominent, full-width on mobile */}
        <div className={`col-span-2 lg:col-span-1 relative rounded-2xl border p-4 sm:p-5 transition-all duration-300 animate-fade-up ${isProfit ? "border-emerald-500/30 bg-emerald-500/[0.06] hover:border-emerald-500/50" : "border-rose-500/30 bg-rose-500/[0.06] hover:border-rose-500/50"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net Profit</p>
              <p className={`mt-2 text-3xl font-bold leading-none ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                {formatCurrency(stats.net_profit)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {isProfit ? "↑ Profit this month" : "↓ Loss this month"}
              </p>
            </div>
            <div className={`flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 ${isProfit ? "bg-emerald-500/10 border-emerald-500/20" : "bg-rose-500/10 border-rose-500/20"}`}>
              <Banknote className={`w-4 h-4 ${isProfit ? "text-emerald-400" : "text-rose-400"}`} />
            </div>
          </div>
        </div>

        {/* Collected */}
        <div className="relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 hover:border-emerald-500/30 transition-all animate-fade-up" style={{ animationDelay: "75ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Collected</p>
              <p className="mt-2 text-lg sm:text-2xl font-bold leading-none">{formatCurrency(stats.monthly_collected)}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${collectionRate}%` }} />
                </div>
                <span className="text-xs text-emerald-400 font-semibold shrink-0">{collectionRate}%</span>
              </div>
              <p className="mt-1 text-[10px] sm:text-xs text-muted-foreground">{formatCurrency(monthlyExpected)} expected</p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
            </div>
          </div>
        </div>

        {/* Outstanding */}
        <div className="relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 hover:border-amber/30 transition-all animate-fade-up" style={{ animationDelay: "150ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Outstanding</p>
              <p className="mt-2 text-lg sm:text-2xl font-bold leading-none">{formatCurrency(stats.monthly_uncollected)}</p>
              <p className="mt-2 text-[10px] sm:text-xs text-muted-foreground">
                {defaulters.length > 0
                  ? `${defaulters.length} tenant${defaulters.length !== 1 ? "s" : ""} yet to pay`
                  : "Nothing pending"}
              </p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber/10 border border-amber/20 shrink-0">
              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber" />
            </div>
          </div>
        </div>

        {/* Occupancy */}
        <div className="relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 hover:border-blue-500/30 transition-all animate-fade-up" style={{ animationDelay: "225ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Occupancy</p>
              <p className="mt-2 text-lg sm:text-2xl font-bold leading-none">{stats.occupancy_rate}%</p>
              <p className="mt-2 text-[10px] sm:text-xs text-muted-foreground">
                {stats.occupied_rooms}/{stats.total_rooms} rooms · {stats.available_rooms} empty
              </p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
              <BedDouble className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Active Tenants", value: String(stats.total_tenants),           sub: undefined,                                          icon: Users,        color: "text-blue-400",   iconBg: "bg-blue-500/10 border-blue-500/20",     hover: "hover:border-blue-500/30",   delay: 150 },
          { label: "Kitchen Costs",  value: formatCurrency(stats.monthly_kitchen),  sub: undefined,                                          icon: ChefHat,      color: "text-amber",       iconBg: "bg-amber/10 border-amber/20",            hover: "hover:border-amber/30",       delay: 225 },
          { label: "Staff Salaries", value: formatCurrency(stats.monthly_salaries), sub: undefined,                                          icon: UserCog,      color: "text-purple-400", iconBg: "bg-purple-500/10 border-purple-500/20",  hover: "hover:border-purple-500/30",  delay: 300 },
          { label: "Total Expenses", value: formatCurrency(stats.monthly_expenses), sub: undefined,                                          icon: TrendingDown, color: "text-rose-400",   iconBg: "bg-rose-500/10 border-rose-500/20",      hover: "hover:border-rose-500/30",    delay: 375 },
          {
            label: "Deposits Held",
            value: formatCurrency(stats.security_deposit_total),
            sub: stats.security_deposit_count > 0
              ? `${stats.security_deposit_count} tenant${stats.security_deposit_count !== 1 ? "s" : ""}`
              : "No deposits yet",
            icon: ShieldCheck, color: "text-violet-400", iconBg: "bg-violet-500/10 border-violet-500/20", hover: "hover:border-violet-500/30", delay: 450,
          },
        ].map(({ label, value, sub, icon: Icon, color, iconBg, hover, delay }) => (
          <div
            key={label}
            className={`relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 ${hover} transition-all animate-fade-up`}
            style={{ animationDelay: `${delay}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
                <p className={`mt-2 text-lg sm:text-2xl font-bold leading-none ${color}`}>{value}</p>
                {sub && <p className="mt-1.5 text-[10px] sm:text-xs text-muted-foreground">{sub}</p>}
              </div>
              <div className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl border shrink-0 ${iconBg}`}>
                <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Defaulters + Chart ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Who hasn't paid */}
        <div className="lg:col-span-2 rounded-2xl border border-sidebar-border bg-card p-6 animate-fade-up animate-delay-300">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Pending Payments</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Who hasn't paid this month</p>
            </div>
            {defaulters.length > 0 && (
              <Badge variant="destructive" className="text-xs tabular-nums">{defaulters.length}</Badge>
            )}
          </div>

          {defaulters.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[180px] gap-2 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 opacity-30 text-emerald-400" />
              <p className="text-sm font-medium text-emerald-400">All caught up</p>
              <p className="text-xs">Every tenant paid this month</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto scrollbar-hide">
              {defaulters.map((d, i) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 animate-fade-up"
                  style={{ animationDelay: `${300 + i * 60}ms` }}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber/10 border border-amber/20 shrink-0">
                    <span className="text-xs font-bold text-amber">{d.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <span className={`text-xs font-medium capitalize ${d.status === "overdue" ? "text-rose-400" : "text-amber"}`}>
                      {d.status}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-foreground shrink-0">{formatCurrency(d.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Revenue vs Expenses Chart */}
        <div className="lg:col-span-3 rounded-2xl border border-sidebar-border bg-card p-6 animate-fade-up animate-delay-300">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Revenue vs Expenses</h2>
              <p className="text-xs text-muted-foreground mt-0.5">6-month trend — green above red = profit</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 rounded-full bg-emerald-400 inline-block" /> Revenue</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 rounded-full bg-rose-400 inline-block" /> Spend</span>
            </div>
          </div>
          <ExpenseChart data={monthlyData} />
        </div>
      </div>

      {/* ── Pending Bills (only if any) ───────────────────── */}
      {upcomingBills.length > 0 && (
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 animate-fade-up animate-delay-400">
          <div className="flex items-center gap-2 mb-4">
            <FileWarning className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-semibold text-foreground">Pending Bills</h2>
            <Badge variant="destructive" className="text-xs ml-auto">{upcomingBills.length}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {upcomingBills.map((bill, i) => (
              <div
                key={bill.id}
                className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 animate-fade-up"
                style={{ animationDelay: `${400 + i * 60}ms` }}
              >
                <div className={`w-1.5 h-8 rounded-full shrink-0 ${bill.status === "overdue" ? "bg-rose-500" : "bg-amber"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{bill.title}</p>
                  <p className="text-xs text-muted-foreground">Due {formatDate(bill.due_date)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-foreground">{formatCurrency(bill.amount)}</p>
                  <p className={`text-xs font-medium capitalize ${bill.status === "overdue" ? "text-rose-400" : "text-amber"}`}>
                    {bill.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
