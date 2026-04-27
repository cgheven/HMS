"use client";
import { useState, useMemo } from "react";
import {
  Search, MapPin, Mail, ExternalLink, Home,
  Users, Wifi, Zap, Utensils, Shield, BedDouble, Clock, X, Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { joinWaitlist } from "@/app/actions/public";
import type { PublicHostel, HostelType } from "@/types";

function toWhatsAppUrl(phone: string, hostelName: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0")
    ? "92" + digits.slice(1)
    : digits.startsWith("92")
    ? digits
    : digits;
  const text = encodeURIComponent(`Hi! I saw your listing on HMS Directory and I'm interested in staying at ${hostelName}. Is there availability?`);
  return `https://wa.me/${normalized}?text=${text}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<HostelType, { label: string; cls: string }> = {
  boys:   { label: "Boys Only",  cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  girls:  { label: "Girls Only", cls: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  mixed:  { label: "Mixed",      cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  family: { label: "Family",     cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
};

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "WiFi": <Wifi className="w-3 h-3" />,
  "Generator / UPS": <Zap className="w-3 h-3" />,
  "Meals Included": <Utensils className="w-3 h-3" />,
  "Security Guard": <Shield className="w-3 h-3" />,
};

function AmenityChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/10 text-xs text-muted-foreground">
      {AMENITY_ICONS[label] ?? null}
      {label}
    </span>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

// ── Waitlist modal ────────────────────────────────────────────────────────────

function WaitlistModal({ hostel, onClose }: { hostel: PublicHostel; onClose: () => void }) {
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]       = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await joinWaitlist(hostel.id, name, phone);
    setSubmitting(false);
    if (!error) setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl border border-sidebar-border bg-sidebar shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border">
          <div>
            <p className="font-semibold text-sm text-foreground">Join Waitlist</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">{hostel.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="font-medium text-foreground">You're on the list!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  The hostel owner will contact you on <strong className="text-foreground">{phone}</strong> when a space opens up.
                </p>
              </div>
              <Button variant="outline" onClick={onClose} className="mt-2 w-full">Close</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This hostel is currently full. Leave your details and the owner will reach out when a bed opens up.
              </p>
              <div className="space-y-1.5">
                <Label>Your Name *</Label>
                <Input placeholder="Ali Ahmed" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp / Phone *</Label>
                <Input placeholder="03xx xxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </div>
              <Button type="submit" disabled={submitting} className="w-full gap-2">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                {submitting ? "Joining…" : "Join Waitlist"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hostel card ───────────────────────────────────────────────────────────────

function HostelCard({ h }: { h: PublicHostel }) {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const typeCfg = h.hostel_type ? TYPE_CONFIG[h.hostel_type] : null;
  const visibleAmenities = h.amenities.slice(0, 6);
  const extra = h.amenities.length - 6;
  const waUrl = h.phone ? toWhatsAppUrl(h.phone, h.name) : null;
  const isFull = h.available_beds === 0;

  return (
    <>
      {waitlistOpen && <WaitlistModal hostel={h} onClose={() => setWaitlistOpen(false)} />}

      <div className="group flex flex-col rounded-2xl border border-sidebar-border bg-card hover:border-amber/20 hover:bg-card/80 transition-all duration-200 overflow-hidden">
        {/* Card header */}
        <div className="px-5 pt-5 pb-4 border-b border-sidebar-border/50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground text-base leading-tight truncate group-hover:text-amber transition-colors">
                {h.name}
              </h3>
              {(h.area || h.city) && (
                <div className="flex items-center gap-1 mt-1.5">
                  <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">
                    {[h.area, h.city].filter(Boolean).join(", ")}
                  </span>
                </div>
              )}
            </div>
            {typeCfg && (
              <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${typeCfg.cls}`}>
                {typeCfg.label}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 gap-4 px-5 py-4">
          {h.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{h.description}</p>
          )}

          {/* Availability + capacity row */}
          <div className="flex items-center gap-3">
            {isFull ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-xs font-medium text-rose-400">
                <BedDouble className="w-3 h-3" /> Full
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400">
                <BedDouble className="w-3 h-3" /> {h.available_beds} bed{h.available_beds !== 1 ? "s" : ""} available
              </span>
            )}
            {h.total_capacity > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3 h-3" /> {h.total_capacity} total
              </span>
            )}
          </div>

          {h.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {visibleAmenities.map((a) => <AmenityChip key={a} label={a} />)}
              {extra > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/10 text-xs text-muted-foreground">
                  +{extra} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Primary CTA */}
        <div className="px-5 pb-4">
          {isFull ? (
            <button
              onClick={() => setWaitlistOpen(true)}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-sidebar-border text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              <Clock className="w-4 h-4" />
              Join Waitlist
            </button>
          ) : waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/25 text-[#25D366] text-sm font-medium transition-colors"
            >
              <WhatsAppIcon />
              Book Now on WhatsApp
            </a>
          ) : null}
        </div>

        {/* Footer: email + map */}
        <div className="px-5 py-3 border-t border-sidebar-border/50 flex flex-wrap gap-3">
          {h.email && (
            <a href={`mailto:${h.email}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Mail className="w-3 h-3" /> {h.email}
            </a>
          )}
          {h.maps_url && (
            <a
              href={h.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-amber hover:text-amber/80 transition-colors ml-auto"
            >
              View on Map <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ALL_TYPES: { value: HostelType | "all"; label: string }[] = [
  { value: "all",    label: "All Types" },
  { value: "boys",   label: "Boys" },
  { value: "girls",  label: "Girls" },
  { value: "mixed",  label: "Mixed" },
  { value: "family", label: "Family" },
];

interface Props { hostels: PublicHostel[] }

export function FindClient({ hostels }: Props) {
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState<HostelType | "all">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");

  const cities = useMemo(() => {
    const set = new Set(hostels.map((h) => h.city).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [hostels]);

  const areas = useMemo(() => {
    const source = cityFilter === "all" ? hostels : hostels.filter((h) => h.city === cityFilter);
    const set = new Set(source.map((h) => h.area).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [hostels, cityFilter]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return hostels.filter((h) => {
      if (typeFilter !== "all" && h.hostel_type !== typeFilter) return false;
      if (cityFilter !== "all" && h.city !== cityFilter) return false;
      if (areaFilter !== "all" && h.area !== areaFilter) return false;
      if (q) {
        return (
          h.name.toLowerCase().includes(q) ||
          (h.city ?? "").toLowerCase().includes(q) ||
          (h.area ?? "").toLowerCase().includes(q) ||
          (h.description ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [hostels, search, typeFilter, cityFilter, areaFilter]);

  const filterPill = (active: boolean, onClick: () => void, label: string) => (
    <button
      key={label}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
        active
          ? "bg-amber/10 text-amber border-amber/30"
          : "border-sidebar-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Compact hero — 2-col on desktop */}
      <div className="border-b border-sidebar-border bg-sidebar/50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center shrink-0">
                <Home className="w-3.5 h-3.5 text-amber" />
              </div>
              <p className="text-xs font-semibold text-amber uppercase tracking-widest">HMS Directory</p>
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-normal tracking-tight">
              Find Your Perfect Hostel
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse verified hostels. Contact directly — no fees, no middlemen.
            </p>
          </div>

          <div className="relative sm:w-72 lg:w-96 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, city, area…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 bg-card border-sidebar-border"
            />
          </div>
        </div>
      </div>

      {/* Sticky filter bar */}
      <div className="sticky top-0 z-10 border-b border-sidebar-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap gap-x-4 gap-y-2 py-2.5 items-center">
            {/* Type */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest shrink-0">Type</span>
              <div className="flex gap-1">
                {ALL_TYPES.map((t) => filterPill(typeFilter === t.value, () => setTypeFilter(t.value), t.label))}
              </div>
            </div>

            {cities.length > 0 && (
              <>
                <div className="w-px h-4 bg-sidebar-border hidden sm:block" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest shrink-0">City</span>
                  <div className="flex gap-1">
                    {filterPill(cityFilter === "all", () => { setCityFilter("all"); setAreaFilter("all"); }, "All")}
                    {cities.map((c) => filterPill(cityFilter === c, () => { setCityFilter(c); setAreaFilter("all"); }, c))}
                  </div>
                </div>
              </>
            )}

            {areas.length > 0 && (
              <>
                <div className="w-px h-4 bg-sidebar-border hidden sm:block" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest shrink-0">Area</span>
                  <div className="flex flex-wrap gap-1">
                    {filterPill(areaFilter === "all", () => setAreaFilter("all"), "All")}
                    {areas.map((a) => filterPill(areaFilter === a, () => setAreaFilter(a), a))}
                  </div>
                </div>
              </>
            )}

            <span className="ml-auto text-xs text-muted-foreground shrink-0">
              {filtered.length} {filtered.length === 1 ? "hostel" : "hostels"}
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-sidebar-border flex items-center justify-center">
              <Home className="w-7 h-7 text-muted-foreground/30" />
            </div>
            <div>
              <p className="font-medium text-foreground">No hostels found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search || typeFilter !== "all" || cityFilter !== "all" || areaFilter !== "all"
                  ? "Try adjusting your filters."
                  : "No hostels are listed yet. Check back soon."}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((h) => <HostelCard key={h.id} h={h} />)}
          </div>
        )}
      </div>
    </div>
  );
}
