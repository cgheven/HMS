"use client";

import Link from "next/link";
import {
  Home, Building2, MapPin, Wifi, UtensilsCrossed, ShieldCheck, Camera,
  Droplets, Car, Snowflake, Zap, Shirt, BookOpen, Phone,
  BedDouble, ArrowRight, Navigation, HelpCircle,
} from "lucide-react";
import type { PublicHostel } from "@/types";
import type { BranchPublicInfo } from "@/app/actions/public";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/phone";

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

/** Only amenities EVERY branch has — claiming a facility the visitor's chosen
 *  branch lacks is the fastest way to lose the trust this page is selling. */
function sharedAmenities(branches: PublicHostel[]): string[] {
  if (branches.length === 0) return [];
  const [first, ...rest] = branches;
  return (first.amenities ?? []).filter((a) =>
    rest.every((b) => (b.amenities ?? []).includes(a))
  );
}

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
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber/[0.07] to-transparent">
      <Building2 className="w-7 h-7 text-amber/40" />
      <span className="text-sm font-semibold tracking-widest text-amber/40">{initials}</span>
    </div>
  );
}

function BranchCard({
  branch, info, hrefBase,
}: { branch: PublicHostel; info?: BranchPublicInfo; hrefBase: string }) {
  const href = branch.slug ? `${hrefBase}/${branch.slug}` : null;
  const place = [branch.area, branch.city].filter(Boolean).join(", ") || branch.city || null;

  // Directions is a sibling of the card link, never a child: an <a> inside an
  // <a> is invalid HTML and breaks hydration. So the Link wraps everything
  // except that row, and the outer element stays a plain div.
  const body = (
    <>
      <div className="relative h-40 overflow-hidden bg-[#101012]">
        <BranchPhoto branch={branch} />
        {branch.available_beds > 0 ? (
          <span className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/25 backdrop-blur-sm text-[11px] font-semibold text-emerald-300">
            {branch.available_beds} bed{branch.available_beds !== 1 ? "s" : ""} free
          </span>
        ) : (
          <span className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-white/10 border border-white/15 backdrop-blur-sm text-[11px] font-semibold text-white/70">
            Fully booked
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground leading-tight group-hover:text-amber transition-colors">
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
        <div className="flex items-end justify-between gap-2 pt-1 border-t border-white/[0.06]">
          {info?.from_price ? (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">From</p>
              <p className="text-lg font-bold text-foreground leading-tight">
                {pkr(info.from_price)}
                <span className="text-xs font-normal text-muted-foreground">/month</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Contact for pricing</p>
          )}
          {href && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber shrink-0 pb-1">
              View <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="group h-full flex flex-col rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden transition-colors hover:border-amber/25">
      {href ? <Link href={href} className="block">{body}</Link> : body}
      {branch.maps_url && (
        <a
          href={branch.maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1.5 px-4 py-3 border-t border-white/[0.06] text-xs text-muted-foreground hover:text-amber hover:bg-white/[0.02] transition-colors"
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
  branches: PublicHostel[];
  branchInfo: BranchPublicInfo[];
  /** "" on a branded subdomain (links stay domain-relative), "/find/{slug}" on the path route. */
  hrefBase: string;
}

export function BusinessPage({ ownerName, branches, branchInfo, hrefBase }: Props) {
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
  const waBranch = branches.find((b) => b.whatsapp) ?? null;
  const phoneBranch = branches.find((b) => b.phone) ?? null;
  const hasContact = !!waBranch || !!phoneBranch;

  const deposits = branchInfo.map((i) => i.security_deposit).filter((d): d is number => !!d);
  const notices = branchInfo.map((i) => i.notice_period_days).filter((n): n is number => !!n);

  const faqs: { q: string; a: string }[] = [];
  if (deposits.length > 0) {
    const lo = Math.min(...deposits), hi = Math.max(...deposits);
    faqs.push({
      q: "Is there a security deposit?",
      a: `Yes — ${lo === hi ? pkr(lo) : `${pkr(lo)} to ${pkr(hi)} depending on the branch and room`}. It's refundable when you move out, less any damages.`,
    });
  }
  if (notices.length > 0) {
    const lo = Math.min(...notices), hi = Math.max(...notices);
    faqs.push({
      q: "How much notice do I give before leaving?",
      a: lo === hi ? `${lo} days' notice.` : `Between ${lo} and ${hi} days depending on the branch.`,
    });
  }
  if (amenities.includes("Meals Included")) {
    faqs.push({ q: "Are meals included?", a: "Yes, meals are included at every branch. Ask about the current menu and timings when you get in touch." });
  }
  faqs.push({
    q: "How do I book a room?",
    a: "Open any branch above, pick a room and apply — or message the owner directly on WhatsApp. There are no agent fees and no booking charges.",
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0B]">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#0D0D0F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-amber/15 border border-amber/25 flex items-center justify-center shrink-0">
                <Home className="w-5 h-5 text-amber" />
              </div>
              <div className="min-w-0">
                <h1 className="font-serif text-xl sm:text-3xl font-medium text-foreground leading-tight truncate">
                  {heading}
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground/80 mt-1">
                  {branches.length} {branches.length === 1 ? "branch" : "branches"}
                  {city && ` · ${city}`}
                  {totalBeds > 0 && ` · ${totalBeds} bed${totalBeds !== 1 ? "s" : ""} available`}
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
                className="inline-flex items-center justify-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#25D366]/15 border border-[#25D366]/35 text-[#25D366] text-sm font-semibold hover:bg-[#25D366]/25 transition-colors shrink-0"
              >
                <WhatsAppIcon className="w-4 h-4 shrink-0" />
                WhatsApp
              </a>
            ) : phoneBranch?.phone ? (
              <a
                href={`tel:${phoneBranch.phone}`}
                className="inline-flex items-center justify-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-amber/15 border border-amber/30 text-amber text-sm font-semibold hover:bg-amber/20 transition-colors shrink-0"
              >
                <Phone className="w-4 h-4 shrink-0" />
                Call
              </a>
            ) : null}
          </div>

          {fromPrice && (
            <p className="text-sm text-muted-foreground mt-4">
              Rooms from <span className="text-lg font-bold text-foreground">{pkr(fromPrice)}</span>
              <span className="text-xs">/month</span>
            </p>
          )}
        </div>
      </header>

      {/* Why book direct */}
      <div className="border-b border-white/[0.06] bg-amber/[0.03]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
          {["Direct contact with the owner", "No agent fees", "No booking charges"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-amber shrink-0" /> {t}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {amenities.map((a) => {
                  const Icon = AMENITY_ICONS[a] ?? ShieldCheck;
                  return (
                    <div key={a} className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                      <Icon className="w-4 h-4 text-amber shrink-0" />
                      <span className="text-xs text-foreground truncate">{a}</span>
                    </div>
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
              <div className="rounded-2xl border border-white/[0.07] overflow-hidden">
                <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr] gap-4 px-4 py-2.5 bg-white/[0.03] text-[11px] font-medium text-muted-foreground">
                  <span>Branch</span><span className="text-right">From</span><span className="text-right">Available</span>
                </div>
                {branches.map((b) => {
                  const i = infoById.get(b.id);
                  return (
                    <div
                      key={b.id}
                      className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr] gap-x-4 gap-y-1 px-4 py-3 border-t border-white/[0.06] first:border-t-0 sm:first:border-t"
                    >
                      <div className="col-span-2 sm:col-span-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{b.name}</p>
                        {(b.area || b.city) && (
                          <p className="text-[11px] text-muted-foreground truncate">{[b.area, b.city].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                      <div className="sm:text-right">
                        <span className="sm:hidden text-[11px] text-muted-foreground/60">From </span>
                        {i?.from_price ? (
                          <span className="text-sm font-semibold text-foreground">{pkr(i.from_price)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Contact</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={cn("text-sm font-medium", b.available_beds > 0 ? "text-emerald-400" : "text-muted-foreground")}>
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
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-full bg-amber/15 border border-amber/25 flex items-center justify-center shrink-0 text-amber font-semibold">
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
                        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#25D366]/15 border border-[#25D366]/35 text-[#25D366] text-sm font-semibold hover:bg-[#25D366]/25 transition-colors"
                      >
                        <WhatsAppIcon className="w-4 h-4 shrink-0" />
                        WhatsApp
                      </a>
                    )}
                    {phoneBranch?.phone && (
                      <a
                        href={`tel:${phoneBranch.phone}`}
                        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl border border-white/[0.1] text-foreground text-sm font-medium hover:bg-white/[0.04] transition-colors"
                      >
                        <Phone className="w-4 h-4 shrink-0" /> {formatPhoneDisplay(phoneBranch.phone)}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* FAQ */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-4">Common questions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {faqs.map((f) => (
                <div key={f.q} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                    <HelpCircle className="w-3.5 h-3.5 text-amber shrink-0 mt-0.5" /> {f.q}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed pl-5.5">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/[0.06] bg-[#0D0D0F] mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{heading}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[city, `${branches.length} ${branches.length === 1 ? "branch" : "branches"}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {waBranch?.whatsapp && (
              <a
                href={waLink(waBranch.whatsapp, "Assalam o Alaikum, I had a question about your hostel.")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-[#25D366] transition-colors"
              >
                <WhatsAppIcon className="w-3.5 h-3.5 shrink-0" /> WhatsApp
              </a>
            )}
            {phoneBranch?.phone && (
              <a href={`tel:${phoneBranch.phone}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-amber transition-colors">
                <Phone className="w-3.5 h-3.5 shrink-0" /> {formatPhoneDisplay(phoneBranch.phone)}
              </a>
            )}
          </div>
        </div>
        <div className="border-t border-white/[0.04]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground/50 inline-flex items-center gap-1.5">
              <BedDouble className="w-3 h-3" /> Availability updated in real time
            </span>
            <a
              href="https://hostel.yourpulse.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground/40 hover:text-amber/70 transition-colors"
            >
              Powered by Pulse
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
