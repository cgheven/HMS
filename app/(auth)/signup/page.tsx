import { headers } from "next/headers";
import { getCountryConfig } from "@/lib/country-config";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Best-effort IP geolocation for the shown default (server re-derives + gates
  // the authoritative value on submit; getCountryConfig fails open to PK).
  const h = await headers();
  const detected = getCountryConfig((h.get("x-vercel-ip-country") || "").toUpperCase());
  // `detected.code` is a supported code (getCountryConfig falls open to PK), so it
  // is a safe default selection for the country picker.
  return <SignupForm detectedCountryCode={detected.code} />;
}
