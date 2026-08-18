"use client";

import { useMemo, useState } from "react";
import { AlertCircle, BedDouble, Megaphone, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";
import type { GrowthBranchRow, GrowthTotals } from "@/types";

interface Props {
  branches: GrowthBranchRow[];
  totals: GrowthTotals | null;
  loadError: string | null;
}

type SortKey = "empty" | "occupancy" | "revenue" | "name";

// Occupancy read as a health signal rather than a number. The thresholds are
// deliberately blunt: a sales conversation only ever needs "room to fill",
// "filling up" or "full", and a finer scale invites arguing about the boundary.
function occupancyTone(pct: number, capacity: number) {
  if (capacity === 0) return "text-muted-foreground/40";
  if (pct >= 90) return "text-emerald-400";
  if (pct >= 70) return "text-amber";
  return "text-orange-400";
}

export function GrowthClient({ branches, totals, loadError }: Props) {
  const [sort, setSort] = useState<SortKey>("empty");

  const sorted = useMemo(() => {
    const list = [...branches];
    switch (sort) {
      case "occupancy":
        return list.sort((a, b) => a.occupancyPercent - b.occupancyPercent);
      case "revenue":
        return list.sort((a, b) => b.referralRevenue - a.referralRevenue);
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      default:
        // Most empty beds first: the branch with the biggest hole is the one
        // worth a call, and it is the number the whole page exists to surface.
        return list.sort((a, b) => b.emptySeats - a.emptySeats);
    }
  }, [branches, sort]);

  // The one line a salesperson repeats. Kept as a derived sentence rather than
  // four separate tiles because the argument only works assembled: this much
  // was earned, this little was given away to earn it.
  const proofLine = useMemo(() => {
    if (!totals || totals.referralsJoined === 0) return null;
    const net = totals.referralRevenue - totals.referralDiscounts;
    return `${totals.referralsJoined} tenant${totals.referralsJoined === 1 ? "" : "s"} came in through a referral, paying ${formatCurrency(totals.referralRevenue)} — for ${formatCurrency(totals.referralDiscounts)} in discounts. Net ${formatCurrency(net)}.`;
  }, [totals]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Could not load analytics</p>
          <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
        </div>
      </div>
    );
  }

  const tiles = [
    {
      label: "Empty seats",
      value: totals ? String(totals.emptySeats) : "—",
      hint: totals ? `across ${totals.branches} branches` : "",
      icon: BedDouble,
      tone: "text-orange-400",
    },
    {
      label: "Occupancy",
      value: totals ? `${totals.occupancyPercent}%` : "—",
      hint: totals ? `${totals.filled} of ${totals.capacity} beds` : "",
      icon: TrendingUp,
      tone: "text-emerald-400",
    },
    {
      label: "Referral revenue",
      value: totals ? formatCurrency(totals.referralRevenue) : "—",
      hint: totals ? `${totals.referralsJoined} joined` : "",
      icon: Wallet,
      tone: "text-emerald-400",
    },
    {
      label: "Pulse commission",
      value: totals ? formatCurrency(totals.pulseCommission) : "—",
      hint: totals ? `${totals.branchesRunningReferrals} branch${totals.branchesRunningReferrals === 1 ? "" : "es"} running it` : "",
      icon: Megaphone,
      tone: "text-amber",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">Growth</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Where the empty beds are, and what referrals have returned on the branches running them
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map(({ label, value, hint, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{label}</p>
              <Icon className={cn("w-4 h-4", tone)} />
            </div>
            <p className={cn("text-xl font-bold mt-2 truncate", tone)}>{value}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 h-4 truncate">{hint}</p>
          </div>
        ))}
      </div>

      {proofLine && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
            The pitch
          </p>
          <p className="text-sm text-foreground mt-1.5 leading-relaxed">{proofLine}</p>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Branches</CardTitle>
            <CardDescription>
              Occupancy is counted from tenants actually holding a room. All-time referral figures.
            </CardDescription>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="shrink-0 rounded-lg border border-sidebar-border bg-background px-2.5 py-1.5 text-xs text-foreground"
          >
            <option value="empty">Most empty seats</option>
            <option value="occupancy">Lowest occupancy</option>
            <option value="revenue">Most referral revenue</option>
            <option value="name">Name</option>
          </select>
        </CardHeader>
        <CardContent className="p-0">
          {/* Header is its own grid, so every track here must match the row
              grid exactly — an `auto` track sizes to its own content and the
              two grids then drift apart column by column. */}
          <div className="hidden md:grid md:grid-cols-[minmax(0,1.7fr)_5rem_5rem_6rem_7rem_8rem_7rem] gap-x-3 px-4 py-2 border-b border-sidebar-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Branch</span>
            <span className="text-right">Beds</span>
            <span className="text-right">Filled</span>
            <span className="text-right">Empty</span>
            <span className="text-right">Occupancy</span>
            <span className="text-right">Referral revenue</span>
            <span className="text-right">Commission</span>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No branches yet.</p>
          ) : (
            sorted.map((b) => (
              <div
                key={b.hostelId}
                className="md:grid md:grid-cols-[minmax(0,1.7fr)_5rem_5rem_6rem_7rem_8rem_7rem] md:items-center md:gap-x-3 px-4 py-3 border-b border-sidebar-border/60 last:border-b-0 hover:bg-white/[0.02] transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{b.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {b.city ?? "—"}
                    {b.referralEnabled && (
                      <span className="text-emerald-400"> · referrals {b.campaign}</span>
                    )}
                    {/* Surfaced rather than folded in: these tenants pay but hold
                        no bed, so they are outside the occupancy ratio entirely
                        and would otherwise look like missing people. */}
                    {b.unroomedTenants > 0 && (
                      <span className="text-muted-foreground/60">
                        {" "}· {b.unroomedTenants} without a room
                      </span>
                    )}
                  </p>
                  {/* Phone: the desktop cells below are display:none there, so
                      the numbers have to appear somewhere. */}
                  <p className="md:hidden text-xs text-muted-foreground mt-1.5">
                    <span className="text-orange-400 font-semibold">{b.emptySeats} empty</span>
                    {" · "}
                    {b.filled}/{b.capacity} filled
                    {b.referralRevenue > 0 && (
                      <span className="text-emerald-400">
                        {" · "}{formatCurrency(b.referralRevenue)} referral revenue
                      </span>
                    )}
                  </p>
                </div>

                <p className="hidden md:block text-right text-xs text-muted-foreground tabular-nums">
                  {b.capacity || "—"}
                </p>
                <p className="hidden md:block text-right text-xs text-muted-foreground tabular-nums">
                  {b.filled}
                </p>
                <p className="hidden md:block text-right text-sm font-semibold text-orange-400 tabular-nums">
                  {b.capacity === 0 ? <span className="text-muted-foreground/40">—</span> : b.emptySeats}
                </p>
                <p
                  className={cn(
                    "hidden md:block text-right text-xs font-medium tabular-nums",
                    occupancyTone(b.occupancyPercent, b.capacity)
                  )}
                >
                  {b.capacity === 0 ? "no rooms" : `${b.occupancyPercent}%`}
                </p>
                <p className="hidden md:block text-right text-xs tabular-nums">
                  {b.referralRevenue > 0 ? (
                    <span className="text-emerald-400">{formatCurrency(b.referralRevenue)}</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </p>
                <p className="hidden md:block text-right text-xs tabular-nums">
                  {b.pulseCommission > 0 ? (
                    <span className="text-amber">{formatCurrency(b.pulseCommission)}</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
