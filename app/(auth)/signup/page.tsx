import { headers } from "next/headers";
import { getCountryConfig } from "@/lib/country-config";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Best-effort IP geolocation for the shown default (server re-derives + gates
  // the authoritative value on submit; getCountryConfig fails open to PK).
  const h = await headers();
  const detected = getCountryConfig((h.get("x-vercel-ip-country") || "").toUpperCase());
  return <SignupForm detectedCountryName={detected.name} />;
}
