import { getExpenses, getAuthContext } from "@/lib/data";
import { ExpensesClient } from "@/components/modules/expenses/expenses-client";
import { yearMonthInZone } from "@/lib/pkt-time";
import { getCountryConfig } from "@/lib/country-config";

export default async function ExpensesPage() {
  // Active hostel's own calendar month (its timezone) — see
  // app/(dashboard)/payments/page.tsx. getAuthContext is cache()'d (a hit here).
  const ctx = await getAuthContext();
  const { year, month } = yearMonthInZone(getCountryConfig(ctx?.hostel?.country).timezone);
  const defaultMonth = `${year}-${String(month).padStart(2, "0")}`;
  const { hostelId, expenses } = await getExpenses(defaultMonth);
  return <ExpensesClient key={hostelId ?? ''} hostelId={hostelId} initialExpenses={expenses} defaultMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
