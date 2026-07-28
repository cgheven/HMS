"use client";

import { useState } from "react";
import { CalendarDays, ArrowDownCircle, ArrowUpCircle, UserPlus, UserMinus, Receipt, ChefHat, TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import { Input } from "@/components/ui/input";
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
  dailyDetails: ReportData["dailyExpenseDetails"];
}

const EMPTY_DETAIL = {
  income: 0, kitchenTotal: 0, otherTotal: 0, total: 0,
  expenseList: [] as ReportData["dailyExpenseDetails"][number]["expenseList"],
  paymentsList: [] as ReportData["dailyExpenseDetails"][number]["paymentsList"],
  joinedList: [] as ReportData["dailyExpenseDetails"][number]["joinedList"],
  leftList: [] as ReportData["dailyExpenseDetails"][number]["leftList"],
};

export function DailyExpensesSection({ dailyDetails }: Props) {
  const now = new Date();
  const todayStr = formatDateInput(now);
  // A single date filter drives the whole tab — every number and list below
  // reacts to it. Data is only fetched for the current calendar month, so the
  // picker is bounded to it.
  const monthStartStr = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEndStr = formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const d = dailyDetails.find((r) => r.date === selectedDate) ?? EMPTY_DETAIL;
  const profit = d.income - d.total;
  const isSameDay = selectedDate === todayStr;

  return (
    <div className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-6 animate-fade-up">
      <div className="mb-5 pb-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-400" />
            {isSameDay ? "Today" : formatDate(selectedDate)}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Pick any day this month to see its numbers</p>
        </div>
        <Input
          type="date"
          value={selectedDate}
          min={monthStartStr}
          max={monthEndStr}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-full sm:w-auto h-9 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {[
          {
            key: "income", label: "Income", value: formatCurrency(d.income), sub: null,
            icon: ArrowDownCircle, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20",
          },
          {
            key: "expense", label: "Expense", value: formatCurrency(d.total),
            sub: `Kitchen ${formatCurrency(d.kitchenTotal)} · Other ${formatCurrency(d.otherTotal)}`,
            icon: ArrowUpCircle, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20",
          },
          {
            key: "profit", label: "Profit", value: formatCurrency(profit), sub: null,
            icon: profit >= 0 ? TrendingUp : TrendingDown,
            color: profit >= 0 ? "text-violet-400" : "text-rose-400",
            bg: profit >= 0 ? "bg-violet-500/10 border-violet-500/20" : "bg-rose-500/10 border-rose-500/20",
          },
          {
            key: "joined", label: "Joined", value: String(d.joinedList.length), sub: null,
            icon: UserPlus, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20",
          },
          {
            key: "left", label: "Left", value: String(d.leftList.length), sub: null,
            icon: UserMinus, color: "text-amber", bg: "bg-amber/10 border-amber/20",
          },
        ].map(({ key, label, value, sub, icon: Icon, color, bg }) => (
          <div key={key} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:p-4 flex flex-col">
            <div className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl border ${bg} mb-2.5 sm:mb-3`}>
              <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${color}`} />
            </div>
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
            <p className={`mt-1 text-lg sm:text-xl font-bold leading-none ${color}`}>{value}</p>
            {sub && <p className="mt-1.5 text-[10px] sm:text-xs text-muted-foreground">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Verification detail — the numbers above are a total, but the owner needs
          to match each one against their own physical register: who exactly
          joined, whose payment came in, who exactly left, what exactly was
          spent. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5" /> Payments Collected
          </h3>
          {d.paymentsList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No payments collected on {formatDate(selectedDate)}</p>
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
                  {d.paymentsList.map((p) => (
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
            <ChefHat className="w-3.5 h-3.5" /> Expenses
          </h3>
          {d.expenseList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No expenses recorded on {formatDate(selectedDate)}</p>
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
                  {d.expenseList.map((e) => (
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
            <UserPlus className="w-3.5 h-3.5" /> New Members Joined
          </h3>
          {d.joinedList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No new members joined on {formatDate(selectedDate)}</p>
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
                  {d.joinedList.map((t) => (
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
            <UserMinus className="w-3.5 h-3.5" /> Checked Out
          </h3>
          {d.leftList.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No one checked out on {formatDate(selectedDate)}</p>
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
                  {d.leftList.map((t) => (
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
    </div>
  );
}
