import { getKitchenExpenses, getAuthContext } from "@/lib/data";
import { KitchenClient } from "@/components/modules/kitchen/kitchen-client";
import { pktYearMonth } from "@/lib/pkt-time";

export default async function KitchenPage() {
  // Pakistan-anchored, not the server process's own OS timezone — see
  // app/(dashboard)/payments/page.tsx for why.
  const { year, month } = pktYearMonth();
  const defaultMonth = `${year}-${String(month).padStart(2, "0")}`;
  const [{ hostelId, items }, ctx] = await Promise.all([
    getKitchenExpenses(defaultMonth),
    getAuthContext(),
  ]);
  return <KitchenClient key={hostelId ?? ''} hostelId={hostelId} initialItems={items} defaultMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
