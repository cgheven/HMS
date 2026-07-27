"use client";

import { useState } from "react";
import { CalendarDays, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { DailyExpenseRow } from "@/types";

interface Props {
  monthlyExpenses: number;
  monthlyKitchen: number;
  daily: DailyExpenseRow[];
  todayIncome: number;
  todayExpense: number;
  showExpenses: boolean;
  showIncome: boolean;
}

export function DailyExpensesSection({ monthlyExpenses, monthlyKitchen, daily, todayIncome, todayExpense, showExpenses, showIncome }: Props) {
  const [view, setView] = useState<"monthly" | "daily">("monthly");
  const monthlyTotal = monthlyExpenses + monthlyKitchen;
  // The Monthly summary has no income figure, so once the Daily table also
  // carries an Income column it's the more complete view — skip the toggle
  // and go straight to Daily rather than offer a strictly worse option.
  const effectiveView = showIncome ? "daily" : view;

  return (
    <div className="rounded-2xl border border-sidebar-border bg-card p-6 animate-fade-up">
      {showExpenses && (
        <div className="grid grid-cols-2 gap-4 mb-5 pb-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <ArrowDownCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Today&apos;s Income</p>
              <p className="mt-1 text-lg sm:text-xl font-bold leading-none text-emerald-400">{formatCurrency(todayIncome)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 shrink-0">
              <ArrowUpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Today&apos;s Expense</p>
              <p className="mt-1 text-lg sm:text-xl font-bold leading-none text-rose-400">{formatCurrency(todayExpense)}</p>
            </div>
          </div>
        </div>
      )}

      {showExpenses ? (
        <>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-rose-400" />
                Expense Overview
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">{showIncome ? "Expenses and income, by day, this month" : "Kitchen + general expenses this month"}</p>
            </div>
            {!showIncome && (
              <div className="inline-flex items-center rounded-lg border border-sidebar-border bg-white/[0.03] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setView("monthly")}
                  className={`px-2.5 py-1 rounded-md transition-colors ${view === "monthly" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setView("daily")}
                  className={`px-2.5 py-1 rounded-md transition-colors ${view === "daily" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Daily
                </button>
              </div>
            )}
          </div>

          {effectiveView === "monthly" ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide">Kitchen</p>
                <p className="mt-1.5 text-lg sm:text-xl font-bold text-amber">{formatCurrency(monthlyKitchen)}</p>
              </div>
              <div>
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide">Other Expenses</p>
                <p className="mt-1.5 text-lg sm:text-xl font-bold text-rose-400">{formatCurrency(monthlyExpenses)}</p>
              </div>
              <div>
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="mt-1.5 text-lg sm:text-xl font-bold text-foreground">{formatCurrency(monthlyTotal)}</p>
              </div>
            </div>
          ) : daily.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[140px] gap-2 text-muted-foreground">
              <CalendarDays className="w-8 h-8 opacity-30" />
              <p className="text-sm">No expenses recorded this month yet</p>
            </div>
          ) : (
            <div className="max-h-[320px] overflow-auto scrollbar-hide rounded-xl border border-white/5">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Date</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Kitchen</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Other</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Total</th>
                    {showIncome && <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Income</th>}
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr key={d.date} className="border-t border-white/5">
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">{formatDate(d.date)}</td>
                      <td className="px-3 py-2 text-right text-amber tabular-nums whitespace-nowrap">{formatCurrency(d.kitchen)}</td>
                      <td className="px-3 py-2 text-right text-rose-400 tabular-nums whitespace-nowrap">{formatCurrency(d.expenses)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-foreground tabular-nums whitespace-nowrap">{formatCurrency(d.total)}</td>
                      {showIncome && <td className="px-3 py-2 text-right text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(d.income ?? 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : showIncome ? (
        <>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-emerald-400" />
              Daily Income
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Payments received this month, by day</p>
          </div>

          {daily.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[140px] gap-2 text-muted-foreground">
              <CalendarDays className="w-8 h-8 opacity-30" />
              <p className="text-sm">No income recorded this month yet</p>
            </div>
          ) : (
            <div className="max-h-[320px] overflow-auto scrollbar-hide rounded-xl border border-white/5">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Date</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Income</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr key={d.date} className="border-t border-white/5">
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">{formatDate(d.date)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(d.income ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
