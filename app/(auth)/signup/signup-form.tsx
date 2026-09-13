"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Loader2, CheckCircle2 } from "lucide-react";
import { requestSignup } from "@/app/actions/signup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_COUNTRIES } from "@/lib/country-config";
import { PROPERTY_TYPES } from "@/lib/validation";
import { LegalFooter } from "@/components/legal/legal-footer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm({ detectedCountryCode }: { detectedCountryCode: string }) {
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Defaults to the IP-detected country; the owner can override it (IP geo is
  // unreliable — VPNs, travel — so the picker, not the IP, is authoritative).
  const [country, setCountry] = useState(detectedCountryCode);
  // Property type — an optional business attribute. Presets plus a free-text
  // "Other". The server re-whitelists the presets and length-caps custom text.
  const [propertyType, setPropertyType] = useState("");
  const [propertyTypeOther, setPropertyTypeOther] = useState("");
  const [contactRef2, setContactRef2] = useState(""); // honeypot — real users never see/fill this
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const dialCode = SUPPORTED_COUNTRIES.find((c) => c.code === country)?.dialCode ?? "";
  const resolvedPropertyType =
    propertyType === "Other" ? propertyTypeOther.trim() : propertyType;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    // The server re-validates the chosen country (isSupportedCountry, else IP,
    // else PK) so a spoofed value can't unlock an unsupported market. Response is
    // intentionally uniform (anti-enumeration) — we show the same "check your
    // inbox" screen regardless. Only a transport failure (never a "this email
    // exists" signal) surfaces an error.
    try {
      await requestSignup({
        businessName: businessName.trim() || undefined,
        ownerName: ownerName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim() || undefined,
        country,
        propertyType: resolvedPropertyType || undefined,
        contactRef2,
      });
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-amber/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber/10 border border-amber/20 overflow-hidden shrink-0">
            <Image src="/logo-mark.jpg" alt="Pulse" width={48} height={48} priority className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-foreground font-bold text-lg tracking-tight leading-none">Pulse</p>
            <p className="text-amber/70 text-[10px] mt-1 font-semibold tracking-[0.15em] uppercase">Pulse of Your Business</p>
          </div>
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-8 shadow-2xl">
          {sent ? (
            <div className="text-center py-4 space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
              <h2 className="text-xl font-semibold text-foreground">Check your inbox</h2>
              <p className="text-sm text-muted-foreground">
                If you can sign up with <span className="font-medium text-foreground">{email.trim()}</span>, a verification
                link is on its way. Click it to create your account and set your password.
              </p>
              <p className="text-xs text-muted-foreground">The link expires in 60 minutes.</p>
              <Link href="/login" className="inline-block text-sm text-amber hover:underline">Back to sign in</Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Hostel Management System</p>
                <h2 className="text-xl font-semibold text-foreground mt-2">Create your account</h2>
                <p className="text-sm text-muted-foreground mt-1">Start your 14-day free trial — no card required.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="business" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Business name</Label>
                  <Input id="business" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Al Noor Hostels" disabled={loading}
                    className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="owner" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your name</Label>
                  <Input id="owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Ali Hassan" disabled={loading}
                    className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="you@example.com" required autoComplete="email" disabled={loading}
                    className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mobile number</Label>
                  <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={`+${dialCode} …`} autoComplete="tel" disabled={loading}
                    className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50" />
                </div>

                {/* Honeypot: off-screen, not tab-reachable, ignored by humans.
                    Non-standard name so password managers don't autofill it. */}
                <div aria-hidden className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
                  <label htmlFor="contactRef2">Leave this field empty</label>
                  <input id="contactRef2" name="contactRef2" tabIndex={-1} autoComplete="off" value={contactRef2} onChange={(e) => setContactRef2(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="country" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Country</Label>
                  <Select value={country} onValueChange={setCountry} disabled={loading}>
                    <SelectTrigger id="country" className="h-10 bg-background/50 border-sidebar-border focus:ring-amber/40 focus:border-amber/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Sets your currency, timezone and billing region.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="propertyType" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Property type <span className="normal-case font-normal">(optional)</span></Label>
                  <Select value={propertyType} onValueChange={setPropertyType} disabled={loading}>
                    <SelectTrigger id="propertyType" className="h-10 bg-background/50 border-sidebar-border focus:ring-amber/40 focus:border-amber/50">
                      <SelectValue placeholder="Select property type" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROPERTY_TYPES.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {propertyType === "Other" && (
                    <Input
                      value={propertyTypeOther}
                      onChange={(e) => setPropertyTypeOther(e.target.value)}
                      placeholder="Describe your property type"
                      maxLength={60}
                      disabled={loading}
                      className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50"
                    />
                  )}
                </div>
                {error && <p className="text-xs text-rose-400">{error}</p>}

                <Button type="submit" disabled={loading || !email.trim()}
                  className="w-full h-10 mt-2 bg-amber text-background font-semibold hover:bg-amber/90 transition-all duration-200 glow-amber">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : "Create account"}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground mt-6">
                Already have an account? <Link href="/login" className="text-amber hover:underline">Sign in</Link>
              </p>
            </>
          )}
        </div>
        <div className="mt-6"><LegalFooter /></div>
      </div>
    </div>
  );
}
