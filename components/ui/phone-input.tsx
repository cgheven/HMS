"use client";

import { useState } from "react";
import { getCountryConfig } from "@/lib/country-config";
import { isValidLocalPhone, phoneExample } from "@/lib/phone";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Phone entry with an auto-detected international dial-code prefix (from the
// selected country) + a local-number field, with per-country validation
// (libphonenumber-js) and a country-specific example placeholder. Stores the
// LOCAL national number (digits only, no trunk 0) — the country code is implied
// by the account/branch country, so existing data + sending logic are unchanged.
export function PhoneInput({
  country,
  value,
  onChange,
  id,
  placeholder,
  disabled,
  autoComplete,
  className,
}: {
  /** ISO 3166-1 alpha-2 country code, e.g. "PK". Drives the dial code, example and validation. */
  country: string;
  value: string;
  /** Receives the local number, digits only (leading trunk 0 stripped). */
  onChange: (localDigits: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  const [touched, setTouched] = useState(false);
  const dialCode = getCountryConfig(country).dialCode;
  const example = phoneExample(country);
  const exampleLen = example.replace(/\D/g, "").length;
  // Show the error the moment the entry is long enough to be judged (>= a typical
  // number's length for the country) — so typing MORE digits than the number
  // allows is flagged live, not only on blur. Still shows on blur for a short
  // number. Falls back to blur-only when the country has no example length.
  const longEnough = exampleLen > 0 ? value.length >= exampleLen : touched;
  const invalid = !!value && !isValidLocalPhone(value, country) && (touched || longEnough);

  return (
    <div>
      <div className="flex">
        <span className="inline-flex items-center rounded-l-md border border-r-0 border-sidebar-border bg-white/[0.03] px-3 text-sm text-muted-foreground whitespace-nowrap">
          +{dialCode || "?"}
        </span>
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          value={value}
          // Digits only; drop a leading trunk 0 so the stored national number never
          // double-prefixes the country code (e.g. PK 0300… → 300…). Capped at 15
          // (E.164 max) so an accidental long paste/hold can't run away.
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 15))}
          onBlur={() => setTouched(true)}
          placeholder={example ? `e.g. ${example}` : placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={invalid}
          className={cn("rounded-l-none", invalid && "border-rose-500/60 focus-visible:ring-rose-500/40", className)}
        />
      </div>
      {invalid && <p className="mt-1 text-xs text-rose-400">Enter a valid mobile number for {getCountryConfig(country).name}.</p>}
    </div>
  );
}
