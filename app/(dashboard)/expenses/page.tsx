import { getExpenses, getAuthContext } from "@/lib/data";
import { ExpensesClient } from "@/components/modules/expenses/expenses-client";
import { pktYearMonth } from "@/lib/pkt-time";

export default async function ExpensesPage() {
  // Pakistan-anchored, not the server process's own OS timezone — see
  // app/(dashboard)/payments/page.tsx for why.
  const { year, month } = pktYearMonth();
  const defaultMonth = `${year}-${String(month).padStart(2, "0")}`;
  const [{ hostelId, expenses }, ctx] = await Promise.all([getExpenses(defaultMonth), getAuthContext()]);
  return <ExpensesClient key={hostelId ?? ''} hostelId={hostelId} initialExpenses={expenses} defaultMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
