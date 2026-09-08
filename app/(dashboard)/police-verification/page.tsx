import { getHotelEyeSettings, getPendingGuests } from "@/app/actions/hotel-eye";
import { getAuthContext } from "@/lib/data";
import { smartEyeName } from "@/lib/smart-eye-name";
import { PoliceVerificationClient } from "@/components/modules/hotel-eye/police-verification-client";

export default async function PoliceVerificationPage() {
  const [settingsRes, pendingRes, ctx] = await Promise.all([
    getHotelEyeSettings(), getPendingGuests(), getAuthContext(),
  ]);
  // The system's local name — from the province the owner configured, else the
  // hostel's city. Resolved server-side so the page title matches the sidebar.
  const systemName = smartEyeName({
    province: settingsRes.settings?.defaultProvince,
    city: ctx?.hostel?.city,
  });
  return (
    <PoliceVerificationClient
      systemName={systemName}
      settings={settingsRes.settings ?? null}
      guests={pendingRes.guests ?? []}
      missing={pendingRes.missing ?? 0}
    />
  );
}
