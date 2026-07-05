"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search, MapPin, ExternalLink, Home, ArrowRight,
  Users, Wifi, Zap, Utensils, Shield, BedDouble, Clock, X, Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { joinWaitlist } from "@/app/actions/public";
import type { PublicHostel, HostelType } from "@/types";

// ── Marquee animation ─────────────────────────────────────────────────────────

const MARQUEE_CITIES = [
  "Karachi", "Lahore", "Islamabad", "Peshawar", "Quetta",
  "Rawalpindi", "Faisalabad", "Multan", "Hyderabad", "Sialkot",
  "Gujranwala", "Bahawalpur", "Sukkur", "Abbottabad", "Mardan",
];

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<HostelType, { label: string; badgeCls: string; gradientFrom: string; gradientTo: string }> = {
  boys:   { label: "Boys Only",  badgeCls: "bg-blue-500/20 text-blue-300 border-blue-400/20",    gradientFrom: "#0a1628", gradientTo: "#0f2347" },
  girls:  { label: "Girls Only", badgeCls: "bg-pink-500/20 text-pink-300 border-pink-400/20",    gradientFrom: "#1a0d18", gradientTo: "#2d1529" },
  mixed:  { label: "Mixed",      badgeCls: "bg-violet-500/20 text-violet-300 border-violet-400/20", gradientFrom: "#110d1e", gradientTo: "#1e1436" },
  family: { label: "Family",     badgeCls: "bg-emerald-500/20 text-emerald-300 border-emerald-400/20", gradientFrom: "#0a1a11", gradientTo: "#0f2d1a" },
};

const DEFAULT_GRADIENT = { gradientFrom: "#1a1208", gradientTo: "#2a1e05" };

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "WiFi":              <Wifi className="w-3 h-3" />,
  "Generator / UPS":   <Zap className="w-3 h-3" />,
  "Meals Included":    <Utensils className="w-3 h-3" />,
  "Security Guard":    <Shield className="w-3 h-3" />,
};

function WhatsAppIcon({ cls = "w-3.5 h-3.5" }: { cls?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-current ${cls}`} xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

// ── Waitlist modal ────────────────────────────────────────────────────────────

function WaitlistModal({ hostel, onClose }: { hostel: PublicHostel; onClose: () => void }) {
  const [name, setName]     = useState("");
  const [phone, setPhone]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]     = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const { error } = await joinWaitlist(hostel.id, name, phone);
    setSubmitting(false);
    if (error) {
      setErrorMsg(error);
    } else {
      setDone(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <p className="font-semibold text-sm">Join Waitlist</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">{hostel.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="font-medium">You&apos;re on the list!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  The hostel owner will contact you on <strong className="text-foreground">{phone}</strong> when a space opens up.
                </p>
              </div>
              <Button variant="outline" onClick={onClose} className="mt-2 w-full">Close</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">Leave your details — the owner contacts you directly on WhatsApp.</p>
              <div className="space-y-1.5">
                <Label>Your Name *</Label>
                <Input placeholder="Ali Ahmed" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp / Phone *</Label>
                <Input placeholder="03xx xxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </div>
              {errorMsg && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}
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
  const router = useRouter();
  const typeCfg = h.hostel_type ? TYPE_CONFIG[h.hostel_type] : null;
  const gradient = typeCfg ?? DEFAULT_GRADIENT;
  const isFull = h.available_beds === 0;
  const detailHref = h.slug ? `/find/${h.slug}` : null;

  useEffect(() => {
    if (detailHref) router.prefetch(detailHref);
  }, [detailHref, router]);
  // SECURITY: reject javascript: URIs — only allow https:// links
  const safeMapsUrl = h.maps_url?.match(/^https?:\/\//i) ? h.maps_url : null;

  return (
    <>
      {waitlistOpen && <WaitlistModal hostel={h} onClose={() => setWaitlistOpen(false)} />}

      <article
        onClick={() => detailHref && router.push(detailHref)}
        className={`group flex flex-col rounded-2xl border border-white/[0.07] bg-[#111113] hover:border-amber/30 transition-all duration-300 overflow-hidden${detailHref ? " cursor-pointer" : ""}`}
      >

        {/* Visual header — cover photo or gradient fallback */}
        <div
          className="relative h-36 sm:h-44 shrink-0 overflow-hidden"
          style={h.cover_image_url ? undefined : { background: `linear-gradient(135deg, ${gradient.gradientFrom} 0%, ${gradient.gradientTo} 100%)` }}
        >
          {h.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={h.cover_image_url}
              alt={h.name}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            /* Dot-grid tile pattern for gradient fallback */
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
                backgroundSize: "18px 18px",
              }}
            />
          )}
          {/* Scrim so text is readable over photos */}
          {h.cover_image_url && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />
          )}

          {/* Availability badge — bottom left */}
          <div className="absolute bottom-3 left-3">
            {isFull ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-xs font-semibold text-rose-300">
                <BedDouble className="w-3 h-3" /> Full
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-emerald-400/30 text-xs font-semibold text-emerald-300">
                <BedDouble className="w-3 h-3" /> {h.available_beds} {h.available_beds === 1 ? "bed" : "beds"} free
              </span>
            )}
          </div>

          {/* Type badge — top right */}
          {typeCfg && (
            <div className="absolute top-3 right-3">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-semibold backdrop-blur-sm ${typeCfg.badgeCls}`}>
                {typeCfg.label}
              </span>
            </div>
          )}

          {/* Maps link — top left */}
          {safeMapsUrl && (
            <a
              href={safeMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 text-[11px] text-white/70 hover:text-white transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Map
            </a>
          )}

          {/* Subtle corner glow on hover */}
          <div className="absolute inset-0 bg-amber/0 group-hover:bg-amber/5 transition-all duration-500" />
        </div>

        {/* Info */}
        <div className="flex flex-col flex-1 px-4 sm:px-5 pt-3 sm:pt-4 pb-2 sm:pb-3 gap-2">
          {/* Name + location */}
          <div>
            {detailHref ? (
              <Link href={detailHref} className="block group/title">
                <h3 className="font-serif text-[17px] font-medium text-foreground leading-snug group-hover/title:text-amber transition-colors line-clamp-1">
                  {h.name}
                </h3>
              </Link>
            ) : (
              <h3 className="font-serif text-[17px] font-medium text-foreground leading-snug line-clamp-1">{h.name}</h3>
            )}
            {(h.area || h.city) && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                <span className="text-xs text-muted-foreground/70 truncate">
                  {[h.area, h.city].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          {h.description && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">{h.description}</p>
          )}

          {/* Capacity */}
          {h.total_capacity > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
              <Users className="w-3 h-3" /> {h.total_capacity} capacity
            </div>
          )}

          {/* Amenity chips */}
          {h.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {h.amenities.slice(0, 5).map((a) => (
                <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-[11px] text-muted-foreground/80">
                  {AMENITY_ICONS[a] ?? null}
                  {a}
                </span>
              ))}
              {h.amenities.length > 5 && (
                <span className="text-[11px] text-muted-foreground/50 self-center">+{h.amenities.length - 5} more</span>
              )}
            </div>
          )}
        </div>

        {/* CTAs */}
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex gap-2">
          {detailHref ? (
            <Link
              href={detailHref}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-amber hover:bg-amber/90 text-black text-sm font-semibold transition-colors"
            >
              View Rooms <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <div className="flex-1" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setWaitlistOpen(true); }}
            className={`flex items-center justify-center gap-1.5 h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-muted-foreground hover:text-foreground text-sm font-medium transition-colors ${detailHref ? "px-4" : "flex-1"}`}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {isFull ? "Waitlist" : "Join Waitlist"}
          </button>
        </div>
      </article>
    </>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────────

function ownerInitials(name: string | null) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function HostelGrid({ hostels }: { hostels: PublicHostel[] }) {
  const countByOwner: Record<string, number> = {};
  for (const h of hostels) countByOwner[h.owner_id] = (countByOwner[h.owner_id] ?? 0) + 1;

  const groups: Record<string, PublicHostel[]> = {};
  const singles: PublicHostel[] = [];

  for (const h of hostels) {
    if (countByOwner[h.owner_id] > 1) {
      if (!groups[h.owner_id]) groups[h.owner_id] = [];
      groups[h.owner_id].push(h);
    } else {
      singles.push(h);
    }
  }

  return (
    <div className="space-y-10">
      {Object.values(groups).map((group) => {
        const owner = group[0];
        return (
          <div key={owner.owner_id}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-amber/10 border border-amber/20 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-amber">{ownerInitials(owner.owner_name)}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{owner.owner_name ?? "Hostel Owner"}</span>
                <span className="text-xs text-muted-foreground shrink-0">· {group.length} properties</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {group.map((h) => <HostelCard key={h.id} h={h} />)}
            </div>
          </div>
        );
      })}

      {singles.length > 0 && (
        <div>
          {Object.keys(groups).length > 0 && (
            <p className="text-[11px] font-semibold text-muted-foreground/40 uppercase tracking-widest mb-4">Other Hostels</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {singles.map((h) => <HostelCard key={h.id} h={h} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────────────────────

function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
        active
          ? "bg-amber/15 text-amber border-amber/30"
          : "border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/20"
      }`}
    >
      {label}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const ALL_TYPES: { value: HostelType | "all"; label: string }[] = [
  { value: "all",    label: "All" },
  { value: "boys",   label: "Boys" },
  { value: "girls",  label: "Girls" },
  { value: "mixed",  label: "Mixed" },
  { value: "family", label: "Family" },
];

export function FindClient({ hostels }: { hostels: PublicHostel[] }) {
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState<HostelType | "all">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");

  const cities = useMemo(() => Array.from(new Set(hostels.map((h) => h.city).filter(Boolean) as string[])).sort(), [hostels]);
  const areas  = useMemo(() => {
    const src = cityFilter === "all" ? hostels : hostels.filter((h) => h.city === cityFilter);
    return Array.from(new Set(src.map((h) => h.area).filter(Boolean) as string[])).sort();
  }, [hostels, cityFilter]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return hostels.filter((h) => {
      if (typeFilter !== "all" && h.hostel_type !== typeFilter) return false;
      if (cityFilter !== "all" && h.city !== cityFilter) return false;
      if (areaFilter !== "all" && h.area !== areaFilter) return false;
      if (q) return h.name.toLowerCase().includes(q) || (h.city ?? "").toLowerCase().includes(q) || (h.area ?? "").toLowerCase().includes(q) || (h.description ?? "").toLowerCase().includes(q);
      return true;
    });
  }, [hostels, search, typeFilter, cityFilter, areaFilter]);

  const marqueeItems = [...MARQUEE_CITIES, ...MARQUEE_CITIES, ...MARQUEE_CITIES];

  return (
    <>
      <style>{`
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.333%); }
        }
      `}</style>

      <div className="min-h-screen bg-[#0A0A0B]">

        {/* ── Header bar ────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden border-b border-white/[0.06]">
          {/* Subtle marquee — only visible on wider viewports, very faint */}
          <div className="absolute inset-0 flex items-center pointer-events-none select-none overflow-hidden">
            <div
              className="whitespace-nowrap text-[56px] font-serif font-bold text-white/[0.018] leading-none"
              style={{ animation: "marquee-scroll 50s linear infinite" }}
            >
              {marqueeItems.map((city, i) => (
                <span key={i} className="mx-8">{city}</span>
              ))}
            </div>
          </div>

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4">
            {/* Brand + title */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-lg bg-amber/15 border border-amber/25 flex items-center justify-center shrink-0">
                <Home className="w-3.5 h-3.5 text-amber" />
              </div>
              <div className="min-w-0">
                <h1 className="font-serif text-lg sm:text-xl font-medium text-foreground leading-tight">
                  Find Your <span className="text-amber">Perfect Hostel</span>
                </h1>
                <p className="text-[11px] text-muted-foreground/50 hidden sm:block">Verified hostels · Direct contact · No fees</p>
              </div>
            </div>

            {/* Search — full width on mobile, fixed width on desktop */}
            <div className="relative w-full sm:w-72 lg:w-80 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="Search by name, city, area…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-xl border border-white/[0.09] bg-white/[0.04] text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-amber/40 focus:bg-white/[0.06] transition-all"
              />
            </div>
          </div>
        </div>

        {/* ── Filter bar ────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 border-b border-white/[0.05] bg-[#0A0A0B]/90 backdrop-blur-md">
          <div className="max-w-6xl mx-auto">

            {/* Mobile: stacked scrollable rows */}
            <div className="sm:hidden">
              {/* Type row */}
              <div className="flex items-center gap-2 px-4 pt-2.5 pb-1 overflow-x-auto scrollbar-none">
                <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest shrink-0 w-8">Type</span>
                <div className="flex gap-1 shrink-0">
                  {ALL_TYPES.map((t) => (
                    <Pill key={t.value} active={typeFilter === t.value} onClick={() => setTypeFilter(t.value)} label={t.label} />
                  ))}
                </div>
              </div>
              {/* City row */}
              {cities.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-1 overflow-x-auto scrollbar-none">
                  <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest shrink-0 w-8">City</span>
                  <div className="flex gap-1 shrink-0">
                    <Pill active={cityFilter === "all"} onClick={() => { setCityFilter("all"); setAreaFilter("all"); }} label="All" />
                    {cities.map((c) => <Pill key={c} active={cityFilter === c} onClick={() => { setCityFilter(c); setAreaFilter("all"); }} label={c} />)}
                  </div>
                </div>
              )}
              {/* Area row */}
              {areas.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-1 overflow-x-auto scrollbar-none">
                  <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest shrink-0 w-8">Area</span>
                  <div className="flex gap-1 shrink-0">
                    <Pill active={areaFilter === "all"} onClick={() => setAreaFilter("all")} label="All" />
                    {areas.map((a) => <Pill key={a} active={areaFilter === a} onClick={() => setAreaFilter(a)} label={a} />)}
                  </div>
                </div>
              )}
              {/* Count */}
              <div className="px-4 pt-1 pb-2 text-right">
                <span className="text-[11px] text-muted-foreground/40 tabular-nums">
                  {filtered.length} {filtered.length === 1 ? "hostel" : "hostels"}
                </span>
              </div>
            </div>

            {/* Desktop: single inline row */}
            <div className="hidden sm:flex items-center gap-x-5 gap-y-2 px-6 py-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest shrink-0">Type</span>
                <div className="flex gap-1">
                  {ALL_TYPES.map((t) => (
                    <Pill key={t.value} active={typeFilter === t.value} onClick={() => setTypeFilter(t.value)} label={t.label} />
                  ))}
                </div>
              </div>
              {cities.length > 0 && (
                <>
                  <div className="w-px h-4 bg-white/[0.07]" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest shrink-0">City</span>
                    <div className="flex gap-1 flex-wrap">
                      <Pill active={cityFilter === "all"} onClick={() => { setCityFilter("all"); setAreaFilter("all"); }} label="All" />
                      {cities.map((c) => <Pill key={c} active={cityFilter === c} onClick={() => { setCityFilter(c); setAreaFilter("all"); }} label={c} />)}
                    </div>
                  </div>
                </>
              )}
              {areas.length > 0 && (
                <>
                  <div className="w-px h-4 bg-white/[0.07]" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest shrink-0">Area</span>
                    <div className="flex gap-1 flex-wrap">
                      <Pill active={areaFilter === "all"} onClick={() => setAreaFilter("all")} label="All" />
                      {areas.map((a) => <Pill key={a} active={areaFilter === a} onClick={() => setAreaFilter(a)} label={a} />)}
                    </div>
                  </div>
                </>
              )}
              <span className="ml-auto text-xs text-muted-foreground/50 shrink-0 tabular-nums">
                {filtered.length} {filtered.length === 1 ? "hostel" : "hostels"}
              </span>
            </div>

          </div>
        </div>

        {/* ── Listings ──────────────────────────────────────────────────────── */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <Home className="w-7 h-7 text-muted-foreground/25" />
              </div>
              <div>
                <p className="font-medium">No hostels found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {search || typeFilter !== "all" || cityFilter !== "all" || areaFilter !== "all"
                    ? "Try adjusting your filters."
                    : "No hostels are listed yet. Check back soon."}
                </p>
              </div>
            </div>
          ) : (
            <HostelGrid hostels={filtered} />
          )}
        </div>

        {/* ── Footer strip ──────────────────────────────────────────────────── */}
        <div className="border-t border-white/[0.05] mt-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-amber/15 border border-amber/25 flex items-center justify-center">
                <Home className="w-2.5 h-2.5 text-amber" />
              </div>
              <span className="text-xs text-muted-foreground/50">HMS Directory</span>
            </div>
            <p className="text-xs text-muted-foreground/40">Verified hostels · Direct contact · No fees</p>
          </div>
        </div>
      </div>
    </>
  );
}
