"use client";

import { CalendarDays, ArrowDownCircle, ArrowUpCircle, UserPlus, UserMinus, Receipt, ChefHat } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { DailyExpenseRow } from "@/types";
import type { ReportData } from "@/app/actions/reports";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  cheque: "Cheque",
  online: "Online",
};

interface Props {
  daily: DailyExpenseRow[];
  todayIncome: number;
  todayExpense: number;
  todayKitchenExpense: number;
  todayOtherExpense: number;
  todayJoined: number;
  todayLeft: number;
  todayExpenseList: ReportData["todayExpenseList"];
  todayJoinedList: ReportData["todayJoinedList"];
  todayLeftList: ReportData["todayLeftList"];
  todayPaymentsList: ReportData["todayPaymentsList"];
}

export function DailyExpensesSection({
  daily, todayIncome, todayExpense, todayKitchenExpense, todayOtherExpense, todayJoined, todayLeft,
  todayExpenseList, todayJoinedList, todayLeftList, todayPaymentsList,
}: Props) {
  return (
    <div className="rounded-2xl border border-sidebar-border bg-card p-6 animate-fade-up">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5 pb-5 border-b border-white/5">
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
            <p className="mt-1 text-[10px] sm:text-xs text-muted-foreground">Kitchen {formatCurrency(todayKitchenExpense)} · Other {formatCurrency(todayOtherExpense)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
            <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Joined Today</p>
            <p className="mt-1 text-lg sm:text-xl font-bold leading-none text-blue-400">{todayJoined}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber/10 border border-amber/20 shrink-0">
            <UserMinus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">Left Today</p>
            <p className="mt-1 text-lg sm:text-xl font-bold leading-none text-amber">{todayLeft}</p>
          </div>
        </div>
      </div>

      {/* Verification detail — the numbers above are a total, but the owner needs
          to match each one against their own physical register: who exactly
          joined, whose payment came in, who exactly left, what exactly was
          spent. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div>
          <h3 className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5" /> Payments Collected Today
          </h3>
          {todayPaymentsList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No payments collected today</p>
          ) : (
            <div className="max-h-[220px] overflow-auto scrollbar-hide rounded-xl border border-white/5">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    <th className="text-left font-medium px-2.5 py-2">Tenant</th>
                    <th className="text-right font-medium px-2.5 py-2 whitespace-nowrap">Amount</th>
                    <th className="text-left font-medium px-2.5 py-2 whitespace-nowrap">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {todayPaymentsList.map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="px-2.5 py-2 text-foreground">
                        <span className="font-medium">{p.tenantName}</span>
                        {p.roomNumber && <span className="text-muted-foreground"> · Rm {p.roomNumber}</span>}
                      </td>
                      <td className="px-2.5 py-2 text-right text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(p.amount)}</td>
                      <td className="px-2.5 py-2 text-muted-foreground whitespace-nowrap">{METHOD_LABELS[p.method] ?? p.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-rose-400 mb-2 flex items-center gap-1.5">
            <ChefHat className="w-3.5 h-3.5" /> Expenses Today
          </h3>
          {todayExpenseList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No expenses recorded today</p>
          ) : (
            <div className="max-h-[220px] overflow-auto scrollbar-hide rounded-xl border border-white/5">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    <th className="text-left font-medium px-2.5 py-2">Title</th>
                    <th className="text-left font-medium px-2.5 py-2 whitespace-nowrap">Category</th>
                    <th className="text-right font-medium px-2.5 py-2 whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {todayExpenseList.map((e) => (
                    <tr key={`${e.source}-${e.id}`} className="border-t border-white/5">
                      <td className="px-2.5 py-2 text-foreground font-medium">{e.title}</td>
                      <td className="px-2.5 py-2 text-muted-foreground whitespace-nowrap">
                        {e.category}
                        <span className="text-muted-foreground/60"> · {e.source === "kitchen" ? "Kitchen" : "Other"}</span>
                      </td>
                      <td className="px-2.5 py-2 text-right text-rose-400 tabular-nums whitespace-nowrap">{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> New Members Joined Today
          </h3>
          {todayJoinedList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No new members joined today</p>
          ) : (
            <div className="max-h-[220px] overflow-auto scrollbar-hide rounded-xl border border-white/5">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    <th className="text-left font-medium px-2.5 py-2">Name</th>
                    <th className="text-left font-medium px-2.5 py-2 whitespace-nowrap">Room</th>
                    <th className="text-left font-medium px-2.5 py-2 whitespace-nowrap">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {todayJoinedList.map((t) => (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="px-2.5 py-2 text-foreground font-medium">{t.name}</td>
                      <td className="px-2.5 py-2 text-muted-foreground whitespace-nowrap">{t.roomNumber ? `Rm ${t.roomNumber}` : "—"}</td>
                      <td className="px-2.5 py-2 text-muted-foreground whitespace-nowrap">{t.phone ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-amber mb-2 flex items-center gap-1.5">
            <UserMinus className="w-3.5 h-3.5" /> Checked Out Today
          </h3>
          {todayLeftList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No one checked out today</p>
          ) : (
            <div className="max-h-[220px] overflow-auto scrollbar-hide rounded-xl border border-white/5">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    <th className="text-left font-medium px-2.5 py-2">Name</th>
                    <th className="text-left font-medium px-2.5 py-2 whitespace-nowrap">Room</th>
                    <th className="text-left font-medium px-2.5 py-2 whitespace-nowrap">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {todayLeftList.map((t) => (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="px-2.5 py-2 text-foreground font-medium">{t.name}</td>
                      <td className="px-2.5 py-2 text-muted-foreground whitespace-nowrap">{t.roomNumber ? `Rm ${t.roomNumber}` : "—"}</td>
                      <td className="px-2.5 py-2 text-muted-foreground whitespace-nowrap">{t.phone ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
