import { getFoodItems, getAuthContext } from "@/lib/data";
import { FoodClient } from "@/components/modules/food/food-client";

export default async function FoodPage() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [{ hostelId, items }, ctx] = await Promise.all([getFoodItems(month), getAuthContext()]);
  return (
    <FoodClient
      key={hostelId ?? ''}
      hostelId={hostelId}
      initialItems={items}
      initialMonth={month}
      partnerTier={ctx?.partnerTier}
    />
  );
}
