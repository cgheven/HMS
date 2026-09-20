"use client";

import { useEffect, useRef, useState } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { getCountryConfig } from "@/lib/country-config";
import { isValidLocalPhone, phoneExample } from "@/lib/phone";
import { COUNTRIES } from "@/lib/countries";
import { COUNTRY_DIAL_CODE } from "@/lib/country-reference";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ISO alpha-2 → flag emoji (regional-indicator pair). Browser-only UI, so emoji
// render fine (unlike the receipt PDF).
function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const DIAL_OPTIONS = COUNTRIES
  .map((c) => ({ code: c.code, name: c.name, dial: COUNTRY_DIAL_CODE[c.code] || "" }))
  .filter((o) => o.dial);

// Compact dial-code picker: the trigger shows just the flag + "+code"; the popover
// is a searchable list (by country name or code). No wide country-name box.
function DialCodePicker({ country, onChange, disabled }: { country: string; onChange: (code: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dial = getCountryConfig(country).dialCode;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? DIAL_OPTIONS.filter((o) => o.name.toLowerCase().includes(q) || o.dial.includes(q.replace(/^\+/, "")))
    : DIAL_OPTIONS;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(n) => { setOpen(n); if (n) setQuery(""); }}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-10 items-center gap-1 rounded-l-md border border-r-0 border-sidebar-border bg-white/[0.03] px-2.5 text-sm whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <span className="text-base leading-none">{flagEmoji(country)}</span>
          <span className="text-muted-foreground">+{dial || "?"}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-[280px] rounded-xl border border-sidebar-border bg-card text-foreground shadow-2xl overflow-hidden"
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            className="max-h-60 overflow-y-auto overscroll-contain p-1"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">No matches</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  onClick={() => { onChange(o.code); setOpen(false); }}
                  className="relative flex w-full items-center gap-2 rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-white/10 focus:bg-white/10 text-left"
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {country === o.code && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="text-base leading-none">{flagEmoji(o.code)}</span>
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="text-muted-foreground shrink-0">+{o.dial}</span>
                </button>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

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

// Split a stored phone into { country, local } for the international field below.
// A value stored with its own code ("+923313454321") resolves to its real country;
// a legacy bare/local number ("03313454321") is read as the default (branch) country.
function splitIntlPhone(value: string | null | undefined, defaultCountry: string): { country: string; local: string } {
  const v = (value ?? "").trim();
  const fallback = (defaultCountry || "PK").toUpperCase();
  if (v.startsWith("+")) {
    try {
      const p = parsePhoneNumberFromString(v);
      if (p?.country) return { country: p.country, local: String(p.nationalNumber).replace(/^0+/, "") };
    } catch { /* fall through */ }
  }
  return { country: fallback, local: v.replace(/\D/g, "").replace(/^0+/, "") };
}

// Phone entry whose COUNTRY CODE is selectable — for a resident/emergency number
// that may belong to a different country than the branch (e.g. a Pakistani tenant
// in a UAE hostel picks +92). Stores the full international number "+<code><nat>"
// (empty string when blank), so the receiver's country is never guessed downstream.
export function IntlPhoneInput({
  value,
  onChange,
  defaultCountry,
  id,
  placeholder,
  disabled,
  autoComplete,
  className,
}: {
  value: string;
  /** Receives the full international number, e.g. "+923313454321" (or "" when empty). */
  onChange: (e164: string) => void;
  /** Branch country — the initial dial code before the user picks another. */
  defaultCountry: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  const initial = splitIntlPhone(value, defaultCountry);
  const [country, setCountry] = useState(initial.country);
  const [local, setLocal] = useState(initial.local);
  const [touched, setTouched] = useState(false);
  // The exact string we last emitted upward. When the parent echoes that same
  // value back as `value`, it is NOT an external change, so we ignore it. This is
  // essential: splitIntlPhone cannot resolve the country of a half-typed "+9715",
  // so re-parsing on every keystroke would wrongly snap the country back to the
  // default (the "+92 reverts as I type" bug).
  const lastEmitted = useRef<string | null>(null);

  // Resync ONLY when the parent supplies a value we did NOT just emit — e.g. the
  // shared dialog reopened for another resident. Our own echo is skipped, so a
  // keystroke never clobbers the in-progress country/number.
  useEffect(() => {
    if ((value ?? "") === (lastEmitted.current ?? "")) return;
    const s = splitIntlPhone(value, defaultCountry);
    setCountry(s.country);
    setLocal(s.local);
    lastEmitted.current = value ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const example = phoneExample(country);
  const exampleLen = example.replace(/\D/g, "").length;
  const longEnough = exampleLen > 0 ? local.length >= exampleLen : touched;
  const invalid = !!local && !isValidLocalPhone(local, country) && (touched || longEnough);

  function emit(nextCountry: string, nextLocal: string) {
    const dc = getCountryConfig(nextCountry).dialCode;
    const v = nextLocal ? `+${dc}${nextLocal}` : "";
    lastEmitted.current = v;
    onChange(v);
  }

  return (
    <div>
      <div className="flex">
        <DialCodePicker
          country={country}
          disabled={disabled}
          onChange={(c) => { setCountry(c); emit(c, local); }}
        />
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          value={local}
          onChange={(e) => {
            const l = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 15);
            setLocal(l);
            emit(country, l);
          }}
          onBlur={() => setTouched(true)}
          placeholder={example ? `e.g. ${example}` : placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={invalid}
          className={cn("rounded-l-none flex-1 min-w-0", invalid && "border-rose-500/60 focus-visible:ring-rose-500/40", className)}
        />
      </div>
      {invalid && <p className="mt-1 text-xs text-rose-400">Enter a valid mobile number for {getCountryConfig(country).name}.</p>}
    </div>
  );
}
