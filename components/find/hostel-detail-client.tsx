"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft, MapPin, ExternalLink, BedDouble, Zap, Wifi,
  Utensils, Shield, ChevronLeft, ChevronRight, Clock, Loader2, X,
  Wind, Thermometer, Users, Banknote, Check,
} from "lucide-react";
import { joinWaitlist } from "@/app/actions/public";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { calcFoodAddonCharge, hasFoodAddonRates, hasIndividualFoodRates, FOOD_INCLUSIVE_TIERS } from "@/lib/food-addon";
import { getSeaterPrice, getSeaterDeposit, SEATER_CAPACITIES, SEATER_LABELS } from "@/lib/seater-pricing";
import { buildPackageOptions } from "@/lib/room-pricing";
import type { PublicHostelDetail, PublicRoom, FoodItem, MealType, SpaceType, PackageConfig, PackageTier, FoodMenuType } from "@/types";

// ── WhatsApp icon ─────────────────────────────────────────────────────────────

function WhatsAppIcon({ cls = "w-4 h-4" }: { cls?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-current ${cls}`}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  boys: "Boys", girls: "Girls", mixed: "Mixed", family: "Family",
};

const SPACE_LABELS: Record<SpaceType, string> = {
  student: "Student", professional: "Professional", general: "General",
};

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner",
};

// ISO 8601 numbering (1=Monday...7=Sunday) — matches the day_of_week column.
const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
};
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7];

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "WiFi":            <Wifi className="w-3 h-3" />,
  "Generator / UPS": <Zap className="w-3 h-3" />,
  "Meals Included":  <Utensils className="w-3 h-3" />,
  "Security Guard":  <Shield className="w-3 h-3" />,
};

function buildWhatsAppUrl(phone: string | null, message: string) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, "");
  const intl = clean.startsWith("0") ? "92" + clean.slice(1) : clean;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-PK", { weekday: "long", month: "long", day: "numeric" });
}

function isSunday(iso: string) {
  return new Date(iso + "T00:00:00").getDay() === 0;
}

// ── Room detail modal ─────────────────────────────────────────────────────────

interface RoomDetailModalProps {
  room: PublicRoom;
  hostel: PublicHostelDetail;
  onClose: () => void;
}

function RoomDetailModal({ room, hostel, onClose }: RoomDetailModalProps) {
  const photos = [room.photo_path, room.photo_path_2, room.photo_path_3, room.photo_path_4, room.photo_path_5].filter(Boolean) as string[];
  const [photoIdx, setPhotoIdx]   = useState(0);
  const [selectedTier, setSelectedTier] = useState("space_only");
  const [meals, setMeals] = useState({ food_breakfast: false, food_lunch: false, food_dinner: false });

  const available = room.capacity - room.occupied;
  const isFull    = room.status === "occupied" || available <= 0;

  const packages = buildPackageOptions(room, hostel.package_config);
  const selected = packages.find((p) => p.tier === selectedTier) ?? packages[0];

  // Seater deposit (by room capacity + AC) takes priority when configured,
  // same precedence as the rent calculation above.
  const SECURITY_DEPOSIT = getSeaterDeposit(room.capacity, room.has_ac, hostel.package_config?.seater_prices) ?? hostel.package_config?.security_deposit ?? 0;

  const foodRates = hostel.package_config;
  // Only offer the add-on for packages that don't already bundle food — avoids
  // double-charging once via the tier's flat rate and again via the add-on.
  const foodAddonOffered = !!foodRates && hasFoodAddonRates(foodRates) && !FOOD_INCLUSIVE_TIERS.has(selectedTier);
  const mealsCharge = foodRates ? calcFoodAddonCharge(meals, foodRates) : 0;

  const contactPhone = hostel.whatsapp || hostel.phone;

  const mealsLabel = [meals.food_breakfast && "Breakfast", meals.food_lunch && "Lunch", meals.food_dinner && "Dinner"].filter(Boolean).join(" + ");

  const waMsg = buildWhatsAppUrl(
    contactPhone,
    `Hi! I'm interested in Room ${room.room_number} at ${hostel.name}.\nPackage: ${selected.label}${mealsLabel ? `\nMeals: ${mealsLabel} (+${formatCurrency(mealsCharge)})` : ""}\nMonthly: ${formatCurrency(selected.price + mealsCharge)}\nDeposit: ${formatCurrency(SECURITY_DEPOSIT)}\n\nPlease let me know next steps.`
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && photos.length > 1) setPhotoIdx((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft"  && photos.length > 1) setPhotoIdx((i) => (i - 1 + photos.length) % photos.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label={`Room ${room.room_number} details`} className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
        <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />

        {/* Modal container */}
        <div className="relative w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-4xl rounded-none sm:rounded-2xl border-0 sm:border sm:border-white/[0.08] bg-[#0E0E10] shadow-2xl overflow-hidden flex flex-col sm:flex-row">

          {/* Close button — min 44px touch target (H6) */}
          <button
            onClick={onClose}
            aria-label="Close room details"
            className="absolute top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* LEFT PANEL — photo + thumbnails */}
          <div className="w-full sm:w-[55%] shrink-0 flex flex-col bg-[#090909]">

            {/* Photo area */}
            <div className="relative h-56 sm:h-72 overflow-hidden">
              {photos.length > 0 ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photos[photoIdx]}
                    alt={`Room ${room.room_number}`}
                    className="w-full h-full object-cover transition-opacity duration-200"
                  />

                  {/* Prev / next arrows */}
                  {photos.length > 1 && (
                    <>
                      <button
                        onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                        aria-label="Previous photo"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                        aria-label="Next photo"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>

                      {/* Dot indicators — padded for 44px touch targets (H6) */}
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                        {photos.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setPhotoIdx(i)}
                            aria-label={`View photo ${i + 1}`}
                            className="p-2 flex items-center justify-center"
                          >
                            <span className={`block h-1.5 rounded-full transition-all bg-white ${i === photoIdx ? "w-5 opacity-100" : "w-1.5 opacity-40"}`} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Full overlay */}
                  {isFull && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-sm font-semibold text-rose-300 bg-rose-500/20 border border-rose-400/30 px-3 py-1.5 rounded-full">Full</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-white/[0.04] to-transparent flex items-center justify-center">
                  <BedDouble className="w-12 h-12 text-muted-foreground/15" />
                  {isFull && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-sm font-semibold text-rose-300 bg-rose-500/20 border border-rose-400/30 px-3 py-1.5 rounded-full">Full</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Thumbnail strip */}
            {photos.length > 1 && (
              <div className="flex gap-2 p-3 border-t border-white/[0.05]">
                {photos.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => setPhotoIdx(i)}
                    aria-label={`View photo ${i + 1}`}
                    className={`w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${i === photoIdx ? "border-amber/60" : "border-white/[0.08] opacity-60 hover:opacity-100"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Room ${room.room_number} photo ${i + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT PANEL — details + package selector */}
          <div className="flex-1 flex flex-col overflow-y-auto sm:max-h-[90vh]">
            <div className="flex-1 px-5 py-5 space-y-5 pb-[80px] sm:pb-5">

              {/* Room heading */}
              <div>
                <h2 className="text-xl font-semibold">Room {room.room_number}</h2>
                {room.floor != null && (
                  <p className="text-sm text-muted-foreground mt-0.5">Floor {room.floor}</p>
                )}

                {/* Badges row */}
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.06] border border-white/[0.1] text-muted-foreground">
                    {SPACE_LABELS[room.type]}
                  </span>

                  {room.has_ac ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-blue-500/10 border border-blue-400/20 text-blue-400">
                      <Wind className="w-3 h-3" />
                      AC Available{hostel.package_config ? ` · ${formatCurrency(hostel.package_config.ac_per_unit_rate)}/unit` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.04] border border-white/[0.07] text-muted-foreground/50">
                      No AC
                    </span>
                  )}

                  {room.has_cooler && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-cyan-500/10 border border-cyan-400/20 text-cyan-400">
                      <Thermometer className="w-3 h-3" /> Cooler
                    </span>
                  )}
                </div>
              </div>

              {/* Seats available */}
              <div className="flex items-center gap-3">
                <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl border ${isFull ? "bg-rose-500/5 border-rose-400/20" : "bg-emerald-500/8 border-emerald-400/20"}`}>
                  <span className={`text-2xl font-bold leading-none ${isFull ? "text-rose-400" : "text-emerald-400"}`}>
                    {isFull ? "0" : available}
                  </span>
                  <span className={`text-[9px] font-medium mt-0.5 ${isFull ? "text-rose-400/60" : "text-emerald-400/60"}`}>
                    {available === 1 ? "seat" : "seats"}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium">{isFull ? "Room Full" : `${available} seat${available !== 1 ? "s" : ""} available`}</p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">{room.occupied}/{room.capacity} occupied</p>
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Package selector */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">Select Package</p>
                <div className="space-y-2">
                  {packages.map((pkg) => (
                    <button
                      key={pkg.tier}
                      disabled={pkg.disabled}
                      onClick={() => {
                        if (pkg.disabled) return;
                        setSelectedTier(pkg.tier);
                        // Clear any add-on meal selection when switching to a package that
                        // already bundles food — prevents a stale double-charge on submit.
                        if (FOOD_INCLUSIVE_TIERS.has(pkg.tier)) {
                          setMeals({ food_breakfast: false, food_lunch: false, food_dinner: false });
                        }
                      }}
                      className={`w-full text-left rounded-xl border px-4 py-3.5 transition-all duration-200 ${
                        pkg.disabled
                          ? "opacity-40 cursor-not-allowed border-white/[0.05] bg-white/[0.01]"
                          : selectedTier === pkg.tier
                          ? "border-amber/40 bg-amber/[0.06]"
                          : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Radio dot */}
                          <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selectedTier === pkg.tier && !pkg.disabled
                              ? "border-amber bg-amber/20"
                              : "border-white/20"
                          }`}>
                            {selectedTier === pkg.tier && !pkg.disabled && (
                              <div className="w-1.5 h-1.5 rounded-full bg-amber" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight">{pkg.label}</p>
                            <p className="text-xs text-muted-foreground/60 mt-0.5">{pkg.subtitle}</p>
                            {pkg.extra && (
                              <p className="text-[11px] text-muted-foreground/40 mt-0.5">{pkg.extra}</p>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold text-amber">{formatCurrency(pkg.price)}</p>
                          <p className="text-[10px] text-muted-foreground/40 mt-0.5">/mo</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* AC rate callout */}
                {room.has_ac && hostel.package_config && (
                  <div className="mt-3 rounded-lg border border-blue-400/15 bg-blue-500/[0.06] px-3 py-2 text-[11px] text-blue-400/80">
                    AC units charged separately at {formatCurrency(hostel.package_config.ac_per_unit_rate)}/unit consumed
                  </div>
                )}
              </div>

              {/* Add Meals — optional, independent of package. Only shown if hostel configured rates. */}
              {foodAddonOffered && foodRates && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">
                    Add Meals <span className="normal-case font-normal text-muted-foreground/40">(optional)</span>
                  </p>
                  {hasIndividualFoodRates(foodRates) ? (
                    <>
                      <div className="rounded-xl border border-white/[0.07] overflow-hidden divide-y divide-white/[0.05]">
                        {([
                          { key: "food_breakfast" as const, label: "Breakfast", rate: Number(foodRates.food_breakfast_rate) },
                          { key: "food_lunch" as const, label: "Lunch", rate: Number(foodRates.food_lunch_rate) },
                          { key: "food_dinner" as const, label: "Dinner", rate: Number(foodRates.food_dinner_rate) },
                        ]).filter((m) => m.rate > 0).map((m) => {
                          const checked = meals[m.key];
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => setMeals({ ...meals, [m.key]: !checked })}
                              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm transition-colors ${checked ? "bg-amber/[0.06]" : "bg-white/[0.01] hover:bg-white/[0.03]"}`}
                            >
                              <span className="flex items-center gap-2.5">
                                <span className={`w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center ${checked ? "border-amber bg-amber" : "border-white/20"}`}>
                                  {checked && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                                </span>
                                <span className={checked ? "text-foreground" : "text-muted-foreground"}>{m.label}</span>
                              </span>
                              <span className={`text-xs font-medium ${checked ? "text-amber" : "text-muted-foreground/60"}`}>+{formatCurrency(m.rate)}</span>
                            </button>
                          );
                        })}
                      </div>
                      {meals.food_breakfast && meals.food_lunch && meals.food_dinner
                        && Number(foodRates.food_all_meals_rate) > 0
                        && Number(foodRates.food_all_meals_rate) < (Number(foodRates.food_breakfast_rate) + Number(foodRates.food_lunch_rate) + Number(foodRates.food_dinner_rate)) && (
                        <p className="text-[11px] text-emerald-400 mt-2">
                          All-3-meals bundle applied: {formatCurrency(Number(foodRates.food_all_meals_rate))}/mo
                        </p>
                      )}
                    </>
                  ) : (
                    // Bundle-only hostel — no individual meal rates, so offer a single
                    // combined toggle instead of 3 checkboxes with undefined partial pricing.
                    (() => {
                      const checked = meals.food_breakfast && meals.food_lunch && meals.food_dinner;
                      return (
                        <button
                          type="button"
                          onClick={() => setMeals({ food_breakfast: !checked, food_lunch: !checked, food_dinner: !checked })}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-xl border transition-colors ${checked ? "bg-amber/[0.06] border-amber/30" : "bg-white/[0.01] border-white/[0.07] hover:bg-white/[0.03]"}`}
                        >
                          <span className="flex items-center gap-2.5">
                            <span className={`w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center ${checked ? "border-amber bg-amber" : "border-white/20"}`}>
                              {checked && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                            </span>
                            <span className={checked ? "text-foreground" : "text-muted-foreground"}>All Meals (Breakfast + Lunch + Dinner)</span>
                          </span>
                          <span className={`text-xs font-medium ${checked ? "text-amber" : "text-muted-foreground/60"}`}>+{formatCurrency(Number(foodRates.food_all_meals_rate))}</span>
                        </button>
                      );
                    })()
                  )}
                </div>
              )}

              {/* Pricing summary */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">{selected.label}</span>
                  <span className="text-sm font-semibold text-amber">{formatCurrency(selected.price)}</span>
                </div>
                {mealsCharge > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.05]">
                    <span className="text-sm text-muted-foreground">{mealsLabel}</span>
                    <span className="text-sm font-semibold text-amber">{formatCurrency(mealsCharge)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.05]">
                  <span className="text-sm text-muted-foreground">Security Deposit</span>
                  <span className="text-sm font-semibold">{formatCurrency(SECURITY_DEPOSIT)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.07] bg-white/[0.02]">
                  <span className="text-sm font-semibold">Total Due Today</span>
                  <span className="text-sm font-bold text-amber">{formatCurrency(selected.price + mealsCharge + SECURITY_DEPOSIT)}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/40 -mt-3">Monthly rent due on the 1st of each month</p>

            </div>

            {/* CTA buttons — sticky on desktop, fixed on mobile */}
            <div className="fixed bottom-0 left-0 right-0 sm:static sm:bottom-auto sm:left-auto sm:right-auto z-10 border-t border-white/[0.08] bg-[#0E0E10]/95 sm:bg-transparent backdrop-blur-md sm:backdrop-blur-none px-5 py-3.5 flex gap-2.5">
              {waMsg ? (
                <a
                  href={waMsg}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/25 text-sm font-semibold transition-colors"
                >
                  <WhatsAppIcon cls="w-4 h-4" /> WhatsApp Now
                </a>
              ) : (
                <div className="flex-1" />
              )}
              {hostel.slug && (
                <Link
                  href={`/join/${hostel.slug}?room=${encodeURIComponent(room.room_number)}`}
                  className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border border-white/[0.12] hover:border-white/20 hover:bg-white/[0.04] text-sm font-medium text-foreground transition-colors"
                >
                  Apply / Register
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Food menu ─────────────────────────────────────────────────────────────────

const MEAL_HEADER_COLOR: Record<MealType, string> = {
  breakfast: "text-amber",
  lunch:     "text-emerald-400",
  dinner:    "text-blue-400",
};

function byMealType(dayItems: FoodItem[]) {
  return dayItems.reduce<Partial<Record<MealType, FoodItem[]>>>((acc, i) => {
    if (!acc[i.meal_type]) acc[i.meal_type] = [];
    acc[i.meal_type]!.push(i);
    return acc;
  }, {});
}

interface FoodMenuRow { key: string; label: string; closed: boolean; meals: Partial<Record<MealType, FoodItem[]>> }

// One table with meal types as column headers, one row per day — so
// "Breakfast"/"Lunch"/"Dinner" is written once, not once per day (a weekly
// menu showing all 7 days at once made the old per-day badge repetition
// obvious and cluttered).
function FoodMenuTable({ rows }: { rows: FoodMenuRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.07] bg-white/[0.02]">
            <th className="px-3.5 py-2.5 text-left sticky left-0 bg-[#111113] z-10 border-r border-white/[0.05] w-[120px]">
              <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Day</span>
            </th>
            {(["breakfast", "lunch", "dinner"] as MealType[]).map((mealType) => (
              <th key={mealType} className="px-3.5 py-2.5 text-left">
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${MEAL_HEADER_COLOR[mealType]}`}>
                  {MEAL_LABEL[mealType]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`border-b border-white/[0.05] last:border-0 ${row.closed ? "opacity-40" : ""}`}>
              <td className="px-3.5 py-2.5 align-top sticky left-0 bg-[#111113] z-10 border-r border-white/[0.05]">
                <span className="text-xs font-semibold">{row.label}</span>
                {row.closed && (
                  <span className="block mt-1 w-fit text-[10px] text-amber/70 bg-amber/10 border border-amber/20 px-1.5 py-0.5 rounded-full">Closed</span>
                )}
              </td>
              {(["breakfast", "lunch", "dinner"] as MealType[]).map((mealType) => {
                const mealItems = row.meals[mealType];
                return (
                  <td key={mealType} className="px-3.5 py-2.5 align-top">
                    {mealItems?.length
                      ? mealItems.map((item) => (
                          <p key={item.id} className="text-[11px] text-foreground/80 leading-snug">{item.item_name}</p>
                        ))
                      : <span className="text-[11px] text-muted-foreground/25">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FoodMenuSection({ items, closedOnSundays, menuType }: { items: FoodItem[]; closedOnSundays: boolean; menuType: FoodMenuType }) {
  if (menuType === "weekly") {
    const byDow = items.reduce<Record<number, FoodItem[]>>((acc, item) => {
      if (item.day_of_week == null) return acc;
      if (!acc[item.day_of_week]) acc[item.day_of_week] = [];
      acc[item.day_of_week].push(item);
      return acc;
    }, {});
    const activeDows = WEEKDAY_ORDER.filter((d) => byDow[d]?.length);
    if (activeDows.length === 0) return null;

    const rows: FoodMenuRow[] = activeDows.map((dow) => ({
      key: String(dow),
      label: WEEKDAY_LABELS[dow],
      closed: dow === 7 && closedOnSundays,
      meals: byMealType(byDow[dow]),
    }));

    return (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Utensils className="w-4 h-4 text-amber" />
          <h2 className="font-semibold text-base">Weekly Menu</h2>
          {closedOnSundays && <span className="text-[11px] text-amber/70 bg-amber/10 border border-amber/20 px-2 py-0.5 rounded-full">Closed Sundays</span>}
        </div>
        <FoodMenuTable rows={rows} />
      </section>
    );
  }

  const byDate = items.reduce<Record<string, FoodItem[]>>((acc, item) => {
    if (!item.date) return acc;
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});

  const dates = Object.keys(byDate).sort();
  if (dates.length === 0) return null;

  const rows: FoodMenuRow[] = dates.map((date) => ({
    key: date,
    label: formatDate(date),
    closed: isSunday(date) && closedOnSundays,
    meals: byMealType(byDate[date]),
  }));

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Utensils className="w-4 h-4 text-amber" />
        <h2 className="font-semibold text-base">Monthly Menu</h2>
        {closedOnSundays && <span className="text-[11px] text-amber/70 bg-amber/10 border border-amber/20 px-2 py-0.5 rounded-full">Closed Sundays</span>}
      </div>
      <FoodMenuTable rows={rows} />
    </section>
  );
}

// ── Waitlist modal ────────────────────────────────────────────────────────────

function WaitlistModal({ hostelId, hostelName, onClose }: { hostelId: string; hostelName: string; onClose: () => void }) {
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]       = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const { error } = await joinWaitlist(hostelId, name, phone);
    setSubmitting(false);
    if (error) { setErrorMsg(error); return; }
    setDone(true);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Join Waitlist" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <p className="font-semibold text-sm">Join Waitlist</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">{hostelName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
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
                <p className="text-sm text-muted-foreground mt-1">We&apos;ll contact you on <strong className="text-foreground">{phone}</strong> when a space opens up.</p>
              </div>
              <Button variant="outline" onClick={onClose} className="mt-2 w-full">Close</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">Leave your details — the owner contacts you directly on WhatsApp.</p>
              {errorMsg && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{errorMsg}</p>}
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

// ── Room card ─────────────────────────────────────────────────────────────────

function RoomCard({ room, hostel }: { room: PublicRoom; hostel: PublicHostelDetail }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);

  const photos = [room.photo_path, room.photo_path_2, room.photo_path_3, room.photo_path_4, room.photo_path_5].filter(Boolean) as string[];
  const available = room.capacity - room.occupied;
  const isFull = room.status === "occupied" || available <= 0;
  // Same precedence used inside the detail modal (seater price -> Space Only
  // package price -> room.monthly_rent), so the card teaser and modal never disagree.
  const cardPrice = buildPackageOptions(room, hostel.package_config)[0].price;

  return (
    <>
      {detailOpen && (
        <RoomDetailModal room={room} hostel={hostel} onClose={() => setDetailOpen(false)} />
      )}

      <div
        className={`flex flex-col rounded-2xl border bg-[#111113] overflow-hidden cursor-pointer ${isFull ? "border-white/[0.05] opacity-60" : "border-white/[0.09] hover:border-amber/20 transition-colors"}`}
        onClick={() => setDetailOpen(true)}
      >
        {/* Photo area */}
        {photos.length > 0 ? (
          <div className="relative h-40 overflow-hidden group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[activePhoto]} alt={`Room ${room.room_number}`} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium bg-black/50 px-2.5 py-1 rounded-full">
                View Details
              </span>
            </div>

            {photos.length > 1 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {photos.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePhoto(i)}
                    className={`h-1.5 rounded-full transition-all bg-white ${i === activePhoto ? "w-4 opacity-100" : "w-1.5 opacity-50"}`}
                  />
                ))}
              </div>
            )}

            {isFull && (
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                <span className="text-xs font-semibold text-rose-300 bg-rose-500/20 border border-rose-400/30 px-2.5 py-1 rounded-full">Full</span>
              </div>
            )}
          </div>
        ) : (
          <div className="relative h-40 bg-gradient-to-br from-white/[0.03] to-transparent border-b border-white/[0.05] flex items-center justify-center">
            <BedDouble className="w-7 h-7 text-muted-foreground/20" />
            {isFull && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-xs font-semibold text-rose-300 bg-rose-500/20 border border-rose-400/30 px-2.5 py-1 rounded-full">Full</span>
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="p-3.5 flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm leading-tight">Room {room.room_number}</p>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                {SPACE_LABELS[room.type]}{room.floor != null ? ` · Floor ${room.floor}` : ""}
              </p>
            </div>
            <div className={`shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-xl border ${isFull ? "bg-rose-500/5 border-rose-400/15" : "bg-emerald-500/8 border-emerald-400/20"}`}>
              <span className={`text-lg font-bold leading-none ${isFull ? "text-rose-400" : "text-emerald-400"}`}>
                {isFull ? "0" : available}
              </span>
              <span className={`text-[9px] font-medium mt-0.5 ${isFull ? "text-rose-400/60" : "text-emerald-400/60"}`}>
                {available === 1 ? "seat" : "seats"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-amber">{formatCurrency(cardPrice)}<span className="text-muted-foreground/50 font-normal">/mo</span></span>
            <span className="text-muted-foreground/50">{room.occupied}/{room.capacity} occupied</span>
          </div>

          {(room.has_ac || room.has_cooler) && (
            <div className="flex gap-1.5">
              {room.has_ac && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-400/20 text-[10px] font-medium">
                  <Wind className="w-2.5 h-2.5" /> AC
                </span>
              )}
              {room.has_cooler && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-400/20 text-[10px] font-medium">
                  <Thermometer className="w-2.5 h-2.5" /> Cooler
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Package pricing section ───────────────────────────────────────────────────

const PUBLIC_PRICING_TIERS: { tier: PackageTier; label: string; subtitle: string }[] = [
  { tier: "space_only",         label: "Space Only",                 subtitle: "Bed + room facilities"       },
  { tier: "space_food",         label: "Space + Breakfast & Dinner", subtitle: "Bed + 2 meals daily"         },
  { tier: "space_3meals",       label: "Space + 3 Meals",            subtitle: "Breakfast, lunch & dinner"   },
  { tier: "space_meals_cooler", label: "Space + Meals + Cooler",     subtitle: "Bed + meals + cooler"        },
];

function PackagePricingSection({
  config,
  hasAcRooms,
  hasNonAcRooms,
}: {
  config: PackageConfig;
  hasAcRooms: boolean;
  hasNonAcRooms: boolean;
}) {
  const prices = config.package_prices ?? {};
  const rows = PUBLIC_PRICING_TIERS.filter((t) => {
    const p = prices[t.tier];
    if (!p) return false;
    return (hasNonAcRooms && p.no_ac > 0) || (hasAcRooms && p.ac > 0);
  });
  if (!rows.length) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Banknote className="w-4 h-4 text-amber" />
        <h2 className="font-semibold text-sm">Monthly Pricing</h2>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-[#111113] overflow-hidden">
        {/* A real <table> — not stacked CSS grid divs — so column widths are
            computed once across header + every row and stay aligned, instead
            of each row's "auto" columns sizing independently to their own content. */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/[0.05]">
              <th className="px-4 py-2 text-left font-normal">
                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Package</span>
              </th>
              {hasNonAcRooms && (
                <th className="px-4 py-2 text-right font-normal">
                  <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Standard</span>
                </th>
              )}
              {hasAcRooms && (
                <th className="px-4 py-2 text-right font-normal">
                  <span className="text-[10px] font-semibold text-blue-400/60 uppercase tracking-widest">AC Room</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const p = prices[t.tier]!;
              return (
                <tr key={t.tier} className={i !== 0 ? "border-t border-white/[0.05]" : ""}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium leading-tight">{t.label}</p>
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5">{t.subtitle}</p>
                  </td>
                  {hasNonAcRooms && (
                    <td className="px-4 py-3 text-right">
                      {p.no_ac > 0
                        ? <span className="text-sm font-semibold text-amber tabular-nums">{formatCurrency(p.no_ac)}</span>
                        : <span className="text-xs text-muted-foreground/30">—</span>}
                    </td>
                  )}
                  {hasAcRooms && (
                    <td className="px-4 py-3 text-right">
                      {p.ac > 0
                        ? <span className="text-sm font-semibold text-blue-400 tabular-nums">{formatCurrency(p.ac)}</span>
                        : <span className="text-xs text-muted-foreground/30">—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* AC note */}
        {hasAcRooms && config.ac_per_unit_rate > 0 && (
          <div className="border-t border-white/[0.05] px-4 py-2.5 flex items-center gap-2">
            <Wind className="w-3 h-3 text-blue-400/60 shrink-0" />
            <span className="text-[11px] text-blue-400/70">AC rooms billed additionally at {formatCurrency(config.ac_per_unit_rate)}/unit consumed</span>
          </div>
        )}
        {/* Security deposit */}
        {config.security_deposit > 0 && (
          <div className="border-t border-white/[0.05] px-4 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Banknote className="w-3 h-3 text-amber/60 shrink-0" />
              <span className="text-[11px] text-muted-foreground/60">Security Deposit (one-time, refundable)</span>
            </div>
            <span className="text-[11px] font-semibold text-amber tabular-nums">{formatCurrency(config.security_deposit)}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Seater pricing section ──────────────────────────────────────────────────────

function SeaterPricingSection({
  config,
  hasAcRooms,
  hasNonAcRooms,
}: {
  config: PackageConfig;
  hasAcRooms: boolean;
  hasNonAcRooms: boolean;
}) {
  const seaterPrices = config.seater_prices ?? {};
  const rows = SEATER_CAPACITIES.filter((c) => {
    const p = seaterPrices[c];
    if (!p) return false;
    return (hasNonAcRooms && p.no_ac > 0) || (hasAcRooms && p.ac > 0);
  });
  if (!rows.length) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Banknote className="w-4 h-4 text-amber" />
        <h2 className="font-semibold text-sm">Monthly Pricing</h2>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-[#111113] overflow-hidden">
        {/* A real <table> — not stacked CSS grid divs — so column widths are
            computed once across header + every row and stay aligned, instead
            of each row's "auto" columns sizing independently to their own content. */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/[0.05]">
              <th className="px-4 py-2 text-left font-normal">
                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Seater</span>
              </th>
              {hasNonAcRooms && (
                <th className="px-4 py-2 text-right font-normal">
                  <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Standard</span>
                </th>
              )}
              {hasAcRooms && (
                <th className="px-4 py-2 text-right font-normal">
                  <span className="text-[10px] font-semibold text-blue-400/60 uppercase tracking-widest">AC Room</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const p = seaterPrices[c]!;
              const depositNoAc = (p.deposit_no_ac ?? 0) > 0 ? p.deposit_no_ac! : config.security_deposit;
              const depositAc = (p.deposit_ac ?? 0) > 0 ? p.deposit_ac! : config.security_deposit;
              return (
                <tr key={c} className={i !== 0 ? "border-t border-white/[0.05]" : ""}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium leading-tight">{SEATER_LABELS[c]}</p>
                  </td>
                  {hasNonAcRooms && (
                    <td className="px-4 py-3 text-right">
                      {p.no_ac > 0
                        ? <span className="text-sm font-semibold text-amber tabular-nums">{formatCurrency(p.no_ac)}</span>
                        : <span className="text-xs text-muted-foreground/30">—</span>}
                      {p.no_ac > 0 && depositNoAc > 0 && (
                        <span className="block text-[10px] text-muted-foreground/50 mt-0.5">Dep {formatCurrency(depositNoAc)}</span>
                      )}
                    </td>
                  )}
                  {hasAcRooms && (
                    <td className="px-4 py-3 text-right">
                      {p.ac > 0
                        ? <span className="text-sm font-semibold text-blue-400 tabular-nums">{formatCurrency(p.ac)}</span>
                        : <span className="text-xs text-muted-foreground/30">—</span>}
                      {p.ac > 0 && depositAc > 0 && (
                        <span className="block text-[10px] text-muted-foreground/50 mt-0.5">Dep {formatCurrency(depositAc)}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* AC note */}
        {hasAcRooms && config.ac_per_unit_rate > 0 && (
          <div className="border-t border-white/[0.05] px-4 py-2.5 flex items-center gap-2">
            <Wind className="w-3 h-3 text-blue-400/60 shrink-0" />
            <span className="text-[11px] text-blue-400/70">AC rooms billed additionally at {formatCurrency(config.ac_per_unit_rate)}/unit consumed</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Sticky band ───────────────────────────────────────────────────────────────

interface StickyBandProps {
  hostel: PublicHostelDetail;
  onWaitlist: () => void;
  backHref: string | null;
}

function StickyBand({ hostel, onWaitlist, backHref }: StickyBandProps) {
  const contactPhone = hostel.whatsapp || hostel.phone;
  const waGeneral = buildWhatsAppUrl(contactPhone, `Hi! I found ${hostel.name} on HMS Directory. I'd like to enquire about availability.`);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 min-w-0">
        {backHref && (
          <Link href={backHref} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
        <span className="font-semibold text-sm truncate">{hostel.name}</span>
        {hostel.available_beds > 0
          ? <span className="shrink-0 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">{hostel.available_beds} free</span>
          : <span className="shrink-0 text-[10px] text-rose-400 bg-rose-500/10 border border-rose-400/20 px-2 py-0.5 rounded-full">Full</span>
        }
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {waGeneral && (
          <a href={waGeneral} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/20 text-xs font-semibold transition-colors">
            <WhatsAppIcon cls="w-3 h-3" /> <span className="hidden sm:inline">WhatsApp</span>
          </a>
        )}
        <button onClick={onWaitlist} className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] text-xs text-muted-foreground transition-colors">
          <Clock className="w-3 h-3" /> Waitlist
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function HostelDetailClient({
  hostel,
  backHref = null,
  backLabel = "Back",
}: {
  hostel: PublicHostelDetail;
  backHref?: string | null;
  backLabel?: string;
}) {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [showBand, setShowBand]         = useState(false);
  const [activeTab, setActiveTab]       = useState<"rooms" | "details">("rooms");
  const infoRef                         = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => setShowBand(!entry.isIntersecting), { threshold: 0 });
    if (infoRef.current) obs.observe(infoRef.current);
    return () => obs.disconnect();
  }, []);

  // Deep-link support for ?tab=menu (used by the welcome-message "Monthly food
  // menu" link) — jumps straight to Packages & Menu instead of landing on Rooms.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "menu") {
      setActiveTab("details");
    }
  }, []);

  // H2: reject non-http(s) URLs to block javascript: protocol injection
  const safeMapsUrl = hostel.maps_url?.match(/^https?:\/\//i) ? hostel.maps_url : null;

  const contactPhone = hostel.whatsapp || hostel.phone;
  const waGeneral = buildWhatsAppUrl(contactPhone, `Hi! I found ${hostel.name} on HMS Directory. I'd like to enquire about availability.`);

  const availableRooms = hostel.rooms.filter((r) => r.status === "available" && r.capacity - r.occupied > 0);
  const fullRooms      = hostel.rooms.filter((r) => r.status !== "available" || r.capacity - r.occupied <= 0);

  return (
    <>
      {waitlistOpen && <WaitlistModal hostelId={hostel.id} hostelName={hostel.name} onClose={() => setWaitlistOpen(false)} />}

      {/* Sticky band */}
      <div className={`fixed top-0 left-0 right-0 z-30 border-b border-white/[0.08] bg-[#0A0A0B]/95 backdrop-blur-md transition-all duration-300 ${showBand ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"}`}>
        <StickyBand hostel={hostel} onWaitlist={() => setWaitlistOpen(true)} backHref={backHref} />
      </div>

      <div className="min-h-screen bg-[#0A0A0B]">

        {/* Compact header */}
        <div ref={infoRef}>
          <nav className="border-b border-white/[0.05] bg-[#0A0A0B]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 h-11 flex items-center gap-2">
              {backHref && (
                <>
                  <Link href={backHref} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors group text-sm">
                    <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" /> {backLabel}
                  </Link>
                  <span className="text-muted-foreground/25 text-xs">/</span>
                </>
              )}
              <span className="text-sm text-foreground/70 truncate">{hostel.name}</span>
            </div>
          </nav>

          <div className="border-b border-white/[0.06] bg-[#0D0D0F]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">

                {/* Left: identity + location + amenities */}
                <div className="min-w-0 flex-1">

                  {/* Title + badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <h1 className="font-serif text-2xl sm:text-[28px] font-medium leading-tight tracking-tight">{hostel.name}</h1>
                    {hostel.hostel_type && (
                      <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-amber/10 text-amber border border-amber/20 leading-none">
                        {TYPE_LABELS[hostel.hostel_type]}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border leading-none ${hostel.available_beds > 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-400/20" : "bg-rose-500/10 text-rose-400 border-rose-400/20"}`}>
                      {hostel.available_beds > 0 ? `${hostel.available_beds} beds free` : "Currently full"}
                    </span>
                  </div>

                  {/* Location + Maps button */}
                  {(hostel.area || hostel.city) && (
                    <div className="flex items-center gap-2 mb-4">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                      <span className="text-sm text-muted-foreground/60">
                        {[hostel.area, hostel.city].filter(Boolean).join(", ")}
                      </span>
                      {safeMapsUrl && (
                        <a
                          href={safeMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open in Google Maps"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.09] text-[11px] text-muted-foreground/60 hover:text-foreground hover:border-white/20 hover:bg-white/[0.07] transition-all"
                        >
                          <ExternalLink className="w-2.5 h-2.5" /> Maps
                        </a>
                      )}
                    </div>
                  )}

                  {/* Description */}
                  {hostel.description && (
                    <p className="text-sm text-muted-foreground/55 leading-relaxed line-clamp-2 max-w-xl mb-4">{hostel.description}</p>
                  )}

                  {/* Amenity chips */}
                  {(hostel.amenities ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(hostel.amenities ?? []).map((a) => (
                        <span key={a} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.07] text-[11px] text-muted-foreground/65">
                          {AMENITY_ICONS[a] ?? null} {a}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: CTAs — WhatsApp (primary) + Waitlist only */}
                <div className="flex sm:flex-col gap-2.5 shrink-0 sm:min-w-[160px]">
                  {waGeneral && (
                    <a
                      href={waGeneral}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black text-sm font-bold transition-colors shadow-[0_0_24px_rgba(37,211,102,0.18)] whitespace-nowrap"
                    >
                      <WhatsAppIcon cls="w-4 h-4" /> WhatsApp
                    </a>
                  )}
                  <button
                    onClick={() => setWaitlistOpen(true)}
                    className="flex items-center justify-center gap-2 h-11 px-5 rounded-xl border border-white/[0.10] hover:border-white/[0.18] hover:bg-white/[0.04] text-sm text-muted-foreground/80 hover:text-foreground transition-all whitespace-nowrap"
                  >
                    <Clock className="w-3.5 h-3.5" /> Join Waitlist
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab strip */}
        {(hostel.package_config || hostel.food_menu.length > 0) && (
          <div className="border-b border-white/[0.06] bg-[#0D0D0F]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 flex">
              {(["rooms", "details"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-2 px-1 py-3 mr-6 text-sm font-medium border-b-2 transition-colors capitalize ${
                    activeTab === tab
                      ? "border-amber text-foreground"
                      : "border-transparent text-muted-foreground/50 hover:text-muted-foreground"
                  }`}
                >
                  {tab === "rooms" ? "Rooms" : "Packages & Menu"}
                  {tab === "rooms" && hostel.rooms.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${activeTab === "rooms" ? "bg-amber/15 text-amber" : "bg-white/[0.06] text-muted-foreground/40"}`}>
                      {hostel.rooms.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tab content */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-10">

          {/* ── Rooms tab ── */}
          {activeTab === "rooms" && (
            <>
              {availableRooms.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <BedDouble className="w-4 h-4 text-emerald-400" />
                    <h2 className="font-semibold text-sm">Available Rooms <span className="text-muted-foreground/50 font-normal">({availableRooms.length})</span></h2>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {availableRooms.map((room) => (
                      <RoomCard key={room.id} room={room} hostel={hostel} />
                    ))}
                  </div>
                </section>
              )}

              {fullRooms.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <BedDouble className="w-4 h-4 text-muted-foreground/40" />
                    <h2 className="font-semibold text-sm text-muted-foreground/60">Occupied Rooms <span className="font-normal">({fullRooms.length})</span></h2>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {fullRooms.map((room) => (
                      <RoomCard key={room.id} room={room} hostel={hostel} />
                    ))}
                  </div>
                </section>
              )}

              {hostel.rooms.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-2xl border border-white/[0.05] bg-[#111113]">
                  <BedDouble className="w-8 h-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground/50">Room details not listed yet.</p>
                </div>
              )}
            </>
          )}

          {/* ── Details tab ── */}
          {activeTab === "details" && (
            <>
              {/* One pricing table only — seater pricing takes over as the sole
                  "Monthly Pricing" table once configured (it's the more specific,
                  capacity-aware source), otherwise the flat package-tier table
                  shows exactly as before. Never both at once. */}
              {hostel.package_config && (() => {
                const config = hostel.package_config;
                const seaterVals = Object.values(config.seater_prices ?? {});
                const hasSeaterPricing = seaterVals.some((p) => (p?.no_ac ?? 0) > 0 || (p?.ac ?? 0) > 0);

                if (hasSeaterPricing) {
                  return (
                    <SeaterPricingSection
                      config={config}
                      hasAcRooms={seaterVals.some((p) => p!.ac > 0)}
                      hasNonAcRooms={seaterVals.some((p) => p!.no_ac > 0)}
                    />
                  );
                }

                const prices = config.package_prices ?? {};
                const vals = Object.values(prices);
                return (
                  <PackagePricingSection
                    config={config}
                    hasAcRooms={vals.some((p) => p.ac > 0)}
                    hasNonAcRooms={vals.some((p) => p.no_ac > 0)}
                  />
                );
              })()}

              {hostel.food_menu.length > 0 && (
                <FoodMenuSection items={hostel.food_menu} closedOnSundays={hostel.food_closed_on_sundays} menuType={hostel.food_menu_type} />
              )}

              {!hostel.package_config && hostel.food_menu.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-2xl border border-white/[0.05] bg-[#111113]">
                  <Banknote className="w-8 h-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground/50">Pricing details not listed yet.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile fixed bottom bar */}
        {waGeneral && (
          <div className="fixed bottom-0 left-0 right-0 z-20 sm:hidden border-t border-white/[0.08] bg-[#0A0A0B]/95 backdrop-blur-md px-4 py-3">
            <div className="flex gap-2">
              <a href={waGeneral} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/25 text-sm font-semibold transition-colors">
                <WhatsAppIcon cls="w-4 h-4" /> WhatsApp Now
              </a>
              <button onClick={() => setWaitlistOpen(true)} className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-white/[0.08] hover:bg-white/[0.05] text-muted-foreground text-sm transition-colors">
                <Clock className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <div className="h-20 sm:hidden" />
      </div>
    </>
  );
}
