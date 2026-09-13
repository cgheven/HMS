import { getKitchenExpenses, getAuthContext } from "@/lib/data";
import { KitchenClient } from "@/components/modules/kitchen/kitchen-client";
import { yearMonthInZone } from "@/lib/pkt-time";
import { getCountryConfig } from "@/lib/country-config";

export default async function KitchenPage() {
  // Active hostel's own calendar month (its timezone) — see
  // app/(dashboard)/payments/page.tsx. getAuthContext is cache()'d (a hit here).
  const ctx = await getAuthContext();
  const { year, month } = yearMonthInZone(getCountryConfig(ctx?.hostel?.country).timezone);
  const defaultMonth = `${year}-${String(month).padStart(2, "0")}`;
  const { hostelId, items } = await getKitchenExpenses(defaultMonth);
  return <KitchenClient key={hostelId ?? ''} hostelId={hostelId} initialItems={items} defaultMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
