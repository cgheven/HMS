import { getExpenses, getAuthContext } from "@/lib/data";
import { ExpensesClient } from "@/components/modules/expenses/expenses-client";

export default async function ExpensesPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [{ hostelId, expenses }, ctx] = await Promise.all([getExpenses(defaultMonth), getAuthContext()]);
  return <ExpensesClient key={hostelId ?? ''} hostelId={hostelId} initialExpenses={expenses} defaultMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
