"use client";
import { useMemo, useState } from "react";
import { Layers, Banknote, Wallet, Receipt, Users, ShieldCheck } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PortfolioSummary } from "@/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Month keys are always server-derived (PKT-anchored) strings, so they are
// formatted with string arithmetic — new Date("2026-08") in the browser parses
// as UTC midnight and renders as the previous month west of Greenwich.
function monthLabel(monthKey: string, long = false) {
  const [year, month] = monthKey.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? monthKey;
  return long ? `${name} ${year}` : `${name.slice(0, 3)} ${year}`;
}

const PRESETS = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_12", label: "12 Months" },
  { id: "custom", label: "Custom" },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

interface BranchRow {
  id: string;
  name: string;
  city: string | null;
  activeMembers: number;
  beds: number;
  occupied: number;
  occupancy: number;
  collected: number;
  pending: number;
  deposits: number;
  costs: number;
  profit: number;
  margin: number;
}

const EMPTY_TOTALS = {
  activeMembers: 0, beds: 0, occupied: 0, collected: 0,
  pending: 0, deposits: 0, costs: 0, profit: 0,
};

function money(n: number) {
  return n === 0 ? "—" : formatCurrency(n);
}

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function OverviewClient({ summary }: { summary: PortfolioSummary }) {
  const [preset, setPreset] = useState<PresetId>("this_month");
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(summary.windowFrom);
  const [customTo, setCustomTo] = useState(summary.windowTo);
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(summary.branches.map((b) => b.id))
  );

  // Every month key here is server-derived and PKT-anchored (pktYearMonth), never
  // new Date() in the browser. The Reports page still derives its own presets
  // from browser-local getters, so on a browser not set to PKT its "This Month"
  // can be the previous month around a month boundary. Parity between the two
  // pages must therefore be checked on an explicit from/to pair, not on the pill.
  const range = useMemo(() => {
    if (preset === "last_12") return { from: summary.windowFrom, to: summary.windowTo };
    if (preset === "custom" && applied) return applied;
    if (preset === "last_month") {
      const keys = summary.months.map((m) => m.monthKey);
      const i = keys.indexOf(summary.currentMonthKey);
      const mk = i > 0 ? keys[i - 1] : summary.currentMonthKey;
      return { from: mk, to: mk };
    }
    return { from: summary.currentMonthKey, to: summary.currentMonthKey };
  }, [preset, applied, summary]);

  const periodLabel =
    range.from === range.to
      ? monthLabel(range.from, true)
      : `${monthLabel(range.from)} – ${monthLabel(range.to)}`;

  const rows = useMemo<BranchRow[]>(
    () =>
      summary.branches
        .filter((b) => selected.has(b.id))
        .map((b) => {
          const months = b.months.filter((m) => m.monthKey >= range.from && m.monthKey <= range.to);
          // Rounded ONCE, here, not per rendered cell. Deposits are pro-rated by
          // paid/amount so they are routinely fractional; rounding each cell
          // independently made the subtraction printed on the row off by a rupee.
          const collected = Math.round(months.reduce((s, m) => s + m.collected, 0));
          const deposits = Math.round(months.reduce((s, m) => s + m.depositsCollected, 0));
          const costs = Math.round(months.reduce((s, m) => s + m.expenses + m.kitchen + m.salaries, 0));
          // The Reports page formula (reports-client.tsx "totalNetProfit")
          // regrouped: Σ(collected − deposits − expenses − kitchen − salaries)
          // is Σcollected − Σdeposits − Σcosts. Derived from the rounded terms so
          // the row always reconciles as displayed.
          const profit = collected - deposits - costs;
          return {
            id: b.id,
            name: b.name,
            city: b.city,
            activeMembers: b.activeMembers,
            beds: b.beds,
            occupied: b.occupied,
            occupancy: pct(b.occupied, b.beds),
            collected,
            pending: Math.round(months.reduce((s, m) => s + m.pending, 0)),
            deposits,
            costs,
            profit,
            margin: pct(profit, collected),
          };
        })
        .sort((a, b) => b.profit - a.profit),
    [summary.branches, selected, range]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          activeMembers: t.activeMembers + r.activeMembers,
          beds: t.beds + r.beds,
          occupied: t.occupied + r.occupied,
          collected: t.collected + r.collected,
          pending: t.pending + r.pending,
          deposits: t.deposits + r.deposits,
          costs: t.costs + r.costs,
          profit: t.profit + r.profit,
        }),
        { ...EMPTY_TOTALS }
      ),
    [rows]
  );

  const depositsHeld = useMemo(
    () =>
      summary.branches
        .filter((b) => selected.has(b.id))
        .reduce(
          (t, b) => ({
            held: t.held + b.depositsHeld,
            count: t.count + b.depositCount,
            unreceived: t.unreceived + b.depositsUnreceived,
          }),
          { held: 0, count: 0, unreceived: 0 }
        ),
    [summary.branches, selected]
  );
  const heldRounded = Math.round(depositsHeld.held);
  const unreceivedRounded = Math.round(depositsHeld.unreceived);

  const insight = useMemo(() => buildInsight(rows, periodLabel), [rows, periodLabel]);

  const isProfit = totals.profit >= 0;
  const collectionRate = pct(totals.collected, totals.collected + totals.pending);
  const totalMargin = pct(totals.profit, totals.collected);
  const totalOccupancy = pct(totals.occupied, totals.beds);
  const partial = selected.size < summary.branches.length;

  function toggleBranch(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Zero branches would render a page of dashes and answer nothing.
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }


  if (summary.branches.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">All Branches</h1>
          <p className="text-muted-foreground text-sm mt-1">Every branch&apos;s money in one place</p>
        </div>
        <div className="flex flex-col items-center justify-center py-32 gap-2 text-muted-foreground">
          <Layers className="w-10 h-10 opacity-20" />
          <p className="text-sm">No branches yet. Add one in Settings to see it here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-normal tracking-tight">All Branches</h1>
        <p className="text-sm mt-1 text-muted-foreground">
          {periodLabel} ·{" "}
          <span className={partial ? "text-amber font-semibold" : ""}>
            {partial
              ? `${selected.size} of ${summary.branches.length} branches`
              : `${summary.branches.length} branch${summary.branches.length === 1 ? "" : "es"}`}
          </span>
        </p>
      </div>

      {/* Filters — both are pure client-side re-sums. No network, no spinner. */}
      <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
        <div className="relative max-w-full">
          <div className="flex items-center gap-1 flex-nowrap overflow-x-auto scrollbar-hide">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.id === "custom") {
                    setShowCustom(true);
                    setPreset("custom");
                    setApplied((prev) => prev ?? { from: summary.windowFrom, to: summary.windowTo });
                    return;
                  }
                  setShowCustom(false);
                  setPreset(p.id);
                }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  preset === p.id
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
              min={summary.windowFrom}
              max={summary.windowTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-auto h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="month"
              value={customTo}
              min={summary.windowFrom}
              max={summary.windowTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-auto h-8 text-xs"
            />
            <Button
              size="sm"
              onClick={() => {
                const lo = customFrom <= customTo ? customFrom : customTo;
                const hi = customFrom <= customTo ? customTo : customFrom;
                setApplied({
                  from: lo < summary.windowFrom ? summary.windowFrom : lo,
                  to: hi > summary.windowTo ? summary.windowTo : hi,
                });
                setPreset("custom");
              }}
              disabled={!customFrom || !customTo}
              className="h-8 text-xs bg-amber text-background hover:bg-amber/90"
            >
              Apply
            </Button>
            <span className="text-xs text-muted-foreground">
              {monthLabel(summary.windowFrom)} – {monthLabel(summary.windowTo)} available
            </span>
          </div>
        )}

        {summary.branches.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-sidebar-border">
            <button
              onClick={() => setSelected(new Set(summary.branches.map((b) => b.id)))}
              className={`mt-2 shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                partial
                  ? "border-sidebar-border text-muted-foreground hover:text-foreground"
                  : "bg-amber/10 text-amber border-amber/30"
              }`}
            >
              All
            </button>
            {summary.branches.map((b) => (
              <button
                key={b.id}
                onClick={() => toggleBranch(b.id)}
                className={`mt-2 shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                  selected.has(b.id)
                    ? "bg-amber/10 text-amber border-amber/30"
                    : "border-sidebar-border text-muted-foreground/60 hover:text-foreground"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          className={`col-span-2 lg:col-span-1 relative rounded-2xl border p-4 sm:p-5 transition-all duration-300 animate-fade-up ${
            isProfit
              ? "border-emerald-500/30 bg-emerald-500/[0.06] hover:border-emerald-500/50"
              : "border-rose-500/30 bg-rose-500/[0.06] hover:border-rose-500/50"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net Profit</p>
              <p className={`mt-2 text-3xl font-bold leading-none ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                {formatCurrency(totals.profit)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {totals.collected > 0 ? `${totalMargin}% margin on collected` : "Nothing collected yet"}
              </p>
            </div>
            <div
              className={`flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 ${
                isProfit ? "bg-emerald-500/10 border-emerald-500/20" : "bg-rose-500/10 border-rose-500/20"
              }`}
            >
              <Banknote className={`w-4 h-4 ${isProfit ? "text-emerald-400" : "text-rose-400"}`} />
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 hover:border-emerald-500/30 transition-all animate-fade-up" style={{ animationDelay: "75ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Collected</p>
              <p className="mt-2 text-lg sm:text-2xl font-bold leading-none">{money(totals.collected)}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${collectionRate}%` }} />
                </div>
                <span className="text-xs text-emerald-400 font-semibold shrink-0">{collectionRate}%</span>
              </div>
              <p className="mt-1 text-[10px] sm:text-xs text-muted-foreground">{money(totals.pending)} still pending</p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 hover:border-amber/30 transition-all animate-fade-up" style={{ animationDelay: "150ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Costs</p>
              <p className="mt-2 text-lg sm:text-2xl font-bold leading-none">{money(totals.costs)}</p>
              <p className="mt-2 text-[10px] sm:text-xs text-muted-foreground">Expenses, kitchen &amp; salaries</p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber/10 border border-amber/20 shrink-0">
              <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber" />
            </div>
          </div>
        </div>

        <div className="col-span-2 lg:col-span-1 relative rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 hover:border-blue-500/30 transition-all animate-fade-up" style={{ animationDelay: "225ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Members Today</p>
              <p className="mt-2 text-lg sm:text-2xl font-bold leading-none">{totals.activeMembers}</p>
              <p className="mt-2 text-[10px] sm:text-xs text-muted-foreground">
                {totals.occupied} of {totals.beds} beds filled · {totalOccupancy}%
              </p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Security deposits — a liability, deliberately outside the period */}
      <div className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.05] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 shrink-0">
            <ShieldCheck className="w-4 h-4 text-violet-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-bold text-violet-300">{money(heldRounded)}</span>
              <span className="text-muted-foreground"> in security deposits held today · {depositsHeld.count} member{depositsHeld.count === 1 ? "" : "s"} · refundable at checkout</span>
            </p>
            {unreceivedRounded > 0 && (
              <p className="text-xs mt-1.5 text-amber">
                {formatCurrency(unreceivedRounded)} billed but not received
              </p>
            )}
            <p className="text-xs mt-1.5 text-muted-foreground">
              Not income — already excluded from Net Profit above
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border text-xs text-muted-foreground">
                <th className="text-left font-medium py-3 pl-4 pr-3">Branch</th>
                <th className="text-left font-medium py-3 pr-3">Members</th>
                <th className="text-right font-medium py-3 pr-3">Collected</th>
                <th className="text-right font-medium py-3 pr-3">Pending</th>
                <th className="text-right font-medium py-3 pr-3" title="Refundable security deposits collected in this period. They sit inside Collected and are subtracted here.">
                  Deposits
                </th>
                <th className="text-right font-medium py-3 pr-3">Costs</th>
                <th className="text-right font-medium py-3 pr-4">Net Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-sidebar-border/60 last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="relative py-3 pl-4 pr-3">
                    {r.profit < 0 && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 rounded-r-full bg-rose-500" />
                    )}
                    <p className="font-medium truncate">{r.name}</p>
                    {r.city && <p className="text-xs text-muted-foreground truncate">{r.city}</p>}
                  </td>
                  <td className="py-3 pr-3 w-40">
                    <p className="text-xs">
                      <span className="font-semibold">{r.activeMembers}</span>
                      <span className="text-muted-foreground"> / {r.beds} beds</span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${r.occupancy}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{r.occupancy}%</span>
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right text-emerald-400">{money(r.collected)}</td>
                  <td className="py-3 pr-3 text-right text-muted-foreground">{money(r.pending)}</td>
                  <td className="py-3 pr-3 text-right text-violet-400">{r.deposits === 0 ? "—" : `− ${formatCurrency(r.deposits)}`}</td>
                  <td className="py-3 pr-3 text-right text-muted-foreground">{money(r.costs)}</td>
                  <td className={cn("py-3 pr-4 text-right", r.profit < 0 ? "text-rose-400 font-semibold" : "font-medium")}>
                    {formatCurrency(r.profit)}
                    {r.collected > 0 && <p className="text-xs font-normal text-muted-foreground">{r.margin}% margin</p>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-sidebar-border bg-white/[0.02] font-semibold">
                <td className="py-3 pl-4 pr-3">Total</td>
                <td className="py-3 pr-3 text-xs">
                  {totals.activeMembers}
                  <span className="font-normal text-muted-foreground"> / {totals.beds} beds · {totalOccupancy}%</span>
                </td>
                <td className="py-3 pr-3 text-right text-emerald-400">{money(totals.collected)}</td>
                <td className="py-3 pr-3 text-right text-muted-foreground">{money(totals.pending)}</td>
                <td className="py-3 pr-3 text-right text-violet-400">{totals.deposits === 0 ? "—" : `− ${formatCurrency(totals.deposits)}`}</td>
                <td className="py-3 pr-3 text-right text-muted-foreground">{money(totals.costs)}</td>
                <td className={cn("py-3 pr-4 text-right", isProfit ? "text-emerald-400" : "text-rose-400")}>
                  {formatCurrency(totals.profit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-sidebar-border/60">
          {rows.map((r) => (
            <div key={r.id} className="relative p-4 space-y-3">
              {r.profit < 0 && <span className="absolute left-0 top-4 w-1.5 h-8 rounded-r-full bg-rose-500" />}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.activeMembers} / {r.beds} beds · {r.occupancy}%
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("font-bold", r.profit < 0 ? "text-rose-400" : "text-emerald-400")}>
                    {formatCurrency(r.profit)}
                  </p>
                  {r.collected > 0 && <p className="text-[10px] text-muted-foreground">{r.margin}% margin</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <Fact label="Collected" value={money(r.collected)} tone="text-emerald-400" />
                <Fact label="Pending" value={money(r.pending)} />
                <Fact label="Deposits" value={r.deposits === 0 ? "—" : `− ${formatCurrency(r.deposits)}`} tone="text-violet-400" />
                <Fact label="Costs" value={money(r.costs)} />
              </div>
            </div>
          ))}
          <div className="p-4 flex items-center justify-between bg-white/[0.02] font-semibold text-sm">
            <span>Total</span>
            <span className={isProfit ? "text-emerald-400" : "text-rose-400"}>{formatCurrency(totals.profit)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        {insight && <p className="text-sm text-muted-foreground">{insight}</p>}
        <p className="text-xs text-muted-foreground/70">
          Net Profit = collected − deposits − expenses, kitchen and salaries. Utility and rent bills
          are not included, matching the Reports page.
        </p>
      </div>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone ?? ""}>{value}</span>
    </div>
  );
}

function buildInsight(rows: BranchRow[], periodLabel: string): string | null {
  if (rows.length === 0) return null;
  const losing = rows.filter((r) => r.profit < 0);
  const best = rows[0];

  if (rows.length === 1) {
    return best.profit < 0
      ? `${best.name} is running at a loss of ${formatCurrency(Math.abs(best.profit))} in ${periodLabel}.`
      : null;
  }

  // Share is taken against the profit EARNED, not the net total. Dividing by a
  // net that loss-making branches have dragged down yields shares above 100%.
  const earned = rows.reduce((s, r) => s + Math.max(0, r.profit), 0);
  const lead =
    best.profit > 0
      ? `${best.name} made ${Math.round((best.profit / earned) * 100)}% of the profit earned in ${periodLabel}`
      : `No branch turned a profit in ${periodLabel}`;

  if (losing.length === 0) return `${lead}, and every branch is profitable.`;
  if (losing.length === rows.length) return `${lead}.`;
  return `${lead}; ${losing.map((r) => r.name).join(", ")} ${losing.length === 1 ? "is" : "are"} running at a loss.`;
}
