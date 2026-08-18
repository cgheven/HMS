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

// Blunt on purpose. A sales conversation only needs "room to fill", "filling up"
// or "full"; a finer scale just invites arguing about the boundary.
function tone(pct: number, capacity: number) {
  if (capacity === 0) return { text: "text-muted-foreground/40", bar: "bg-white/10" };
  if (pct >= 90) return { text: "text-emerald-400", bar: "bg-emerald-400" };
  if (pct >= 70) return { text: "text-amber", bar: "bg-amber" };
  return { text: "text-orange-400", bar: "bg-orange-400" };
}

// Cities arrive however they were typed — "Lahore" on one branch, "LAHORE" on
// the next. Shouting one row's city and not its neighbour's reads as a defect
// in the page rather than in the data.
function cityLabel(city: string | null) {
  if (!city) return null;
  return city
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function OccupancyBar({ pct, capacity }: { pct: number; capacity: number }) {
  const t = tone(pct, capacity);
  if (capacity === 0) {
    return <span className="text-[11px] text-muted-foreground/40">no rooms yet</span>;
  }
  return (
    <div className="flex items-center gap-2.5">
      {/* The bar is what makes the table scannable: an owner reads "who has room"
          from the shape of the column, not by comparing eight percentages. */}
      <div className="relative h-1.5 flex-1 min-w-0 rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", t.bar)}
          style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 3 : 0))}%` }}
        />
      </div>
      <span className={cn("text-xs font-medium tabular-nums w-9 text-right shrink-0", t.text)}>
        {pct}%
      </span>
    </div>
  );
}

export function GrowthClient({ branches, totals, loadError }: Props) {
  const [sort, setSort] = useState<SortKey>("empty");

  // Two entire columns of "—" is not a table, it is furniture. They appear only
  // once some branch has referral activity to put in them.
  const showReferral = useMemo(
    () => branches.some((b) => b.referralsJoined > 0 || b.referralRevenue > 0 || b.pulseCommission > 0),
    [branches]
  );

  const cols = showReferral
    ? "md:grid-cols-[minmax(0,1.5fr)_minmax(7rem,1fr)_6rem_5rem_8rem_7rem]"
    : "md:grid-cols-[minmax(0,1.5fr)_minmax(9rem,1fr)_7rem_6rem]";

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
        // Most empty beds first: the branch with the biggest hole is the call
        // worth making, and it is the number this page exists to surface.
        return list.sort((a, b) => b.emptySeats - a.emptySeats);
    }
  }, [branches, sort]);

  // Kept as one sentence rather than four tiles because the argument only works
  // assembled: this much came in, this little was given away to earn it.
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
      value: totals ? totals.emptySeats.toLocaleString() : "—",
      hint: totals ? `across ${totals.branches} branches` : "",
      icon: BedDouble,
      t: "text-orange-400",
    },
    {
      label: "Occupancy",
      value: totals ? `${totals.occupancyPercent}%` : "—",
      hint: totals ? `${totals.filled.toLocaleString()} of ${totals.capacity.toLocaleString()} beds` : "",
      icon: TrendingUp,
      t: "text-emerald-400",
    },
    {
      label: "Referral revenue",
      value: totals ? formatCurrency(totals.referralRevenue) : "—",
      hint: totals && totals.referralsJoined > 0 ? `${totals.referralsJoined} joined` : "none running yet",
      icon: Wallet,
      t: totals && totals.referralRevenue > 0 ? "text-emerald-400" : "text-muted-foreground/50",
    },
    {
      label: "Pulse commission",
      value: totals ? formatCurrency(totals.pulseCommission) : "—",
      hint:
        totals && totals.branchesRunningReferrals > 0
          ? `${totals.branchesRunningReferrals} branch${totals.branchesRunningReferrals === 1 ? "" : "es"} running it`
          : "none running yet",
      icon: Megaphone,
      t: totals && totals.pulseCommission > 0 ? "text-amber" : "text-muted-foreground/50",
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {tiles.map(({ label, value, hint, icon: Icon, t }) => (
          <div
            key={label}
            className="rounded-2xl border border-sidebar-border bg-card p-4 hover:border-white/15 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground truncate">{label}</p>
              <Icon className={cn("w-4 h-4 shrink-0", t)} />
            </div>
            <p className={cn("text-xl lg:text-2xl font-bold mt-2 truncate tabular-nums", t)}>{value}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 h-4 truncate">{hint}</p>
          </div>
        ))}
      </div>

      {proofLine && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">The pitch</p>
          <p className="text-sm text-foreground mt-1.5 leading-relaxed">{proofLine}</p>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle>Branches</CardTitle>
            <CardDescription>
              Occupancy counted from tenants actually holding a room
              {showReferral ? " · all-time referral figures" : ""}
            </CardDescription>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="shrink-0 rounded-lg border border-sidebar-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:border-white/20 transition-colors"
          >
            <option value="empty">Most empty seats</option>
            <option value="occupancy">Lowest occupancy</option>
            {showReferral && <option value="revenue">Most referral revenue</option>}
            <option value="name">Name</option>
          </select>
        </CardHeader>

        <CardContent className="p-0">
          {/* The header is its own grid, so every track below must match it
              exactly — an `auto` track sizes to its own content and the two
              grids then drift apart column by column. */}
          <div
            className={cn(
              "hidden md:grid gap-x-4 px-5 py-2.5 border-y border-sidebar-border/70 bg-white/[0.015] text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70",
              cols
            )}
          >
            <span>Branch</span>
            <span>Occupancy</span>
            <span className="text-right">Filled</span>
            <span className="text-right">Empty</span>
            {showReferral && <span className="text-right">Referral revenue</span>}
            {showReferral && <span className="text-right">Commission</span>}
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No branches yet.</p>
          ) : (
            sorted.map((b) => {
              const t = tone(b.occupancyPercent, b.capacity);
              const city = cityLabel(b.city);
              return (
                <div
                  key={b.hostelId}
                  className={cn(
                    "md:grid md:items-center gap-x-4 px-5 py-2.5 border-b border-sidebar-border/40 last:border-b-0 hover:bg-white/[0.025] transition-colors",
                    cols
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                      {city ?? "—"}
                      {b.referralEnabled && (
                        <span className="text-emerald-400/80"> · referrals {b.campaign}</span>
                      )}
                      {/* Surfaced, never folded in: these tenants pay but hold no
                          bed, so they sit outside the ratio entirely and would
                          otherwise read as people who had gone missing. */}
                      {b.unroomedTenants > 0 && <span> · {b.unroomedTenants} without a room</span>}
                    </p>
                  </div>

                  {/* Phone: the desktop cells are display:none there, so every
                      number has to appear somewhere. */}
                  <div className="md:hidden mt-2 space-y-1.5">
                    <OccupancyBar pct={b.occupancyPercent} capacity={b.capacity} />
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-orange-400">{b.emptySeats} empty</span>
                      {" · "}
                      {b.filled}/{b.capacity} filled
                      {b.referralRevenue > 0 && (
                        <span className="text-emerald-400">
                          {" · "}
                          {formatCurrency(b.referralRevenue)}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="hidden md:block min-w-0">
                    <OccupancyBar pct={b.occupancyPercent} capacity={b.capacity} />
                  </div>

                  {/* Filled and total in one cell. As two columns they were read
                      as unrelated figures; the ratio is the fact. */}
                  <p className="hidden md:block text-right text-xs tabular-nums text-muted-foreground">
                    <span className="text-foreground">{b.filled}</span>
                    <span className="text-muted-foreground/40"> / {b.capacity || "—"}</span>
                  </p>

                  <p className="hidden md:block text-right text-sm font-semibold tabular-nums">
                    {b.capacity === 0 ? (
                      <span className="text-muted-foreground/30">—</span>
                    ) : (
                      <span className="text-orange-400">{b.emptySeats}</span>
                    )}
                  </p>

                  {showReferral && (
                    <p className="hidden md:block text-right text-xs tabular-nums">
                      {b.referralRevenue > 0 ? (
                        <span className="text-emerald-400">{formatCurrency(b.referralRevenue)}</span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </p>
                  )}

                  {showReferral && (
                    <p className="hidden md:block text-right text-xs tabular-nums">
                      {b.pulseCommission > 0 ? (
                        <span className="text-amber">{formatCurrency(b.pulseCommission)}</span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {!showReferral && (
        <p className="text-xs text-muted-foreground/70 text-center">
          Referral columns appear once a client branch starts running the programme.
        </p>
      )}
    </div>
  );
}
