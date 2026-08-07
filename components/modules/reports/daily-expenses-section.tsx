"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ArrowDownCircle, ArrowUpCircle, UserPlus, UserMinus, Receipt, ChefHat, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
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
  income: 0, kitchenTotal: 0, otherTotal: 0, salaryTotal: 0, billTotal: 0, total: 0,
  expenseList: [] as ReportData["dailyExpenseDetails"][number]["expenseList"],
  paymentsList: [] as ReportData["dailyExpenseDetails"][number]["paymentsList"],
  joinedList: [] as ReportData["dailyExpenseDetails"][number]["joinedList"],
  leftList: [] as ReportData["dailyExpenseDetails"][number]["leftList"],
  dueList: [] as ReportData["dailyExpenseDetails"][number]["dueList"],
};

export function DailyExpensesSection({ dailyDetails }: Props) {
  const now = new Date();
  const todayStr = formatDateInput(now);
  // A single date filter drives the whole tab — every number and list below
  // reacts to it. The server fetches through the end of NEXT month too (see
  // app/actions/reports.ts), so an entry logged a few days ahead of today
  // near month-end doesn't fall outside a window this picker can even reach.
  const monthStartStr = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEndStr = formatDateInput(new Date(now.getFullYear(), now.getMonth() + 2, 0));
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  // Defaults to today–today, so the tab opens on exactly what it always showed.
  const d = useMemo(() => {
    const days = dailyDetails.filter((r) => r.date >= fromDate && r.date <= toDate);
    if (days.length === 0) return EMPTY_DETAIL;
    if (days.length === 1) return days[0];
    const merged = {
      ...EMPTY_DETAIL,
      income: 0, kitchenTotal: 0, otherTotal: 0, salaryTotal: 0, billTotal: 0, total: 0,
      expenseList: [] as typeof EMPTY_DETAIL.expenseList,
      paymentsList: [] as typeof EMPTY_DETAIL.paymentsList,
      joinedList: [] as typeof EMPTY_DETAIL.joinedList,
      leftList: [] as typeof EMPTY_DETAIL.leftList,
      dueList: [] as typeof EMPTY_DETAIL.dueList,
    };
    // A tenant's due day repeats on their own cadence, so the same person can
    // appear on several days inside a range. Summing those would invent money
    // that is owed once — keyed by tenant, so each is counted a single time.
    const dueSeen = new Map<string, typeof merged.dueList[number]>();
    for (const day of days) {
      merged.income += day.income;
      merged.kitchenTotal += day.kitchenTotal;
      merged.otherTotal += day.otherTotal;
      merged.salaryTotal += day.salaryTotal;
      merged.billTotal += day.billTotal;
      merged.total += day.total;
      merged.expenseList.push(...day.expenseList);
      merged.paymentsList.push(...day.paymentsList);
      merged.joinedList.push(...day.joinedList);
      merged.leftList.push(...day.leftList);
      for (const t of day.dueList) if (!dueSeen.has(t.id)) dueSeen.set(t.id, t);
    }
    merged.dueList = [...dueSeen.values()].sort((a, b) => b.amount - a.amount);
    merged.expenseList.sort((a, b) => b.amount - a.amount);
    merged.paymentsList.sort((a, b) => b.amount - a.amount);
    return merged;
  }, [dailyDetails, fromDate, toDate]);

  const profit = d.income - d.total;
  const isRange = fromDate !== toDate;
  const isSameDay = !isRange && fromDate === todayStr;
  // What the "on <date>" copy below reads as, for one day or many.
  const periodLabel = isRange
    ? `${formatDate(fromDate)} – ${formatDate(toDate)}`
    : formatDate(fromDate);
  const dueTotal = d.dueList.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-6 animate-fade-up">
      <div className="mb-5 pb-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-400" />
            {isSameDay ? "Today" : periodLabel}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick a day — or a range — anywhere in this month or next
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Input
            type="date"
            value={fromDate}
            min={monthStartStr}
            max={monthEndStr}
            // Dragging the start past the end would show an empty range rather
            // than an error, so the end follows it instead.
            onChange={(e) => {
              if (!e.target.value) return;
              setFromDate(e.target.value);
              if (e.target.value > toDate) setToDate(e.target.value);
            }}
            className="flex-1 sm:flex-none sm:w-auto h-9 text-sm"
          />
          <span className="text-xs text-muted-foreground shrink-0">to</span>
          <Input
            type="date"
            value={toDate}
            min={fromDate}
            max={monthEndStr}
            onChange={(e) => e.target.value && setToDate(e.target.value)}
            className="flex-1 sm:flex-none sm:w-auto h-9 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {[
          {
            key: "income", label: "Income", value: formatCurrency(d.income), sub: null,
            icon: ArrowDownCircle, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20",
          },
          {
            key: "expense", label: "Expense", value: formatCurrency(d.total),
            // Salaries only earn a slot on days one was actually paid — most days
            // have none, and a permanent "Salary Rs 0" is noise.
            sub: [
              `Kitchen ${formatCurrency(d.kitchenTotal)}`,
              `Other ${formatCurrency(d.otherTotal)}`,
              ...(d.salaryTotal > 0 ? [`Salary ${formatCurrency(d.salaryTotal)}`] : []),
              ...(d.billTotal > 0 ? [`Bills ${formatCurrency(d.billTotal)}`] : []),
            ].join(" · "),
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
        ].map(({ key, label, value, sub, icon: Icon, color, bg }, i, arr) => (
          <div
            key={key}
            className={`rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:p-4 flex flex-col ${
              // 5 cards can't split evenly across a 2-col mobile grid — the
              // last one was left alone with blank space beside it.
              i === arr.length - 1 ? "col-span-2 sm:col-span-1" : ""
            }`}
          >
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
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No payments collected on {periodLabel}</p>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-xl border border-white/5">
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
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No expenses recorded on {periodLabel}</p>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-xl border border-white/5">
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
                        <span className="text-muted-foreground/60"> · {e.source === "kitchen" ? "Kitchen" : e.source === "salary" ? "Salary" : e.source === "bill" ? "Bill" : "Other"}</span>
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
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No new members joined on {periodLabel}</p>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-xl border border-white/5">
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
            <p className="text-xs text-muted-foreground rounded-xl border border-white/5 p-3">No one checked out on {periodLabel}</p>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-xl border border-white/5">
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

      {/* Due Today — kept separate from the compact verification grid above and
          given full width, matching the Payments page's own "Due Today" tab,
          since this is the one list an owner actually needs to act on (send a
          reminder), not just cross-check against a register. */}
      <div className="mt-6 rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-5 py-4 border-b border-white/5">
          <AlertTriangle className="w-4 h-4 text-amber" />
          <h3 className="text-sm font-semibold text-foreground">
            {isSameDay ? "Due Today" : isRange ? `Due between ${periodLabel}` : `Due on ${periodLabel}`}
          </h3>
          {d.dueList.length > 0 && (
            <span className="ml-auto text-sm font-semibold text-amber">{formatCurrency(dueTotal)} total</span>
          )}
        </div>

        {d.dueList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <AlertTriangle className="w-10 h-10 opacity-20" />
            <p className="text-sm">Nobody is due {isSameDay ? "today" : isRange ? `between ${periodLabel}` : `on ${periodLabel}`}</p>
          </div>
        ) : (
          <div>
            {/* Desktop header row (≥ md) */}
            <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-6 px-5 py-2.5 border-b border-white/5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Room</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-32">Amount Due</span>
            </div>
            <div className="p-2 md:p-0 space-y-2 md:space-y-0 md:divide-y md:divide-white/5">
              {d.dueList.map((t) => (
                <div key={t.id}>
                  {/* Mobile card (< md) */}
                  <div className="md:hidden rounded-xl border border-white/5 bg-white/[0.02] p-3.5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground leading-tight truncate">{t.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                        {t.roomNumber && <span>Room {t.roomNumber}</span>}
                        {t.phone && <span>{t.phone}</span>}
                      </div>
                    </div>
                    <p className="text-base font-bold text-amber shrink-0 tabular-nums">{formatCurrency(t.amount)}</p>
                  </div>

                  {/* Desktop row (≥ md) */}
                  <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-6 px-5 py-3.5 items-center">
                    <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                    <span className="text-sm text-muted-foreground">{t.roomNumber ? `Room ${t.roomNumber}` : "—"}</span>
                    <span className="text-sm text-muted-foreground">{t.phone ?? "—"}</span>
                    <span className="text-sm font-semibold text-amber text-right w-32 tabular-nums">{formatCurrency(t.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
