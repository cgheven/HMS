import { getFoodItems, getAuthContext } from "@/lib/data";
import { FoodClient } from "@/components/modules/food/food-client";
import { pktYearMonth } from "@/lib/pkt-time";

export default async function FoodPage() {
  // Pakistan-anchored, not the server process's own OS timezone — see
  // app/(dashboard)/payments/page.tsx for why.
  const { year, month: pktMonth } = pktYearMonth();
  const month = `${year}-${String(pktMonth).padStart(2, "0")}`;
  const [{ hostelId, items }, ctx] = await Promise.all([getFoodItems(month), getAuthContext()]);
  return (
    <FoodClient
      key={hostelId ?? ''}
      hostelId={hostelId}
      initialItems={items}
      initialMonth={month}
      initialMenuType={ctx?.hostel?.food_menu_type ?? "monthly"}
      partnerTier={ctx?.partnerTier}
    />
  );
}
