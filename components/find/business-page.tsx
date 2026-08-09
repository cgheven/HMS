"use client";

import Link from "next/link";
import {
  Home, Building2, MapPin, Wifi, UtensilsCrossed, ShieldCheck, Camera,
  Droplets, Car, Snowflake, Zap, Shirt, BookOpen, Phone, Globe,
  BedDouble, ArrowRight, Navigation, HelpCircle,
} from "lucide-react";
import type { PublicHostel } from "@/types";
import type { BranchPublicInfo } from "@/app/actions/public";
import { cn } from "@/lib/utils";
import { socialUrl } from "@/lib/social";
import { formatPhoneDisplay } from "@/lib/phone";
import { PULSE_SITE_URL, PULSE_SOCIALS, PULSE_TAGLINE } from "@/lib/pulse-brand";
import { sharedAmenities, type Faq } from "@/lib/business-content";

// ── helpers ───────────────────────────────────────────────────────────────────

/** WhatsApp's own glyph. lucide dropped brand icons, and a generic speech
 *  bubble doesn't read as "WhatsApp" at a glance — which is the entire point
 *  of putting it on a page aimed at Pakistani students. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.885 3.488" />
    </svg>
  );
}

// Brand glyphs, same reason as WhatsApp above — lucide has no brand icons.
// Instagram's mark is a gradient, not a flat colour, so it carries its own
// fill rather than inheriting currentColor like the others.
// The gradient is defined inside the component, so every instance carries its
// own <defs>. Two instances sharing one id is invalid HTML that still renders —
// browsers resolve url(#id) to the first match in document order — and then
// silently ignores any later edit to whichever definition lost. The default
// keeps the Pulse footer icon byte-identical to before the prop existed.
function InstagramIcon({ className, gradientId = "pulse-ig-gradient" }: { className?: string; gradientId?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill={`url(#${gradientId})`} aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="24" x2="24" y2="0">
          <stop offset="0" stopColor="#FFDD55" />
          <stop offset="0.35" stopColor="#FF543E" />
          <stop offset="0.7" stopColor="#C837AB" />
          <stop offset="1" stopColor="#3771C8" />
        </linearGradient>
      </defs>
      <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm7.846-10.405a1.441 1.441 0 01-2.88 0 1.44 1.44 0 012.88 0z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

const pkr = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

/** Digits only, PK country code — wa.me rejects spaces, dashes and leading zeros. */
function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0/, "92");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Up to two city names, then "+N" — an owner with branches in four cities
 *  must not blow out the header line. */
function cityLabel(branches: PublicHostel[]): string | null {
  const cities = [...new Set(branches.map((b) => b.city?.trim()).filter(Boolean) as string[])];
  if (cities.length === 0) return null;
  if (cities.length === 1) return cities[0];
  if (cities.length === 2) return `${cities[0]} & ${cities[1]}`;
  return `${cities[0]}, ${cities[1]} +${cities.length - 2}`;
}

const AMENITY_ICONS: Record<string, typeof Wifi> = {
  "WiFi": Wifi,
  "Meals Included": UtensilsCrossed,
  "Security Guard": ShieldCheck,
  "CCTV": Camera,
  "Hot Water": Droplets,
  "Parking": Car,
  "AC": Snowflake,
  "Generator / UPS": Zap,
  "Laundry": Shirt,
  "Study Room": BookOpen,
  "Attached Bath": Droplets,
  "Cupboard": Home,
};

// ── sections ──────────────────────────────────────────────────────────────────

function BranchPhoto({ branch }: { branch: PublicHostel }) {
  if (branch.cover_image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={branch.cover_image_url} alt={branch.name} className="w-full h-full object-cover" />
    );
  }
  // Branded placeholder, not a grey box — a missing photo should read as
  // designed rather than broken.
  const initials = branch.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/[0.06] to-transparent">
      <Building2 className="w-7 h-7 text-muted-foreground" />
      <span className="text-sm font-semibold tracking-widest text-muted-foreground">{initials}</span>
    </div>
  );
}

function BranchCard({
  branch, info, hrefBase,
}: { branch: PublicHostel; info?: BranchPublicInfo; hrefBase: string }) {
  const href = branch.slug ? `${hrefBase}/${branch.slug}` : null;
  const place = [branch.area, branch.city].filter(Boolean).join(", ") || branch.city || null;
  // Same guard find-client.tsx and hostel-detail-client.tsx already apply:
  // maps_url is owner-editable with no server-side validation, so anything
  // that isn't plainly http(s) must not become an href.
  const safeMapsUrl = branch.maps_url && /^https?:\/\//i.test(branch.maps_url) ? branch.maps_url : null;

  // Directions is a sibling of the card link, never a child: an <a> inside an
  // <a> is invalid HTML and breaks hydration. So the Link wraps everything
  // except that row, and the outer element stays a plain div.
  const body = (
    <>
      <div className="relative h-40 overflow-hidden bg-surface-sunken">
        <BranchPhoto branch={branch} />
        {branch.available_beds > 0 ? (
          <span className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-card/95 border border-pub-success/30 backdrop-blur-sm text-[11px] font-semibold text-pub-success">
            {branch.available_beds} bed{branch.available_beds !== 1 ? "s" : ""} free
          </span>
        ) : (
          // Tokens, not fixed white: the pill sits on the card surface, which
          // is near-black on the dark theme. A white chip there was the
          // brightest thing on a sold-out card.
          <span className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-card/95 border border-card-border backdrop-blur-sm text-[11px] font-semibold text-muted-foreground">
            Fully booked
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">
            {branch.name}
          </h3>
          {place && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <MapPin className="w-3 h-3 shrink-0" /> {place}
            </p>
          )}
        </div>

        {/* Same slot whether or not a price exists — an empty gap beside priced
            siblings reads as a broken feature, not an unset field. */}
        <div className="flex items-end justify-between gap-2 pt-1 border-t border-border">
          {info?.from_price ? (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">From</p>
              <p className="text-lg font-bold text-foreground leading-tight">
                {pkr(info.from_price)}
                <span className="text-xs font-normal text-muted-foreground">/month</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Contact for pricing</p>
          )}
          {href && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary shrink-0 pb-1">
              View <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className={cn(
      // border-card-border, not border-border: the default edge is a 1.70:1
      // hairline and the card surface is only 1.05:1 off the page, so the card
      // had no perceptible outline at all. --card-border is defined in BOTH
      // public scopes (public-theme.css) — the dark page has the same problem
      // for the same reason, and the box-shadows below do nothing on a dark
      // surface, so the border is the only thing holding the grid together.
      "group h-full flex flex-col rounded-2xl border border-card-border overflow-hidden transition-all",
      branch.available_beds > 0
        ? "bg-card shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.10)] hover:border-primary/50 hover:shadow-[0_4px_12px_rgba(16,24,40,0.10)]"
        // bg-surface-sunken, not bg-accent: --accent is darker than --card on the
        // light palette but LIGHTER than it on the dark one, so a sold-out branch
        // would have become the brightest card on a dark page. Same value as
        // --accent on light, so nothing moves there.
        : "bg-surface-sunken"
    )}>
      {href ? <Link href={href} className="block">{body}</Link> : body}
      {safeMapsUrl && (
        <a
          href={safeMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1.5 px-4 py-3 border-t border-border text-xs text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
        >
          <Navigation className="w-3 h-3" /> Directions
        </a>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

interface Props {
  ownerName: string | null;
  /** Client logo. Falls back to a generic mark when absent. */
  logoUrl?: string | null;
  /** Owner-configured handles, not Pulse's. Validated at render by socialUrl(). */
  instagramHandle?: string | null;
  facebookHandle?: string | null;
  branches: PublicHostel[];
  branchInfo: BranchPublicInfo[];
  /** Built server-side so the visible answers and the FAQPage JSON-LD are one source. */
  faqs: Faq[];
  /** "" on a branded subdomain (links stay domain-relative), "/find/{slug}" on the path route. */
  hrefBase: string;
}

export function BusinessPage({
  ownerName, logoUrl, instagramHandle, facebookHandle, branches, branchInfo, faqs, hrefBase,
}: Props) {
  const heading = ownerName ?? branches[0]?.name ?? "Our Branches";
  const infoById = new Map(branchInfo.map((i) => [i.hostel_id, i]));
  const totalBeds = branches.reduce((s, b) => s + b.available_beds, 0);
  const city = cityLabel(branches);
  const amenities = sharedAmenities(branches);

  // Cheapest across the whole business — the number a visitor is scanning for.
  const prices = branchInfo.map((i) => i.from_price).filter((p): p is number => !!p);
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;

  // Contact: prefer a branch with WhatsApp, else any with a phone. Both absent
  // (one real branch today) and the block is dropped rather than left dead.
  // Only handles that are actually configured — an icon linking to a 404 costs
  // more trust than no icon at all.
  const socials = (
    [
      // Each in its own brand colour. Instagram supplies its own gradient fill,
      // so it gets no colour class — a text colour there would be ignored.
      { key: "website", href: PULSE_SITE_URL, Icon: Globe, label: "Pulse website", color: "text-primary", ring: "hover:border-primary/40" },
      { key: "facebook", href: PULSE_SOCIALS.facebook, Icon: FacebookIcon, label: "Pulse on Facebook", color: "text-[#1877F2]", ring: "hover:border-[#1877F2]/50" },
      { key: "instagram", href: PULSE_SOCIALS.instagram, Icon: InstagramIcon, label: "Pulse on Instagram", color: "", ring: "hover:border-[#C837AB]/50" },
      { key: "linkedin", href: PULSE_SOCIALS.linkedin, Icon: LinkedInIcon, label: "Pulse on LinkedIn", color: "text-[#0A66C2]", ring: "hover:border-[#0A66C2]/50" },
    ] as const
  ).filter((s) => !!s.href);

  // The CLIENT's own handles, deliberately separate from `socials` above, which
  // is PULSE's footer row. socialUrl re-validates the stored handle and returns
  // null for anything that is not a plain handle, so a bad row drops the icon
  // rather than emitting an href — the same shape as safeMapsUrl above. The
  // filter is what keeps that guarantee: href on these anchors is only ever the
  // non-null return of socialUrl(). Do not unroll this into literal anchors.
  const clientSocials = (
    [
      { key: "instagram", href: socialUrl("instagram", instagramHandle), label: `${ownerName ?? heading} on Instagram`, ring: "hover:border-[#C837AB]/50", color: "" },
      { key: "facebook", href: socialUrl("facebook", facebookHandle), label: `${ownerName ?? heading} on Facebook`, ring: "hover:border-[#1877F2]/50", color: "text-[#1877F2]" },
    ] as const
  ).filter((s): s is typeof s & { href: string } => !!s.href);

  const waBranch = branches.find((b) => b.whatsapp) ?? null;
  const phoneBranch = branches.find((b) => b.phone) ?? null;
  const hasContact = !!waBranch || !!phoneBranch;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface-header">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* A brand lockup: logo left, name and meta stacked beside it.
              Sized so the logo spans BOTH text lines — stacked above the title
              it left a band of empty space, and at 44px beside a three-line
              block it floated aligned to nothing. Two lines and a matching
              logo height means the block reads as one unit. */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {logoUrl ? (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border border-border bg-card shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- client-supplied URL, not in next.config images */}
                  <img src={logoUrl} alt={ownerName ?? "Logo"} className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-primary/[0.08] border border-primary/20 flex items-center justify-center shrink-0">
                  <Home className="w-6 h-6 text-primary" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="font-serif text-2xl sm:text-3xl font-medium text-foreground leading-[1.15] tracking-tight truncate">
                  {heading}
                </h1>
                {/* One meta line, not three. The price used to sit on its own
                    row, which made the block too tall for any logo to align to. */}
                <p className="text-sm text-muted-foreground mt-1">
                  {branches.length} {branches.length === 1 ? "branch" : "branches"}
                  {city && ` · ${city}`}
                  {totalBeds > 0 && ` · ${totalBeds} bed${totalBeds !== 1 ? "s" : ""} available`}
                  {fromPrice && (
                    <>
                      {" · from "}
                      <span className="font-semibold text-foreground">{pkr(fromPrice)}</span>
                      <span className="text-muted-foreground">/month</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Quick connect. Falls back to Call for the rare branch with no
                WhatsApp on file, so the slot is never empty and never dead. */}
            {waBranch?.whatsapp ? (
              <a
                href={waLink(waBranch.whatsapp, "Assalam o Alaikum, I saw your hostel page and had a question about rooms.")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#006c49] border border-[#006c49] text-white text-sm font-semibold hover:bg-[#005238] transition-colors shrink-0"
              >
                <WhatsAppIcon className="w-4 h-4 shrink-0" />
                WhatsApp
              </a>
            ) : phoneBranch?.phone ? (
              <a
                href={`tel:${phoneBranch.phone}`}
                className="inline-flex items-center justify-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-primary border border-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shrink-0"
              >
                <Phone className="w-4 h-4 shrink-0" />
                Call
              </a>
            ) : null}
          </div>

        </div>
      </header>

      {/* Why book direct */}
      <div className="border-b border-border bg-surface-trust">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
          {[
            { t: "Direct contact with the owner", Icon: ShieldCheck },
            { t: "No agent fees", Icon: ShieldCheck },
            { t: "Availability updated in real time", Icon: BedDouble },
          ].map(({ t, Icon }) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Icon className="w-3.5 h-3.5 text-primary shrink-0" /> {t}
            </span>
          ))}
        </div>
      </div>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-10 sm:space-y-14">
          {/* Branches */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-4">
              {branches.length === 1 ? "Our hostel" : "Choose a branch"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {branches.map((b) => (
                <BranchCard key={b.id} branch={b} info={infoById.get(b.id)} hrefBase={hrefBase} />
              ))}
            </div>
          </section>

          {/* What's included */}
          {amenities.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-foreground mb-1">What's included</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Available at {branches.length === 1 ? "our hostel" : "every branch"}
              </p>
              {/* Pills that wrap to their content, not grid cells that stretch.
                  In a 4-column grid the word "WiFi" sat in a ~390px box and read
                  as a button you were meant to press. */}
              <div className="flex flex-wrap gap-2">
                {amenities.map((a) => {
                  const Icon = AMENITY_ICONS[a] ?? ShieldCheck;
                  return (
                    <span
                      key={a}
                      className="inline-flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-full border border-border bg-card text-xs text-foreground"
                    >
                      <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                      {a}
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          {/* Compare branches — a grid, not a <table>: on a phone these stack
              as readable rows instead of forcing a horizontal scroll. */}
          {branches.length > 1 && prices.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-foreground mb-4">Compare branches</h2>
              <div className="rounded-2xl border border-border overflow-hidden">
                <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr] gap-4 px-4 py-2.5 bg-muted text-[11px] font-medium text-muted-foreground">
                  <span>Branch</span><span className="text-right">From</span><span className="text-right">Available</span>
                </div>
                {branches.map((b) => {
                  const i = infoById.get(b.id);
                  return (
                    <div
                      key={b.id}
                      className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr] gap-x-4 gap-y-1 px-4 py-3 border-t border-border first:border-t-0 sm:first:border-t"
                    >
                      <div className="col-span-2 sm:col-span-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{b.name}</p>
                        {(b.area || b.city) && (
                          <p className="text-[11px] text-muted-foreground truncate">{[b.area, b.city].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                      <div className="sm:text-right">
                        <span className="sm:hidden text-[11px] text-muted-foreground">From </span>
                        {i?.from_price ? (
                          <span className="text-sm font-semibold text-foreground">{pkr(i.from_price)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Contact</span>
                        )}
                      </div>
                      <div className="text-right">
                        {/* text-teal, not the literal #006c49: this sits on the
                            page surface rather than on a white pill, and #006c49
                            is 3.0:1 against the dark theme's background. --teal
                            is #006c49 on the light theme and a bright cyan on
                            the dark one. */}
                        <span className={cn("text-sm font-medium", b.available_beds > 0 ? "text-teal" : "text-muted-foreground")}>
                          {b.available_beds > 0
                            ? `${b.available_beds} bed${b.available_beds !== 1 ? "s" : ""}`
                            : "Full"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Contact the owner */}
          {hasContact && (
            <section>
              <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-full bg-primary border border-primary flex items-center justify-center shrink-0 text-primary-foreground font-semibold">
                      {(ownerName ?? heading).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{ownerName ?? heading}</p>
                      <p className="text-xs text-muted-foreground">
                        Have a question? Message directly — no agents in between.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    {waBranch?.whatsapp && (
                      <a
                        href={waLink(waBranch.whatsapp, `Assalam o Alaikum, I saw your hostel page and had a question about rooms.`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#006c49] border border-[#006c49] text-white text-sm font-semibold hover:bg-[#005238] transition-colors"
                      >
                        <WhatsAppIcon className="w-4 h-4 shrink-0" />
                        WhatsApp
                      </a>
                    )}
                    {phoneBranch?.phone && (
                      <a
                        href={`tel:${phoneBranch.phone}`}
                        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors"
                      >
                        <Phone className="w-4 h-4 shrink-0" /> {formatPhoneDisplay(phoneBranch.phone)}
                      </a>
                    )}
                  </div>
                </div>

                {/* Subordinate to the WhatsApp/Call row on every axis — below it
                    rather than beside it, inside the card's own rule, w-8 against
                    the pill's h-11, an xs label. These name the BUSINESS, never
                    Pulse, so they can't be confused with the footer row. */}
                {clientSocials.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
                    <p className="text-xs text-muted-foreground">Follow {ownerName ?? heading}</p>
                    <div className="flex items-center gap-2">
                      {clientSocials.map(({ key, href, label, ring, color }) => (
                        <a
                          key={key}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={label}
                          title={label}
                          className={cn(
                            "w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center transition-all hover:bg-muted",
                            color,
                            ring
                          )}
                        >
                          {key === "instagram" ? (
                            <InstagramIcon className="w-3.5 h-3.5" gradientId="client-ig-gradient" />
                          ) : (
                            <FacebookIcon className="w-3.5 h-3.5" />
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* FAQ */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-4">Common questions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {faqs.map((f) => (
                <div key={f.q} className="rounded-xl border border-border bg-card p-4">
                  <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                    <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" /> {f.q}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed pl-5.5">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer is Pulse's, not the client's — their name, branches and contact
          all appear above. This is the one surface every branded hostel page
          gives us, so it stays a clean marketing block rather than a second
          copy of the hostel's details. */}
      <footer className="border-t border-border bg-surface-header mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <a
              href={PULSE_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 shrink-0"
            >
              <span className="w-9 h-9 rounded-lg overflow-hidden border border-border shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.jpg" alt="Pulse" width={36} height={36} className="w-full h-full object-cover" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-foreground leading-none group-hover:text-primary transition-colors">
                  Pulse
                </span>
                <span className="block text-[10px] font-semibold tracking-[0.15em] uppercase text-primary mt-1">
                  Pulse of Your Business
                </span>
              </span>
            </a>

            <div className="flex flex-col sm:items-end gap-2.5">
              <p className="text-xs text-muted-foreground">{PULSE_TAGLINE}</p>
              {socials.length > 0 && (
                <div className="flex items-center gap-2">
                  {socials.map(({ key, href, Icon, label, color, ring }) => (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      title={label}
                      className={cn(
                        "w-9 h-9 rounded-lg border border-border bg-card flex items-center justify-center transition-all hover:bg-muted hover:scale-105",
                        color,
                        ring
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
