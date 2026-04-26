"use client";
import React, { createContext, useContext, useMemo } from "react";
import type { Profile, Hostel } from "@/types";

interface HostelContextValue {
  profile: Profile | null;
  hostel: Hostel | null;
  hostelId: string | null;
}

const HostelContext = createContext<HostelContextValue>({
  profile: null,
  hostel: null,
  hostelId: null,
});

export function HostelProvider({
  children,
  profile,
  hostel,
}: {
  children: React.ReactNode;
  profile: Profile | null;
  hostel: Hostel | null;
}) {
  const value = useMemo(
    () => ({ profile, hostel, hostelId: hostel?.id ?? null }),
    [profile, hostel]
  );
  return (
    <HostelContext.Provider value={value}>
      {children}
    </HostelContext.Provider>
  );
}

export function useHostelContext() {
  return useContext(HostelContext);
}
