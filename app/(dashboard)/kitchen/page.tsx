import { getKitchenExpenses } from "@/lib/data";
import { KitchenClient } from "@/components/modules/kitchen/kitchen-client";

export default async function KitchenPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { hostelId, items } = await getKitchenExpenses(defaultMonth);
  return <KitchenClient hostelId={hostelId} initialItems={items} defaultMonth={defaultMonth} />;
}
