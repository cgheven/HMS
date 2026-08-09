"use client";
// PUBLIC SURFACE ONLY — light "Academic Trust" theme. Never import this into a
// dashboard, admin or super-admin page: it is styled for app/(public)/ and will
// render white inside a dark shell. The dark twin that internal pages use is
// `HostelCard` inside components/find/find-client.tsx, which must stay untouched
// (app/(super-admin)/super-admin/directory and app/(admin)/admin/directory both
// render FindClient from it).
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MapPin, ExternalLink, ArrowRight,
  Users, Wifi, Zap, Utensils, Shield, BedDouble, Clock, X, Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { joinWaitlist } from "@/app/actions/public";
import type { PublicHostel, HostelType } from "@/types";

const TYPE_CONFIG: Record<HostelType, { label: string; badgeCls: string; gradientFrom: string; gradientTo: string }> = {
  boys:   { label: "Boys Only",  badgeCls: "bg-[#0b57d0]/10 text-[#0b57d0] border-[#0b57d0]/30", gradientFrom: "#eef1f6", gradientTo: "#dde3ee" },
  girls:  { label: "Girls Only", badgeCls: "bg-[#6b3fa0]/10 text-[#6b3fa0] border-[#6b3fa0]/30", gradientFrom: "#f7eef4", gradientTo: "#efdfe9" },
};

const DEFAULT_GRADIENT = { gradientFrom: "#f1f2f4", gradientTo: "#e4e6ea" };

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "WiFi":              <Wifi className="w-3 h-3" />,
  "Generator / UPS":   <Zap className="w-3 h-3" />,
  "Meals Included":    <Utensils className="w-3 h-3" />,
  "Security Guard":    <Shield className="w-3 h-3" />,
};

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
      <div className="absolute inset-0 bg-foreground/45 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-sm">Join Waitlist</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">{hostel.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-12 h-12 rounded-full bg-[#006c49]/10 border border-[#006c49]/25 flex items-center justify-center">
                <Clock className="w-5 h-5 text-[#006c49]" />
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
                <p className="text-xs text-destructive bg-destructive/10 border border-destructive/25 rounded-lg px-3 py-2">
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

export function HostelCard({ h, hrefBase = "/find" }: { h: PublicHostel; hrefBase?: string }) {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const router = useRouter();
  const typeCfg = h.hostel_type ? TYPE_CONFIG[h.hostel_type] : null;
  const gradient = typeCfg ?? DEFAULT_GRADIENT;
  const isFull = h.available_beds === 0;
  const detailHref = h.slug ? `${hrefBase}/${h.slug}` : null;

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
        className={`group flex flex-col rounded-2xl border transition-all duration-300 overflow-hidden ${
          isFull
            ? "border-border bg-accent"
            : "border-border bg-card shadow-sm hover:border-primary/40 hover:shadow-md"
        }${detailHref ? " cursor-pointer" : ""}`}
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
              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03] ${isFull ? "grayscale opacity-70" : ""}`}
            />
          ) : (
            /* Dot-grid tile pattern for gradient fallback */
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(0,15,39,0.06) 1px, transparent 1px)",
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
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/95 backdrop-blur-sm border border-input text-xs font-semibold text-muted-foreground">
                <BedDouble className="w-3 h-3" /> Full
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/95 backdrop-blur-sm border border-[#006c49]/30 text-xs font-semibold text-[#006c49]">
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
              className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 backdrop-blur-sm border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Map
            </a>
          )}

          {/* Subtle corner glow on hover */}
          <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/[0.04] transition-all duration-500" />
        </div>

        {/* Info */}
        <div className="flex flex-col flex-1 px-4 sm:px-5 pt-3 sm:pt-4 pb-2 sm:pb-3 gap-2">
          {/* Name + location */}
          <div>
            {detailHref ? (
              <Link href={detailHref} className="block group/title">
                <h3 className="font-serif text-[17px] font-medium text-foreground leading-snug group-hover/title:text-primary transition-colors line-clamp-1">
                  {h.name}
                </h3>
              </Link>
            ) : (
              <h3 className="font-serif text-[17px] font-medium text-foreground leading-snug line-clamp-1">{h.name}</h3>
            )}
            {(h.area || h.city) && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {[h.area, h.city].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          {h.description && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{h.description}</p>
          )}

          {/* Capacity */}
          {h.total_capacity > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="w-3 h-3" /> {h.total_capacity} capacity
            </div>
          )}

          {/* Amenity chips */}
          {h.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {h.amenities.slice(0, 5).map((a) => (
                <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border text-[11px] text-muted-foreground">
                  {AMENITY_ICONS[a] ?? null}
                  {a}
                </span>
              ))}
              {h.amenities.length > 5 && (
                <span className="text-[11px] text-muted-foreground self-center">+{h.amenities.length - 5} more</span>
              )}
            </div>
          )}
        </div>

        {/* CTAs */}
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex gap-2">
          {detailHref ? (
            <Link
              href={detailHref}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors"
            >
              View Rooms <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <div className="flex-1" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setWaitlistOpen(true); }}
            className={`flex items-center justify-center gap-1.5 h-10 rounded-xl border border-input bg-background hover:bg-muted text-foreground text-sm font-medium transition-colors ${detailHref ? "px-4" : "flex-1"}`}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {isFull ? "Waitlist" : "Join Waitlist"}
          </button>
        </div>
      </article>
    </>
  );
}
