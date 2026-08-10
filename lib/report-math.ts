// The money reducers, extracted so every screen that reports revenue, deposits
// or staff cash-out computes them from ONE definition. Previously these lived
// inline in app/actions/reports.ts; the cross-branch Overview needs the exact
// same arithmetic, and a hand-copy would drift the first time either side is
// touched. Pure — no I/O, no "use server", safe to import anywhere.
//
// Every asymmetry below is inherited deliberately and must not be "tidied":
//   • late_fee is absent from collected and present in pending
//   • "waived" is excluded from both
//   • deposits are pro-rated by paid/amount on a partially-settled bill
//   • salaries are gross minus advance_deducted, plus advances by their own date

export interface PaymentMoneyRow {
  status: string;
  amount: unknown;
  amount_paid?: unknown;
  late_fee?: unknown;
  security_deposit_charge?: unknown;
}

export interface SalaryMoneyRow {
  for_month: string;
  status: string;
  amount: unknown;
  advance_deducted?: unknown;
}

export interface AdvanceMoneyRow {
  advance_date: string;
  amount: unknown;
}

const isCollectedRow = (p: PaymentMoneyRow) => p.status === "paid" || p.status === "partially_paid";

const isPendingRow = (p: PaymentMoneyRow) =>
  p.status === "pending" || p.status === "overdue" || p.status === "partially_paid";

/** Cash actually received in the given rows. Mirrors reports.ts totalRevenue. */
export function collectedFrom(rows: PaymentMoneyRow[]): number {
  return rows.filter(isCollectedRow).reduce((s, p) => s + Number(p.amount_paid ?? p.amount), 0);
}

/** Remaining balance still owed, late fee included. Mirrors reports.ts pendingCollections. */
export function pendingFrom(rows: PaymentMoneyRow[]): number {
  return rows
    .filter(isPendingRow)
    .reduce((s, p) => s + Math.max(0, Number(p.amount) + Number(p.late_fee || 0) - Number(p.amount_paid ?? 0)), 0);
}

// Security deposits are refundable liabilities, not income. They ride inside
// `amount`, so `collected` legitimately contains them (it is cash received) but
// profit must not. Nothing records WHICH component a partial payment went to, so
// the deposit is treated as collected in the same proportion as the bill.
export function depositsCollectedFrom(rows: PaymentMoneyRow[]): number {
  return rows.filter(isCollectedRow).reduce((s, p) => {
    const charged = Number(p.security_deposit_charge ?? 0);
    if (charged <= 0) return s;
    const amt = Number(p.amount ?? 0);
    const paid = Number(p.amount_paid ?? p.amount ?? 0);
    if (amt <= 0) return s + charged;
    return s + Math.min(charged, charged * (paid / amt));
  }, 0);
}

// The exact complement of depositsCollectedFrom over the UNPAID rows: deposit
// money billed to a member that has not arrived yet. The `paid` fallback is 0
// here, not `amount` as above — on an unpaid row amount_paid is null, and
// falling back to the bill would declare the deposit fully received.
export function depositsPendingFrom(rows: PaymentMoneyRow[]): number {
  return rows.filter(isPendingRow).reduce((s, p) => {
    const charged = Number(p.security_deposit_charge ?? 0);
    if (charged <= 0) return s;
    const amt = Number(p.amount ?? 0);
    const paid = Number(p.amount_paid ?? 0);
    if (amt <= 0) return s + charged;
    return s + (charged - Math.min(charged, charged * (paid / amt)));
  }, 0);
}

// NET of any advance held back, plus advances handed over inside the month.
// Gross would count the deducted rupees twice: once when the advance left the
// drawer, and again inside a salary payment that never fully went out.
export function salaryCashOutFrom(
  salaries: SalaryMoneyRow[],
  advances: AdvanceMoneyRow[],
  monthKey: string,
  monthStart: string,
  monthEnd: string
): number {
  return (
    salaries
      .filter((s) => s.for_month === monthKey && s.status === "paid")
      .reduce((sum, s) => sum + Number(s.amount) - Number(s.advance_deducted ?? 0), 0) +
    advances
      .filter((a) => a.advance_date >= monthStart && a.advance_date <= monthEnd)
      .reduce((sum, a) => sum + Number(a.amount), 0)
  );
}

export interface MonthSlot {
  monthKey: string;
  label: string;
  start: string;
  end: string;
}

// Built with UTC arithmetic and string keys throughout. The version this
// replaced used local Date getters, which yield the PREVIOUS month's key on a
// machine set west of UTC — invisible on Vercel (UTC) and wrong on a laptop.
export function enumerateMonths(from: string, to: string): MonthSlot[] {
  const out: MonthSlot[] = [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) return out;

  let y = fromYear;
  let m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    const mk = `${y}-${String(m).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({
      monthKey: mk,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
      start: `${mk}-01`,
      end: `${mk}-${String(lastDay).padStart(2, "0")}`,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Subtract `months` calendar months from a YYYY-MM key, in UTC. Inclusive
 *  window arithmetic stays with the caller. */
export function monthKeyMinus(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
