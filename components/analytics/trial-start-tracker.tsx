"use client";

import { useEffect } from "react";
import { trackEvent, trackOnce } from "@/lib/analytics";

/**
 * Fires `trial_started` once when a trial owner first lands in the authenticated
 * app. The trial is created SERVER-SIDE at signup provisioning (a non-null
 * hms_profiles.trial_ends_at set just after account creation, cleared on first
 * payment), which has no browser context — so first authenticated load with an
 * active trial is the earliest client-observable, backend-backed proxy.
 *
 * De-duped once per browser (localStorage). Renders nothing.
 *
 * Limitation (documented): the once-guard is per-browser, not per-account, so a
 * returning trial owner on a new device could re-fire. A fully reliable
 * trial_started would come from GA4 Measurement Protocol at signup.ts (server).
 */
export function TrialStartTracker({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    trackOnce("trial_started", () => trackEvent("trial_started"));
  }, [active]);
  return null;
}
