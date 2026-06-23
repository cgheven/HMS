import { getPartnerDashboardData } from "@/app/actions/partner";
import {
  BedDouble, Wallet, Clock, TrendingUp,
  Users, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default async function PartnerDashboardPage() {
  const { data, error } = await getPartnerDashboardData();

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground p-6">
        <BedDouble className="w-10 h-10 opacity-20" />
        <p className="text-sm">{error ?? "No data available"}</p>
      </div>
    );
  }

  const {
    hostelName, totalTenants, monthlyRevenue,
    collected, pendingAmount, occupancyRate,
    totalRooms, occupiedRooms, recentPayments,
  } = data;

  const collectionRate =
    monthlyRevenue > 0
      ? Math.min(100, Math.round((collected / monthlyRevenue) * 100))
      : 0;

  const statusConfig: Record<string, { label: string; color: string }> = {
    paid:    { label: "Paid",    color: "text-emerald-400" },
    pending: { label: "Pending", color: "text-amber" },
    overdue: { label: "Overdue", color: "text-rose-400" },
    waived:  { label: "Waived",  color: "text-muted-foreground" },
  };

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {hostelName} —{" "}
          {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} overview
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Tenants</p>
              <p className="text-2xl font-bold text-foreground leading-none mt-0.5">
                {totalTenants}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <Wallet className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Collected</p>
              <p className="text-xl font-bold text-foreground leading-none mt-0.5">
                {formatCurrency(collected)}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full"
                    style={{ width: `${collectionRate}%` }}
                  />
                </div>
                <span className="text-xs text-emerald-400 font-semibold">{collectionRate}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber/10 border border-amber/20 shrink-0">
              <Clock className="w-4 h-4 text-amber" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-xl font-bold text-foreground leading-none mt-0.5">
                {formatCurrency(pendingAmount)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
              <BedDouble className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Occupancy</p>
              <p className="text-2xl font-bold text-foreground leading-none mt-0.5">
                {occupancyRate}%
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {occupiedRooms}/{totalRooms} rooms
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Payments */}
      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-sidebar-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Recent Payments</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Latest payment activity</p>
          </div>
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
        </div>

        {recentPayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 opacity-20" />
            <p className="text-sm">No payment records yet</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {recentPayments.map((p) => {
              const cfg = statusConfig[p.status] ?? { label: p.status, color: "text-foreground" };
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber/10 border border-amber/20 shrink-0">
                    <span className="text-xs font-bold text-amber">
                      {p.tenantName[0]?.toUpperCase() ?? "?"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{p.tenantName}</p>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{p.for_month}</span>
                      {p.payment_date && (
                        <span className="text-xs text-muted-foreground">
                          Paid: {formatDate(p.payment_date)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(p.amount)}
                    </p>
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
