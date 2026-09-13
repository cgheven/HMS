"use client";
import React, { createContext, useContext, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { terms } from "@/lib/country-config";
import type { Profile, Hostel, PartnerTier } from "@/types";

interface HostelContextValue {
  profile: Profile | null;
  hostel: Hostel | null;
  hostels: Hostel[];
  hostelId: string | null;
  // null for an owner (unrestricted); the partner's tier on the active branch otherwise.
  partnerTier: PartnerTier | null;
  setActiveHostel: (hostelId: string) => void;
}

const HostelContext = createContext<HostelContextValue>({
  profile: null,
  hostel: null,
  hostels: [],
  hostelId: null,
  partnerTier: null,
  setActiveHostel: () => {},
});

export function HostelProvider({
  children,
  profile,
  hostel,
  hostels,
  partnerTier = null,
}: {
  children: React.ReactNode;
  profile: Profile | null;
  hostel: Hostel | null;
  hostels: Hostel[];
  partnerTier?: PartnerTier | null;
}) {
  const router = useRouter();

  const setActiveHostel = useCallback(
    (hostelId: string) => {
      document.cookie = `hms_active_hostel=${hostelId}; path=/; max-age=31536000; SameSite=Lax`;
      router.refresh();
    },
    [router]
  );

  const value = useMemo(
    () => ({ profile, hostel, hostels, hostelId: hostel?.id ?? null, partnerTier, setActiveHostel }),
    [profile, hostel, hostels, partnerTier, setActiveHostel]
  );

  return <HostelContext.Provider value={value}>{children}</HostelContext.Provider>;
}

export function useHostelContext() {
  return useContext(HostelContext);
}

// Currency bound to the ACTIVE hostel's country — the single way client
// components format a hostel's money so £ / Rs follow the branch automatically.
// Falls open to Pakistan when there's no active hostel. Do NOT use for Pulse's
// own SaaS billing to the owner (that is USD/PKR — use billing-client's formatter).
export function useMoney() {
  const { hostel } = useHostelContext();
  const country = hostel?.country;
  return useCallback((amount: number) => formatCurrency(amount, country), [country]);
}

// User-facing terminology bound to the ACTIVE hostel's country — mirrors
// useMoney(). Client components call const t = useTerms() and render {t.tenants}
// etc. Falls open to Pakistan (the legacy words) when there's no active hostel,
// so every existing all-PK render is byte-identical.
export function useTerms() {
  const { hostel } = useHostelContext();
  return terms(hostel?.country);
}
