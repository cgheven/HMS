"use client";
import { useState } from "react";
import { AlertTriangle, ChefHat, ChevronDown, FlaskConical, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ReportData } from "@/app/actions/reports";

const BASIS_LABEL: Record<string, string> = {
  billed: "from food charges on payments",
  configured: "from the food rate in Settings",
  derived: "from package prices",
  unknown: "no price separates food from rent",
};

function Disclosure({
  icon,
  label,
  tone = "muted",
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  tone?: "muted" | "warn";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-sidebar-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <span className={tone === "warn" ? "text-amber-400" : "text-muted-foreground"}>{icon}</span>
        <span className={`text-xs flex-1 ${tone === "warn" ? "text-foreground" : "text-muted-foreground"}`}>
          {label}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-4 pb-4 -mt-1">{children}</div>}
    </div>
  );
}

export function UnitCostTab({ data: d, period }: { data: ReportData; period: string }) {
  const u = d.unitCost;
  const meal = u.meal;
  const hasSubscribers = !!meal && meal.subscriberMonths > 0;
  const hasRevenue = hasSubscribers && meal.revenuePerSubscriber > 0;

  // Sorted by size, not by a fixed order — the biggest line is the one worth
  // looking at, and which one that is changes branch to branch.
  const sources = (
    [
      ["Kitchen & cooks", u.perPersonBySource.kitchen],
      ["Bills / utilities", u.perPersonBySource.bills],
      ["Staff payroll", u.perPersonBySource.staff],
      ["General expenses", u.perPersonBySource.expenses],
    ] as const
  )
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 flex gap-2.5">
        <FlaskConical className="w-4 h-4 text-amber-400 shrink-0 mt-px" />
        <p className="text-xs text-amber-200/90 leading-relaxed">
          <span className="font-semibold text-amber-300">Experimental — still being tested.</span>{" "}
          These figures are estimates and may change as we refine them.
        </p>
      </div>

      {/* The two numbers the tab exists to answer. Everything else is detail. */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <p className="text-xs text-muted-foreground font-medium">Cost per resident</p>
          <p className="text-3xl font-bold text-foreground mt-1">
            {formatCurrency(u.costPerPerson)}
            <span className="text-sm font-normal text-muted-foreground"> / month</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">
            {u.activeTenants} {u.activeTenants === 1 ? "resident" : "residents"} ·{" "}
            {u.tenantMonths.toFixed(1)} resident-months in {period}
          </p>
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <p className="text-xs text-muted-foreground font-medium">Cost per person on meals</p>
          {hasSubscribers ? (
            <>
              <p className="text-3xl font-bold text-foreground mt-1">
                {formatCurrency(meal.costPerSubscriber)}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </p>
              <p className="text-xs mt-1.5">
                {hasRevenue ? (
                  <>
                    <span className={meal.marginPerSubscriber >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {meal.marginPerSubscriber >= 0 ? "+" : "−"}
                      {formatCurrency(Math.abs(meal.marginPerSubscriber))}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}against {formatCurrency(meal.revenuePerSubscriber)} charged
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {meal.subscriberMonths.toFixed(1)} person-months on meals · no food price set
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-muted-foreground mt-1">—</p>
              <p className="text-xs text-muted-foreground mt-1.5">Nobody on meals in {period}</p>
            </>
          )}
        </div>
      </div>

      {/* Where the money goes, per resident */}
      {sources.length > 0 && (
        <div className="rounded-2xl border border-sidebar-border bg-card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Where it goes</p>
            <p className="text-xs text-muted-foreground">per resident / month</p>
          </div>
          <div>
            {sources.map(([label, amount]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 py-1.5 border-b border-sidebar-border/40 last:border-0"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="flex items-baseline gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">
                    {u.costPerPerson > 0 ? `${Math.round((amount / u.costPerPerson) * 100)}%` : "—"}
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {formatCurrency(amount)}
                  </span>
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 pt-2.5 mt-1.5 border-t border-sidebar-border">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-sm font-bold text-foreground tabular-nums">
                {formatCurrency(u.costPerPerson)}
              </span>
            </div>
          </div>
          {u.capitalExcluded > 0 && (
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-sidebar-border">
              {formatCurrency(u.capitalExcluded)} of one-off capital spend left out — it is not what
              running the branch costs each month.
            </p>
          )}
        </div>
      )}

      {/* Shared kitchen collapses to a single sentence until asked */}
      {hasSubscribers && meal.mode === "shared" && (
        <Disclosure
          icon={<ChefHat className="w-3.5 h-3.5" />}
          label={
            <>
              Kitchen shared across {meal.branches.length} branches — this one takes{" "}
              <span className="text-foreground font-medium">
                {(meal.sharePercent * 100).toFixed(0)}%
              </span>{" "}
              of {formatCurrency(meal.kitchenCost)}
            </>
          }
        >
          <table className="w-full text-xs">
            <tbody>
              {meal.branches.map((b) => (
                <tr key={b.hostelId} className="border-t border-sidebar-border/60">
                  <td className="py-2 text-foreground">
                    {b.name}
                    {b.isCurrent && <span className="text-muted-foreground"> · this branch</span>}
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {b.subscriberMonths.toFixed(1)} people
                  </td>
                  <td className="py-2 text-right text-foreground w-16 tabular-nums">
                    {meal.groupSubscriberMonths > 0
                      ? `${((b.subscriberMonths / meal.groupSubscriberMonths) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-3">
            Split by how many people ate at each branch, and for how much of the month. Food leaving
            the kitchen is not weighed, so this is a share, not a measurement.
          </p>
        </Disclosure>
      )}

      {u.warnings.length > 0 && (
        <Disclosure
          tone="warn"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label={`${u.warnings.length} ${u.warnings.length === 1 ? "thing is" : "things are"} holding these numbers back`}
        >
          <ul className="space-y-2">
            {u.warnings.map((w) => (
              <li key={w.code} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-amber-400 shrink-0">•</span>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <Disclosure icon={<Info className="w-3.5 h-3.5" />} label="How these are worked out">
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            <span className="text-foreground">Estimates, not audited figures.</span> Costs count for
            the period they belong to, not the day they were paid.
          </p>
          <p>
            <span className="text-foreground">Resident-months, not head count.</span> Someone who
            stayed half of {period} counts as half a person — a head count on one day misses everyone
            who came and went.
          </p>
          <p>
            <span className="text-foreground">Payroll comes off the staff roster</span>, prorated from
            each join date, so it does not wait on a salary payment being recorded. The Expenses tab
            reports cash that actually left, which is why the two differ.
          </p>
          {hasRevenue && (
            <p>
              <span className="text-foreground">Food revenue</span> {BASIS_LABEL[meal.priceBasis]}.
            </p>
          )}
          {u.mealCustomPackages.length > 0 && (
            <p>
              <span className="text-foreground">Counted as meal packages:</span>{" "}
              {u.mealCustomPackages.map((p) => p.name).join(", ")} — set under Settings → Package
              Pricing.
            </p>
          )}
          {u.unclassifiedCustomPackages.length > 0 && (
            <p>
              <span className="text-amber-400">Not set either way:</span>{" "}
              {u.unclassifiedCustomPackages.map((p) => p.name).join(", ")} — counted as no meals for
              now.
            </p>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
