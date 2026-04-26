import { getFoodItems } from "@/lib/data";
import { FoodClient } from "@/components/modules/food/food-client";
import { formatDateInput } from "@/lib/utils";

export default async function FoodPage() {
  const today = formatDateInput(new Date());
  const { hostelId, items } = await getFoodItems(today);
  return <FoodClient hostelId={hostelId} initialItems={items} initialDate={today} />;
}
