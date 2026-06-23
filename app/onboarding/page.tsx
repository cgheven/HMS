import type { Metadata } from "next";
import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = {
  title: "Join Pulse — Manage Your Hostel Digitally",
  description:
    "Sign up to manage your hostel with Pulse. Track tenants, collect payments, manage expenses, and grow your business — all in one place.",
};

export default function OnboardingPage() {
  return <OnboardingClient />;
}
