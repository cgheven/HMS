"use client";

import { CalendarDays, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { DailyExpenseRow } from "@/types";

interface Props {
  daily: DailyExpenseRow[];
  todayIncome: number;
  todayExpense: number;
}

export function DailyExpensesSection({ daily, todayIncome, todayExpense }: Props) {
  return (
    <div className="rounded-2xl border border-sidebar-border bg-card p-6 animate-fade-up">
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

      <div className="mb-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-rose-400" />
          Expense Overview
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Expenses and income, by day, this month</p>
      </div>

      {daily.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[140px] gap-2 text-muted-foreground">
          <CalendarDays className="w-8 h-8 opacity-30" />
          <p className="text-sm">No activity recorded this month yet</p>
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
                <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Income</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date} className="border-t border-white/5">
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{formatDate(d.date)}</td>
                  <td className="px-3 py-2 text-right text-amber tabular-nums whitespace-nowrap">{formatCurrency(d.kitchen)}</td>
                  <td className="px-3 py-2 text-right text-rose-400 tabular-nums whitespace-nowrap">{formatCurrency(d.expenses)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground tabular-nums whitespace-nowrap">{formatCurrency(d.total)}</td>
                  <td className="px-3 py-2 text-right text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(d.income)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
