"use server";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { pktYearMonth } from "@/lib/pkt-time";
import {
  collectedFrom,
  pendingFrom,
  depositsCollectedFrom,
  depositsPendingFrom,
  salaryCashOutFrom,
  enumerateMonths,
  monthKeyMinus,
} from "@/lib/report-math";
import type { PortfolioBranch, PortfolioBranchMonth, PortfolioSummary } from "@/types";

const WINDOW_MONTHS = 12;

type PaymentRow = {
  hostel_id: string;
  for_month: string;
  amount: unknown;
  amount_paid: unknown;
  late_fee: unknown;
  status: string;
  security_deposit_charge: unknown;
};
type DatedAmountRow = { hostel_id: string; amount: unknown; date: string };
// `status` is selected even though the query already filters on it — the shared
// reducer re-asserts status === "paid", and that assertion is the parity contract.
type SalaryRow = { hostel_id: string; for_month: string; status: string; amount: unknown; advance_deducted: unknown };
type AdvanceRow = { hostel_id: string; amount: unknown; advance_date: string };
type TenantRow = {
  hostel_id: string;
  is_active: boolean;
  is_waiting: boolean;
  security_deposit: unknown;
  deposit_collected_amount: unknown;
};
type RoomRow = { hostel_id: string; capacity: number; occupied: number };

type PagedResult = { data: unknown[] | null; count: number | null; error: { message: string } | null };
type PageWindow = { from: number; to: number };

// Structural shape of a supabase query builder, narrowed to the two calls the
// pager makes. Lets `paginate` stay one function instead of seven ternaries.
interface PageableQuery extends PromiseLike<PagedResult> {
  order(column: string, options: { ascending: boolean }): PageableQuery;
  range(from: number, to: number): PageableQuery;
}

// OFFSET paging is only coherent under a total order — Postgres gives no row
// order for LIMIT/OFFSET without ORDER BY, and each page is a separate request
// on its own snapshot, so an unordered second page can repeat or skip rows.
// `id` is the uuid primary key on all seven tables and need not be selected.
function paginate(query: PageableQuery, window: PageWindow | null): PromiseLike<PagedResult> {
  if (!window) return query;
  return query.order("id", { ascending: true }).range(window.from, window.to);
}

// PostgREST silently caps a response at its max-rows setting with no error at
// all — a truncated page here produces a wrong profit figure that looks
// perfectly plausible. The exact count tells us whether that happened.
//
// The first request carries NO range, so when max-rows is unset (as it must be
// today — every query in reports.ts reads unbounded and the business trusts
// those figures to the rupee) this is ONE round trip per query and the paging
// path below is never entered. Only a genuine truncation makes us re-read, and
// then the page size is the cap the server just demonstrated, never an assumed
// constant: guessing 1000 against a smaller cap would silently skip whole blocks
// of rows and understate profit.
//
// A failed query is thrown, not swallowed into `?? []`. Every other read in this
// codebase defaults an error to an empty array, which here would silently render
// a branch's profit as its costs alone — a plausible-looking wrong number is far
// worse on this page than an error boundary.
async function fetchAllRows<T>(query: (window: PageWindow | null) => PromiseLike<PagedResult>): Promise<T[]> {
  const first = await query(null);
  if (first.error) throw new Error(`Portfolio query failed: ${first.error.message}`);
  const rows = (first.data ?? []) as T[];

  // A missing count is UNKNOWN, not "nothing further to fetch". Treating null as
  // the latter would hand back a truncated response as if it were the whole set.
  if (first.count === null || first.count === undefined) {
    throw new Error("Portfolio query returned no exact row count; refusing to report a possibly truncated total");
  }
  if (rows.length >= first.count) return rows;

  const pageSize = rows.length;
  if (pageSize === 0) throw new Error(`Portfolio query returned 0 of ${first.count} rows`);

  const all: T[] = [];
  while (all.length < first.count) {
    const res = await query({ from: all.length, to: all.length + pageSize - 1 });
    if (res.error) throw new Error(`Portfolio query failed: ${res.error.message}`);
    const batch = (res.data ?? []) as T[];
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

function groupByHostel<T extends { hostel_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const bucket = m.get(r.hostel_id);
    if (bucket) bucket.push(r);
    else m.set(r.hostel_id, [r]);
  }
  return m;
}

function sumBy<T extends { hostel_id: string }>(rows: T[], pick: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.hostel_id, (m.get(r.hostel_id) ?? 0) + pick(r));
  return m;
}

function emptySummary(windowFrom: string, windowTo: string, currentMonthKey: string): PortfolioSummary {
  return {
    branches: [],
    months: enumerateMonths(windowFrom, windowTo).map(({ monthKey, label }) => ({ monthKey, label })),
    windowFrom,
    windowTo,
    currentMonthKey,
  };
}

/**
 * Every branch the caller owns, at (branch × month) grain, for a trailing
 * 12-month window. One server wave; the client re-slices any period inside that
 * window with no further network calls.
 *
 * TAKES NO PARAMETERS, EVER — not a date range, and above all not a hostel id
 * list. The branch set comes from getAuthContext (the owner_id ∪
 * hms_owner_hostels union), which is the same set verifyReportAccess approves,
 * at zero query cost. createAdminClient() bypasses RLS entirely, so a
 * caller-supplied id list here would be an IDOR across every paying client. The
 * branch filter on /overview is client-side and can only ever narrow this set.
 */
export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const [, ctx] = await Promise.all([requireOwnerOrAbove(), getAuthContext()]);

  const { year, month } = pktYearMonth();
  const currentMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const windowTo = currentMonthKey;
  const windowFrom = monthKeyMinus(windowTo, WINDOW_MONTHS - 1);

  // requireOwnerOrAbove already redirected anyone who is not owner/super_admin.
  // This second check is not redundant: getAuthContext has a partner early-return
  // that fills ctx.hostels from hms_partnerships, so building the branch list
  // without a role gate would be an accident of role ordering rather than a rule.
  if (!ctx?.profile || ctx.profile.role === "partner") {
    return emptySummary(windowFrom, windowTo, currentMonthKey);
  }

  const ids = ctx.hostels.map((h) => h.id);
  if (ids.length === 0) return emptySummary(windowFrom, windowTo, currentMonthKey);

  const monthSlots = enumerateMonths(windowFrom, windowTo);
  const fullStart = monthSlots[0].start;
  const fullEnd = monthSlots[monthSlots.length - 1].end;

  const admin = createAdminClient();

  // Deliberate departure from CLAUDE.md rule 2 (prefer FK joins): NO joins here.
  // reports.ts joins tenant name/phone/room onto every payment row, which is the
  // single largest payload multiplier — this page needs sums, not names. Branch
  // names and cities come from ctx.hostels, already in memory at zero DB cost,
  // so there is no second query for a join to collapse.
  //
  // THE KEYING SPLIT IS LOAD-BEARING: payments and salary payments filter on
  // for_month (text 'YYYY-MM'); expenses, kitchen and advances filter on real
  // DATE columns over fullStart..fullEnd. A July bill settled in August counts
  // in JULY. Mixing the two would have revenue and costs cover different windows.
  const [payments, expenses, kitchen, salaries, advances, tenants, rooms] = await Promise.all([
    fetchAllRows<PaymentRow>((w) =>
      paginate(
        admin
          .from("hms_payments")
          .select("hostel_id, for_month, amount, amount_paid, late_fee, status, security_deposit_charge", {
            count: "exact",
          })
          .in("hostel_id", ids)
          .gte("for_month", windowFrom)
          .lte("for_month", windowTo),
        w
      )
    ),
    fetchAllRows<DatedAmountRow>((w) =>
      paginate(
        admin
          .from("hms_expenses")
          .select("hostel_id, amount, date", { count: "exact" })
          .in("hostel_id", ids)
          .gte("date", fullStart)
          .lte("date", fullEnd),
        w
      )
    ),
    fetchAllRows<DatedAmountRow>((w) =>
      paginate(
        admin
          .from("hms_kitchen_expenses")
          .select("hostel_id, amount, date", { count: "exact" })
          .in("hostel_id", ids)
          .gte("date", fullStart)
          .lte("date", fullEnd),
        w
      )
    ),
    fetchAllRows<SalaryRow>((w) =>
      paginate(
        admin
          .from("hms_salary_payments")
          .select("hostel_id, for_month, status, amount, advance_deducted", { count: "exact" })
          .in("hostel_id", ids)
          .gte("for_month", windowFrom)
          .lte("for_month", windowTo)
          .eq("status", "paid"),
        w
      )
    ),
    fetchAllRows<AdvanceRow>((w) =>
      paginate(
        admin
          .from("hms_salary_advances")
          .select("hostel_id, amount, advance_date", { count: "exact" })
          .in("hostel_id", ids)
          .gte("advance_date", fullStart)
          .lte("advance_date", fullEnd),
        w
      )
    ),
    // Bounded to members who still matter. Without it this reads every tenant
    // row ever written across every branch — years of checked-out members that
    // no consumer below looks at, growing without limit.
    fetchAllRows<TenantRow>((w) =>
      paginate(
        admin
          .from("hms_tenants")
          .select("hostel_id, is_active, is_waiting, security_deposit, deposit_collected_amount", {
            count: "exact",
          })
          .in("hostel_id", ids)
          .or("is_active.eq.true,is_waiting.eq.true"),
        w
      )
    ),
    fetchAllRows<RoomRow>((w) =>
      paginate(
        admin
          .from("hms_rooms")
          .select("hostel_id, capacity, occupied", { count: "exact" })
          .in("hostel_id", ids),
        w
      )
    ),
  ]);

  const paymentsByBranch = groupByHostel(payments);
  const expensesByBranch = groupByHostel(expenses);
  const kitchenByBranch = groupByHostel(kitchen);
  const salariesByBranch = groupByHostel(salaries);
  const advancesByBranch = groupByHostel(advances);
  const tenantsByBranch = groupByHostel(tenants);
  const bedsByBranch = sumBy(rooms, (r) => Number(r.capacity ?? 0));
  const occupiedByBranch = sumBy(rooms, (r) => Number(r.occupied ?? 0));

  // Every owned branch emits a row even with zero activity — silently dropping a
  // branch from a page called "All Branches" is worse than a row of dashes.
  const branches: PortfolioBranch[] = ctx.hostels.map((hostel) => {
    const branchPayments = paymentsByBranch.get(hostel.id) ?? [];
    const branchExpenses = expensesByBranch.get(hostel.id) ?? [];
    const branchKitchen = kitchenByBranch.get(hostel.id) ?? [];
    const branchSalaries = salariesByBranch.get(hostel.id) ?? [];
    const branchAdvances = advancesByBranch.get(hostel.id) ?? [];
    const branchTenants = tenantsByBranch.get(hostel.id) ?? [];

    const paymentsByMonth = new Map<string, PaymentRow[]>();
    for (const p of branchPayments) {
      const bucket = paymentsByMonth.get(p.for_month);
      if (bucket) bucket.push(p);
      else paymentsByMonth.set(p.for_month, [p]);
    }

    const months: PortfolioBranchMonth[] = monthSlots.map(({ monthKey, start, end }) => {
      const monthPayments = paymentsByMonth.get(monthKey) ?? [];
      return {
        monthKey,
        collected: collectedFrom(monthPayments),
        pending: pendingFrom(monthPayments),
        depositsCollected: depositsCollectedFrom(monthPayments),
        expenses: branchExpenses
          .filter((e) => e.date >= start && e.date <= end)
          .reduce((s, e) => s + Number(e.amount), 0),
        kitchen: branchKitchen
          .filter((k) => k.date >= start && k.date <= end)
          .reduce((s, k) => s + Number(k.amount), 0),
        salaries: salaryCashOutFrom(branchSalaries, branchAdvances, monthKey, start, end),
      };
    });

    // Point-in-time NOW, deliberately outside the date range. Mirrors
    // getDashboardData's security_deposit_total / _count: active members holding
    // an agreed deposit, plus waiting-list members whose reservation money is
    // already in hand. Waiting rows carry is_active = false.
    const depositMembers = branchTenants.filter(
      (t) => t.is_active && !t.is_waiting && Number(t.security_deposit ?? 0) > 0
    );
    const reservedMembers = branchTenants.filter(
      (t) => t.is_waiting && Number(t.deposit_collected_amount ?? 0) > 0
    );

    return {
      id: hostel.id,
      name: hostel.name,
      city: hostel.city,
      activeMembers: branchTenants.filter((t) => t.is_active && !t.is_waiting).length,
      beds: bedsByBranch.get(hostel.id) ?? 0,
      occupied: occupiedByBranch.get(hostel.id) ?? 0,
      depositsHeld:
        depositMembers.reduce((s, t) => s + Number(t.security_deposit), 0) +
        reservedMembers.reduce((s, t) => s + Number(t.deposit_collected_amount ?? 0), 0),
      depositCount: depositMembers.length + reservedMembers.length,
      // Deliberately the FULL window, not the selected period, so the figure is
      // stable when the period pill changes and does not miss a member billed
      // before the selected month who never paid.
      depositsUnreceived: depositsPendingFrom(branchPayments),
      months,
    };
  });

  return {
    branches,
    months: monthSlots.map(({ monthKey, label }) => ({ monthKey, label })),
    windowFrom,
    windowTo,
    currentMonthKey,
  };
}
