"use client";
import { useState } from "react";
import { Loader2, Building2, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { isValidLocalPhone } from "@/lib/phone";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { createBranch, previewAddProperty, switchActiveHostel } from "@/app/actions/branches";
import { trackEvent, marketFromCountry } from "@/lib/analytics";
import { terms as getTerms, getCountryConfig } from "@/lib/country-config";
import { COUNTRY_NAMES, countryNameOf, countryCodeOfName } from "@/lib/countries";
import { PROPERTY_TYPES, PROPERTY_TYPE_MAX_LEN, ACCOMMODATION_TYPES } from "@/lib/validation";
import type { Hostel } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The owner's existing properties — offered as "copy setup from" sources. */
  hostels: Hostel[];
  defaultCountry: string | null | undefined;
}


const TIER_LABEL: Record<string, string> = {
  basic: "Basic", standard: "Standard", business: "Business", enterprise: "Enterprise",
};

function formatMinor(amount: string, currency?: string): string {
  const value = Number(amount) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

type PreviewState = {
  willCharge?: boolean;
  amount?: string;
  currency?: string;
  fromTier?: string;
  toTier?: string;
};

export function AddPropertyDialog({ open, onClose, hostels, defaultCountry }: Props) {
  const [country, setCountry] = useState((defaultCountry ?? "PK").toUpperCase());
  const t = getTerms(country);
  // WhatsApp/"Mobile Number" is only meaningful where WhatsApp messaging is
  // offered (Pakistan). For every other market it's an unused second phone box, so
  // it's hidden — non-PK properties keep a single Phone contact.
  const showWhatsapp = getCountryConfig(country).whatsapp;
  // An existing owner already has an email on file — prefill it (editable) so they
  // don't retype it for every new property.
  const existingEmail = hostels.find((h) => (h as { email?: string | null }).email)?.email ?? "";
  const [form, setForm] = useState({
    name: "", address: "", city: "", area: "", phone: "", whatsapp: "", email: existingEmail, total_capacity: "",
  });
  const [propertyType, setPropertyType] = useState("");
  const [propertyTypeOther, setPropertyTypeOther] = useState("");
  const [hostelType, setHostelType] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set, we're showing the pre-charge confirmation instead of the form.
  const [confirm, setConfirm] = useState<PreviewState | null>(null);

  const busy = checking || saving;

  // Step 1 — validate, then preview the billing impact. If a charge is due we
  // surface a confirmation; otherwise we create straight away.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(`${t.branch} name is required.`); return; }
    if (form.phone.trim() && !isValidLocalPhone(form.phone, country)) { setError("Enter a valid phone number, or leave it blank."); return; }
    if (form.whatsapp.trim() && !isValidLocalPhone(form.whatsapp, country)) { setError(`Enter a valid ${t.mobileNumber.toLowerCase()}, or leave it blank.`); return; }
    setChecking(true);
    setError(null);
    const preview = await previewAddProperty();
    setChecking(false);
    if (!preview.ok) {
      setError(preview.error ?? `Could not add the ${t.branch.toLowerCase()}.`);
      return;
    }
    if (preview.willCharge) {
      setConfirm({
        willCharge: true,
        amount: preview.amount,
        currency: preview.currency,
        fromTier: preview.fromTier,
        toTier: preview.toTier,
      });
      return;
    }
    // No charge due (within-tier / manual / trial) — create immediately.
    await create();
  }

  // Step 2 — actually create. Payment (if any) is taken server-side FIRST; the
  // property is only returned once Paddle has confirmed the upgrade.
  async function create() {
    setSaving(true);
    setError(null);
    const resolvedType = propertyType === "Other" ? propertyTypeOther.trim() : propertyType;
    const result = await createBranch({
      name: form.name,
      address: form.address || undefined,
      city: form.city || undefined,
      area: form.area || undefined,
      phone: form.phone || undefined,
      whatsapp: form.whatsapp || undefined,
      email: form.email || undefined,
      total_capacity: parseInt(form.total_capacity) || 0,
      country,
      property_type: resolvedType || undefined,
      hostel_type: hostelType || undefined,
      copyFromHostelId: copyFrom || undefined,
    });
    if (result.error || !result.hostel) {
      setSaving(false);
      setConfirm(null);
      setError(result.error ?? `Could not create the ${t.branch.toLowerCase()}.`);
      return;
    }
    // Activation milestone — backend-confirmed first property (server counted
    // existing hostels). No property name/id/PII sent, only the market bucket.
    if (result.firstProperty) {
      trackEvent("first_property_created", {
        module: "properties",
        market: marketFromCountry(country),
      });
    }
    // Switch to the new property, then a full reload so the new cookie is sent
    // (same reasoning as the switcher's window.location.reload()).
    await switchActiveHostel(result.hostel.id);
    window.location.reload();
  }

  if (confirm) {
    const tierLabel = TIER_LABEL[confirm.toTier ?? ""] ?? confirm.toTier ?? "";
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber" /> Confirm upgrade
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Adding this {t.branch.toLowerCase()} moves your plan to <span className="font-medium text-foreground">{tierLabel}</span>.
            </p>
            <div className="rounded-lg border border-sidebar-border bg-white/5 p-4">
              {confirm.amount ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Due now (prorated)</span>
                    <span className="text-lg font-semibold">{formatMinor(confirm.amount, confirm.currency)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Charged today for the rest of this billing period, then the {tierLabel} rate each cycle. Your {t.branch.toLowerCase()} is created only after payment is confirmed.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  An upgrade charge applies. You&apos;ll be billed the prorated {tierLabel} difference now; the {t.branch.toLowerCase()} is created only after payment is confirmed.
                </p>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setConfirm(null); setError(null); }} disabled={busy}>Back</Button>
              <Button type="button" onClick={create} disabled={busy}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : "Confirm & pay"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-amber" /> Add {t.branch}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t.branch} Name <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`e.g. Downtown ${t.branch}`} autoFocus required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Country</Label>
              <SearchableSelect
                value={countryNameOf(country)}
                onValueChange={(v) => setCountry((countryCodeOfName(v) || "PK").toUpperCase())}
                options={COUNTRY_NAMES}
                placeholder="Select country"
                searchPlaceholder="Search countries…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Property type</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {propertyType === "Other" && (
            <div className="space-y-1.5">
              <Label>Specify type</Label>
              <Input value={propertyTypeOther} onChange={(e) => setPropertyTypeOther(e.target.value)} placeholder="Your property type" maxLength={PROPERTY_TYPE_MAX_LEN} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Who can live here?</Label>
            <Select value={hostelType} onValueChange={setHostelType}>
              <SelectTrigger><SelectValue placeholder="Select accommodation type" /></SelectTrigger>
              <SelectContent>
                {ACCOMMODATION_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Area / Neighbourhood</Label><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><PhoneInput country={country} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="Phone number" /></div>
            {showWhatsapp && (
              <div className="space-y-1.5"><Label>{t.mobileNumber}</Label><PhoneInput country={country} value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} placeholder={t.mobileNumber} /></div>
            )}
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className={`space-y-1.5${!showWhatsapp ? " sm:col-span-2" : ""}`}><Label>Total Capacity</Label><Input type="number" min="0" placeholder="0" value={form.total_capacity} onChange={(e) => setForm({ ...form, total_capacity: e.target.value })} /></div>
          </div>

          {hostels.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-sidebar-border bg-white/5 p-3">
              <Label className="flex items-center gap-1.5"><Copy className="w-3.5 h-3.5 text-amber" /> Copy setup from</Label>
              <Select value={copyFrom || "none"} onValueChange={(v) => setCopyFrom(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Start blank</SelectItem>
                  {hostels.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {copyFrom
                  ? "Copies pricing, charges, WiFi, meals, menu, referral rewards and payment methods. Rooms, residents and payments are never copied — those start fresh for this property."
                  : "Optional — reuse the full setup (pricing, WiFi, meals, menu, referral, payment methods) from an existing property. Rooms, residents and payments always start fresh."}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
                : saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                : `Add ${t.branch}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
