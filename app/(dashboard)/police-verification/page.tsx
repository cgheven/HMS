import { notFound } from "next/navigation";
import { getHotelEyeSettings, getPendingGuests, getSyncedGuests } from "@/app/actions/hotel-eye";
import { getAuthContext } from "@/lib/data";
import { smartEyeName } from "@/lib/smart-eye-name";
import { isSupportedCountry } from "@/lib/country-config";
import { requiresGuestRegistration } from "@/lib/national-id";
import { PoliceVerificationClient } from "@/components/modules/hotel-eye/police-verification-client";

// The background sync (Next `after`) files guests server-side after the response
// is sent. Give that work a generous serverless budget so a long queue finishes.
export const maxDuration = 300;

export default async function PoliceVerificationPage() {
  // Guest registration (Hotel Eye / Smart Eye) is Pakistan-only. For any other
  // country the feature doesn't exist — 404 the route, matching the hidden nav
  // item and the fail-closed action gate. Every current hostel is PK (no-op).
  const gateCtx = await getAuthContext();
  const country = gateCtx?.hostel?.country;
  if (!(isSupportedCountry(country) && requiresGuestRegistration(country))) notFound();

  const [settingsRes, pendingRes, syncedRes, ctx] = await Promise.all([
    getHotelEyeSettings(), getPendingGuests(), getSyncedGuests(), getAuthContext(),
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
      synced={syncedRes.guests ?? []}
    />
  );
}
