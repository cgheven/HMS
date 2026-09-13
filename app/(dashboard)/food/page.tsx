import { getFoodItems, getAuthContext } from "@/lib/data";
import { FoodClient } from "@/components/modules/food/food-client";
import { yearMonthInZone } from "@/lib/pkt-time";
import { getCountryConfig } from "@/lib/country-config";

export default async function FoodPage() {
  // Active hostel's own calendar month (its timezone) — see
  // app/(dashboard)/payments/page.tsx. getAuthContext is cache()'d (a hit here).
  const ctx = await getAuthContext();
  const { year, month: pktMonth } = yearMonthInZone(getCountryConfig(ctx?.hostel?.country).timezone);
  const month = `${year}-${String(pktMonth).padStart(2, "0")}`;
  const { hostelId, items } = await getFoodItems(month);
  return (
    <FoodClient
      key={hostelId ?? ''}
      hostelId={hostelId}
      initialItems={items}
      initialMonth={month}
      // Dead fallback in practice — the column is NOT NULL — but it should not
      // contradict the DB default, which migration 200 set to 'weekly'.
      initialMenuType={ctx?.hostel?.food_menu_type ?? "weekly"}
      partnerTier={ctx?.partnerTier}
    />
  );
}
