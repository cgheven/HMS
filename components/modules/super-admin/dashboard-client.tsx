"use client";

import Link from "next/link";
import { Building2, Users, CreditCard, Inbox, ArrowRight, Crown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { SuperAdminStats, SuperHostelRow } from "@/app/actions/super-admin";
import type { PlatformLead } from "@/types";
import { cn } from "@/lib/utils";

const LEAD_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new:       { label: "New",       cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  contacted: { label: "Contacted", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  converted: { label: "Converted", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected:  { label: "Rejected",  cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

interface Props {
  stats: SuperAdminStats;
  recentLeads: PlatformLead[];
  hostelsSummary: SuperHostelRow[];
}

export function SuperAdminDashboardClient({ stats, recentLeads, hostelsSummary }: Props) {
  const statCards = [
    {
      label: "Total Hostels",
      value: stats.totalHostels,
      icon: Building2,
      color: "text-amber-400",
      bg: "bg-amber/10",
      border: "border-amber/20",
    },
    {
      label: "Active Tenants",
      value: stats.totalActiveTenants,
      icon: Users,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
    },
    {
      label: "Revenue This Month",
      value: formatCurrency(stats.totalRevenueThisMonth),
      icon: CreditCard,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
    },
    {
      label: "New Leads This Month",
      value: stats.newLeadsThisMonth,
      icon: Inbox,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="border-b border-sidebar-border px-4 sm:px-6 py-4">
        <div className="flex items-center gap-3 max-w-7xl mx-auto">
          <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
            <Crown className="w-4 h-4 text-amber" />
          </div>
          <div>
            <h1 className="text-base font-bold">Super Admin Dashboard</h1>
            <p className="text-xs text-muted-foreground">Platform-wide overview and metrics</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(({ label, value, icon: Icon, color, bg, border }) => (
            <Card key={label}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className={cn("p-2.5 rounded-lg border shrink-0", bg, border)}>
                  <Icon className={cn("w-5 h-5", color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold truncate">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Leads */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Recent Leads</CardTitle>
                  <CardDescription>Last 10 platform onboarding requests</CardDescription>
                </div>
                <Link
                  href="/super-admin/leads"
                  className="flex items-center gap-1 text-xs text-amber hover:text-amber/80 transition-colors"
                >
                  View all
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recentLeads.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Inbox className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No leads yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Business</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Status</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {recentLeads.map((lead) => {
                        const badge = LEAD_STATUS_MAP[lead.status] ?? LEAD_STATUS_MAP["new"];
                        return (
                          <tr key={lead.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-medium text-sm truncate max-w-[160px]">{lead.business_name}</p>
                              <p className="text-xs text-muted-foreground truncate">{lead.owner_name}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium",
                                  badge.cls
                                )}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                              {formatDate(lead.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Hostels Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Hostels Summary</CardTitle>
                  <CardDescription>Recently onboarded properties</CardDescription>
                </div>
                <Link
                  href="/super-admin/hostels"
                  className="flex items-center gap-1 text-xs text-amber hover:text-amber/80 transition-colors"
                >
                  View all
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {hostelsSummary.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Building2 className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No hostels yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Hostel</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Owner</th>
                        <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Tenants</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {hostelsSummary.map((h) => (
                        <tr key={h.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-amber/10 border border-amber/20 flex items-center justify-center shrink-0">
                                <Building2 className="w-3.5 h-3.5 text-amber" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate max-w-[140px]">{h.name}</p>
                                <p className="text-xs text-muted-foreground">{h.city ?? "—"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <p className="text-sm truncate max-w-[120px]">{h.owner_name ?? "—"}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-medium">{h.tenant_count}</span>
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
    </div>
  );
}
