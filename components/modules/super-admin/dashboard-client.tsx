"use client";

import { Fragment } from "react";
import Link from "next/link";
import {
  Building2, Users, Wallet, AlertCircle, ArrowRight, Crown, TrendingUp, UserRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { SuperAdminStats, ClientSummaryRow } from "@/app/actions/super-admin";
import { cn } from "@/lib/utils";

const HOSTEL_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  boys:  { label: "Boys",  cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  girls: { label: "Girls", cls: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
};

// Fixed width and centred so Boys and Girls occupy the same footprint — the
// badges then form a straight column instead of stepping in and out.
function TypeBadge({ type }: { type: string | null }) {
  const cfg = type ? HOSTEL_TYPE_LABEL[type] : undefined;
  if (!cfg) {
    return <span className="inline-flex w-full justify-center text-[10px] text-muted-foreground/50">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex w-full justify-center px-1.5 py-0.5 rounded border text-[10px] font-semibold",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}

interface Props {
  stats: SuperAdminStats;
  clients: ClientSummaryRow[];
}

export function SuperAdminDashboardClient({ stats, clients }: Props) {
  const hasOverdue = stats.overdue > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Page header — h-14 to match the sidebar's brand bar exactly, so the two
          bottom borders form one continuous line across the viewport. */}
      <div className="border-b border-sidebar-border px-4 sm:px-6 h-14 flex items-center">
        <div className="flex items-center gap-3 max-w-7xl mx-auto w-full">
          <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
            <Crown className="w-4 h-4 text-amber" />
          </div>
          <div>
            <h1 className="text-base font-bold">Super Admin Dashboard</h1>
            <p className="text-xs text-muted-foreground">Your revenue and client base</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-6">
        {/* Money — Pulse's own, not the rent flowing through the platform */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-2.5 rounded-lg border shrink-0 bg-emerald-500/10 border-emerald-500/20">
                <Wallet className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Collected</p>
                <p className="text-2xl font-bold truncate">{formatCurrency(stats.collected)}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Invoices marked paid</p>
              </div>
            </CardContent>
          </Card>

          <Card className={cn(hasOverdue && "border-rose-500/30")}>
            <CardContent className="p-5 flex items-center gap-4">
              <div
                className={cn(
                  "p-2.5 rounded-lg border shrink-0",
                  hasOverdue ? "bg-rose-500/10 border-rose-500/20" : "bg-amber/10 border-amber/20"
                )}
              >
                <AlertCircle className={cn("w-5 h-5", hasOverdue ? "text-rose-400" : "text-amber")} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="text-2xl font-bold truncate">{formatCurrency(stats.outstanding)}</p>
                <p
                  className={cn(
                    "text-[11px] mt-0.5",
                    hasOverdue ? "text-rose-400 font-medium" : "text-muted-foreground/70"
                  )}
                >
                  {hasOverdue ? `${formatCurrency(stats.overdue)} overdue` : "Nothing overdue"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-2.5 rounded-lg border shrink-0 bg-purple-500/10 border-purple-500/20">
                <TrendingUp className="w-5 h-5 text-purple-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Monthly Recurring</p>
                <p className="text-2xl font-bold truncate">{formatCurrency(stats.mrr)}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Contracted per month</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-2.5 rounded-lg border shrink-0 bg-amber/10 border-amber/20">
                <UserRound className="w-5 h-5 text-amber" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Clients</p>
                <p className="text-2xl font-bold truncate">{stats.totalClients}</p>
                <p
                  className={cn(
                    "text-[11px] mt-0.5",
                    stats.unbilledClients > 0 ? "text-amber" : "text-muted-foreground/70"
                  )}
                >
                  {stats.unbilledClients > 0
                    ? `${stats.unbilledClients} not billed yet`
                    : "All billed"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Scale — clients' scale, explicitly not Pulse income */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground/70" />
            <strong className="text-foreground font-semibold">{stats.totalBranches}</strong> branches
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-muted-foreground/70" />
            <strong className="text-foreground font-semibold">{stats.totalActiveTenants}</strong> active tenants
          </span>
          <span className="text-muted-foreground/50">Test accounts excluded</span>
        </div>

        {/* Clients */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Clients ({clients.length})</CardTitle>
                <CardDescription>Every branch, tenant count and type per client</CardDescription>
              </div>
              <Link
                href="/super-admin/hostels"
                className="flex items-center gap-1 text-xs text-amber hover:text-amber/80 transition-colors"
              >
                Manage
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {clients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Building2 className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No clients yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Client</th>
                      <th className="text-center text-xs font-medium text-muted-foreground px-4 py-2.5">Total Branches</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Branch Breakdown</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Total Tenants</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Rate</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5 hidden md:table-cell">Owed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {clients.map((c) => (
                      <tr key={c.owner_id} className="align-top hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium">{c.owner_name ?? "Unnamed"}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[220px]">{c.owner_email}</p>
                        </td>
                        <td className="px-4 py-3 text-center text-lg font-bold tabular-nums">
                          {c.branch_count}
                        </td>
                        {/* One shared grid rather than a flex row per branch, so the
                            Boys/Girls badges and tenant counts line up in fixed columns
                            instead of drifting with each branch name's length. */}
                        <td className="px-4 py-3">
                          {c.branches.length === 0 ? (
                            <span className="text-xs text-muted-foreground/60">No branches</span>
                          ) : (
                            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem] items-center gap-x-3 gap-y-1.5 text-xs">
                              {c.branches.map((b) => (
                                <Fragment key={b.id}>
                                  <span className="truncate text-foreground/90" title={b.name}>{b.name}</span>
                                  <TypeBadge type={b.hostel_type} />
                                  <span className="text-right tabular-nums text-muted-foreground whitespace-nowrap">
                                    {b.tenant_count} <span className="text-muted-foreground/50">tenants</span>
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-lg font-bold tabular-nums">
                          {c.tenant_count}
                        </td>
                        <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap">
                          {c.monthly_rate == null ? (
                            <span className="text-xs text-amber">Not billed</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {formatCurrency(c.monthly_rate)}/branch
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell whitespace-nowrap">
                          {c.outstanding > 0 ? (
                            <span className="text-xs font-medium text-rose-400">
                              {formatCurrency(c.outstanding)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
