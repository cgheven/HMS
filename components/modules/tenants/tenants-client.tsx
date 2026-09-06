"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Users, BedDouble, Search, Edit2, Trash2,
  LogOut, Clock, UserCheck, Phone, Mail, CreditCard, Eye,
  ClipboardList, CheckCircle2, XCircle, Link2, Loader2, ShieldCheck,
  FileSpreadsheet, FileText, ExternalLink, Banknote, Copy, Check, UtensilsCrossed,
  CalendarClock, CalendarX, MessageCircle, Car, Download, Printer, Zap,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { organizationPresetsFor } from "@/lib/organization-presets";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput, formatMonthLong, capitalize, cn, sortRooms } from "@/lib/utils";
import { calcFoodAddonCharge, hasFoodAddonRates, hasIndividualFoodRates, FOOD_INCLUSIVE_TIERS, type FoodAddonRates, type FoodAddonFlags } from "@/lib/food-addon";
import { getSeaterPrice, getSeaterDeposit, type SeaterPrices } from "@/lib/seater-pricing";
import { STUDENT_CATEGORY_LABELS, STUDENT_CATEGORY_OPTIONS, studentCategoryHasDepartment, studentCategoryHasSpecialization, STUDENT_SPECIALIZATION_PRESETS, INSTITUTE_PRESETS_BY_CATEGORY, studentCategoryHasInstitutePresets , departmentPresetsFor } from "@/lib/student-category-labels";
import { countBillableNights, daysInMonth, parseLocalDate, proRateMonthlyRent } from "@/lib/daily-billing";
import { computeACSegmentBilling } from "@/lib/ac-billing";
import { formatCnic, isValidCnic, normalizeCnic } from "@/lib/cnic";
import { discountedRent } from "@/lib/tenant-discount";
import { VISIT_PURPOSE_OPTIONS, VISIT_PURPOSE_LABELS, visitPurposeLabel } from "@/lib/visit-purpose";
import { RELATIONSHIP_OPTIONS } from "@/types";
import type { Tenant, Room, SpaceType, PackageTier, PackageConfig, TenantApplication, ApplicationStatus, TenantDocument, PaymentMethod, PaymentStatus, CheckoutInput, PackagePrices, WaitlistEntry, PartnerTier, StaffPermission, StudentCategory, VisitPurpose, MealTimes } from "@/types";
import { PhotoPicker } from "./photo-picker";
import { DocumentManager } from "./document-manager";
import { updateApplicationStatus, convertToTenant, type ConvertFormData } from "@/app/actions/applications";
import { backfillTenantPaymentsAction, checkoutTenantAction, createInvoiceLink, getACCheckoutContextAction, getCheckoutPendingPaymentAction, getTenantRecordedMoneyAction, logTenantEvent, giveTenantNoticeAction, cancelTenantNoticeAction, deleteTenantAction, recordReservationDepositAction, resendTenantWelcomeMessageAction, getRoomTransferPreviewAction, transferTenantRoomAction, getRoomTransferCorrectionAction, correctRoomTransferAction, type RoomTransferPreview } from "@/app/actions/tenants";
// Straight from the module that declares it. Re-exporting it through the
// "use server" file as `export type { RoomTransferResult }` did not survive
// Turbopack — a re-exported import binding is emitted as a real runtime export,
// and every page that pulls in tenants.ts died with "RoomTransferResult is not
// defined". A dedicated `import type` is erased outright, so the server-only
// module it names is never bundled into this client component.
import type { RoomTransferResult, CorrectableTransfer } from "@/lib/room-transfer";
import { checkoutTenantAsPartner, addTenantAsPartner, editTenantAsPartner } from "@/app/actions/partner";
import { addTenantAsManager, editTenantAsManager, checkoutTenantAsManager, giveTenantNoticeAsManager, cancelTenantNoticeAsManager } from "@/app/actions/managers";
import { checkTenantRedflagAction } from "@/app/actions/redflag";
import { MeterPhoto } from "@/components/modules/ac/meter-photo";
import { uploadJoiningMeterPhoto, deleteJoiningMeterPhoto } from "@/app/actions/ac-meter-photos";
import type { RedflagMatch } from "@/types";
import { attributeReferralForTenant, detachReferralRewardsForTenant, sendReferralLinkForTenant } from "@/app/actions/referrals";
import { ReferralAdmissionBanner } from "@/components/modules/referrals/referral-admission-banner";
import { sendTenantWelcomeMessageAction } from "@/lib/whatsapp-welcome-action";
import { downloadQrFlyerPdf } from "@/lib/qr-flyer-pdf";
import QRCode from "qrcode";
import { computeReferralDiscount, computeRentDiscount } from "@/lib/payment-calc";

interface Props {
  hostelId: string | null;
  active: Tenant[];
  waiting: Tenant[];
  checkedOut: Tenant[];
  rooms: Room[];
  applications?: TenantApplication[];
  hostelSlug?: string | null;
  hostelName?: string | null;
  waitlistEntries?: WaitlistEntry[];
  foodAddonRates?: FoodAddonRates;
  foodMonthlyRate?: number;
  noticePeriodDays?: number;
  /** hms_hostels.meal_times — printed as a rule on the admission form. */
  mealTimes?: MealTimes | null;
  /** Branch-level AC maintenance rate. Applied on the admission form only to a
   *  resident whose room has AC, matching what the payment trigger charges. */
  acMaintenanceRate?: number;
  /** hms_hostels.meter_all_rooms — the branch meters every room, not only the
   *  ones flagged has_ac. The checkout dialog's AC section keyed off has_ac
   *  alone, so on these branches it never appeared and the departing member's
   *  final electricity went unbilled onto whoever stayed. */
  meterAllRooms?: boolean;
  currentMonthPaymentByTenant?: Record<string, { status: string; remaining: number }>;
  // null/undefined = owner (unrestricted). Add/Edit Tenant and Give Notice are
  // deferred for partners in this pass — the safe write actions only cover a
  // reduced field set, and a full-parity partner form is a planned follow-up
  // rather than something rushed in here. Checkout has full parity (shares the
  // exact same performTenantCheckout as the owner path) and is wired for Full tier.
  partnerTier?: PartnerTier | null;
  // null/undefined = not a manager (owner or partner — unchanged behaviour).
  // A non-null array puts the page in manager mode: the full list, stats, search,
  // filters and timeline stay visible, but every money-settling or record-rewriting
  // control (Edit / Checkout / Delete / Give Notice / Activate) is hidden, and Add
  // requires the "add_members" permission. Writes go through addTenantAsManager,
  // which re-resolves the branch server-side.
  managerPermissions?: StaffPermission[] | null;
  // Server-seeded pricing config. Only the portal passes this — managers can't
  // read hms_package_configs from the browser, so without it every suggested
  // rent and deposit in the Add Tenant dialog would be blank.
  initialPackageConfig?: PackageConfig | null;
}

const PACKAGE_TIER_LABELS: Record<PackageTier, string> = {
  space_only: "Space Only",
  space_food: "Space + 2 Meals",
  space_3meals: "Space + 3 Meals",
  space_food_ac: "Space + Meals + AC", // legacy — kept for display only, never offered in new forms
  space_meals_cooler: "Space + Meals + Cooler",
};

// Tiers shown when adding/editing a tenant — space_food_ac intentionally excluded
const SELECTABLE_TIERS: { tier: PackageTier; label: string }[] = [
  { tier: "space_only",         label: "Space Only" },
  { tier: "space_food",         label: "Space + 2 Meals" },
  { tier: "space_3meals",       label: "Space + 3 Meals" },
  { tier: "space_meals_cooler", label: "Space + Meals + Cooler" },
];

function getPkgPrice(prices: Partial<Record<PackageTier, { no_ac: number; ac: number }>>, tier: PackageTier, hasAc: boolean): string {
  const p = prices[tier];
  if (!p) return "";
  const val = hasAc ? p.ac : p.no_ac;
  return val > 0 ? String(val) : "";
}

// Flat washroom add-on stacked on top of any suggested price string — applies
// regardless of package/custom-package/room-rent source, but never inflates
// an empty ("no price set") suggestion.
function addWashroomPremium(priceStr: string, hasWashroom: boolean, premium: number): string {
  if (!priceStr || !hasWashroom || premium <= 0) return priceStr;
  return String(Number(priceStr) + premium);
}

// Suggested price for the manual "Add New Tenant" dialog's Package Tier field.
// Seater pricing (by capacity + AC) only takes priority for "space_only" when
// the room has an attached washroom — scoped narrowly on purpose: every other
// room keeps this dialog's original behavior (flat package-tier price) exactly
// as it's always been, since no existing hostel has any room tagged with a
// washroom yet. Only a room an owner has just opted into the new feature gets
// the corrected, consistent total (matching Approve Application / the public
// site). Deliberately does NOT fall back further to room.monthly_rent here —
// callers already layer that on separately, exactly as before this fix.
function getTierPriceString(
  room: Room,
  tier: PackageTier,
  pkgPrices: Partial<Record<PackageTier, { no_ac: number; ac: number }>>,
  seaterPrices: SeaterPrices | null | undefined,
  washroomPremium: number
): string {
  if (tier === "space_only" && room.has_attached_washroom) {
    const seater = getSeaterPrice(room.capacity, room.has_ac, seaterPrices);
    if (seater !== null) return addWashroomPremium(String(seater), room.has_attached_washroom, washroomPremium);
  }
  return addWashroomPremium(getPkgPrice(pkgPrices, tier, room.has_ac), room.has_attached_washroom, washroomPremium);
}

// Suggested rent for a room + package tier — mirrors the precedence chain used on the
// public join/room-browsing pages (lib/room-pricing.ts): seater price only governs the
// base "space_only" tier; other tiers are always flat package-tier prices.
function getSuggestedRent(
  room: Room,
  tier: PackageTier,
  pkgPrices: Partial<Record<PackageTier, PackagePrices>>,
  seaterPrices: SeaterPrices | null | undefined,
  washroomPremium = 0
): number {
  // Flat add-on for a washroom-equipped room, same amount regardless of seater
  // count or package tier — stacks on top of whichever price is actually
  // resolved below, but never added to a tier that has no price set (stays 0).
  const washroomAddOn = room.has_attached_washroom ? washroomPremium : 0;
  if (tier === "space_only") {
    const seater = getSeaterPrice(room.capacity, room.has_ac, seaterPrices);
    if (seater !== null) return seater + washroomAddOn;
  }
  const tierPrices = pkgPrices[tier];
  const tierPrice = tierPrices ? (room.has_ac ? tierPrices.ac : tierPrices.no_ac) : 0;
  if (tierPrice > 0) return tierPrice + washroomAddOn;
  return tier === "space_only" ? room.monthly_rent + washroomAddOn : 0;
}

function getSuggestedDeposit(
  room: Room,
  tier: PackageTier,
  pkgPrices: Partial<Record<PackageTier, PackagePrices>>,
  seaterPrices: SeaterPrices | null | undefined,
  configSecurityDeposit: number
): number {
  if (tier === "space_only") {
    const seaterDep = getSeaterDeposit(room.capacity, room.has_ac, seaterPrices);
    if (seaterDep !== null) return seaterDep;
  }
  const tierPrices = pkgPrices[tier];
  const tierDeposit = tierPrices ? (room.has_ac ? (tierPrices.deposit_ac ?? 0) : (tierPrices.deposit_no_ac ?? 0)) : 0;
  if (tierDeposit > 0) return tierDeposit;
  return configSecurityDeposit;
}

// Whole calendar days between notice_given_date and intended_checkout_date — the same
// two dates the owner sees on the tenant, so this always matches what's on file.
function computeDaysNotice(t: Tenant): number | null {
  if (!t.notice_given_date || !t.intended_checkout_date) return null;
  const given = new Date(t.notice_given_date + "T00:00:00");
  const intended = new Date(t.intended_checkout_date + "T00:00:00");
  return Math.round((intended.getTime() - given.getTime()) / 86400000);
}

// Deleting a tenant cascades their payment rows away with them, so any month
// they contributed to quietly loses that money from its collected figure. The
// owner's decision is that the delete is still allowed — but never as a
// surprise, and never in the abstract: the warning names the amount and the
// month, because "some payment records" is not something an owner can weigh.
const DELETE_TENANT_BASE = "This tenant and all associated payment records will be permanently deleted.";

function buildDeleteDescription(
  t: Tenant | null,
  money: { total: number; byMonth: { month: string; amount: number }[] } | null,
  error: string | null
): string {
  if (error) {
    return `${DELETE_TENANT_BASE} Their recorded payments could NOT be checked (${error}), so if any money was collected from them it will vanish from those months' totals without appearing here.`;
  }
  if (!money) return `${DELETE_TENANT_BASE} Checking what has already been collected from them…`;
  if (money.total <= 0) return DELETE_TENANT_BASE;

  const name = t?.full_name ?? "This tenant";
  const removals = money.byMonth
    .map((m) => `${formatCurrency(m.amount)} from ${formatMonthLong(m.month)}'s collected total`)
    .join(", ");
  return `${name} has ${formatCurrency(money.total)} in recorded payments. Deleting will remove ${removals}. ${DELETE_TENANT_BASE}`;
}

function approveFormFoodFlags(form: ConvertFormData): FoodAddonFlags {
  return {
    food_breakfast: form.food_breakfast ?? false,
    food_lunch: form.food_lunch ?? false,
    food_dinner: form.food_dinner ?? false,
  };
}

interface CustomPackage {
  id: string;
  name: string;
  no_ac: number;
  ac: number;
  deposit_no_ac: number;
  deposit_ac: number;
}

function getCustomPackagePrice(customPackages: CustomPackage[], id: string | null, hasAc: boolean): string {
  const c = id ? customPackages.find((p) => p.id === id) : undefined;
  if (!c) return "";
  const val = hasAc ? c.ac : c.no_ac;
  return val > 0 ? String(val) : "";
}

function getCustomPackageDeposit(customPackages: CustomPackage[], id: string | null, hasAc: boolean): number {
  const c = id ? customPackages.find((p) => p.id === id) : undefined;
  if (!c) return 0;
  return hasAc ? c.deposit_ac : c.deposit_no_ac;
}

const emptyForm = {
  full_name: "", phone: "", email: "", cnic: "",
  type: "student" as SpaceType,
  package_tier: "space_only" as PackageTier,
  custom_package_id: null as string | null,
  room_id: "", bed_number: "",
  check_in: formatDateInput(new Date()),
  billing_type: "monthly" as "monthly" | "daily",
  monthly_rent: "", daily_rate: "", discount_percent: "", check_out: "", security_deposit: "0",
  registration_fee: "",
  ac_maintenance: "",
  vehicle_type: "", vehicle_number: "", vehicle_model: "",
  joining_meter_reading: "",
  emergency_contact: "", emergency_relationship: "", emergency_phone: "", permanent_address: "", notes: "",
  father_name: "", purpose_of_visit: "" as "" | VisitPurpose, purpose_of_visit_detail: "",
  is_waiting: false,
  photo_url: "" as string,
  food_breakfast: false, food_lunch: false, food_dinner: false,
  institute_name: "", student_category: "" as "" | StudentCategory, student_specialization: "", organization: "", organization_type: "" as "" | "private" | "government", department: "",
};

// ---------------------------------------------------------------------------
// TenantRow — module scope so React preserves identity across parent re-renders
// (UX-F1: defining inside render causes unmount/remount on every parent state change)
// ---------------------------------------------------------------------------

interface TenantRowProps {
  t: Tenant;
  showCheckout?: boolean;
  showActivate?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  showGiveNotice?: boolean;
  showSendWelcome?: boolean;
  /** Waiting list only — record the deposit that holds this person's bed. */
  showRecordDeposit?: boolean;
  roomMap: Record<string, Room>;
  foodAddonRates: FoodAddonRates;
  noticePeriodDays?: number;
  currentMonthPaymentByTenant?: Record<string, { status: string; remaining: number }>;
  sendingWelcome?: boolean;
  /** True while this row's admission form is being built. */
  printingForm?: boolean;
  // Omitted for managers: opens the same Add/Edit Tenant form read-only, and
  // that form resolves hostelId client-side in a way managers don't have.
  // Undefined hides the control entirely.
  onView?: (t: Tenant) => void;
  /** Prints the admission form, pre-filled from this row. Undefined hides it. */
  onPrintForm?: (t: Tenant) => void;
  onCheckout: (t: Tenant) => void;
  onActivate: (t: Tenant) => void;
  onEdit: (t: Tenant) => void;
  onDelete: (t: Tenant) => void;
  onGiveNotice?: (t: Tenant) => void;
  onSendWelcome?: (t: Tenant) => void;
  onRecordDeposit?: (t: Tenant) => void;
}

function TenantRow({ t, showCheckout = false, showActivate = false, showEdit = true, showDelete = true, showGiveNotice = true, showSendWelcome = false, showRecordDeposit = false, roomMap, foodAddonRates, noticePeriodDays = 30, currentMonthPaymentByTenant, sendingWelcome = false, printingForm = false, onView, onPrintForm, onCheckout, onActivate, onEdit, onDelete, onGiveNotice, onSendWelcome, onRecordDeposit }: TenantRowProps) {
  const room = t.room_id ? roomMap[t.room_id] : null;
  const foodCharge = calcFoodAddonCharge(t, foodAddonRates);
  const initials = t.full_name[0].toUpperCase();
  const depositCollected = Number(t.deposit_collected_amount ?? 0);
  const depositBalance = Math.max(0, Number(t.security_deposit ?? 0) - depositCollected);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-3.5 sm:px-4 sm:py-3 rounded-xl hover:bg-white/[0.03] transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
      <button
        type="button"
        disabled={!onView}
        onClick={() => onView?.(t)}
        className="w-9 h-9 rounded-full shrink-0 overflow-hidden border border-amber/20 bg-amber/10 flex items-center justify-center hover:opacity-80 transition-opacity disabled:hover:opacity-100 disabled:cursor-default"
      >
        {t.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.photo_url} alt={t.full_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-amber">{initials}</span>
        )}
      </button>

      <button
        type="button"
        disabled={!onView}
        onClick={() => onView?.(t)}
        className="flex-1 min-w-0 text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{t.full_name}</p>
          <Badge variant="secondary" className="text-xs capitalize shrink-0">{t.type}</Badge>
          {t.billing_type === "daily" && <Badge variant="warning" className="text-xs shrink-0">Daily</Badge>}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-1 mt-0.5 items-center">
          {room && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Rm {room.room_number}{t.bed_number ? ` · ${t.bed_number}` : ""}
            </span>
          )}
          {t.phone && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-0.5">
              <Phone className="w-2.5 h-2.5 shrink-0" />{t.phone}
            </span>
          )}
          {t.check_in && (
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
              In: {formatDate(t.check_in)}
            </span>
          )}
          {t.check_out && (
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
              Out: {formatDate(t.check_out)}
            </span>
          )}
          {(t.documents?.length ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400 whitespace-nowrap">
              <ShieldCheck className="w-3 h-3" />{t.documents.length}
            </span>
          )}
          {t.vehicle_number && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-0.5" title={t.vehicle_model ?? undefined}>
              <Car className="w-2.5 h-2.5 shrink-0" />{t.vehicle_number}
            </span>
          )}
          {/* The whole point of the waiting list: who has actually put money
              down and confirmed their seat, versus who is only a name on it.
              Reads deposit_collected_amount — what was RECEIVED — never
              security_deposit, which is what was agreed. Showing the agreed
              figure made a Rs 5,000 part payment against a Rs 10,000 deposit
              claim Rs 10,000 had been received the moment the page reloaded. */}
          {t.is_waiting && (
            depositCollected > 0 ? (
              <span
                className="inline-flex items-center gap-0.5 whitespace-nowrap px-1.5 py-0.5 rounded-full text-xs font-medium border text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                title={
                  depositBalance > 0
                    ? `Seat held — ${formatCurrency(depositCollected)} received${t.deposit_collected_on ? ` on ${formatDate(t.deposit_collected_on)}` : ""}. ${formatCurrency(depositBalance)} of the deposit will be billed on the first monthly bill.`
                    : `Seat confirmed — full deposit received${t.deposit_collected_on ? ` on ${formatDate(t.deposit_collected_on)}` : ""}`
                }
              >
                <Banknote className="w-2.5 h-2.5 shrink-0" />
                {depositBalance > 0
                  ? `${formatCurrency(depositCollected)} of ${formatCurrency(t.security_deposit)} deposit received`
                  : `${formatCurrency(depositCollected)} deposit received`}
                {t.deposit_collected_on ? ` ${formatDate(t.deposit_collected_on)}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 whitespace-nowrap px-1.5 py-0.5 rounded-full text-xs font-medium border text-amber bg-amber/10 border-amber/20">
                <Banknote className="w-2.5 h-2.5 shrink-0" />
                Deposit pending
              </span>
            )
          )}
        </div>
        {t.intended_checkout_date && (() => {
          const daysNotice = computeDaysNotice(t);
          const adequate = daysNotice != null && daysNotice >= noticePeriodDays;
          const duePayment = currentMonthPaymentByTenant?.[t.id];
          const showDueChip = !!duePayment
            && ["pending", "overdue", "partially_paid"].includes(duePayment.status)
            && duePayment.remaining > 0;
          return (
            <div className="flex flex-wrap gap-1.5 mt-1 items-center">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 whitespace-nowrap px-1.5 py-0.5 rounded-full text-xs font-medium border",
                  adequate
                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                    : "text-amber bg-amber/10 border-amber/20"
                )}
                title={t.notice_given_date ? `Notice given ${formatDate(t.notice_given_date)} — leaving ${formatDate(t.intended_checkout_date)}` : `Leaving ${formatDate(t.intended_checkout_date)}`}
              >
                <CalendarClock className="w-2.5 h-2.5 shrink-0" />
                {t.notice_given_date && <span className="hidden sm:inline">Notice {formatDate(t.notice_given_date)} →{" "}</span>}
                Leaving {formatDate(t.intended_checkout_date)}
                {daysNotice != null && <span className="opacity-80">({daysNotice}d {adequate ? "✓" : "⚠"})</span>}
              </span>
              {showDueChip && (
                <span className="inline-flex items-center gap-0.5 whitespace-nowrap px-1.5 py-0.5 rounded-full text-xs font-medium border text-rose-400 bg-rose-500/10 border-rose-500/20">
                  ⚠ {formatCurrency(duePayment!.remaining)} due
                </span>
              )}
            </div>
          );
        })()}
      </button>
      </div>

      <div className="flex items-center justify-end gap-3 sm:contents">
      {/* Fixed width, else the column re-sizes per row (Rs 30,000 vs Rs 19,000)
          and drifts horizontally, breaking alignment down the list. */}
      <div className="text-right shrink-0 hidden md:block w-28">
        {t.billing_type === "daily"
          ? <p className="text-sm font-semibold text-foreground">{formatCurrency(t.daily_rate)}<span className="text-xs text-muted-foreground font-normal">/day</span></p>
          : <p className="text-sm font-semibold text-foreground">{formatCurrency(t.monthly_rent + foodCharge)}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
        }
        {foodCharge > 0 && (
          <p className="text-xs text-amber flex items-center justify-end gap-0.5">
            <UtensilsCrossed className="w-2.5 h-2.5" />Food incl.
          </p>
        )}
        {t.billing_type === "monthly" && (t.discount_percent ?? 0) > 0 && (
          <p
            className="text-xs text-emerald-400"
            title={`Standing discount on rent — bills ${formatCurrency(discountedRent(t.monthly_rent, t.discount_percent!))}/month`}
          >
            {t.discount_percent}% off
          </p>
        )}
        {t.security_deposit > 0 && <p className="text-xs text-muted-foreground">Dep: {formatCurrency(t.security_deposit)}</p>}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {showRecordDeposit && onRecordDeposit && !t.deposit_collected_on && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/20"
            onClick={() => onRecordDeposit(t)}
            title="Record Deposit"
          >
            <Banknote className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline text-xs ml-1.5">Deposit</span>
          </Button>
        )}
        {showActivate && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/20"
            onClick={() => onActivate(t)}
            title="Activate Tenant"
          >
            <UserCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline text-xs ml-1.5">Activate</span>
          </Button>
        )}
        {showGiveNotice && onGiveNotice && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              // Fixed width so "Notice" and "Give Notice" occupy the same space —
              // otherwise the label swap shifts every column to its left.
              "h-8 px-2 border sm:w-[112px]",
              t.intended_checkout_date
                ? "text-amber hover:text-amber hover:bg-amber/10 border-amber/20"
                : "text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 border-blue-500/20"
            )}
            onClick={() => onGiveNotice(t)}
            title={t.intended_checkout_date ? "Manage Notice" : "Give Notice"}
          >
            {t.intended_checkout_date ? <CalendarX className="w-3.5 h-3.5 shrink-0" /> : <CalendarClock className="w-3.5 h-3.5 shrink-0" />}
            <span className="hidden sm:inline text-xs ml-1.5">{t.intended_checkout_date ? "Notice" : "Give Notice"}</span>
          </Button>
        )}
        {showCheckout && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20"
            onClick={() => onCheckout(t)}
            title="Check Out"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline text-xs ml-1.5">Check Out</span>
          </Button>
        )}
        {showSendWelcome && onSendWelcome && t.phone && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
            onClick={() => onSendWelcome(t)}
            disabled={sendingWelcome}
            title="Resend Welcome Message (WiFi + Mess Link)"
          >
            {sendingWelcome ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
          </Button>
        )}
        {onPrintForm && (
          // Desktop only, like View: this ends at a printer, and the row is
          // already carrying six controls on a phone.
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:flex h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Print admission form"
            disabled={printingForm}
            onClick={() => onPrintForm(t)}
          >
            {printingForm ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
          </Button>
        )}
        {onView && (
          <Button variant="ghost" size="icon" className="hidden sm:flex h-8 w-8 text-muted-foreground hover:text-foreground" title="View Tenant" onClick={() => onView(t)}>
            <Eye className="w-3.5 h-3.5" />
          </Button>
        )}
        {showEdit && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(t)}>
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
        )}
        {showDelete && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(t)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Advisory RedFlag warning shown before a tenant is actually written. A CNIC
// hit is treated as an identity match (rose); a phone-only hit is treated as a
// weak signal (amber) — one real number in the registry is shared by 28
// different tenants, so a phone match can never be presented as a confirmed
// defaulter. Never renders a raw CNIC: the action hands back masked values and
// they are printed exactly as given.
function RedflagWarningDialog({
  matches,
  proceedLabel,
  onCancel,
  onProceed,
}: {
  matches: RedflagMatch[] | null;
  proceedLabel: string;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const list = matches ?? [];
  const identityMatch = list.some((m) => m.matchKind === "cnic");
  return (
    <Dialog open={list.length > 0} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", identityMatch ? "text-rose-400" : "text-amber")}>
            {identityMatch ? "🚩 RedFlag Alert" : "Possible RedFlag match"}
          </DialogTitle>
          <DialogDescription>
            {identityMatch
              ? list.every((m) => m.matchKind === "cnic")
                ? "This person has a RedFlag record reported by another hostel."
                : "This person has a RedFlag record reported by another hostel. Some entries below matched on phone number only — those need checking against the name."
              : "Only the phone number matched, and phone numbers are sometimes shared between people — check that the name below is actually this person before you decide."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[45vh] overflow-y-auto">
          {list.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-xl border p-3",
                m.matchKind === "cnic" ? "bg-rose-500/15 border-rose-500/25" : "bg-amber/15 border-amber/25"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{m.fullName}</span>
                <span className={cn("text-[10px] font-semibold uppercase tracking-wide shrink-0 pt-0.5", m.matchKind === "cnic" ? "text-rose-400" : "text-amber")}>
                  {m.matchKind === "cnic" ? "CNIC match" : "Phone match"}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {m.cnicMasked && <span>CNIC {m.cnicMasked}</span>}
                {m.phoneMasked && <span>Phone {m.phoneMasked}</span>}
                <span className={m.matchKind === "cnic" ? "text-rose-400" : "text-amber"}>Owes {formatCurrency(m.amount)}</span>
                {m.monthsUnpaid != null && (
                  <span>{m.monthsUnpaid} month{m.monthsUnpaid === 1 ? "" : "s"} unpaid</span>
                )}
                <span className="col-span-2">
                  Reported {formatDate(m.reportedAt)}{m.reportedBySelf ? " · by your own hostel" : ""}
                </span>
                {/* The most useful thing on this screen. The operator is deciding
                    right now whether to give this person a bed; one call to the
                    hostel that filed it answers what a status pill cannot. */}
                {!m.reportedBySelf && m.reportedByHostelName && (
                  <span className="col-span-2 text-foreground/80">
                    Reported by {m.reportedByHostelName}
                    {m.reportedByHostelPhone && (
                      <>
                        {" · "}
                        <a
                          href={`tel:${m.reportedByHostelPhone.replace(/\s/g, "")}`}
                          className="underline underline-offset-2 hover:text-amber"
                        >
                          {m.reportedByHostelPhone}
                        </a>
                        <span className="text-muted-foreground"> — call to verify</span>
                      </>
                    )}
                  </span>
                )}
                {m.matchKind === "phone" && (
                  <span className="col-span-2 text-amber/80">
                    Phone numbers are sometimes shared — check the name matches before deciding.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            variant="ghost"
            onClick={onProceed}
            className="text-muted-foreground hover:text-foreground"
          >
            {proceedLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TenantsClient({ hostelId, active: initialActive, waiting: initialWaiting, checkedOut: initialCheckedOut, rooms: initialRooms, applications: initialApplications = [], hostelSlug, hostelName, waitlistEntries: initialWaitlistEntries = [], foodAddonRates: initialFoodAddonRates, foodMonthlyRate: initialFoodMonthlyRate, noticePeriodDays = 30, mealTimes = null, acMaintenanceRate = 0, meterAllRooms = false, currentMonthPaymentByTenant = {}, partnerTier = null, managerPermissions = null, initialPackageConfig = null }: Props) {
  const isPartner = !!partnerTier;
  const canFullTier = !partnerTier || partnerTier === "full";
  const canStandardTier = !partnerTier || partnerTier !== "read_only";
  const router = useRouter();
  const isManager = !!managerPermissions;
  const canAddAsManager = managerPermissions?.includes("add_members") ?? false;
  const canEditAsManager = managerPermissions?.includes("edit_members") ?? false;
  // Every flag below collapses to its pre-existing value when isManager is false,
  // so the owner and partner paths are untouched.
  const canAdd = isManager ? canAddAsManager : canStandardTier;
  const canEditRow = isManager ? canEditAsManager : canFullTier;
  // Delete is never available to a manager, regardless of permissions — no
  // delete permission exists anywhere in the system; checkout (not delete) is
  // the only way a manager can end a tenancy.
  const canDeleteRow = canFullTier && !isManager;
  // Give/cancel notice is a variant of editing a tenant's record, so it shares
  // edit_members instead of getting its own dedicated permission.
  const canNotice = isManager ? canEditAsManager : canStandardTier;
  // Same "add_members"/"standard" gate as adding a tenant — resending the
  // welcome message is a variant of that capability, matches resolveWelcomeMessageHostelId.
  const canSendWelcome = canAdd;
  const [active, setActive] = useState(initialActive);
  const [waiting, setWaiting] = useState(initialWaiting);
  const [checkedOut, setCheckedOut] = useState(initialCheckedOut);
  const [sendingWelcomeId, setSendingWelcomeId] = useState<string | null>(null);
  const [rooms, setRooms] = useState(() => sortRooms(initialRooms));
  const [applications, setApplications] = useState<TenantApplication[]>(initialApplications);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>(initialWaitlistEntries);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [checkingOut, setCheckingOut] = useState<Tenant | null>(null);
  const [checkoutDate, setCheckoutDate] = useState(formatDateInput(new Date()));
  // Room transfer: when an EDIT changes the room and either side is metered, the
  // meter has to be read on both sides at the moment of the move. Fetched when
  // the room is picked so the fields can prefill and the operator sees what is
  // being asked before they save.
  const [transferPreview, setTransferPreview] = useState<RoomTransferPreview | null>(null);
  // Whether the "is this move metered?" question is still unanswered. Save is
  // blocked while it is, because a null preview is indistinguishable from
  // "nothing is metered here" and would silently perform a bare room change.
  const [transferChecking, setTransferChecking] = useState(false);
  // Guards against an out-of-order response when the room is picked twice
  // quickly — only the latest request may write state.
  const transferReqRef = useRef(0);
  const [transferFromReading, setTransferFromReading] = useState("");
  // A move already saved this month that can still be re-priced. Fetched when the
  // edit dialog opens, because a mistyped meter reading used to be permanent and
  // the only repair was a hand-written SQL statement.
  const [correction, setCorrection] = useState<CorrectableTransfer | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctFrom, setCorrectFrom] = useState("");
  const [correctTo, setCorrectTo] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [transferToReading, setTransferToReading] = useState("");

  const [checkoutPendingPayment, setCheckoutPendingPayment] = useState<{ id: string; for_month: string; amount: number; amount_paid: number; status: PaymentStatus; ac_charge: number; ac_units_consumed: number | null; food_charge: number; security_deposit_charge: number; registration_fee_charge: number; ac_maintenance_charge: number; late_fee: number; discount_percent: number; referral_percent: number; carried_ac_charge?: number } | null>(null);
  const [checkoutPaymentLoading, setCheckoutPaymentLoading] = useState(false);
  const [checkoutPaymentError, setCheckoutPaymentError] = useState<string | null>(null);
  const [checkoutPayAction, setCheckoutPayAction] = useState<"pay" | "waive">("pay");
  // RULE 2 opt-in. MUST default false: an owner who clicks straight through gets
  // the full month, exactly as before.
  // Defaults to ON: rent is collected in advance for the period ahead, so a
  // tenant who leaves on their own next payment date has slept 0 nights of it
  // and owes nothing for that month — only AC and the deposit settle. Charging
  // the full month by default produced a phantom "outstanding" for money the
  // tenant was never going to owe. The owner can still switch to Full month.
  const [checkoutProRate, setCheckoutProRate] = useState(true);
  const [checkoutPayDate, setCheckoutPayDate] = useState(formatDateInput(new Date()));
  const [checkoutPayMethod, setCheckoutPayMethod] = useState<string>("cash");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutDepositReturned, setCheckoutDepositReturned] = useState("");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutACReading, setCheckoutACReading] = useState("");
  const [checkoutACOpeningReading, setCheckoutACOpeningReading] = useState("");
  const [checkoutACContext, setCheckoutACContext] = useState<{
    prevMonthReading: number | null;
    prevMonthUnits: number | null;
    currentMonthReading: number | null;
    currentMonthUnits: number | null;
    /** That reading was taken while the room stood empty — an opening, not this
     *  tenant's departure reading. */
    currentMonthVacant?: boolean;
    perUnitRate: number;
    activeTenantCount: number;
    priorCheckoutUnits: number[];
    joiners: { tenantId: string; unitsAtJoin: number | null; joiningMeterReading: number | null }[];
    derivedOpening: number | null;
    eligibleTenants: { id: string; check_in: string; joining_meter_reading: number | null }[];
    joinReadingsRaw: { tenant_id: string; units_at_join: number }[];
    checkoutReadingsRaw: { meter_reading: number; tenant_count_at_checkout: number; tenant_id: string | null }[];
  } | null>(null);
  const [checkoutACContextLoading, setCheckoutACContextLoading] = useState(false);
  const [shareReceipt, setShareReceipt] = useState<{ name: string; phone: string | null; token: string } | null>(null);
  const [shareLinkDialog, setShareLinkDialog] = useState(false);
  const [shareLinkPhone, setShareLinkPhone] = useState("");
  const [formQrDataUrl, setFormQrDataUrl] = useState<string | null>(null);
  const [formQrGenerating, setFormQrGenerating] = useState(false);
  const [formQrDownloading, setFormQrDownloading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  // Prefills the name the referral was submitted under. Only when the field is
  // still empty — the operator's own typing always wins, and a person may well
  // introduce themselves differently to how their friend wrote them down.
  const prefillReferredName = useCallback((name: string) => {
    setForm((f) => (f.full_name.trim() ? f : { ...f, full_name: name }));
  }, []);
  const [saving, setSaving] = useState(false);
  // Held until the tenant row exists: on Add there is no id to attach a photo
  // to until the insert returns, so the file waits here and uploads after.
  const [joiningPhotoFile, setJoiningPhotoFile] = useState<File | null>(null);
  // Advisory RedFlag warning. `source` records which flow was interrupted so
  // "Add Anyway" resumes exactly that one — the manual Add dialog or an
  // application approval.
  const [redflagPrompt, setRedflagPrompt] = useState<{ source: "save" | "approve"; matches: RedflagMatch[] } | null>(null);
  const [redflagChecking, setRedflagChecking] = useState(false);
  // Set when the registry could not answer (budget spent, timeout, outage). The
  // add still proceeds -- the check is advisory -- but the operator is told it
  // did not run, because a silent empty result reads as "clean".
  const [redflagUnavailable, setRedflagUnavailable] = useState(false);
  const [deleteTenant, setDeleteTenant] = useState<Tenant | null>(null);
  // Which tenant the open delete dialog is asking about. A ref, not the state
  // above, because the in-flight money lookup has to be matched against it from
  // outside a render — reading it through a state updater would mean calling
  // setState from inside one.
  const deleteTenantIdRef = useRef<string | null>(null);
  // Money already recorded against the tenant being deleted. Deleting cascades
  // their payment rows away, and every month they were counted in silently
  // drops — so the confirm dialog has to name the figure before it is agreed to.
  // `null` = still being read; the confirm button waits for it rather than
  // letting the warning arrive after the click it exists to inform.
  const [deleteMoney, setDeleteMoney] = useState<{ total: number; byMonth: { month: string; amount: number }[] } | null>(null);
  const [deleteMoneyError, setDeleteMoneyError] = useState<string | null>(null);
  const [pkgPrices, setPkgPrices] = useState<Partial<Record<PackageTier, PackagePrices>>>({});
  const [customPackages, setCustomPackages] = useState<CustomPackage[]>([]);
  const [configSecurityDeposit, setConfigSecurityDeposit] = useState<number>(0);
  const [configRegistrationFee, setConfigRegistrationFee] = useState<number>(0);
  const [configAcMaintenance, setConfigAcMaintenance] = useState<number>(0);
  const [seaterPrices, setSeaterPrices] = useState<SeaterPrices>({});
  const [washroomPremium, setWashroomPremium] = useState<number>(0);
  const [foodAddonRates, setFoodAddonRates] = useState<FoodAddonRates>(
    initialFoodAddonRates ?? { food_breakfast_rate: 0, food_lunch_rate: 0, food_dinner_rate: 0, food_all_meals_rate: 0 }
  );
  const [foodMonthlyRate, setFoodMonthlyRate] = useState<number>(initialFoodMonthlyRate ?? 0);

  // Single place that maps an hms_package_configs row onto the pricing state,
  // so the server-seeded (manager) and browser-fetched (owner/partner) paths
  // can never drift apart.
  const applyPackageConfig = useCallback((data: Record<string, unknown>) => {
    if (data.package_prices) {
      const raw = data.package_prices as Record<string, unknown>;
      setPkgPrices(raw as Partial<Record<PackageTier, PackagePrices>>);
      const custom = (raw._custom ?? []) as Array<{
        id: string; name: string; no_ac: number; ac: number;
        deposit_no_ac?: number; deposit_ac?: number;
      }>;
      setCustomPackages(custom
        .filter((c) => c.name)
        .map((c) => ({
          id: c.id,
          name: c.name,
          no_ac: c.no_ac ?? 0,
          ac: c.ac ?? 0,
          deposit_no_ac: c.deposit_no_ac ?? 0,
          deposit_ac: c.deposit_ac ?? 0,
        })));
    }
    if (data.security_deposit) setConfigSecurityDeposit(Number(data.security_deposit));
    if (data.registration_fee) setConfigRegistrationFee(Number(data.registration_fee));
    if (data.ac_maintenance_rate) setConfigAcMaintenance(Number(data.ac_maintenance_rate));
    if (data.seater_prices) setSeaterPrices(data.seater_prices as SeaterPrices);
    setWashroomPremium(Number(data.washroom_premium ?? 0));
    setFoodAddonRates({
      food_breakfast_rate: Number(data.food_breakfast_rate ?? 0),
      food_lunch_rate: Number(data.food_lunch_rate ?? 0),
      food_dinner_rate: Number(data.food_dinner_rate ?? 0),
      food_all_meals_rate: Number(data.food_all_meals_rate ?? 0),
    });
    setFoodMonthlyRate(Number(data.food_monthly_rate ?? 0));
  }, []);

  useEffect(() => {
    if (!hostelId) return;

    // Managers have no RLS grant on hms_package_configs (by design — migration
    // 051), so this browser-client read returns nothing for them and every
    // suggested rate silently falls back to 0 / a hardcoded 10000 deposit. The
    // portal fetches the config server-side with the admin client and hands it
    // in, so seed from that instead of fetching.
    if (initialPackageConfig) {
      applyPackageConfig(initialPackageConfig as unknown as Record<string, unknown>);
      return;
    }

    const supabase = createClient();
    supabase.from("hms_package_configs")
      .select("package_prices, security_deposit, registration_fee, ac_maintenance_rate, seater_prices, washroom_premium, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, food_monthly_rate")
      .eq("hostel_id", hostelId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) applyPackageConfig(data as Record<string, unknown>);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostelId, initialPackageConfig]);
  const [viewOnly, setViewOnly] = useState(false);
  const [customSpecialization, setCustomSpecialization] = useState(false);
  const [customInstitute, setCustomInstitute] = useState(false);
  const [customDepartment, setCustomDepartment] = useState(false);
  const [customApproveDepartment, setCustomApproveDepartment] = useState(false);
  const [customOrganization, setCustomOrganization] = useState(false);
  const [customApproveOrganization, setCustomApproveOrganization] = useState(false);
  const [appActionLoading, setAppActionLoading] = useState<string | null>(null);
  const [approvingApp, setApprovingApp] = useState<TenantApplication | null>(null);
  const [approveForm, setApproveForm] = useState<ConvertFormData>({
    type: "student",
    package_tier: "space_only",
    billing_type: "monthly",
    monthly_rent: 0,
    discount_percent: null,
    daily_rate: 0,
    security_deposit: 0,
    registration_fee: 0,
    vehicle_type: null,
    vehicle_number: null,
    vehicle_model: null,
    check_in: formatDateInput(new Date()),
    room_id: null,
    bed_number: null,
    is_waiting: true,
    notes: null,
    joining_meter_reading: null,
    food_breakfast: false,
    food_lunch: false,
    food_dinner: false,
    emergency_contact: null,
    emergency_phone: null,
    emergency_relationship: null,
    permanent_address: null,
    father_name: null,
    purpose_of_visit: null as VisitPurpose | null,
    purpose_of_visit_detail: null,
    institute_name: null,
    student_category: null,
    student_specialization: null,
    organization: null,
    organization_type: null,
    department: null,
  });
  const [approveSaving, setApproveSaving] = useState(false);
  const [editingDocs, setEditingDocs] = useState<TenantDocument[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "student" | "professional" | "general">("all");
  const [depositFilter, setDepositFilter] = useState(false);
  const [noticeFilter, setNoticeFilter] = useState(false);
  const [roomFilter, setRoomFilter] = useState<string>("all"); // room_id or "all"
  const [exportLoading, setExportLoading] = useState<"excel" | "pdf" | null>(null);
  const [printingForm, setPrintingForm] = useState<string | null>(null);

  /**
   * The admission form, pre-filled and sent straight to the print dialog.
   *
   * Gated exactly like onView at every call site. The form carries CNIC, the
   * permanent address, the father's name and the emergency contact — the same
   * data the tenant detail dialog withholds from a manager who lacks
   * edit_members. Ungated, this button was a printable route around that.
   *
   * The room number is resolved here rather than inside the generator: the row
   * already holds roomMap, and the PDF has no business knowing how this page
   * stores rooms.
   */
  async function handlePrintForm(t: Tenant) {
    setPrintingForm(t.id);
    try {
      const { printTenantForm } = await import("@/lib/tenant-form-pdf");
      const room = t.room_id ? roomMap[t.room_id] : null;
      await printTenantForm(
        {
          ...t,
          bed_number: [room?.room_number ? `Room ${room.room_number}` : null, t.bed_number]
            .filter(Boolean)
            .join(" · ") || null,
          // Same rule the payment trigger applies: the branch rate, but only
          // for a room that actually has AC.
          ac_maintenance: room?.has_ac ? acMaintenanceRate : 0,
        },
        {
          name: hostelName || "Hostel",
          noticePeriodDays,
          mealTimes,
        }
      );
    } catch {
      toast({
        title: "Could not print",
        description: "The form could not be generated. Try again.",
        variant: "destructive",
      });
    } finally {
      setPrintingForm(null);
    }
  }
  const [depositDialogTenant, setDepositDialogTenant] = useState<Tenant | null>(null);
  const [depositForm, setDepositForm] = useState({ amount: "", date: formatDateInput(new Date()), method: "cash" as PaymentMethod, notes: "" });
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [noticeDialogTenant, setNoticeDialogTenant] = useState<Tenant | null>(null);
  const [noticeDate, setNoticeDate] = useState("");
  const [noticeSubmitting, setNoticeSubmitting] = useState(false);

  // Rooms with remaining capacity
  // A metered side with an empty box is refused by the server anyway; blocking
  // it here keeps the operator from discovering that only after the closing
  // reading has already been written and rolled back.
  // A destination with no opening reading for this month is refused by the server
  // — Save stays disabled rather than letting the operator fill the form first.
  const transferBlocked = !!transferPreview?.toBlocked;
  const transferReadingsMissing = !!transferPreview && (
    (transferPreview.fromMetered && transferFromReading.trim() === "") ||
    (transferPreview.toMetered && transferToReading.trim() === "")
  );

  const availableRooms = useMemo(
    () => rooms.filter((r) => r.status !== "maintenance" && r.occupied < r.capacity),
    [rooms]
  );

  async function reload() {
    // A manager's client SDK session has no RLS grants — this query returns
    // nothing and would silently blank the list. Re-render the server component
    // instead, which refetches through the admin-client portal data layer.
    if (isManager) { router.refresh(); return; }
    if (!hostelId) return;
    const supabase = createClient();
    const [{ data: tenants }, { data: rms }] = await Promise.all([
      supabase.from("hms_tenants").select("*").eq("hostel_id", hostelId).order("created_at", { ascending: false }),
      supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number"),
    ]);
    const all = (tenants ?? []) as Tenant[];
    setActive(all.filter((t) => t.is_active && !t.is_waiting));
    setWaiting(all.filter((t) => t.is_waiting));
    setCheckedOut(all.filter((t) => !t.is_active && !t.is_waiting));
    setRooms(sortRooms((rms ?? []) as Room[]));

    // The owner writes tenants straight from the browser, so no server action
    // ever runs revalidatePath for them and OTHER routes keep serving their
    // cached RSC payload. Navigating to Payments after adding a tenant showed
    // the pre-add page until a manual refresh. router.refresh() invalidates the
    // client Router Cache, so the next navigation re-renders Payments on the
    // server — which is also what generates the new tenant's payment row.
    router.refresh();
  }

  async function reloadApplications() {
    // Same RLS blind spot as reload() — a manager read here returns [] and
    // would wipe the applications list that was server-rendered.
    if (isManager) { router.refresh(); return; }
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("hms_tenant_applications")
      .select("*")
      .eq("hostel_id", hostelId)
      .order("applied_at", { ascending: false });
    setApplications((data ?? []) as TenantApplication[]);
  }

  async function handleRejectApp(appId: string) {
    setAppActionLoading(appId);
    const result = await updateApplicationStatus(appId, "rejected");
    if (result.success) {
      toast({ title: "Application rejected" });
      await reloadApplications();
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
    setAppActionLoading(null);
  }

  function openApproveDialog(app: TenantApplication) {
    setApprovingApp(app);
    // Prefer the verified room_id FK captured by the join form — trust it over the
    // free-text room_preference string, which only exists for legacy applications
    // submitted before room selection was added to the join form.
    const rawMatchedRoom = app.room_id
      ? rooms.find((r) => r.id === app.room_id) ?? null
      : app.room_preference
      ? rooms.find((r) => r.room_number === app.room_preference) ?? null
      : null;
    // A room that filled up or went into maintenance between application and approval
    // must not be silently auto-activated — fall back to the waitlist so staff notice
    // and pick a new room.
    const matchedRoom = rawMatchedRoom && rawMatchedRoom.status !== "maintenance" && rawMatchedRoom.capacity - rawMatchedRoom.occupied > 0
      ? rawMatchedRoom
      : null;
    const tier = app.package_tier ?? "space_only";
    setApproveForm({
      type: app.type ?? matchedRoom?.type ?? "student",
      package_tier: tier,
      billing_type: "monthly",
      monthly_rent: matchedRoom ? getSuggestedRent(matchedRoom, tier, pkgPrices, seaterPrices, washroomPremium) : 0,
      // Explicit, so approving a second applicant after a discounted one can
      // never inherit their concession.
      discount_percent: null,
      daily_rate: 0,
      security_deposit: matchedRoom
        ? getSuggestedDeposit(matchedRoom, tier, pkgPrices, seaterPrices, configSecurityDeposit)
        : (configSecurityDeposit > 0 ? configSecurityDeposit : 10000),
      registration_fee: configRegistrationFee > 0 ? configRegistrationFee : 0,
      vehicle_type: null,
      vehicle_number: null,
      vehicle_model: null,
      check_in: app.move_in_date ?? formatDateInput(new Date()),
      room_id: matchedRoom?.id ?? null,
      bed_number: null,
      is_waiting: matchedRoom === null, // auto-switch to Active if room found
      notes: app.notes ?? null,
      joining_meter_reading: null,
      food_breakfast: app.food_breakfast ?? false,
      food_lunch: app.food_lunch ?? false,
      food_dinner: app.food_dinner ?? false,
      emergency_contact: app.emergency_contact ?? null,
      emergency_phone: app.emergency_phone ?? null,
      emergency_relationship: app.emergency_relationship ?? null,
      permanent_address: app.permanent_address ?? null,
      father_name: app.father_name ?? null,
      purpose_of_visit: app.purpose_of_visit ?? null,
      purpose_of_visit_detail: app.purpose_of_visit_detail ?? null,
      institute_name: app.institute_name ?? null,
      student_category: app.student_category ?? null,
      student_specialization: app.student_specialization ?? null,
      organization: app.organization ?? null,
      organization_type: app.organization_type ?? null,
      department: app.department ?? null,
    });
    const presets = app.student_category && studentCategoryHasSpecialization(app.student_category)
      ? STUDENT_SPECIALIZATION_PRESETS[app.student_category]
      : [];
    setCustomSpecialization(!!app.student_specialization && !presets.includes(app.student_specialization));
    const institutePresets = app.student_category && studentCategoryHasInstitutePresets(app.student_category)
      ? INSTITUTE_PRESETS_BY_CATEGORY[app.student_category]
      : [];
    setCustomInstitute(!!app.institute_name && !institutePresets.includes(app.institute_name));
    // A department saved before this list existed (or a genuine 'Other') opens
    // in free-text mode with the stored value intact, not an empty dropdown.
    setCustomApproveDepartment(!!app.department && !departmentPresetsFor(app.type ?? "").includes(app.department));
    setCustomApproveOrganization(!!app.organization && !organizationPresetsFor(app.organization_type).includes(app.organization));
  }

  // Mirrors the Add/Edit dialog's renderInstituteField, scoped to the Approve
  // Application dialog's own form/state so an owner can review and correct the
  // data an applicant submitted before activating them.
  const approveCategory = (approveForm.student_category ?? "") as "" | StudentCategory;
  const approveOrgType = (approveForm.organization_type ?? "") as "" | "private" | "government";
  function renderApproveInstituteField() {
    if (!studentCategoryHasInstitutePresets(approveCategory)) {
      return (
        <Input
          placeholder="Academy or institute name"
          value={approveForm.institute_name ?? ""}
          onChange={(e) => setApproveForm({ ...approveForm, institute_name: e.target.value })}
        />
      );
    }
    if (customInstitute) {
      return (
        <div className="flex gap-2">
          <Input
            placeholder={approveCategory === "college" ? "College name" : approveCategory === "university" ? "University name" : "Academy or institute name"}
            value={approveForm.institute_name ?? ""}
            onChange={(e) => setApproveForm({ ...approveForm, institute_name: e.target.value })}
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9 text-xs"
            onClick={() => { setCustomInstitute(false); setApproveForm({ ...approveForm, institute_name: "" }); }}
          >
            Choose from list
          </Button>
        </div>
      );
    }
    return (
      <SearchableSelect
        value={approveForm.institute_name ?? ""}
        onValueChange={(v) => {
          if (v === "other") {
            setCustomInstitute(true);
            setApproveForm({ ...approveForm, institute_name: "" });
          } else {
            setApproveForm({ ...approveForm, institute_name: v });
          }
        }}
        options={INSTITUTE_PRESETS_BY_CATEGORY[approveCategory]}
        searchPlaceholder={approveCategory === "college" ? "Search colleges..." : approveCategory === "university" ? "Search universities..." : "Search institutes..."}
        otherLabel="Other (specify)"
      />
    );
  }

  async function handleApproveApp() {
    await performApprove(false);
  }

  // `ignoreRedflag` is set only by "Add Anyway" on the warning dialog. The
  // approver cannot edit the applicant's CNIC/phone, so the check runs
  // server-side against the application row inside convertToTenant.
  async function performApprove(ignoreRedflag: boolean) {
    if (!approvingApp) return;
    setApproveSaving(true);
    const result = await convertToTenant(approvingApp.id, {
      ...approveForm,
      // Empty string, not undefined, is what a cleared input produces — and
      // convertToTenant falls back to the application's value with `??`, which
      // only catches null/undefined. Without this, clearing a wrong emergency
      // phone would store "" rather than actually clearing it.
      father_name: approveForm.father_name?.trim() || null,
      purpose_of_visit: approveForm.purpose_of_visit || null,
      purpose_of_visit_detail:
        approveForm.purpose_of_visit === "other" ? approveForm.purpose_of_visit_detail?.trim() || null : null,
      emergency_contact: approveForm.emergency_contact?.trim() || null,
      emergency_phone: approveForm.emergency_phone?.trim() || null,
      emergency_relationship: approveForm.emergency_relationship?.trim() || null,
      permanent_address: approveForm.permanent_address?.trim() || null,
      institute_name: approveForm.type === "student" ? (approveForm.institute_name || null) : null,
      student_category: approveForm.type === "student" ? (approveForm.student_category || null) : null,
      student_specialization: approveForm.type === "student" && studentCategoryHasSpecialization(approveCategory) ? (approveForm.student_specialization || null) : null,
      organization: approveForm.type === "professional" ? (approveForm.organization || null) : null,
      organization_type: approveForm.type === "professional" ? (approveForm.organization_type || null) : null,
      department: approveForm.type === "professional" || (approveForm.type === "student" && studentCategoryHasDepartment(approveCategory)) ? (approveForm.department || null) : null,
    }, { ignoreRedflag });
    if (result.success) {
      // The approval went through either way, but if the registry never
      // answered, say so here — the approver has no other signal, and silence
      // on this screen means "clean".
      toast(
        result.redflagUnavailable
          ? {
              title: "Added — RedFlag not checked",
              description: `${approvingApp.full_name} has been added, but the defaulter registry could not be reached, so they were not verified.`,
            }
          : {
              title: approveForm.is_waiting ? "Added to waiting list" : "Tenant activated",
              description: `${approvingApp.full_name} has been added.`,
            }
      );
      setApprovingApp(null);
      await Promise.all([reload(), reloadApplications()]);
    } else if (result.redflagWarning && result.redflagWarning.length > 0) {
      setRedflagPrompt({ source: "approve", matches: result.redflagWarning });
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
    setApproveSaving(false);
  }

  function openAdd() {
    setEditing(null);
    setViewOnly(false);
    setJoiningPhotoFile(null);
    setForm({
      ...emptyForm,
      security_deposit: configSecurityDeposit > 0 ? String(configSecurityDeposit) : "",
      registration_fee: configRegistrationFee > 0 ? String(configRegistrationFee) : "",
    });
    setEditingDocs([]);
    setCustomSpecialization(false);
    setCustomInstitute(false);
    setCustomDepartment(false);
    setCustomOrganization(false);
    setDialogOpen(true);
  }

  function openView(t: Tenant) {
    openEdit(t);
    setViewOnly(true);
  }

  function openEdit(t: Tenant, forceActive = false) {
    setEditing(t);
    setViewOnly(false);
    setCorrection(null);
    setCorrectionOpen(false);
    getRoomTransferCorrectionAction(t.id)
      .then((r) => {
        if (r.correction) {
          setCorrection(r.correction);
          setCorrectFrom(String(r.correction.fromRoomReading));
          setCorrectTo(r.correction.toRoomReading != null ? String(r.correction.toRoomReading) : "");
        }
      })
      .catch(() => {/* the panel simply does not appear */});
    setJoiningPhotoFile(null);
    setEditingDocs(t.documents ?? []);
    setForm({
      full_name: t.full_name,
      phone: t.phone ?? "",
      email: t.email ?? "",
      cnic: t.cnic ?? "",
      type: t.type,
      package_tier: t.package_tier ?? "space_only",
      custom_package_id: t.custom_package_id ?? null,
      room_id: t.room_id ?? "",
      bed_number: t.bed_number ?? "",
      check_in: t.check_in ?? formatDateInput(new Date()),
      billing_type: t.billing_type ?? "monthly",
      monthly_rent: t.monthly_rent.toString(),
      daily_rate: t.daily_rate?.toString() ?? "0",
      discount_percent: t.discount_percent != null ? t.discount_percent.toString() : "",
      check_out: t.check_out ?? "",
      security_deposit: t.security_deposit?.toString() ?? "0",
      registration_fee: t.registration_fee?.toString() ?? "",
      ac_maintenance: t.ac_maintenance?.toString() ?? "",
      vehicle_type: t.vehicle_type ?? "",
      vehicle_number: t.vehicle_number ?? "",
      vehicle_model: t.vehicle_model ?? "",
      joining_meter_reading: t.joining_meter_reading?.toString() ?? "",
      emergency_contact: t.emergency_contact ?? "",
      emergency_relationship: t.emergency_relationship ?? "",
      permanent_address: t.permanent_address ?? "",
      father_name: t.father_name ?? "",
      purpose_of_visit: t.purpose_of_visit ?? "",
      purpose_of_visit_detail: t.purpose_of_visit_detail ?? "",
      emergency_phone: t.emergency_phone ?? "",
      notes: t.notes ?? "",
      is_waiting: forceActive ? false : t.is_waiting,
      photo_url: t.photo_url ?? "",
      food_breakfast: t.food_breakfast ?? false,
      food_lunch: t.food_lunch ?? false,
      food_dinner: t.food_dinner ?? false,
      institute_name: t.institute_name ?? "",
      student_category: t.student_category ?? "",
      student_specialization: t.student_specialization ?? "",
      organization: t.organization ?? "",
      organization_type: t.organization_type ?? "",
      department: t.department ?? "",
    });
    const presets = t.student_category && studentCategoryHasSpecialization(t.student_category)
      ? STUDENT_SPECIALIZATION_PRESETS[t.student_category]
      : [];
    setCustomSpecialization(!!t.student_specialization && !presets.includes(t.student_specialization));
    const institutePresets = t.student_category && studentCategoryHasInstitutePresets(t.student_category)
      ? INSTITUTE_PRESETS_BY_CATEGORY[t.student_category]
      : [];
    setCustomInstitute(!!t.institute_name && !institutePresets.includes(t.institute_name));
    setCustomDepartment(!!t.department && !departmentPresetsFor(t.type ?? "").includes(t.department));
    setCustomOrganization(!!t.organization && !organizationPresetsFor(t.organization_type).includes(t.organization));
    setDialogOpen(true);
  }

  // Institute Name — rendered right after Student Category for University/College
  // (no Specialization step to sequence after), or right after Specialization for
  // Test Preparation/Professional Course/Skills Training (pick what you're doing
  // before where — matches how someone would naturally answer these questions).
  function renderInstituteField() {
    if (!studentCategoryHasInstitutePresets(form.student_category)) {
      return (
        <Input
          placeholder="Academy or institute name"
          value={form.institute_name}
          onChange={(e) => setForm({ ...form, institute_name: e.target.value })}
        />
      );
    }
    if (customInstitute) {
      return (
        <div className="flex gap-2">
          <Input
            placeholder={form.student_category === "college" ? "College name" : form.student_category === "university" ? "University name" : "Academy or institute name"}
            value={form.institute_name}
            onChange={(e) => setForm({ ...form, institute_name: e.target.value })}
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9 text-xs"
            onClick={() => { setCustomInstitute(false); setForm({ ...form, institute_name: "" }); }}
          >
            Choose from list
          </Button>
        </div>
      );
    }
    return (
      <SearchableSelect
        value={form.institute_name}
        onValueChange={(v) => {
          if (v === "other") {
            setCustomInstitute(true);
            setForm({ ...form, institute_name: "" });
          } else {
            setForm({ ...form, institute_name: v });
          }
        }}
        options={INSTITUTE_PRESETS_BY_CATEGORY[form.student_category]}
        searchPlaceholder={form.student_category === "college" ? "Search colleges..." : form.student_category === "university" ? "Search universities..." : "Search institutes..."}
        otherLabel="Other (specify)"
      />
    );
  }

  // Advisory only. Returns the unresolved reports worth warning about, and an
  // empty list for anything else. A RedFlag outage must never stop a tenant
  // being added, so no failure here is propagated.
  //
  // It does, however, record WHY the list is empty. "No reports" and "the
  // registry could not answer" are the same value but opposite meanings, and
  // showing the second as the first quietly tells the operator that someone is
  // clean when nobody actually looked.
  async function liveRedflagMatches(cnic: string, phone: string): Promise<RedflagMatch[]> {
    setRedflagUnavailable(false);
    if (!cnic && !phone) return [];
    try {
      const result = await checkTenantRedflagAction({ cnic: cnic || undefined, phone: phone || undefined });
      // Any error at all means nobody looked — not just the two the action
      // labels `degraded`. An expired session, an unreachable DB or a thrown
      // fetch all return a bare { error }, and treating those as "no reports"
      // is the failure this whole function exists to prevent.
      if (result.degraded || result.error) setRedflagUnavailable(true);
      if (result.error || !result.matches) return [];
      return result.matches.filter((m) => m.status === "reported");
    } catch {
      setRedflagUnavailable(true);
      return [];
    }
  }

  // Guard half. Everything that can reject the input lives here; the write
  // itself is performSave(), which "Add Anyway" calls directly so an
  // acknowledged RedFlag warning is not re-raised.
  async function handleSave() {
    if ((!hostelId && !isManager) || !form.full_name) return;
    if (!form.is_waiting && !form.check_in) return;
    if (form.cnic && !isValidCnic(form.cnic)) {
      toast({ title: "Invalid CNIC", description: "Format must be XXXXX-XXXXXXX-X (13 digits)", variant: "destructive" });
      return;
    }
    if (form.billing_type === "monthly" && form.discount_percent.trim()) {
      const pct = parseFloat(form.discount_percent);
      // The owner path writes straight to Postgres from here, so without this the
      // only thing standing in the way is the column's CHECK and the operator
      // gets a constraint dump instead of a sentence.
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        toast({ title: "Invalid discount", description: "Discount must be a percentage between 0 and 100.", variant: "destructive" });
        return;
      }
    }
    // Creates only — an owner editing an existing profile should not be
    // re-warned about a tenant they already accepted.
    if (!editing) {
      setRedflagChecking(true);
      const matches = await liveRedflagMatches(form.cnic, form.phone);
      setRedflagChecking(false);
      if (matches.length > 0) {
        setRedflagPrompt({ source: "save", matches });
        return;
      }
    }
    await performSave();
  }

  async function performSave() {
    setSaving(true);
    const supabase = createClient();

    const payload = {
      hostel_id: hostelId,
      full_name: form.full_name,
      phone: form.phone || null,
      email: form.email || null,
      cnic: normalizeCnic(form.cnic),
      type: form.type,
      package_tier: form.package_tier,
      custom_package_id: form.custom_package_id || null,
      room_id: form.is_waiting || !form.room_id ? null : form.room_id,
      bed_number: form.bed_number || null,
      // Was `is_waiting ? today : form.check_in`, which overwrote a pre-booked
      // member's joining date with today's on EVERY save — so an expected
      // joining date could never be stored, only guessed at. The column is NOT
      // NULL, hence the fallback rather than passing through an empty string.
      check_in: form.check_in || formatDateInput(new Date()),
      check_out: form.billing_type === "daily" && form.check_out ? form.check_out : null,
      billing_type: form.billing_type,
      monthly_rent: form.billing_type === "monthly" ? parseFloat(form.monthly_rent) || 0 : 0,
      daily_rate: form.billing_type === "daily" ? parseFloat(form.daily_rate) || 0 : 0,
      // Empty means NULL — no concession at all — not 0, so a tenant who has
      // never been given one stays out of the "who is on a discount" reports.
      discount_percent:
        form.billing_type === "monthly" && form.discount_percent.trim()
          ? parseFloat(form.discount_percent) || 0
          : null,
      security_deposit: parseFloat(form.security_deposit) || 0,
      registration_fee: parseFloat(form.registration_fee) || 0,
      ac_maintenance: form.ac_maintenance.trim() === "" ? null : (parseFloat(form.ac_maintenance) || 0),
      vehicle_type: form.vehicle_type.trim() || null,
      vehicle_number: form.vehicle_number.trim() || null,
      vehicle_model: form.vehicle_model.trim() || null,
      joining_meter_reading: form.joining_meter_reading.trim() ? parseFloat(form.joining_meter_reading) || null : null,
      emergency_contact: form.emergency_contact || null,
      emergency_relationship: form.emergency_relationship || null,
      permanent_address: form.permanent_address.trim() || null,
      father_name: form.father_name.trim() || null,
      purpose_of_visit: form.purpose_of_visit || null,
      // Cleared unless "Other" is selected, so a preset never carries a stale
      // description — same rule normalizeVisitPurpose applies server-side.
      purpose_of_visit_detail:
        form.purpose_of_visit === "other" ? form.purpose_of_visit_detail.trim() || null : null,
      emergency_phone: form.emergency_phone || null,
      notes: form.notes || null,
      is_waiting: form.is_waiting,
      is_active: !form.is_waiting,
      photo_url: form.photo_url || null,
      food_breakfast: form.food_breakfast,
      food_lunch: form.food_lunch,
      food_dinner: form.food_dinner,
      institute_name: form.type === "student" ? (form.institute_name || null) : null,
      student_category: form.type === "student" ? (form.student_category || null) : null,
      student_specialization: form.type === "student" && studentCategoryHasSpecialization(form.student_category) ? (form.student_specialization || null) : null,
      organization: form.type === "professional" ? (form.organization || null) : null,
      organization_type: form.type === "professional" ? (form.organization_type || null) : null,
      department: form.type === "professional" || (form.type === "student" && studentCategoryHasDepartment(form.student_category)) ? (form.department || null) : null,
    };

    // Staged move-in photo, for the paths that write the tenant through a server
    // action and return before the owner path's upload below. Both add actions
    // hand back tenantId, so a brand-new tenant gets its evidence too — without
    // this, a manager could record a reading and silently lose the photo.
    const uploadStagedJoiningPhoto = async (tenantId: string | null | undefined) => {
      if (!tenantId || !joiningPhotoFile) return;
      const fd = new FormData();
      fd.append("file", joiningPhotoFile);
      const res = await uploadJoiningMeterPhoto(tenantId, fd);
      if (res.error) {
        toast({ title: "Tenant saved, meter photo failed", description: res.error, variant: "destructive" });
      }
      setJoiningPhotoFile(null);
    };

    // ── Room transfer, BEFORE the tier branches ─────────────────────────
    // handleSave returns early for managers and for partners, so anything below
    // those branches never runs for them. The meter panel has no role gate and
    // the preview action serves managers explicitly, so leaving the transfer
    // further down meant a manager typed both readings, saw "Tenant updated",
    // and nothing was recorded — the exact silent misbilling this feature
    // exists to remove. transferTenantRoomAction authorises all three tiers
    // itself, so it runs here for everyone, and each tier's own room write is
    // suppressed below because the move has already happened.
    const prevRoomIdEarly = editing?.room_id;
    const isMeteredTransfer = !!(editing && transferPreview && prevRoomIdEarly && payload.room_id && prevRoomIdEarly !== payload.room_id);
    let transferOutcome: RoomTransferResult | null = null;
    if (isMeteredTransfer) {
      const parseReading = (v: string): number | null => {
        const t = v.trim();
        if (t === "") return null;
        const n = parseFloat(t);
        return Number.isFinite(n) ? n : null;
      };
      const res = await transferTenantRoomAction({
        tenantId: editing!.id,
        toRoomId: payload.room_id!,
        fromRoomReading: transferPreview!.fromMetered ? parseReading(transferFromReading) : null,
        toRoomReading: transferPreview!.toMetered ? parseReading(transferToReading) : null,
      });
      if (!res.success) {
        toast({ title: "Room transfer not saved", description: res.error, variant: "destructive" });
        setSaving(false);
        return;
      }
      transferOutcome = res.result!;
    }

    // Raised AFTER each tier's completion toast, deliberately. TOAST_LIMIT is 1
    // and ADD_TOAST slices, so a later toast REPLACES an earlier one — raising
    // this first meant "Tenant updated" evicted it every time, including the
    // warning branch, which is the only place the operator is told to go finish
    // the job under Mid-Month Joiners.
    const announceTransfer = () => {
      if (!transferOutcome) return;
      if (transferOutcome.warning) {
        toast({ title: "Moved — one thing left to finish", description: transferOutcome.warning, variant: "destructive" });
      } else if (transferOutcome.closedMeter && transferOutcome.closedCharge > 0) {
        toast({
          title: `Moved to room ${transferOutcome.toRoomNumber}`,
          description: `Room ${transferOutcome.fromRoomNumber}: ${transferOutcome.closedUnits} units (${formatCurrency(transferOutcome.closedCharge)}) billed up to the move.`,
        });
      }
    };

    if (isManager) {
      // The action re-resolves the branch server-side, so hostel_id/is_active are dropped.
      // room_id is left in the payload even after a transfer: the action reads
      // the tenant's CURRENT room to decide whether the room changed, and the
      // transfer has already moved them, so it correctly sees no change and
      // neither logs a second room_changed event nor re-adjusts occupancy.
      const { hostel_id: _mHostelId, is_active: _mIsActive, ...managerPayload } = payload;
      const result = editing
        ? await editTenantAsManager(editing.id, managerPayload)
        : await addTenantAsManager(managerPayload);
      if (result.error) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        setSaving(false);
        return;
      }
      toast({
        title: editing
          ? editing.is_waiting && !form.is_waiting ? `${form.full_name} activated` : "Tenant updated"
          : form.is_waiting ? "Added to waiting list" : "Tenant added",
      });
      await uploadStagedJoiningPhoto(editing ? editing.id : (result as { tenantId?: string }).tenantId);
      announceTransfer();
      setDialogOpen(false);
      // Managers have no RLS grants, so the client-SDK reload() below would come back
      // empty and blank the list. A full reload re-runs the server page, which reads
      // through the admin client.
      window.location.reload();
      return;
    }

    if (isPartner) {
      // The partner write action does everything the rest of this function
      // does client-side for an owner — insert/update, room occupancy,
      // ledger events, historical backfill — server-side in one call.
      // Same as the manager branch: the transfer already moved them, so this
      // action sees no room change and does not duplicate its side effects.
      const { hostel_id: _hostelId, is_active: _isActive, ...partnerPayload } = payload;
      const result = editing
        ? await editTenantAsPartner(editing.id, partnerPayload)
        : await addTenantAsPartner(partnerPayload);
      if (result.error) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        setSaving(false);
        return;
      }
      toast({
        title: editing
          ? editing.is_waiting && !form.is_waiting ? `${form.full_name} activated` : "Tenant updated"
          : form.is_waiting ? "Added to waiting list" : "Tenant added",
      });
      await uploadStagedJoiningPhoto(editing ? editing.id : (result as { tenantId?: string }).tenantId);
      announceTransfer();
      setDialogOpen(false);
      await reload();
      setSaving(false);
      return;
    }

    const prevRoomId = prevRoomIdEarly;
    const newRoomId = payload.room_id;

    let newTenantId: string | null = null;
    const { data: mutData, error } = editing
      ? await supabase.from("hms_tenants").update(payload).eq("id", editing.id).select("id").single()
      : await supabase.from("hms_tenants").insert(payload).select("id").single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    if (!editing) newTenantId = (mutData as { id: string } | null)?.id ?? null;

    // Referral attribution deliberately does NOT run here.
    //
    // It has to happen AFTER the historical back-fill further down, which writes
    // past months as `paid`. Attributing first grants the welcome discount, the
    // back-fill then settles a month it is sitting on, and the settlement trigger
    // retires the reward against a bill the tenant never actually paid — the
    // discount is spent before they see a real one. managers.ts and partner.ts
    // already run in the correct order; this path was the odd one out.
    //
    // It is also awaited rather than fire-and-forget, so the reward exists before
    // the dialog closes and the list reloads — otherwise the row can render
    // without its discount and look like the feature failed.
    const attributeIfNewAdmission = async () => {
      if (!editing && newTenantId && !form.is_waiting) {
        await attributeReferralForTenant(newTenantId);
        // Their own link, so the owner never hands one out by hand again.
        // Fire-and-forget: a marketing message must not delay this dialog, and
        // every gate is re-checked server-side at the moment of sending.
        void sendReferralLinkForTenant(newTenantId);
      }
    };

    // Fire-and-forget welcome WhatsApp — new active tenant, or a waiting-list
    // tenant getting activated (room finally assigned). Never awaited inline
    // so a slow/failed WhatsApp send can't delay this dialog closing.
    if (!editing && newTenantId && !form.is_waiting) {
      void sendTenantWelcomeMessageAction(newTenantId);
    } else if (editing && editing.is_waiting && !form.is_waiting) {
      void sendTenantWelcomeMessageAction(editing.id);
      // Activation is this person's real admission — until now they had no room
      // and no bill, so the add-tenant path deliberately skipped them and the
      // referral was simply lost. The server measures the 14-day deadline from
      // today, not from the date they were queued.
      await attributeReferralForTenant(editing.id);
      void sendReferralLinkForTenant(editing.id);
    }

    // Moving an already-active tenant back to the waiting list leaves behind
    // any payment row already generated for them — they were never actually
    // billable, unlike a genuinely checked-out tenant, so it must not linger
    // as a phantom due. Only ever touches this month/later, and only rows
    // nothing has been paid against yet — never paid/partially_paid/waived
    // history, which is real money already handled.
    if (editing && !editing.is_waiting && form.is_waiting) {
      const currentMonth = new Date().toISOString().slice(0, 7);
      await supabase.from("hms_payments")
        .delete()
        .eq("tenant_id", editing.id)
        .eq("hostel_id", hostelId ?? "")
        .gte("for_month", currentMonth)
        // A reservation deposit is always status 'paid', so the status filter
        // already excludes it — stated explicitly because that row is real
        // collected cash and must survive any future widening of this filter.
        .eq("is_reservation", false)
        .in("status", ["pending", "overdue"]);

      // DETACH, never void. Attribution is a one-shot pending->joined transition
      // that can never re-grant, so voiding here would destroy the reward for
      // good; detaching parks it unplaced and the reconciler re-places it if this
      // tenant is activated again. Goes through a server action because this file
      // runs in the browser and hms_referral_rewards has no `authenticated` grant.
      await detachReferralRewardsForTenant(editing.id, currentMonth);
    }

    // Log room/plan changes and deposit collection to the Member Ledger — best-effort,
    // never blocks the save itself. `hms_tenants.room_id`/`package_tier` are overwritten
    // in place above with no history kept, so this is the only place these are captured.
    const ledgerTenantId = editing ? editing.id : newTenantId;

    // Move-in meter photo staged in the dialog — upload now that a tenant id
    // exists. Awaited, unlike the ledger events below, because losing it means
    // losing the evidence for a reading the tenant is about to be billed from.
    if (ledgerTenantId && joiningPhotoFile) {
      const photoData = new FormData();
      photoData.append("file", joiningPhotoFile);
      const photoRes = await uploadJoiningMeterPhoto(ledgerTenantId, photoData);
      if (photoRes.error) {
        toast({ title: "Tenant saved, meter photo failed", description: photoRes.error, variant: "destructive" });
      }
      setJoiningPhotoFile(null);
    }

    if (ledgerTenantId) {
      // Skipped for a metered transfer: transferTenantRoomAction already wrote a
      // richer room_changed event carrying the meter readings and the charge.
      if (editing && prevRoomId !== newRoomId && !isMeteredTransfer) {
        const oldRoomLabel = prevRoomId ? rooms.find((r) => r.id === prevRoomId)?.room_number ?? "Unknown" : "None";
        const newRoomLabel = newRoomId ? rooms.find((r) => r.id === newRoomId)?.room_number ?? "Unknown" : "None";
        logTenantEvent({ tenantId: ledgerTenantId, eventType: "room_changed", fromValue: oldRoomLabel, toValue: newRoomLabel });
      }
      if (editing && editing.package_tier !== payload.package_tier) {
        logTenantEvent({ tenantId: ledgerTenantId, eventType: "plan_changed", fromValue: editing.package_tier ?? null, toValue: payload.package_tier });
      }
      if (!editing && payload.security_deposit > 0) {
        logTenantEvent({ tenantId: ledgerTenantId, eventType: "deposit_collected", amount: payload.security_deposit });
      }
    }

    // Update room occupancy counts
    if (!editing && newRoomId) {
      // New active tenant — increment room occupied
      const room = rooms.find((r) => r.id === newRoomId);
      if (room) {
        const newOccupied = room.occupied + 1;
        await supabase.from("hms_rooms").update({
          occupied: newOccupied,
          status: newOccupied >= room.capacity ? "occupied" : "available",
        }).eq("id", newRoomId);
      }
    } else if (editing && prevRoomId !== newRoomId && !isMeteredTransfer) {
      // Room changed — update both old and new.
      // Skipped for a metered transfer: the server action already recounted both
      // rooms from the tenant table, which is truth. Letting this run too would
      // apply a second -1/+1 on top of a count that is already correct.
      if (prevRoomId) {
        const oldRoom = rooms.find((r) => r.id === prevRoomId);
        if (oldRoom) {
          const newOcc = Math.max(0, oldRoom.occupied - 1);
          await supabase.from("hms_rooms").update({ occupied: newOcc, status: newOcc < oldRoom.capacity ? "available" : "occupied" }).eq("id", prevRoomId);
        }
      }
      if (newRoomId) {
        const newRoom = rooms.find((r) => r.id === newRoomId);
        if (newRoom) {
          const newOcc = newRoom.occupied + 1;
          await supabase.from("hms_rooms").update({ occupied: newOcc, status: newOcc >= newRoom.capacity ? "occupied" : "available" }).eq("id", newRoomId);
        }
      }
    }

    // Backfill past months as Paid (Cash) for historical tenants
    if (newTenantId && !form.is_waiting && form.check_in) {
      const checkInMonth = form.check_in.slice(0, 7);
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      if (checkInMonth < currentMonth) {
        const backfill = await backfillTenantPaymentsAction(newTenantId);
        if (backfill.success && (backfill.monthsCreated ?? 0) > 0) {
          // Inside the early-return branch too, or a tenant with back-filled
          // history silently loses their referral.
          await attributeIfNewAdmission();
          toast({
            title: "Tenant added",
            description: `${backfill.monthsCreated} past month${backfill.monthsCreated === 1 ? "" : "s"} recorded as Paid (Cash).`,
          });
          setDialogOpen(false);
          await reload();
          setSaving(false);
          return;
        }
      }
    }

    await attributeIfNewAdmission();

    toast({
      title: editing
        ? editing.is_waiting && !form.is_waiting
          ? `${form.full_name} activated`
          : "Tenant updated"
        : form.is_waiting
          ? "Added to waiting list"
          : "Tenant added",
    });
    announceTransfer();
    setDialogOpen(false);
    await reload();
    setSaving(false);
  }

  function resetCheckoutState() {
    setCheckingOut(null);
    setCheckoutDate(formatDateInput(new Date()));
    setCheckoutPendingPayment(null);
    setCheckoutPaymentLoading(false);
    setCheckoutPaymentError(null);
    setCheckoutPayAction("pay");
    setCheckoutProRate(false);
    setCheckoutPayDate(formatDateInput(new Date()));
    setCheckoutPayMethod("cash");
    setCheckoutNotes("");
    setCheckoutDepositReturned("");
    setCheckoutSubmitting(false);
    setCheckoutACReading("");
    setCheckoutACOpeningReading("");
    setCheckoutACContext(null);
    setCheckoutACContextLoading(false);
  }

  // Bundles all checkout-dialog setup so TenantRow (module scope) can call a single callback.
  // The actual outstanding-payment/AC-context fetches are left to the effect
  // below, which reacts to checkoutDate too — a backdated checkout (recording
  // a departure that already happened, common when this is entered a few
  // days late) needs both to reflect the typed Departure Date, not whatever
  // date happened to be "today" when the dialog was first opened.
  function openCheckout(t: Tenant) {
    const today = formatDateInput(new Date());
    setCheckingOut(t);
    setCheckoutDate(t.intended_checkout_date ?? today);
    setCheckoutPayDate(today);
    setCheckoutPayAction("pay");
    setCheckoutProRate(true);
    setCheckoutPayMethod("cash");
    // Left to the checkoutMath effect, which nets the dues off first.
    setCheckoutDepositReturned("");
    setCheckoutACReading("");
    setCheckoutACOpeningReading("");
  }

  // Re-fetches whenever the tenant being checked out changes OR the Departure
  // Date field is edited — both the outstanding-payment lookup and the AC
  // context are month-scoped to whatever date is actually in that field, not
  // to "today". Without this, editing the date after the dialog opens (e.g.
  // correcting it to a past date) left both fetches stuck on the month the
  // dialog happened to open in.
  useEffect(() => {
    if (!checkingOut || !checkoutDate) return;
    const month = checkoutDate.slice(0, 7);

    setCheckoutPendingPayment(null);
    setCheckoutPaymentError(null);
    setCheckoutPaymentLoading(true);
    // Bounded to the departure month — a tenant paying in advance already has
    // next month's row sitting there as "pending" simply because it isn't due
    // yet, not because anything is actually owed. Without this bound, the
    // latest-for_month row wins regardless of whether it's in the future, and
    // checkout tries to collect an advance payment nobody actually owes.
    fetchCheckoutPayment(checkingOut.id, month);

    const room = checkingOut.room_id ? roomMap[checkingOut.room_id] : null;
    if (room?.has_ac || meterAllRooms) {
      setCheckoutACContextLoading(true);
      setCheckoutACContext(null);
      getACCheckoutContextAction(checkingOut.room_id!, month).then((ctx) => {
        if (!ctx.error) {
          setCheckoutACContext(ctx);
          // Already entered this month via the AC Units tab — default to it
          // instead of leaving the field blank for a re-type of a number
          // that's already on file. Only when the operator hasn't already
          // typed something themselves, so re-fetching on a date edit doesn't
          // clobber a value they just entered.
          // NOT pre-filled, deliberately. This used to default to the reading the
          // AC Units tab had already applied for the room, on the reasoning that
          // the operator often reads the meter and checks someone out the same
          // day. That was harmless while the departure reading was discarded
          // whenever it did not exceed what Apply had billed — it changed no
          // money either way. It is not harmless now that the reading prices the
          // departure: accepting the default records the member as present until
          // the room's month-end reading, which for anyone who left earlier in
          // the month is simply false, and bills them for units burned after they
          // had gone. Same trap as the room-transfer panel's prefill, and the
          // same answer — the number is shown underneath for reference, and the
          // operator types what the meter read when they actually walked out.

          // Same treatment for the OPENING reading. It was shown only as a
          // placeholder, so the operator saw a greyed-out number in an empty box
          // while the departure field directly below it carried a real value —
          // two fields, same kind of number, filled two different ways.
          //
          // Only when there is no previous-month record: with one, the server
          // uses it and the dialog shows it as text with no box to fill. Same
          // priority order as checkoutMath and the hint below the field, so the
          // number in the box is the number the estimate is computed from.
          if (ctx.prevMonthReading == null) {
            const impliedOpening =
              ctx.currentMonthReading != null && ctx.currentMonthUnits != null
                ? ctx.currentMonthReading - ctx.currentMonthUnits
                : null;
            const suggested = impliedOpening ?? ctx.derivedOpening ?? null;
            if (suggested != null) {
              setCheckoutACOpeningReading((prev) => (prev === "" ? String(suggested) : prev));
            }
          }
        }
        setCheckoutACContextLoading(false);
      });
    } else {
      setCheckoutACContext(null);
      setCheckoutACContextLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingOut, checkoutDate]);

  async function fetchCheckoutPayment(tenantId: string, maxMonth: string) {
    // Routed through a server action (not a direct client-side Supabase call)
    // — hms_payments only has RLS SELECT policies for owners and partners, so
    // a manager's own browser session silently got zero rows back here,
    // always showing "nothing outstanding" regardless of the real balance.
    const { payment, error } = await getCheckoutPendingPaymentAction(tenantId, maxMonth);

    if (error) {
      setCheckoutPaymentError(error);
    } else if (payment) {
      // UX-F10: only surface a payment section when there is a real amount to collect.
      // `amount` here stays the GROSS original bill (checkoutProRateInfo backs
      // base rent out of it) — amount_paid is threaded through separately so
      // checkoutMath can net it out where it actually matters.
      const amount = payment.amount + payment.late_fee;
      if (amount - payment.amount_paid > 0) {
        setCheckoutPendingPayment({
          id: payment.id,
          for_month: payment.for_month,
          status: payment.status,
          discount_percent: payment.discount_percent,
          referral_percent: payment.referral_percent,
          carried_ac_charge: payment.carried_ac_charge,
          amount,
          amount_paid: payment.amount_paid,
          ac_charge: payment.ac_charge,
          ac_units_consumed: payment.ac_units_consumed,
          food_charge: payment.food_charge,
          security_deposit_charge: payment.security_deposit_charge,
          registration_fee_charge: payment.registration_fee_charge,
          ac_maintenance_charge: payment.ac_maintenance_charge,
          late_fee: payment.late_fee,
        });
      }
    }
    setCheckoutPaymentLoading(false);
  }

  async function handleCheckout() {
    if (!checkingOut) return;
    setCheckoutSubmitting(true);

    const acReadingNum = checkoutACReading.trim() !== "" ? Number(checkoutACReading) : undefined;
    const input: CheckoutInput = {
      tenantId: checkingOut.id,
      checkoutDate,
      paymentSettlement: checkoutPendingPayment
        ? {
            paymentId: checkoutPendingPayment.id,
            action: checkoutPayAction,
            ...(checkoutPayAction === "pay"
              ? { paymentDate: checkoutPayDate, paymentMethod: checkoutPayMethod as PaymentMethod }
              : {}),
          }
        : undefined,
      ...(checkoutNotes.trim() ? { notes: checkoutNotes.trim() } : {}),
      // Only sent when the owner explicitly opted in. Absent = full month, i.e.
      // byte-for-byte the pre-existing behaviour.
      ...(proRateActive ? { proRateFinalMonth: true } : {}),
      // Always send the deposit decision when one is held. Gating this on a non-empty
      // box let an untouched field mean "say nothing", which is how 12 departed tenants
      // ended up with deposits that were never returned, forfeited, or even recorded.
      ...((checkingOut.security_deposit ?? 0) > 0
        ? {
            depositReturned: checkoutDepositReturned.trim() !== "" ? Number(checkoutDepositReturned) : 0,
            depositNotes: checkoutNotes.trim() || undefined,
          }
        : {}),
      ...(acReadingNum !== undefined && Number.isFinite(acReadingNum) ? { acCheckoutReading: acReadingNum } : {}),
      ...(checkoutACContext?.prevMonthReading == null && checkoutACOpeningReading.trim() !== ""
        ? { acOpeningReading: Number(checkoutACOpeningReading) }
        : {}),
    };

    const result = isManager
      ? await checkoutTenantAsManager(input)
      : isPartner
      ? await checkoutTenantAsPartner(input)
      : await checkoutTenantAction(input);

    if (!result.success) {
      toast({ title: "Checkout failed", description: result.error, variant: "destructive" });
      setCheckoutSubmitting(false);
      return;
    }

    const name = checkingOut.full_name;
    const phone = checkingOut.phone;
    const collectedPaymentId = checkoutPayAction === "pay" ? checkoutPendingPayment?.id : null;
    setActive((prev) => prev.filter((t) => t.id !== checkingOut.id));
    resetCheckoutState();

    // Report what the server actually recorded, not what the dialog predicted — the
    // two silently disagreeing is the whole reason this flow was broken.
    const s = result.settlement;
    const settlementLines = s
      ? [
          s.depositApplied > 0 ? `${formatCurrency(s.depositApplied)} deposit applied to dues` : null,
          s.cashCollected > 0 ? `${formatCurrency(s.cashCollected)} collected` : null,
          s.depositReturned > 0 ? `${formatCurrency(s.depositReturned)} refunded` : null,
          s.depositForfeited > 0 ? `${formatCurrency(s.depositForfeited)} forfeited` : null,
        ].filter(Boolean).join(" · ")
      : "";

    // If payment was collected, generate receipt link and open share dialog
    if (collectedPaymentId) {
      const linkResult = await createInvoiceLink(collectedPaymentId);
      if (linkResult.token) {
        setShareReceipt({ name, phone, token: linkResult.token });
      } else {
        toast({ title: `${name} checked out`, description: settlementLines || "Payment collected." });
      }
    } else {
      toast({ title: `${name} has been checked out`, description: settlementLines || undefined });
    }

    // AFTER the completion toast, deliberately. TOAST_LIMIT is 1 and ADD_TOAST
    // slices, so a second toast REPLACES the first — raised before, this warning
    // was evicted by the success message on every path that reaches one, which is
    // every path. It is the only thing that tells an operator to hand money back,
    // so it has to be the toast that survives.
    if (result.warning) {
      toast({ title: "Check the amount", description: result.warning, variant: "destructive" });
    }

    reload(); // refresh room occupancy counts in background
  }

  // Opened on click, not preloaded with the page: this is one rare action, and
  // shipping every tenant's whole payment history on every Tenants load to be
  // ready for it would cost far more than it saves.
  async function openDeleteDialog(t: Tenant) {
    deleteTenantIdRef.current = t.id;
    setDeleteTenant(t);
    setDeleteMoney(null);
    setDeleteMoneyError(null);
    const result = await getTenantRecordedMoneyAction(t.id);
    // The click may have been abandoned, or moved on to a different tenant,
    // while this was in flight — applying a stale answer would name the wrong
    // person's money.
    if (deleteTenantIdRef.current !== t.id) return;
    if (result.success) setDeleteMoney({ total: result.total ?? 0, byMonth: result.byMonth ?? [] });
    else setDeleteMoneyError(result.error ?? "Could not check this member's recorded payments.");
  }

  function closeDeleteDialog() {
    deleteTenantIdRef.current = null;
    setDeleteTenant(null);
    setDeleteMoney(null);
    setDeleteMoneyError(null);
  }

  async function handleDelete(t: Tenant) {
    const result = await deleteTenantAction(t.id);
    if (result.error) { toast({ title: "Error", description: result.error, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    await reload();
  }

  async function handleSendWelcome(t: Tenant) {
    // Deliberately NOT pre-opening a blank tab and navigating it later —
    // Safari/WebKit silently drops a deferred .location.href assignment on a
    // window opened with window.open("", ...) once any async gap (our server
    // round-trip) has passed, treating it as a suspicious popup redirect. The
    // tab opens blank and just stays blank, with no error anywhere. Opening
    // the real URL only once we have it is the reliable, cross-browser way —
    // the spinner below still gives instant feedback on click.
    setSendingWelcomeId(t.id);
    const result = await resendTenantWelcomeMessageAction(t.id);
    setSendingWelcomeId(null);
    if (!result.ok) {
      toast({ title: "Couldn't send welcome message", description: result.error, variant: "destructive" });
      return;
    }
    // Branches without WhatsApp API access get a wa.me link instead of an
    // automatic send — open it so the owner can hit send themselves.
    if (result.waLink) {
      window.open(result.waLink, "_blank", "noopener,noreferrer");
      toast({ title: "Opening WhatsApp…", description: `Message ready to send to ${t.full_name}.` });
      return;
    }
    toast({ title: "Welcome message sent", description: `Sent to ${t.full_name} via WhatsApp.` });
  }

  function openDepositDialog(t: Tenant) {
    setDepositDialogTenant(t);
    setDepositForm({
      amount: t.security_deposit > 0 ? String(t.security_deposit) : "",
      date: formatDateInput(new Date()),
      method: "cash",
      notes: "",
    });
    setDepositSubmitting(false);
  }

  function closeDepositDialog() {
    setDepositDialogTenant(null);
    setDepositSubmitting(false);
  }

  async function handleRecordDeposit() {
    if (!depositDialogTenant) return;
    const amount = parseFloat(depositForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter the deposit amount actually received.", variant: "destructive" });
      return;
    }
    if (!depositForm.date) {
      toast({ title: "Invalid date", description: "Enter the date the money was received.", variant: "destructive" });
      return;
    }
    setDepositSubmitting(true);
    const result = await recordReservationDepositAction({
      tenantId: depositDialogTenant.id,
      amount,
      collectedOn: depositForm.date,
      paymentMethod: depositForm.method,
      notes: depositForm.notes || undefined,
    });
    if (!result.success) {
      toast({ title: "Failed to record deposit", description: result.error, variant: "destructive" });
      setDepositSubmitting(false);
      return;
    }
    // security_deposit is the AGREED deposit and is deliberately left alone —
    // overwriting it with what was collected is what made the badge show the
    // right figure until the page reloaded and then quietly show the wrong one,
    // and it would also have shrunk the refund due at checkout.
    setWaiting((prev) => prev.map((t) =>
      t.id === depositDialogTenant.id
        ? { ...t, deposit_collected_on: result.collectedOn ?? depositForm.date, deposit_collected_amount: amount }
        : t
    ));
    const balance = result.remainingDeposit ?? 0;
    toast({
      title: `${formatCurrency(amount)} deposit recorded`,
      description: balance > 0
        ? `${depositDialogTenant.full_name}'s bed is held. The remaining ${formatCurrency(balance)} of the deposit will be charged on their first monthly bill. Receipt ${result.receiptNumber ?? ""}`.trim()
        : `${depositDialogTenant.full_name}'s seat is confirmed. Receipt ${result.receiptNumber ?? ""}`.trim(),
    });
    closeDepositDialog();
  }

  function openNoticeDialog(t: Tenant) {
    setNoticeDialogTenant(t);
    setNoticeDate(t.intended_checkout_date ?? formatDateInput(new Date()));
  }

  function closeNoticeDialog() {
    setNoticeDialogTenant(null);
    setNoticeDate("");
    setNoticeSubmitting(false);
  }

  async function handleGiveNotice() {
    if (!noticeDialogTenant || !noticeDate) return;
    setNoticeSubmitting(true);
    const result = isManager
      ? await giveTenantNoticeAsManager(noticeDialogTenant.id, noticeDate)
      : await giveTenantNoticeAction(noticeDialogTenant.id, noticeDate);
    if (!result.success) {
      toast({ title: "Failed to record notice", description: result.error, variant: "destructive" });
      setNoticeSubmitting(false);
      return;
    }
    const today = formatDateInput(new Date());
    setActive((prev) => prev.map((t) =>
      t.id === noticeDialogTenant.id ? { ...t, notice_given_date: today, intended_checkout_date: noticeDate } : t
    ));
    toast({ title: `Notice recorded for ${noticeDialogTenant.full_name}` });
    closeNoticeDialog();
  }

  async function handleCancelNotice() {
    if (!noticeDialogTenant) return;
    setNoticeSubmitting(true);
    const result = isManager
      ? await cancelTenantNoticeAsManager(noticeDialogTenant.id)
      : await cancelTenantNoticeAction(noticeDialogTenant.id);
    if (!result.success) {
      toast({ title: "Failed to cancel notice", description: result.error, variant: "destructive" });
      setNoticeSubmitting(false);
      return;
    }
    setActive((prev) => prev.map((t) =>
      t.id === noticeDialogTenant.id ? { ...t, notice_given_date: null, intended_checkout_date: null } : t
    ));
    toast({ title: `Notice cancelled for ${noticeDialogTenant.full_name}` });
    closeNoticeDialog();
  }

  function filterList(list: Tenant[]) {
    let result = typeFilter !== "all" ? list.filter((t) => t.type === typeFilter) : list;
    if (depositFilter) result = result.filter((t) => Number(t.security_deposit) > 0);
    if (noticeFilter && tab === "active") {
      result = result
        .filter((t) => t.intended_checkout_date != null)
        .sort((a, b) => (a.intended_checkout_date ?? "").localeCompare(b.intended_checkout_date ?? ""));
    }
    if (roomFilter !== "all") result = result.filter((t) => t.room_id === roomFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.full_name.toLowerCase().includes(q) ||
        (t.phone ?? "").includes(q) ||
        (t.cnic ?? "").includes(q) ||
        (t.vehicle_number ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

  // Checkout money math — the deposit pays the tenant's dues down first, and only
  // what survives that is refundable. Lives here rather than inside the summary box
  // because the refund input needs the same numbers; keeping two copies is exactly
  // how the displayed deduction drifted away from what was actually recorded.
  // The server recomputes all of this from the real deposit — this is a preview.
  // RULE 2 — pro-rating a MONTHLY tenant's final month. Only ever a preview; the
  // server recomputes it. Offered only when the outstanding row IS the checkout
  // month and the tenant leaves before it ends, so there is a real discount to make.
  // Extras (food, AC, deposit) are never pro-rated, so the rent is isolated by
  // subtraction and only that part is scaled.
  const checkoutProRateInfo = useMemo(() => {
    if (!checkingOut || checkingOut.billing_type !== "monthly") return null;
    if (!checkoutPendingPayment || !checkoutDate) return null;
    if (checkoutPendingPayment.for_month !== checkoutDate.slice(0, 7)) return null;

    const month = checkoutPendingPayment.for_month;
    // The basis is monthly_rent, identically to lib/tenant-checkout.ts. Deriving it
    // by subtraction instead would let the preview and the server disagree.
    const fullRent = Number(checkingOut.monthly_rent ?? 0);
    if (fullRent <= 0) return null;

    const totalDays = daysInMonth(month);
    const nights = countBillableNights({
      checkIn: checkingOut.check_in,
      checkOut: checkoutDate,
      month,
    });
    if (nights >= totalDays) return null;

    const proRatedRent = proRateMonthlyRent({
      monthlyRent: fullRent,
      checkIn: checkingOut.check_in,
      checkOut: checkoutDate,
      month,
    });

    // What the outstanding total actually drops by: the server swaps the row's
    // stored base rent for the pro-rated one, keeping extras and late fee intact.
    // MUST mirror lib/tenant-checkout.ts Step 2b's `extras` exactly — every
    // non-rent component of the row. Dropping registration fee / AC maintenance
    // here overstated storedBaseRent, so the dialog quoted less than the server
    // billed (Rs 3,000-5,000 at hostels that charge them).
    const extras =
      checkoutPendingPayment.ac_charge +
      checkoutPendingPayment.food_charge +
      checkoutPendingPayment.security_deposit_charge +
      checkoutPendingPayment.registration_fee_charge +
      checkoutPendingPayment.ac_maintenance_charge +
      checkoutPendingPayment.late_fee;
    // storedBaseRent is NET — `amount` has the discounts already taken out of it —
    // so comparing it against a GROSS pro-rated rent quoted the member more than
    // the server settles at, and under-refunded their deposit by the same amount.
    // Price the pro-rated rent through the same two percents the trigger pins.
    const storedBaseRent = Math.max(0, checkoutPendingPayment.amount - extras);
    const proRatedReferral = computeReferralDiscount(proRatedRent, checkoutPendingPayment.referral_percent);
    const proRatedNet =
      proRatedRent - proRatedReferral -
      computeRentDiscount(proRatedRent, checkoutPendingPayment.discount_percent, proRatedReferral);
    const discount = Math.max(0, storedBaseRent - proRatedNet);
    if (discount <= 0) return null;

    return { month, nights, totalDays, fullRent, proRatedRent, discount };
  }, [checkingOut, checkoutPendingPayment, checkoutDate]);

  const proRateActive = !!checkoutProRateInfo && checkoutProRate && checkoutPayAction === "pay";

  const checkoutMath = useMemo(() => {
    const deposit = checkingOut?.security_deposit ?? 0;
    // The AC estimate below REPLACES whatever ac_charge is already on the row
    // (e.g. from an AC Units tab apply earlier this month) — it must not be
    // billed twice, once already inside `amount` and again as the fresh estimate.
    // Whatever's already been paid toward this row (a partially_paid balance,
    // e.g. AC billed after an advance rent payment already settled the rest)
    // is netted out here too, alongside AC — both are already-known quantities,
    // unlike a genuinely fresh AC reading which isn't computed until below.
    const existingAcCharge = checkoutPendingPayment?.ac_charge ?? 0;
    const alreadyPaid = checkoutPendingPayment?.amount_paid ?? 0;
    // MUST match lib/tenant-checkout.ts rowPartiallyPaid exactly, or the figure
  // quoted at the door differs from the one the server settles. The money test
  // is the half that was missing: a REVERSED payment is stored partially_paid
  // holding nothing, and treating it as "AC already collected" froze the charge
  // here while the server recomputed it.
  const isPartiallyPaid = checkoutPendingPayment?.status === "partially_paid"
    && Number(checkoutPendingPayment?.amount_paid ?? 0) > 0.009;
    // Only netted out when the row IS the departure month's — otherwise the
    // fresh AC belongs to a different month than this row's charge and the two
    // must not be swapped. Mirrors supersededAcCharge in lib/tenant-checkout.ts.
    const rowIsDepartureMonth = checkoutPendingPayment?.for_month === checkoutDate.slice(0, 7);
    // Only the CURRENT room's part is superseded by the fresh estimate. After a
    // transfer this column also holds the share of a room the member has already
    // moved out of, which the server deliberately keeps (acChargeForBill in
    // lib/tenant-checkout.ts adds it back). Superseding all of it quoted the
    // door figure that much too low while the server settled the full amount.
    const carriedAc = checkoutPendingPayment?.carried_ac_charge ?? 0;
    // Declared here, assigned after estimatedACCharge is known — the two must
    // agree, and which one is right depends on the branch the estimate takes.
    let supersededAc = 0;

    // The exact opening the AC Units tab already used, backed out from what it
    // actually saved (reading - units) — preferred over the generic move-in-reading
    // fallback, since a manual opening override at apply time (or any other reason
    // the two derivations diverge) would otherwise make this preview disagree with
    // what's already billed for the room this month.
    const impliedCurrentOpening = (checkoutACContext?.currentMonthReading != null && checkoutACContext?.currentMonthUnits != null)
      ? checkoutACContext.currentMonthReading - checkoutACContext.currentMonthUnits
      : null;
    const acReading = checkoutACReading.trim() !== "" ? Number(checkoutACReading) : NaN;
    const acPrev = checkoutACContext?.prevMonthReading
      ?? (checkoutACOpeningReading.trim() !== "" ? Number(checkoutACOpeningReading) : null)
      ?? impliedCurrentOpening
      ?? checkoutACContext?.derivedOpening
      ?? 0;
    const acRate = checkoutACContext?.perUnitRate ?? 0;
    const acCount = checkoutACContext?.activeTenantCount ?? 0;
    const roomHasAC = !!(checkingOut?.room_id && (roomMap[checkingOut.room_id]?.has_ac || meterAllRooms));
    // A partially_paid row never recomputes, regardless of the reading entered —
    // there's no way to tell how much of what's already been paid covered AC vs.
    // rent, so re-deriving a fresh split would risk double-billing or writing off
    // the AC portion against a payment that already happened.


    // Computed by the SAME function the Payments page's AC Units tab bills with
    // (computeACSegmentBilling), fed the same raw join/checkout rows — so this
    // preview and the charge the server actually records can no longer disagree.
    // It throws when a prior checkout reading is >= this one (a real validation
    // the server surfaces on submit); a preview must never crash the dialog, so
    // that case just shows 0 until the operator corrects the reading.
    const previewACCharge = (): number => {
      if (!Number.isFinite(acReading) || acReading <= acPrev || acRate <= 0 || acCount <= 0) return 0;
      try {
        const { tenantBilling } = computeACSegmentBilling({
          eligible: checkoutACContext?.eligibleTenants ?? [],
          prevReading: acPrev,
          reading: acReading,
          units: acReading - acPrev,
          perUnitRate: acRate,
          forMonth: checkoutDate.slice(0, 7),
          joinReadingsRaw: checkoutACContext?.joinReadingsRaw ?? [],
          // Same `<=` bound the server applies — the preview has to divide by the
          // exact head count the real checkout will. See lib/tenant-checkout.ts.
          checkoutReadingsRaw: (checkoutACContext?.checkoutReadingsRaw ?? [])
            .filter(r => Math.round(Number(r.meter_reading)) <= acReading),
        });
        return tenantBilling.find(r => r.id === checkingOut?.id)?.charge ?? 0;
      } catch {
        return 0;
      }
    };

    // Two of these branches REUSE the charge already on the row rather than
    // estimating a fresh one. That stored figure may include a share carried
    // from a room the member moved out of this month — so on those branches the
    // whole of it is being put back and the whole of it must come off, while on
    // the estimate branch only the current room's part is replaced. Netting the
    // carried share out unconditionally (as this did) over-quoted by exactly
    // that amount: on a deposit checkout the surplus was written off as a
    // forfeit, and without a deposit it was collected in cash and never recorded.
    // MUST match performTenantCheckout exactly — see the long note on
    // hasNewerReading there. The departure reading always prices the departure
    // now; the ONLY row that reuses what is on it is one with money already
    // collected against AC, because that is the one case where the split cannot
    // be re-derived without risking billing it twice or writing it off.
    const reusesStoredCharge = roomHasAC && isPartiallyPaid && existingAcCharge > 0;
    const estimatedACCharge = !roomHasAC ? 0
      : reusesStoredCharge ? existingAcCharge
      : previewACCharge();

    supersededAc = rowIsDepartureMonth
      ? (reusesStoredCharge ? existingAcCharge : Math.max(0, existingAcCharge - carriedAc))
      : 0;

    // Computed here, not earlier: it subtracts supersededAc, which is only
    // knowable once the estimate's branch is decided just above.
    const rawPending = Math.max(0, (checkoutPendingPayment?.amount ?? 0) - supersededAc - alreadyPaid);
    const proRateDiscount = proRateActive ? (checkoutProRateInfo?.discount ?? 0) : 0;
    const basePending = Math.max(0, rawPending - proRateDiscount);

    const pending = basePending + estimatedACCharge;
    // "waive" forgives the dues outright, so there is nothing for the deposit to cover.
    const collecting = pending > 0 && checkoutPayAction === "pay";
    const applied = collecting && deposit > 0 ? Math.min(deposit, pending) : 0;
    const refundable = deposit - applied;

    return {
      deposit, basePending, estimatedACCharge, pending, collecting, applied, refundable,
      rawPending, proRateDiscount,
      toCollect: Math.max(0, pending - applied),
      depositCoversAll: collecting && applied >= pending,
    };
  }, [checkingOut, checkoutPendingPayment, checkoutACReading, checkoutACOpeningReading, checkoutACContext, checkoutPayAction, roomMap, proRateActive, checkoutProRateInfo]);

  // Keep the refund box pinned to what is actually left after dues. Without this the
  // operator has to notice the deduction and subtract by hand — and the old default
  // (the full deposit) meant the standard path applied the deposit AND refunded it.
  useEffect(() => {
    if (!checkingOut || checkingOut.security_deposit <= 0) return;
    setCheckoutDepositReturned(String(checkoutMath.refundable));
  }, [checkingOut, checkoutMath.refundable]);

  useEffect(() => {
    if (!shareLinkDialog || !hostelSlug) return;
    const formUrl = `${window.location.origin}/join/${hostelSlug}`;
    setFormQrGenerating(true);
    QRCode.toDataURL(formUrl, { width: 320, margin: 2 })
      .then(setFormQrDataUrl)
      .catch(() => setFormQrDataUrl(null))
      .finally(() => setFormQrGenerating(false));
  }, [shareLinkDialog, hostelSlug]);

  // Single source of truth for "what does the Vehicles tab show" — used by
  // both the on-screen table and the exports below, so exporting while on
  // that tab can never drift from what's actually displayed.
  function getVehicleTenants() {
    return filterList(active)
      .filter((t) => t.vehicle_number)
      .sort((a, b) => (a.vehicle_number ?? "").localeCompare(b.vehicle_number ?? ""));
  }

  function getCurrentFilteredList() {
    if (tab === "vehicles") return getVehicleTenants();
    const map: Record<string, Tenant[]> = { active, waiting, checkedout: checkedOut };
    return filterList(map[tab] ?? active);
  }

  // ONE definition per column, used by both exports. Previously the PDF and the
  // Excel each hard-coded their own list, which is how CNIC ended up in both
  // with no way to leave it out — and how they had silently drifted apart (the
  // spreadsheet also carried email, the PDF did not).
  const EXPORT_COLUMNS: {
    key: string;
    label: string;
    sensitive?: boolean;
    get: (t: Tenant, room: Room | null) => string | number;
  }[] = [
    { key: "name",    label: "Name",           get: (t) => t.full_name },
    { key: "father",  label: "Father Name",    get: (t) => t.father_name ?? "" },
    { key: "purpose", label: "Purpose of Visit", get: (t) => visitPurposeLabel(t.purpose_of_visit, t.purpose_of_visit_detail) ?? "" },
    { key: "phone",   label: "Phone",          get: (t) => t.phone ?? "" },
    { key: "email",   label: "Email",          sensitive: true, get: (t) => t.email ?? "" },
    { key: "cnic",    label: "CNIC",           sensitive: true, get: (t) => t.cnic ?? "" },
    { key: "type",    label: "Type",           get: (t) => capitalize(t.type) },
    { key: "package", label: "Package",        get: (t) => PACKAGE_TIER_LABELS[t.package_tier as PackageTier] ?? t.package_tier },
    { key: "room",    label: "Room",           get: (_t, room) => (room ? `Rm ${room.room_number}` : "") },
    { key: "bed",     label: "Bed",            get: (t) => t.bed_number ?? "" },
    { key: "rent",    label: "Monthly Rent",   get: (t) => t.monthly_rent },
    { key: "deposit", label: "Security Deposit", get: (t) => t.security_deposit },
    { key: "vtype",   label: "Vehicle Type",   get: (t) => t.vehicle_type ?? "" },
    { key: "vnumber", label: "Plate Number",   get: (t) => t.vehicle_number ?? "" },
    { key: "vmodel",  label: "Vehicle Model",  get: (t) => t.vehicle_model ?? "" },
    { key: "checkin", label: "Check In",       get: (t) => t.check_in ?? "" },
    { key: "checkout",label: "Check Out",      get: (t) => t.check_out ?? "" },
  ];

  // Sensitive columns start UNCHECKED. An export is the easiest way for a
  // tenant's ID number to leave the building — it has to be chosen
  // deliberately, not left in by default.
  const [exportCols, setExportCols] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.filter((c) => !c.sensitive).map((c) => c.key))
  );
  const [exportFormat, setExportFormat] = useState<"excel" | "pdf" | null>(null);

  function chosenColumns() {
    const picked = EXPORT_COLUMNS.filter((c) => exportCols.has(c.key));
    return picked.length > 0 ? picked : EXPORT_COLUMNS.filter((c) => c.key === "name");
  }

  async function exportExcel() {
    setExportLoading("excel");
    try {
      const XLSX = await import("xlsx");
      const cols = chosenColumns();
      const rows = getCurrentFilteredList().map((t) => {
        const room = t.room_id ? roomMap[t.room_id] : null;
        return Object.fromEntries(cols.map((c) => [c.label, c.get(t, room)]));
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Tenants");
      const label = tab === "checkedout" ? "checked-out" : tab;
      XLSX.writeFile(wb, `tenants-${label}-${new Date().toISOString().split("T")[0]}.xlsx`);
    } catch {
      toast({ title: "Export failed", description: "Could not generate Excel file.", variant: "destructive" });
    } finally {
      setExportLoading(null);
    }
  }

  async function exportPDF() {
    setExportLoading("pdf");
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "landscape" });

      const tabLabel = tab === "checkedout" ? "Checked Out" : capitalize(tab);
      doc.setFontSize(16);
      doc.setTextColor(30, 30, 30);
      doc.text(`Tenants — ${tabLabel}`, 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated ${new Date().toLocaleDateString()}${typeFilter !== "all" ? ` · Type: ${capitalize(typeFilter)}` : ""}${depositFilter ? " · With Deposit" : ""}`, 14, 23);

      const cols = chosenColumns();
      const rows = getCurrentFilteredList().map((t) => {
        const room = t.room_id ? roomMap[t.room_id] : null;
        return cols.map((c) => {
          const v = c.get(t, room);
          if (c.key === "rent" || c.key === "deposit") {
            return Number(v) > 0 ? `Rs ${Number(v).toLocaleString()}` : "—";
          }
          return v === "" || v == null ? "—" : String(v);
        });
      });

      autoTable(doc, {
        startY: 28,
        head: [cols.map((c) => c.label)],
        body: rows,
        theme: "striped",
        headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 9 },
        bodyStyles: { fontSize: 8.5 },
        alternateRowStyles: { fillColor: [248, 248, 248] },
      });

      const label = tab === "checkedout" ? "checked-out" : tab;
      doc.save(`tenants-${label}-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch {
      toast({ title: "Export failed", description: "Could not generate PDF.", variant: "destructive" });
    } finally {
      setExportLoading(null);
    }
  }

  const stats = {
    active: active.length,
    waiting: waiting.length + waitlistEntries.length,
    vacantRooms: rooms.filter((r) => r.status === "available").length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Tenants</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage hostel residents</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Applications are an owner-only surface and the portal never passes
              hostelSlug, so for a manager this button could only ever produce
              the "No form link yet" error toast. */}
          {!isManager && (
            <Button
              variant="outline"
              onClick={() => { if (hostelSlug) setShareLinkDialog(true); else toast({ title: "No form link yet", description: "Contact support to set up your hostel slug.", variant: "destructive" }); }}
              className="gap-2 h-9 text-sm flex-1 sm:flex-none"
            >
              <Link2 className="w-4 h-4" /> Share Application Form
            </Button>
          )}
          {canAdd && (
            <Button onClick={openAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold flex-1 sm:flex-none">
              <Plus className="w-4 h-4" /> Add Tenant
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: "Active Tenants", value: stats.active, icon: UserCheck, color: "text-emerald-400", iconBg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "Waiting List", value: stats.waiting, icon: Clock, color: "text-amber", iconBg: "bg-amber/10 border-amber/20" },
          { label: "Vacant Rooms", value: stats.vacantRooms, icon: BedDouble, color: "text-blue-400", iconBg: "bg-blue-500/10 border-blue-500/20" },
        ].map(({ label, value, icon: Icon, color, iconBg }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-3 sm:p-5">
            <div className="flex items-start justify-between gap-1 mb-2">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground leading-tight">{label}</p>
              <div className={`flex items-center justify-center w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl border ${iconBg} shrink-0`}>
                <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${color}`} />
              </div>
            </div>
            <p className={`text-2xl sm:text-3xl font-bold leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Search + Export (same row) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name, phone, CNIC, plate number…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {tab !== "applications" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-xs" disabled={!!exportLoading} onClick={() => setExportFormat("excel")} title="Export to Excel">
              {exportLoading === "excel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />}
              <span className="hidden sm:inline">Excel</span>
            </Button>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-xs" disabled={!!exportLoading} onClick={() => setExportFormat("pdf")} title="Export to PDF">
              {exportLoading === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-rose-400" />}
              <span className="hidden sm:inline">PDF</span>
            </Button>
          </div>
        )}
      </div>

      {/* Filter chips — single scrollable row, never wraps */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex items-center gap-1.5 w-max">
          {(() => {
            const allTenants = [...active, ...waiting, ...checkedOut];
            return (
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
                <SelectTrigger
                  className={cn(
                    "h-7 text-xs border rounded-full px-3 gap-1.5 w-auto min-w-[100px] shrink-0",
                    typeFilter !== "all"
                      ? "bg-amber/15 border-amber/30 text-amber"
                      : "border-sidebar-border text-muted-foreground"
                  )}
                >
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  {(["all", "student", "professional", "general"] as const).map((type) => {
                    const count = type === "all" ? allTenants.length : allTenants.filter((t) => t.type === type).length;
                    return (
                      <SelectItem key={type} value={type}>
                        {type === "all" ? "All Types" : capitalize(type)}
                        <span className="ml-1 opacity-50 tabular-nums">({count})</span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            );
          })()}

          <span className="w-px h-4 bg-sidebar-border mx-0.5 shrink-0" />

          <button
            onClick={() => setDepositFilter((v) => !v)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap",
              depositFilter
                ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
                : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
            )}
          >
            <ShieldCheck className="w-3 h-3 shrink-0" />
            With Deposit
            <span className="opacity-50 tabular-nums">
              ({[...active, ...waiting, ...checkedOut].filter((t) => Number(t.security_deposit) > 0).length})
            </span>
          </button>

          {tab === "active" && (
            <button
              onClick={() => setNoticeFilter((v) => !v)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap",
                noticeFilter
                  ? "bg-amber/15 border-amber/30 text-amber"
                  : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
              )}
            >
              <CalendarClock className="w-3 h-3 shrink-0" />
              Notice Given
              <span className="opacity-50 tabular-nums">
                ({active.filter((t) => t.intended_checkout_date != null).length})
              </span>
            </button>
          )}

          {/* Room filter — dropdown */}
          {(() => {
            const occupiedRooms = rooms
              .filter((r) => r.id === roomFilter || active.some((t) => t.room_id === r.id))
              .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
            if (occupiedRooms.length === 0) return null;
            return (
              <>
                <span className="w-px h-4 bg-sidebar-border mx-0.5 shrink-0" />
                <Select value={roomFilter} onValueChange={setRoomFilter}>
                  <SelectTrigger
                    className={cn(
                      "h-7 text-xs border rounded-full px-3 gap-1.5 w-auto min-w-[110px] shrink-0",
                      roomFilter !== "all"
                        ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                        : "border-sidebar-border text-muted-foreground"
                    )}
                  >
                    <BedDouble className="w-3 h-3 shrink-0" />
                    <SelectValue placeholder="All Rooms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Rooms</SelectItem>
                    {occupiedRooms.map((r) => {
                      const count = active.filter((t) => t.room_id === r.id).length;
                      return (
                        <SelectItem key={r.id} value={r.id}>
                          Room {r.room_number}
                          <span className="ml-1 opacity-50 tabular-nums">({count})</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </>
            );
          })()}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-hide">
          <TabsList className="flex w-max gap-0.5">
            <TabsTrigger value="active" className="shrink-0 gap-1.5 whitespace-nowrap">
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Active</span>
              <span className="text-muted-foreground">({active.length})</span>
            </TabsTrigger>
            <TabsTrigger value="waiting" className="shrink-0 gap-1.5 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Waiting</span>
              <span className="text-muted-foreground">({waiting.length + waitlistEntries.length})</span>
            </TabsTrigger>
            <TabsTrigger value="checkedout" className="shrink-0 gap-1.5 whitespace-nowrap">
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Checked Out</span>
              <span className="sm:hidden">Out</span>
              <span className="text-muted-foreground">({checkedOut.length})</span>
            </TabsTrigger>
            <TabsTrigger value="applications" className="shrink-0 gap-1.5 whitespace-nowrap">
              <ClipboardList className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Applications</span>
              <span className="sm:hidden">Apps</span>
              {applications.filter((a) => a.status === "pending").length > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber text-background text-[10px] font-bold leading-none shrink-0">
                  {applications.filter((a) => a.status === "pending").length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="vehicles" className="shrink-0 gap-1.5 whitespace-nowrap">
              <Car className="w-3.5 h-3.5 shrink-0" />
              <span>Vehicles</span>
              <span className="text-muted-foreground">({active.filter((t) => t.vehicle_number).length})</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="active">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {filterList(active).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Users className="w-10 h-10 opacity-20" />
                <p className="text-sm">{search ? "No tenants match" : "No active tenants yet"}</p>
              </div>
            ) : (
              <div className="divide-y divide-sidebar-border/50">
                {filterList(active).map((t) => (
                <TenantRow
                  key={t.id} t={t} showCheckout={canEditRow}
                  showEdit={canEditRow} showDelete={canDeleteRow} showGiveNotice={canNotice}
                  showSendWelcome={canSendWelcome}
                  roomMap={roomMap}
                  foodAddonRates={foodAddonRates}
                  noticePeriodDays={noticePeriodDays}
                  currentMonthPaymentByTenant={currentMonthPaymentByTenant}
                  sendingWelcome={sendingWelcomeId === t.id}
                  onView={!isManager || canEditAsManager ? openView : undefined}
                  printingForm={printingForm === t.id}
                  onPrintForm={!isManager || canEditAsManager ? handlePrintForm : undefined}
                  onCheckout={openCheckout}
                  onActivate={(tenant) => openEdit(tenant, true)}
                  onEdit={openEdit}
                  onDelete={openDeleteDialog}
                  onGiveNotice={openNoticeDialog}
                  onSendWelcome={handleSendWelcome}
                />
              ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="waiting">
          <div className="space-y-4">
            {/* Pre-booked tenants (is_waiting: true) */}
            <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
              {filterList(waiting).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Clock className="w-8 h-8 opacity-20" />
                  <p className="text-sm">{search ? "No tenants match" : "No pre-booked tenants"}</p>
                </div>
              ) : (
                <div className="divide-y divide-sidebar-border/50">
                  {filterList(waiting).map((t) => (
                    <TenantRow
                      key={t.id} t={t} showActivate={canEditRow}
                      showEdit={canEditRow} showDelete={canDeleteRow}
                      // Owner-only: recordReservationDepositAction is gated on
                      // requireOwnerOrAbove(), so a manager or partner clicking
                      // this would only ever get an access-denied toast.
                      showRecordDeposit={!isManager && !isPartner}
                      roomMap={roomMap}
                      foodAddonRates={foodAddonRates}
                      noticePeriodDays={noticePeriodDays}
                      currentMonthPaymentByTenant={currentMonthPaymentByTenant}
                      onView={!isManager || canEditAsManager ? openView : undefined}
                      printingForm={printingForm === t.id}
                  onPrintForm={!isManager || canEditAsManager ? handlePrintForm : undefined}
                  onCheckout={openCheckout}
                      onActivate={(tenant) => openEdit(tenant, true)}
                      onEdit={openEdit}
                      onDelete={openDeleteDialog}
                      onRecordDeposit={openDepositDialog}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Public waitlist (joined via /find page) */}
            {(waitlistEntries.length > 0 || search) && (
              <div className="rounded-2xl border border-amber/20 bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber/10 bg-amber/[0.04]">
                  <Clock className="w-3.5 h-3.5 text-amber/70 shrink-0" />
                  <span className="text-xs font-semibold text-amber/80">Public Waitlist</span>
                  <span className="text-xs text-muted-foreground/50">· joined via /find page</span>
                  <span className="ml-auto text-xs text-amber/60 tabular-nums">{waitlistEntries.length}</span>
                </div>
                {waitlistEntries.filter((e) => {
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return e.name.toLowerCase().includes(q) || e.phone.includes(q);
                }).length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground/50">
                    {search ? "No entries match" : "Public waitlist is empty"}
                  </div>
                ) : (
                  <div className="divide-y divide-sidebar-border/40">
                    {waitlistEntries
                      .filter((e) => {
                        if (!search) return true;
                        const q = search.toLowerCase();
                        return e.name.toLowerCase().includes(q) || e.phone.includes(q);
                      })
                      .map((entry) => (
                        <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-8 h-8 rounded-full bg-amber/10 border border-amber/20 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-amber">{entry.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{entry.name}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {entry.phone}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-muted-foreground/50">
                              {new Date(entry.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          </div>
                          {canNotice && (
                            <button
                              onClick={async () => {
                                const supabase = createClient();
                                const { data, error } = await supabase.from("hms_waitlist").delete().eq("id", entry.id).select("id");
                                if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                                else if (!data?.length) toast({ title: "Not allowed", description: "You don't have permission to remove waitlist entries.", variant: "destructive" });
                                else setWaitlistEntries((prev) => prev.filter((e) => e.id !== entry.id));
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                              title="Remove from waitlist"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {waitlistEntries.length === 0 && waiting.length === 0 && !search && (
              <div className="rounded-2xl border border-sidebar-border bg-card flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Clock className="w-10 h-10 opacity-20" />
                <p className="text-sm">Waiting list is empty</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="checkedout">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {filterList(checkedOut).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <LogOut className="w-10 h-10 opacity-20" />
                <p className="text-sm">{search ? "No tenants match" : "No checked-out tenants"}</p>
              </div>
            ) : (
              <div className="divide-y divide-sidebar-border/50">
                {filterList(checkedOut).map((t) => (
                <TenantRow
                  key={t.id} t={t}
                  showEdit={canEditRow} showDelete={canDeleteRow}
                  roomMap={roomMap}
                  foodAddonRates={foodAddonRates}
                  noticePeriodDays={noticePeriodDays}
                  currentMonthPaymentByTenant={currentMonthPaymentByTenant}
                  onView={!isManager || canEditAsManager ? openView : undefined}
                  printingForm={printingForm === t.id}
                  onPrintForm={!isManager || canEditAsManager ? handlePrintForm : undefined}
                  onCheckout={openCheckout}
                  onActivate={(tenant) => openEdit(tenant, true)}
                  onEdit={openEdit}
                  onDelete={openDeleteDialog}
                />
              ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Vehicles — a flat, plate-sorted view across active tenants so an
            owner/guard can resolve a parking dispute by scanning plates
            directly, instead of searching one tenant at a time. Reuses
            already-loaded tenant data; no new fetch, no schema change. */}
        <TabsContent value="vehicles">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {(() => {
              const vehicles = getVehicleTenants();
              if (vehicles.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                    <Car className="w-10 h-10 opacity-20" />
                    <p className="text-sm">{search ? "No vehicles match" : "No vehicles on file yet"}</p>
                  </div>
                );
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border">
                        <th className="text-left px-4 py-2.5">Plate Number</th>
                        <th className="text-left px-4 py-2.5">Type</th>
                        <th className="text-left px-4 py-2.5">Model</th>
                        <th className="text-left px-4 py-2.5">Tenant</th>
                        <th className="text-left px-4 py-2.5">Room</th>
                        <th className="text-left px-4 py-2.5">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sidebar-border/50">
                      {vehicles.map((t) => {
                        const room = t.room_id ? roomMap[t.room_id] : null;
                        return (
                          <tr key={t.id} className="hover:bg-white/[0.02]">
                            <td className="px-4 py-2.5 font-semibold text-foreground whitespace-nowrap">{t.vehicle_number}</td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{t.vehicle_type ?? "—"}</td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{t.vehicle_model ?? "—"}</td>
                            <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{t.full_name}</td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{room ? `Rm ${room.room_number}` : "—"}</td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{t.phone ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </TabsContent>

        <TabsContent value="applications">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {applications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <ClipboardList className="w-10 h-10 opacity-20" />
                <div className="text-center space-y-1">
                  <p className="text-sm">No applications yet</p>
                  <p className="text-xs text-muted-foreground/70">Share the application form link so prospective tenants can apply.</p>
                </div>
                {hostelSlug && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 mt-1"
                    onClick={() => setShareLinkDialog(true)}
                  >
                    <Link2 className="w-3.5 h-3.5" /> Share Application Form
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-sidebar-border bg-white/[0.02]">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Applicant</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Package</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Room Pref</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Applied</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sidebar-border/50">
                    {applications.map((app) => {
                      const isLoading = appActionLoading === app.id;
                      const statusColors: Record<ApplicationStatus, string> = {
                        pending: "text-amber bg-amber/10 border-amber/20",
                        approved: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                        rejected: "text-rose-400 bg-rose-500/10 border-rose-500/20",
                      };
                      const pkgLabels: Record<string, string> = {
                        space_only: "Space Only",
                        space_food: "Space + 2 Meals",
                        space_3meals: "Space + 3 Meals",
                        space_food_ac: "Space + Meals + AC",
                        space_meals_cooler: "Space + Meals + Cooler",
                      };
                      return (
                        <tr key={app.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-foreground">{app.full_name}</p>
                              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                                {app.phone && (
                                  <a
                                    href={`https://wa.me/${app.phone.replace(/\D/g, "").replace(/^0/, "92")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[#25D366] hover:underline flex items-center gap-1"
                                  >
                                    <Phone className="w-2.5 h-2.5" /> {app.phone}
                                  </a>
                                )}
                                {app.email && <span className="text-xs text-muted-foreground">{app.email}</span>}
                                {app.cnic && <span className="text-xs text-muted-foreground flex items-center gap-1"><CreditCard className="w-2.5 h-2.5" />{app.cnic}</span>}
                                {app.father_name && <span className="text-xs text-muted-foreground">s/o {app.father_name}</span>}
                                {/* Surfaced on the review row, not just stored: a
                                    two-week exam candidate and a year-long student
                                    are the same Type and a different decision. */}
                                {visitPurposeLabel(app.purpose_of_visit, app.purpose_of_visit_detail) && (
                                  <span className="text-xs text-muted-foreground">
                                    {visitPurposeLabel(app.purpose_of_visit, app.purpose_of_visit_detail)}
                                  </span>
                                )}
                              </div>
                              {app.notes && <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-1">{app.notes}</p>}
                              {app.cnic_doc_path && (
                                <a
                                  href={`/api/documents?path=${encodeURIComponent(`application-docs/${app.cnic_doc_path}`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                                >
                                  <ExternalLink className="w-2.5 h-2.5" /> CNIC Doc
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="text-xs text-muted-foreground">{pkgLabels[app.package_tier] ?? app.package_tier}</span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <span className="text-xs text-muted-foreground capitalize">{app.room_preference ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <span className="text-xs text-muted-foreground">
                              {new Date(app.applied_at).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${statusColors[app.status]}`}>
                              {app.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {app.status === "pending" && canAdd && (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={isLoading}
                                  onClick={() => openApproveDialog(app)}
                                  className="h-7 text-xs gap-1 text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20"
                                >
                                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={isLoading}
                                  onClick={() => handleRejectApp(app.id)}
                                  className="h-7 w-7 text-rose-400 hover:bg-rose-500/10"
                                  title="Reject application"
                                >
                                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Approve Application Dialog */}
      <Dialog open={!!approvingApp} onOpenChange={(open) => { if (!open) setApprovingApp(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Approve Application
            </DialogTitle>
          </DialogHeader>

          {approvingApp && (
            <div className="space-y-5 py-1">
              {/* Applicant summary */}
              <div className="rounded-xl bg-white/[0.03] border border-sidebar-border p-4 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Applicant</p>
                <p className="text-sm font-semibold text-foreground">
                  {approvingApp.full_name}
                  {approvingApp.father_name && (
                    <span className="font-normal text-muted-foreground"> s/o {approvingApp.father_name}</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {approvingApp.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{approvingApp.phone}</span>}
                  {approvingApp.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{approvingApp.email}</span>}
                  {approvingApp.cnic && <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{approvingApp.cnic}</span>}
                </div>
                {approvingApp.move_in_date && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Requested move-in: <span className="text-foreground">{formatDate(approvingApp.move_in_date)}</span>
                    <span className="text-muted-foreground/70"> — set the actual date in Check-in below</span>
                  </p>
                )}
                {approvingApp.notes && (
                  <p className="text-xs text-muted-foreground italic mt-1">&quot;{approvingApp.notes}&quot;</p>
                )}
              </div>

              <ReferralAdmissionBanner
                phone={approvingApp.phone ?? ""}
                rent={approveForm.billing_type === "monthly" ? approveForm.monthly_rent : approveForm.daily_rate}
              />

              {/* Active vs Waiting toggle */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Add as</Label>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => setApproveForm({ ...approveForm, is_waiting: false })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${!approveForm.is_waiting ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                    Active Resident
                  </button>
                  <button type="button"
                    onClick={() => setApproveForm({ ...approveForm, is_waiting: true, room_id: null })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${approveForm.is_waiting ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                    Waiting List
                  </button>
                </div>
              </div>

              {/* Tenant Type */}
              <div className="space-y-1.5">
                <Label>Tenant Type</Label>
                <Select value={approveForm.type} onValueChange={(v) => setApproveForm({ ...approveForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Institute / Organization — carried over from what the applicant
                  submitted (convertToTenant falls back to the application's own
                  values if left untouched here), shown so the owner can review
                  and correct it before activating. */}
              {approveForm.type === "student" && (
                <div className={studentCategoryHasSpecialization(approveCategory) ? "space-y-1.5" : "grid grid-cols-2 gap-4"}>
                  <div className="space-y-1.5"><Label>Student Category</Label>
                    <Select
                      value={approveCategory}
                      onValueChange={(v) => {
                        const next = v as StudentCategory;
                        setCustomSpecialization(false);
                        // Institute name is category-specific (a university name doesn't
                        // belong to an Exam Prep record) — clear it along with
                        // specialization instead of carrying the old category's value over.
                        setCustomInstitute(false);
                        setApproveForm({ ...approveForm, student_category: next, student_specialization: "", institute_name: "" });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {STUDENT_CATEGORY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>{STUDENT_CATEGORY_LABELS[c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!studentCategoryHasSpecialization(approveCategory) && (
                    <div className="space-y-1.5"><Label>Institute Name</Label>
                      {renderApproveInstituteField()}
                    </div>
                  )}
                </div>
              )}
              {approveForm.type === "student" && studentCategoryHasSpecialization(approveCategory) && (
                <div className="space-y-1.5">
                  <Label>{STUDENT_CATEGORY_LABELS[approveCategory]} — Specialization</Label>
                  {customSpecialization ? (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type the specific exam, certification, or skill"
                        value={approveForm.student_specialization ?? ""}
                        onChange={(e) => setApproveForm({ ...approveForm, student_specialization: e.target.value })}
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 h-9 text-xs"
                        onClick={() => { setCustomSpecialization(false); setApproveForm({ ...approveForm, student_specialization: "" }); }}
                      >
                        Choose from list
                      </Button>
                    </div>
                  ) : (
                    <SearchableSelect
                      value={approveForm.student_specialization ?? ""}
                      onValueChange={(v) => {
                        if (v === "other") {
                          setCustomSpecialization(true);
                          setApproveForm({ ...approveForm, student_specialization: "" });
                        } else {
                          setApproveForm({ ...approveForm, student_specialization: v });
                        }
                      }}
                      options={STUDENT_SPECIALIZATION_PRESETS[approveCategory]}
                      searchPlaceholder="Search..."
                      otherLabel="Other (specify)"
                    />
                  )}
                </div>
              )}
              {approveForm.type === "student" && studentCategoryHasSpecialization(approveCategory) && (
                <div className="space-y-1.5"><Label>Institute Name</Label>
                  {renderApproveInstituteField()}
                </div>
              )}
              {approveForm.type === "professional" && (
                <div className="grid grid-cols-2 gap-4">
                  {/* Type before name — matches the public form and Add Tenant. */}
                  <div className="space-y-1.5"><Label>Organization Type</Label>
                    <Select
                      value={approveOrgType}
                      onValueChange={(v) => { setCustomApproveOrganization(false); setApproveForm({ ...approveForm, organization_type: v as "private" | "government", organization: "" }); }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">Private</SelectItem>
                        <SelectItem value="government">Government</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Organization</Label>
                    {organizationPresetsFor(approveOrgType).length > 0 && !customApproveOrganization ? (
                      <SearchableSelect
                        value={approveForm.organization ?? ""}
                        onValueChange={(v) => {
                          if (v === "other") { setCustomApproveOrganization(true); setApproveForm({ ...approveForm, organization: "" }); }
                          else setApproveForm({ ...approveForm, organization: v });
                        }}
                        options={organizationPresetsFor(approveOrgType)}
                        placeholder="Select organization"
                        searchPlaceholder="Search organizations..."
                        otherLabel="Other (specify)"
                      />
                    ) : organizationPresetsFor(approveOrgType).length > 0 ? (
                      <div className="flex gap-2">
                        <Input placeholder="Company / employer name" value={approveForm.organization ?? ""} autoFocus
                          onChange={(e) => setApproveForm({ ...approveForm, organization: e.target.value })} />
                        <Button type="button" variant="outline" size="sm" className="shrink-0 h-9 text-xs"
                          onClick={() => { setCustomApproveOrganization(false); setApproveForm({ ...approveForm, organization: "" }); }}>
                          List
                        </Button>
                      </div>
                    ) : (
                      <Input placeholder="Company / employer name" value={approveForm.organization ?? ""}
                        onChange={(e) => setApproveForm({ ...approveForm, organization: e.target.value })} />
                    )}
                  </div>
                </div>
              )}
              {(approveForm.type === "professional" || (approveForm.type === "student" && studentCategoryHasDepartment(approveCategory))) && (
                <div className="space-y-1.5"><Label>Department / Field</Label>
                  {!customApproveDepartment ? (
                    <SearchableSelect
                      value={approveForm.department ?? ""}
                      onValueChange={(v) => {
                        if (v === "other") { setCustomApproveDepartment(true); setApproveForm({ ...approveForm, department: "" }); }
                        else setApproveForm({ ...approveForm, department: v });
                      }}
                      options={departmentPresetsFor(approveForm.type)}
                      placeholder="Select department / field"
                      searchPlaceholder={approveForm.type === "professional" ? "Search departments..." : "Search programmes..."}
                      otherLabel="Other (specify)"
                    />
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type department / field"
                        value={approveForm.department ?? ""}
                        onChange={(e) => setApproveForm({ ...approveForm, department: e.target.value })}
                        autoFocus
                      />
                      <Button type="button" variant="outline" size="sm" className="shrink-0 h-9 text-xs"
                        onClick={() => { setCustomApproveDepartment(false); setApproveForm({ ...approveForm, department: "" }); }}>
                        List
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Room + Bed (only for active) — must come before Package Tier so AC status is known */}
              {!approveForm.is_waiting && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Room</Label>
                    <Select
                      value={approveForm.room_id ?? ""}
                      onValueChange={(v) => {
                        const approveRoom = rooms.find((r) => r.id === v);
                        const tier = approveForm.package_tier as PackageTier;
                        const suggestedDeposit = approveRoom
                          ? getSuggestedDeposit(approveRoom, tier, pkgPrices, seaterPrices, configSecurityDeposit)
                          : (configSecurityDeposit > 0 ? configSecurityDeposit : approveForm.security_deposit);
                        setApproveForm({
                          ...approveForm,
                          room_id: v || null,
                          monthly_rent: approveRoom ? getSuggestedRent(approveRoom, tier, pkgPrices, seaterPrices, washroomPremium) : approveForm.monthly_rent,
                          security_deposit: suggestedDeposit,
                        });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
                      <SelectContent>
                        {availableRooms.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            Rm {r.room_number} · {r.capacity - r.occupied} free · {formatCurrency(getSuggestedRent(r, approveForm.package_tier as PackageTier, pkgPrices, seaterPrices, washroomPremium))}/mo
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Bed Number</Label>
                    <Input
                      placeholder="A1"
                      value={approveForm.bed_number ?? ""}
                      onChange={(e) => setApproveForm({ ...approveForm, bed_number: e.target.value || null })}
                    />
                  </div>
                </div>
              )}

              {/* AC Meter Reading at move-in — printed on the tenant's receipt so
                  there's a documented reference if AC billing is ever disputed. */}
              {!approveForm.is_waiting && approveForm.room_id && rooms.find((r) => r.id === approveForm.room_id)?.has_ac && (
                <div className="space-y-1.5">
                  <Label>AC Meter Reading at Move-in</Label>
                  <Input
                    type="number" min={0} step="0.01"
                    placeholder="e.g. 1284.5"
                    value={approveForm.joining_meter_reading ?? ""}
                    onChange={(e) => setApproveForm({ ...approveForm, joining_meter_reading: e.target.value ? parseFloat(e.target.value) || null : null })}
                  />
                  <p className="text-xs text-muted-foreground">Optional — recorded on the tenant's receipt to avoid future disputes over AC billing.</p>
                </div>
              )}

              {/* Package Tier */}
              <div className="space-y-1.5">
                <Label>Package Tier</Label>
                <Select value={approveForm.package_tier} onValueChange={(v) => {
                  const tier = v as PackageTier;
                  const approveRoom = approveForm.room_id ? rooms.find((r) => r.id === approveForm.room_id) : null;
                  const suggestedDeposit = approveRoom
                    ? getSuggestedDeposit(approveRoom, tier, pkgPrices, seaterPrices, configSecurityDeposit)
                    : (configSecurityDeposit > 0 ? configSecurityDeposit : approveForm.security_deposit);
                  const suggestedRent = approveRoom
                    ? getSuggestedRent(approveRoom, tier, pkgPrices, seaterPrices, washroomPremium)
                    : approveForm.monthly_rent;
                  // Clear any add-on meal selection when switching to a package that
                  // already bundles food — prevents a stale double-charge on save.
                  const clearFood = FOOD_INCLUSIVE_TIERS.has(tier)
                    ? { food_breakfast: false, food_lunch: false, food_dinner: false }
                    : {};
                  setApproveForm({ ...approveForm, package_tier: tier, security_deposit: suggestedDeposit, monthly_rent: suggestedRent, ...clearFood });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PACKAGE_TIER_LABELS) as [PackageTier, string][]).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Food Add-on — optional, independent of package tier. Only shown if the hostel
                  configured rates AND the selected package doesn't already bundle food. */}
              {FOOD_INCLUSIVE_TIERS.has(approveForm.package_tier) ? (
                <p className="text-xs text-muted-foreground/60">
                  Food is billed automatically for this package
                  {foodMonthlyRate > 0 && (
                    <> — Rs. {foodMonthlyRate.toLocaleString()}/mo added on top of rent (total Rs. {(Number(approveForm.monthly_rent || 0) + foodMonthlyRate).toLocaleString()}/mo, shown as a separate line on the receipt)</>
                  )}.
                </p>
              ) : hasFoodAddonRates(foodAddonRates) && (
                  <div className="space-y-1.5">
                    <Label>Add Food? <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                    {hasIndividualFoodRates(foodAddonRates) ? (
                      <div className="rounded-xl border border-sidebar-border divide-y divide-sidebar-border overflow-hidden">
                        {([
                          { key: "food_breakfast" as const, label: "Breakfast", rate: foodAddonRates.food_breakfast_rate },
                          { key: "food_lunch" as const, label: "Lunch", rate: foodAddonRates.food_lunch_rate },
                          { key: "food_dinner" as const, label: "Dinner", rate: foodAddonRates.food_dinner_rate },
                        ]).filter((meal) => meal.rate > 0).map((meal) => {
                          const checked = approveForm[meal.key] ?? false;
                          return (
                            <button
                              key={meal.key}
                              type="button"
                              onClick={() => setApproveForm({ ...approveForm, [meal.key]: !checked })}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors",
                                checked ? "bg-amber/10 text-foreground" : "bg-card text-muted-foreground hover:bg-white/[0.02]"
                              )}
                            >
                              <span className="flex items-center gap-2.5">
                                <span className={cn(
                                  "w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center",
                                  checked ? "border-amber bg-amber" : "border-sidebar-border"
                                )}>
                                  {checked && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
                                </span>
                                {meal.label}
                              </span>
                              <span className={checked ? "text-amber font-medium" : ""}>+{formatCurrency(meal.rate)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      (() => {
                        const checked = approveForm.food_breakfast && approveForm.food_lunch && approveForm.food_dinner;
                        return (
                          <button
                            type="button"
                            onClick={() => setApproveForm({ ...approveForm, food_breakfast: !checked, food_lunch: !checked, food_dinner: !checked })}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl border transition-colors",
                              checked ? "bg-amber/10 border-amber/30 text-foreground" : "bg-card border-sidebar-border text-muted-foreground hover:bg-white/[0.02]"
                            )}
                          >
                            <span className="flex items-center gap-2.5">
                              <span className={cn(
                                "w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center",
                                checked ? "border-amber bg-amber" : "border-sidebar-border"
                              )}>
                                {checked && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
                              </span>
                              All Meals (Breakfast + Lunch + Dinner)
                            </span>
                            <span className={checked ? "text-amber font-medium" : ""}>+{formatCurrency(foodAddonRates.food_all_meals_rate)}</span>
                          </button>
                        );
                      })()
                    )}
                    {(approveForm.food_breakfast || approveForm.food_lunch || approveForm.food_dinner) && (
                      <p className="text-xs text-muted-foreground">
                        Food add-on: <span className="text-foreground font-medium">{formatCurrency(calcFoodAddonCharge(approveFormFoodFlags(approveForm), foodAddonRates))}</span>/mo — billed automatically on top of rent.
                      </p>
                    )}
                  </div>
              )}

              {/* Billing type */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Billing</Label>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => setApproveForm({ ...approveForm, billing_type: "monthly" })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${approveForm.billing_type === "monthly" ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                    Monthly
                  </button>
                  <button type="button"
                    onClick={() => setApproveForm({ ...approveForm, billing_type: "daily" })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${approveForm.billing_type === "daily" ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                    Daily
                  </button>
                </div>
              </div>

              {/* Rent + Deposit */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>{approveForm.billing_type === "monthly" ? "Monthly Rent (PKR)" : "Daily Rate (PKR)"}</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={approveForm.billing_type === "monthly" ? approveForm.monthly_rent || "" : approveForm.daily_rate || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setApproveForm(approveForm.billing_type === "monthly"
                        ? { ...approveForm, monthly_rent: val }
                        : { ...approveForm, daily_rate: val });
                    }}
                  />
                  {approveForm.billing_type === "monthly" && (approveForm.food_breakfast || approveForm.food_lunch || approveForm.food_dinner) && (() => {
                    const foodCharge = calcFoodAddonCharge(approveFormFoodFlags(approveForm), foodAddonRates);
                    return (
                      <p className="text-xs text-amber">
                        + {formatCurrency(foodCharge)} food = {formatCurrency(approveForm.monthly_rent + foodCharge)}/mo total
                      </p>
                    );
                  })()}
                </div>
                {/* 126 of the members on production were admitted through this
                    dialog rather than Add Member, so a concession agreed at
                    admission has to be settable here too — otherwise the owner
                    approves, then immediately edits. Monthly only: a nightly
                    bill carries no rent discount. */}
                {approveForm.billing_type === "monthly" && (
                  <div className="space-y-1.5">
                    <Label>Discount (%)</Label>
                    <Input
                      type="number" min="0" max="100" step="0.01" placeholder="0"
                      value={approveForm.discount_percent ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setApproveForm({ ...approveForm, discount_percent: raw.trim() === "" ? null : (parseFloat(raw) || 0) });
                      }}
                    />
                    {(() => {
                      const pct = Number(approveForm.discount_percent ?? 0);
                      if (!(pct > 0) || pct > 100) return null;
                      return (
                        <p className="text-xs text-emerald-400">
                          Effective rent: {formatCurrency(discountedRent(approveForm.monthly_rent || 0, pct))}/month
                        </p>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">Rent only — never food, AC or the deposit.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Security Deposit (PKR)</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={approveForm.security_deposit || ""}
                    onChange={(e) => setApproveForm({ ...approveForm, security_deposit: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                {configAcMaintenance > 0 && (
                  <div className="space-y-1.5">
                    <Label>AC Maintenance (PKR / month)</Label>
                    <Input
                      type="number" min="0"
                      placeholder={`Default ${configAcMaintenance}`}
                      value={approveForm.ac_maintenance ?? ""}
                      onChange={(e) => setApproveForm({ ...approveForm, ac_maintenance: e.target.value === "" ? null : (parseFloat(e.target.value) || 0) })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter 0 to waive it for this tenant.
                    </p>
                  </div>
                )}
                {configRegistrationFee > 0 && (
                  <div className="space-y-1.5">
                    <Label>Registration Fee</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={approveForm.registration_fee || ""}
                      onChange={(e) => setApproveForm({ ...approveForm, registration_fee: parseFloat(e.target.value) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground">One-time, non-refundable.</p>
                  </div>
                )}
              </div>

              {/* Check-in */}
              <div className="space-y-1.5">
                <Label>Check-in Date</Label>
                <Input
                  type="date"
                  value={approveForm.check_in}
                  onChange={(e) => setApproveForm({ ...approveForm, check_in: e.target.value })}
                />
              </div>

              {/* Personal-record fields, deliberately last before Vehicle —
                  same position as the Add Tenant dialog, so an owner giving an
                  admission reaches room, package and rent first.

                  Editable rather than read-only: they are prefilled from what
                  the applicant submitted, but an approver is often correcting a
                  typo or a wrong number, and this is the last point before the
                  data becomes a tenant record. */}
              <div className="space-y-1.5">
                <Label>Permanent Address</Label>
                <textarea
                  rows={2}
                  placeholder="House / street, area, city — the tenant's home address"
                  value={approveForm.permanent_address ?? ""}
                  onChange={(e) => setApproveForm({ ...approveForm, permanent_address: e.target.value })}
                  className="w-full rounded-lg border border-sidebar-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/50 resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Purpose of Visit</Label>
                <Select
                  value={approveForm.purpose_of_visit ?? ""}
                  onValueChange={(v) =>
                    setApproveForm({
                      ...approveForm,
                      purpose_of_visit: v,
                      purpose_of_visit_detail: v === "other" ? approveForm.purpose_of_visit_detail : "",
                    })
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                  <SelectContent>
                    {VISIT_PURPOSE_OPTIONS.map((pv) => (
                      <SelectItem key={pv} value={pv}>{VISIT_PURPOSE_LABELS[pv]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {approveForm.purpose_of_visit === "other" && (
                  <Input
                    placeholder="Please describe"
                    value={approveForm.purpose_of_visit_detail ?? ""}
                    onChange={(e) => setApproveForm({ ...approveForm, purpose_of_visit_detail: e.target.value })}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Father Name</Label>
                <Input
                  placeholder="Muhammad Khan"
                  value={approveForm.father_name ?? ""}
                  onChange={(e) => setApproveForm({ ...approveForm, father_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Emergency Contact</Label>
                  <Input
                    placeholder="Name"
                    value={approveForm.emergency_contact ?? ""}
                    onChange={(e) => setApproveForm({ ...approveForm, emergency_contact: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Emergency Phone</Label>
                  <Input
                    placeholder="+92 300 0000000"
                    value={approveForm.emergency_phone ?? ""}
                    onChange={(e) => setApproveForm({ ...approveForm, emergency_phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Emergency Relationship</Label>
                <Select
                  value={approveForm.emergency_relationship ?? ""}
                  onValueChange={(v) => setApproveForm({ ...approveForm, emergency_relationship: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select relationship" /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Vehicle — on-file record for safety verification and resolving
                  parking disputes. Always optional, no hostel-level gate. */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Vehicle Type</Label>
                  <Select value={approveForm.vehicle_type ?? ""} onValueChange={(v) => setApproveForm({ ...approveForm, vehicle_type: v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Motorcycle">Motorcycle</SelectItem>
                      <SelectItem value="Car">Car</SelectItem>
                      <SelectItem value="Rickshaw">Rickshaw</SelectItem>
                      <SelectItem value="Bicycle">Bicycle</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Plate Number</Label>
                  <Input
                    placeholder="e.g. ABC-123"
                    value={approveForm.vehicle_number ?? ""}
                    onChange={(e) => setApproveForm({ ...approveForm, vehicle_number: e.target.value || null })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <Input
                    placeholder="e.g. Honda CD 70"
                    value={approveForm.vehicle_model ?? ""}
                    onChange={(e) => setApproveForm({ ...approveForm, vehicle_model: e.target.value || null })}
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  placeholder="Any additional notes"
                  value={approveForm.notes ?? ""}
                  onChange={(e) => setApproveForm({ ...approveForm, notes: e.target.value || null })}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApprovingApp(null)}>Cancel</Button>
            <Button
              onClick={handleApproveApp}
              disabled={approveSaving}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {approveSaving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                : <><CheckCircle2 className="w-4 h-4" /> {approveForm.is_waiting ? "Add to Waitlist" : "Activate Tenant"}</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RedflagWarningDialog
        matches={redflagPrompt?.matches ?? null}
        proceedLabel="Add Anyway"
        onCancel={() => setRedflagPrompt(null)}
        onProceed={() => {
          const source = redflagPrompt?.source;
          setRedflagPrompt(null);
          if (source === "approve") void performApprove(true);
          else if (source === "save") void performSave();
        }}
      />

      <ConfirmDialog
        open={!!deleteTenant}
        title={`Delete ${deleteTenant?.full_name ?? "tenant"}?`}
        description={buildDeleteDescription(deleteTenant, deleteMoney, deleteMoneyError)}
        confirmDisabled={!deleteMoney && !deleteMoneyError}
        onConfirm={() => { if (deleteTenant) { handleDelete(deleteTenant); closeDeleteDialog(); } }}
        onCancel={closeDeleteDialog}
      />

      {/* Add / Edit Dialog */}
      {/* ── Export column picker ─────────────────────────── */}
      <Dialog open={!!exportFormat} onOpenChange={(o) => !o && setExportFormat(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Export {exportFormat === "pdf" ? "PDF" : "Excel"} — {getCurrentFilteredList().length} tenant
              {getCurrentFilteredList().length === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-1">
            <p className="text-xs text-muted-foreground mb-3">Choose what to include.</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 max-h-[46vh] overflow-y-auto">
              {EXPORT_COLUMNS.map((c) => {
                const on = exportCols.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() =>
                      setExportCols((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      })
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-left transition-colors",
                      on ? "border-amber/40 bg-amber/[0.07] text-foreground" : "border-sidebar-border text-muted-foreground hover:border-white/20"
                    )}
                  >
                    <span
                      className={cn(
                        "w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",
                        on ? "bg-amber border-amber" : "border-muted-foreground/40"
                      )}
                    >
                      {on && <Check className="w-2.5 h-2.5 text-background" />}
                    </span>
                    <span className="truncate">{c.label}</span>
                    {/* Named on the control itself: an owner ticking CNIC should
                        know what they are putting into a file they may forward. */}
                    {c.sensitive && <span className="ml-auto text-[9px] text-amber/80 shrink-0">private</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportFormat(null)}>Cancel</Button>
            <Button
              disabled={!!exportLoading}
              onClick={() => {
                const fmt = exportFormat;
                setExportFormat(null);
                if (fmt === "pdf") void exportPDF();
                else void exportExcel();
              }}
              className="bg-amber/10 border border-amber/25 text-amber hover:bg-amber/20"
            >
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewOnly
                ? "Tenant Details"
                : editing
                  ? editing.is_waiting
                    ? "Activate / Edit Tenant"
                    : "Edit Tenant"
                  : "Add Tenant"}
            </DialogTitle>
          </DialogHeader>
          <fieldset disabled={viewOnly} className="contents">
          <div className="grid gap-4 py-2">
            {/* Status toggle — always shown for new tenants; shown when editing a waiting tenant to allow activation */}
            {(!editing || editing.is_waiting) && (
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => setForm({ ...form, is_waiting: false })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${!form.is_waiting ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                  Active Resident
                </button>
                <button type="button"
                  onClick={() => setForm({ ...form, is_waiting: true, room_id: "" })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${form.is_waiting ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                  Waiting List
                </button>
              </div>
            )}

            {/* Managers have no hostelId client-side; uploadTenantPhoto resolves
                their active branch server-side and ignores this prop. */}
            {(hostelId || isManager) && (
              <div className="space-y-1.5">
                <Label>Photo</Label>
                <PhotoPicker
                  value={form.photo_url || null}
                  onChange={(url) => setForm({ ...form, photo_url: url })}
                  hostelId={hostelId ?? ""}
                  initials={form.full_name ? form.full_name.trim().charAt(0) : "?"}
                />
              </div>
            )}

            {/* Personal info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2"><Label>Full Name *</Label><Input placeholder="Ahmed Khan" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Phone *</Label><Input placeholder="+92 300 0000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>CNIC</Label>
                <Input
                  placeholder="44102-7891219-1"
                  value={form.cnic}
                  onChange={(e) => setForm({ ...form, cnic: formatCnic(e.target.value) })}
                  maxLength={15}
                />
                {form.cnic && !isValidCnic(form.cnic) && (
                  <p className="text-xs text-rose-400">Format: XXXXX-XXXXXXX-X</p>
                )}
              </div>
              {/* Spans both columns, so it must sit between two COMPLETE rows or
                  it splits a pair. The grid runs Phone|CNIC then Email|Type —
                  this is the boundary between them, directly under the phone
                  number that triggered it. */}
              <ReferralAdmissionBanner
                className="sm:col-span-2"
                phone={form.phone}
                rent={form.billing_type === "monthly" ? form.monthly_rent : form.daily_rate}
                onReferralFound={prefillReferredName}
              />
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" placeholder="tenant@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as SpaceType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Institute / Organization — Student or Professional, foundational
                data for a future roommate-matching platform. Institute Name sits
                next to Student Category for University/College (no Specialization
                step to sequence after), or after Specialization for Test Prep/
                Professional Course/Skills Training — pick what you're doing before
                where. */}
            {form.type === "student" && (
              <div className={studentCategoryHasSpecialization(form.student_category) ? "space-y-1.5" : "grid grid-cols-2 gap-4"}>
                <div className="space-y-1.5"><Label>Student Category</Label>
                  <Select
                    value={form.student_category}
                    onValueChange={(v) => {
                      const next = v as StudentCategory;
                      setCustomSpecialization(false);
                      // Institute name is category-specific (a university name doesn't
                      // belong to an Exam Prep record) — clear it along with
                      // specialization instead of carrying the old category's value over.
                      setCustomInstitute(false);
                      setForm({ ...form, student_category: next, student_specialization: "", institute_name: "" });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {STUDENT_CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>{STUDENT_CATEGORY_LABELS[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!studentCategoryHasSpecialization(form.student_category) && (
                  <div className="space-y-1.5"><Label>Institute Name</Label>
                    {renderInstituteField()}
                  </div>
                )}
              </div>
            )}
            {form.type === "student" && studentCategoryHasSpecialization(form.student_category) && (
              <div className="space-y-1.5">
                <Label>{STUDENT_CATEGORY_LABELS[form.student_category]} — Specialization</Label>
                {customSpecialization ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type the specific exam, certification, or skill"
                      value={form.student_specialization}
                      onChange={(e) => setForm({ ...form, student_specialization: e.target.value })}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-9 text-xs"
                      onClick={() => { setCustomSpecialization(false); setForm({ ...form, student_specialization: "" }); }}
                    >
                      Choose from list
                    </Button>
                  </div>
                ) : (
                  <SearchableSelect
                    value={form.student_specialization}
                    onValueChange={(v) => {
                      if (v === "other") {
                        setCustomSpecialization(true);
                        setForm({ ...form, student_specialization: "" });
                      } else {
                        setForm({ ...form, student_specialization: v });
                      }
                    }}
                    options={STUDENT_SPECIALIZATION_PRESETS[form.student_category]}
                    searchPlaceholder="Search..."
                    otherLabel="Other (specify)"
                  />
                )}
              </div>
            )}
            {form.type === "student" && studentCategoryHasSpecialization(form.student_category) && (
              <div className="space-y-1.5"><Label>Institute Name</Label>
                {renderInstituteField()}
              </div>
            )}
            {form.type === "professional" && (
              <div className="grid grid-cols-2 gap-4">
                {/* Type before name — pick the kind of employer, then name it. */}
                <div className="space-y-1.5"><Label>Organization Type</Label>
                  <Select
                    value={form.organization_type}
                    onValueChange={(v) => { setCustomOrganization(false); setForm({ ...form, organization_type: v as "private" | "government", organization: "" }); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="government">Government</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Organization</Label>
                  {organizationPresetsFor(form.organization_type).length > 0 && !customOrganization ? (
                    <SearchableSelect
                      value={form.organization}
                      onValueChange={(v) => {
                        if (v === "other") { setCustomOrganization(true); setForm({ ...form, organization: "" }); }
                        else setForm({ ...form, organization: v });
                      }}
                      options={organizationPresetsFor(form.organization_type)}
                      placeholder="Select organization"
                      searchPlaceholder="Search organizations..."
                      otherLabel="Other (specify)"
                    />
                  ) : organizationPresetsFor(form.organization_type).length > 0 ? (
                    <div className="flex gap-2">
                      <Input placeholder="Company / employer name" value={form.organization} autoFocus
                        onChange={(e) => setForm({ ...form, organization: e.target.value })} />
                      <Button type="button" variant="outline" size="sm" className="shrink-0 h-9 text-xs"
                        onClick={() => { setCustomOrganization(false); setForm({ ...form, organization: "" }); }}>
                        List
                      </Button>
                    </div>
                  ) : (
                    <Input placeholder="Company / employer name" value={form.organization}
                      onChange={(e) => setForm({ ...form, organization: e.target.value })} />
                  )}
                </div>
              </div>
            )}
            {(form.type === "professional" || (form.type === "student" && studentCategoryHasDepartment(form.student_category))) && (
              <div className="space-y-1.5"><Label>Department / Field</Label>
                {/* Both types get a dropdown — academic programmes for students,
                    workplace functions for professionals. */}
                {!customDepartment ? (
                  <SearchableSelect
                    value={form.department}
                    onValueChange={(v) => {
                      if (v === "other") { setCustomDepartment(true); setForm({ ...form, department: "" }); }
                      else setForm({ ...form, department: v });
                    }}
                    options={departmentPresetsFor(form.type)}
                    placeholder="Select department / field"
                    searchPlaceholder={form.type === "professional" ? "Search departments..." : "Search programmes..."}
                    otherLabel="Other (specify)"
                  />
                ) : (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type department / field"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                      autoFocus
                    />
                    <Button type="button" variant="outline" size="sm" className="shrink-0 h-9 text-xs"
                      onClick={() => { setCustomDepartment(false); setForm({ ...form, department: "" }); }}>
                      List
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Room + Bed — must come before Package Tier so AC status is known */}
            {!form.is_waiting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Room *</Label>
                  <Select value={form.room_id} onValueChange={(v) => {
                    const room = rooms.find((r) => r.id === v);
                    const hasWashroom = !!room?.has_attached_washroom;
                    const pkgSuggested = room
                      ? (form.custom_package_id
                          ? addWashroomPremium(getCustomPackagePrice(customPackages, form.custom_package_id, room.has_ac), hasWashroom, washroomPremium)
                          : getTierPriceString(room, form.package_tier, pkgPrices, seaterPrices, washroomPremium))
                      : "";
                    const fallback = addWashroomPremium(room?.monthly_rent?.toString() ?? "", hasWashroom, washroomPremium);
                    const tierPrices = pkgPrices[form.package_tier];
                    const tierDeposit = room
                      ? (form.custom_package_id
                          ? getCustomPackageDeposit(customPackages, form.custom_package_id, room.has_ac)
                          : (room.has_ac ? (tierPrices?.deposit_ac ?? 0) : (tierPrices?.deposit_no_ac ?? 0)))
                      : 0;
                    const suggestedDeposit = tierDeposit > 0 ? String(tierDeposit) : (configSecurityDeposit > 0 ? String(configSecurityDeposit) : "");
                    const deposit = !form.security_deposit ? suggestedDeposit : form.security_deposit;
                    setForm({ ...form, room_id: v, monthly_rent: pkgSuggested || fallback || form.monthly_rent, security_deposit: deposit });

                    // Only an EDIT can be a transfer — a new member has no room
                    // to leave. Cleared first so a re-pick never shows the
                    // previous destination's fields.
                    setTransferPreview(null);
                    setTransferFromReading("");
                    setTransferToReading("");
                    if (editing && v && editing.room_id && v !== editing.room_id) {
                      const req = ++transferReqRef.current;
                      setTransferChecking(true);
                      // Draw the panel NOW from what the page already knows. Which
                      // rooms are metered is a local fact — has_ac on the room, plus
                      // the branch's meter_all_rooms — so waiting on the round trip
                      // to render the two boxes left the operator staring at an
                      // unchanged dialog for as long as the server took, with no
                      // sign the room change had registered.
                      //
                      // Only three things genuinely need the server: each room's
                      // last recorded reading (a hint), and whether the destination
                      // has an opening for this month (which blocks the move). They
                      // merge in below. Save stays disabled until they arrive, so
                      // nothing can be submitted against a half-known panel.
                      const fromRoomLocal = roomMap[editing.room_id];
                      const toRoomLocal = roomMap[v];
                      const fromMeteredLocal = !!(fromRoomLocal?.has_ac || meterAllRooms);
                      const toMeteredLocal = !!(toRoomLocal?.has_ac || meterAllRooms);
                      if (fromMeteredLocal || toMeteredLocal) {
                        setTransferPreview({
                          fromRoomNumber: fromRoomLocal?.room_number ?? null,
                          toRoomNumber: toRoomLocal?.room_number ?? null,
                          fromMetered: fromMeteredLocal,
                          toMetered: toMeteredLocal,
                          fromLastReading: null,
                          toLastReading: null,
                          toBlocked: null,
                        });
                      }
                      getRoomTransferPreviewAction(editing.id, v)
                        .then((p) => {
                          if (req !== transferReqRef.current) return; // a later pick won
                          if (p.error) {
                            // Swallowing this used to leave the operator with no
                            // panel and no warning — indistinguishable from an
                            // unmetered move, which is how a metered one slipped
                            // through as a bare room change.
                            toast({ title: "Could not check the meters", description: p.error, variant: "destructive" });
                            setTransferPreview(null);
                            return;
                          }
                          if (!p.fromMetered && !p.toMetered) {
                            // The server disagrees with the local guess — clear the
                            // panel rather than leave two boxes asking for readings
                            // nothing will use.
                            setTransferPreview(null);
                            return;
                          }
                          setTransferPreview(p);
                          // Deliberately left EMPTY. These were prefilled with each
                          // room's last recorded reading, which is the month's
                          // OPENING — the one number that is never what the meter
                          // says at the moment of the move. Pressing Save without
                          // touching them was the path of least resistance and it
                          // silently closed the old room at zero units and opened
                          // the new one at offset zero, so the member paid nothing
                          // where they had been and got billed in the new room for
                          // everything burned before they arrived. Both figures are
                          // still shown underneath each box for reference; the
                          // operator is standing at the meter and has to type what
                          // it reads. Save stays disabled until they do.
                        })
                        .finally(() => {
                          if (req === transferReqRef.current) setTransferChecking(false);
                        });
                    }
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
                    <SelectContent>
                      {availableRooms.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          Room {r.room_number}{r.has_ac ? " · AC" : ""} · {r.capacity - r.occupied} free
                        </SelectItem>
                      ))}
                      {editing && editing.room_id && !availableRooms.find(r => r.id === editing.room_id) && (
                        <SelectItem value={editing.room_id}>Current room (keep)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Bed Number</Label><Input placeholder="A1" value={form.bed_number} onChange={(e) => setForm({ ...form, bed_number: e.target.value })} /></div>
              </div>
            )}

            {/* Room transfer on a metered room. Shown only when a meter is
                actually involved — a move between two unmetered rooms stays the
                one-click change it has always been. Each side is asked for
                independently: close the room being left, open the room being
                joined, and only where there is a meter to read. */}
            {transferPreview?.toBlocked && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/[0.07] p-3">
                <p className="text-xs font-medium text-destructive flex items-start gap-1.5">
                  <Zap className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{transferPreview.toBlocked}</span>
                </p>
              </div>
            )}
            {transferPreview && !transferPreview.toBlocked && (
              <div className="rounded-xl border border-amber/25 bg-amber/[0.06] p-3 space-y-3">
                <p className="text-xs font-medium text-amber flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  {transferPreview.fromMetered && transferPreview.toMetered
                    ? "Both rooms are metered — enter the readings at the time of the move"
                    : transferPreview.fromMetered
                      ? `Room ${transferPreview.fromRoomNumber} is metered — enter its reading at the time of the move`
                      : `Room ${transferPreview.toRoomNumber} is metered — enter its reading at the time of the move`}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {transferPreview.fromMetered && (
                    <div className="space-y-1">
                      <Label className="text-xs">Room {transferPreview.fromRoomNumber} meter now</Label>
                      <Input
                        type="number" min="0" max="999999" inputMode="numeric"
                        placeholder="Read the meter now"
                        value={transferFromReading}
                        onChange={(e) => setTransferFromReading(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {transferChecking
                          ? "Checking the meter…"
                          : transferPreview.fromLastReading != null
                            ? `Last recorded ${transferPreview.fromLastReading.toLocaleString()}`
                            : "No earlier reading on file"}
                      </p>
                    </div>
                  )}
                  {transferPreview.toMetered && (
                    <div className="space-y-1">
                      <Label className="text-xs">Room {transferPreview.toRoomNumber} meter now</Label>
                      <Input
                        type="number" min="0" max="999999" inputMode="numeric"
                        placeholder="Read the meter now"
                        value={transferToReading}
                        onChange={(e) => setTransferToReading(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {transferChecking
                          ? "Checking the meter…"
                          : transferPreview.toLastReading != null
                            ? `Last recorded ${transferPreview.toLastReading.toLocaleString()}`
                            : "No earlier reading on file"}
                      </p>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {form.full_name || "This member"} pays room {transferPreview.fromRoomNumber ?? "—"}
                  {transferPreview.fromMetered && transferFromReading ? ` up to ${Number(transferFromReading).toLocaleString()}` : ""}
                  , and room {transferPreview.toRoomNumber}
                  {transferPreview.toMetered && transferToReading ? ` from ${Number(transferToReading).toLocaleString()}` : ""} onward.
                </p>
              </div>
            )}

            {/* A move already recorded this month, and the way back from a slipped
                digit. Hidden while a NEW destination is being picked — one dialog
                cannot both make a move and re-price the last one. */}
            {correction && !transferPreview && (
              <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/20 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      Moved {correction.fromRoomNumber} → {correction.toRoomNumber} on {formatDate(correction.movedOn)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {correction.fromRoomNumber} meter: {correction.fromRoomReading.toLocaleString()}
                      {" · "}{correction.billedUnits} units → {formatCurrency(correction.billedCharge)}
                      {correction.toRoomReading != null && <> · {correction.toRoomNumber} meter: {correction.toRoomReading.toLocaleString()}</>}
                    </p>
                  </div>
                  {!correctionOpen && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs shrink-0"
                      onClick={() => setCorrectionOpen(true)}>
                      Fix readings
                    </Button>
                  )}
                </div>
                {correctionOpen && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Room {correction.fromRoomNumber} meter at the move</Label>
                        <Input type="number" min="0" max="999999" inputMode="numeric"
                          value={correctFrom} onChange={(e) => setCorrectFrom(e.target.value)} />
                      </div>
                      {correction.toRoomReading != null && (
                        <div className="space-y-1">
                          <Label className="text-xs">Room {correction.toRoomNumber} meter at the move</Label>
                          <Input type="number" min="0" max="999999" inputMode="numeric"
                            value={correctTo} onChange={(e) => setCorrectTo(e.target.value)} />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Re-prices the move and re-splits both rooms. The original entry stays in the ledger.
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="h-7 text-xs"
                        disabled={correcting || correctFrom.trim() === "" || (correction.toRoomReading != null && correctTo.trim() === "")}
                        onClick={async () => {
                          setCorrecting(true);
                          const res = await correctRoomTransferAction({
                            tenantId: editing!.id,
                            fromRoomReading: Number(correctFrom),
                            toRoomReading: correction.toRoomReading != null ? Number(correctTo) : null,
                          });
                          setCorrecting(false);
                          if (!res.success) {
                            toast({ title: "Readings not changed", description: res.error, variant: "destructive" });
                            return;
                          }
                          const r = res.result!;
                          toast({
                            title: r.warning ? "Re-priced — one thing left to finish" : "Move re-priced",
                            description: r.warning
                              ?? `Room ${r.fromRoomNumber}: ${r.closedUnits} units (${formatCurrency(r.closedCharge)}), was ${r.previousUnits} units (${formatCurrency(r.previousCharge)}).`,
                            variant: r.warning ? "destructive" : undefined,
                          });
                          setCorrectionOpen(false);
                          setCorrection(null);
                          router.refresh();
                        }}>
                        {correcting ? "Saving…" : "Save readings"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                        onClick={() => setCorrectionOpen(false)} disabled={correcting}>
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* AC Meter Reading at move-in — printed on the tenant's receipt so
                there's a documented reference if AC billing is ever disputed. */}
            {!form.is_waiting && form.room_id && rooms.find((r) => r.id === form.room_id)?.has_ac && (
              <div className="space-y-1.5">
                <Label>AC Meter Reading at Move-in</Label>
                <Input
                  type="number" min={0} step="0.01"
                  placeholder="e.g. 1284.5"
                  value={form.joining_meter_reading}
                  onChange={(e) => setForm({ ...form, joining_meter_reading: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Optional — recorded on the tenant's receipt to avoid future disputes over AC billing.</p>

                {/* The number above is the operator's word; this is the proof.
                    On a phone the picker opens the rear camera directly, so the
                    photo gets taken standing at the meter rather than hunted for
                    later. */}
                <MeterPhoto
                  label="move-in photo"
                  path={editing?.joining_meter_photo ?? null}
                  stagedLabel={joiningPhotoFile?.name}
                  onUpload={async (file) => {
                    // Editing an existing tenant: the id exists, so store it now.
                    // Adding: no row yet — stage it and let handleSave upload.
                    if (editing) {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await uploadJoiningMeterPhoto(editing.id, fd);
                      if (!res.error) {
                        // `editing` is a snapshot taken when the dialog opened.
                        // reload() refreshes the LIST behind it, but this dialog
                        // renders from the snapshot, so without patching it the
                        // control keeps showing the replaced photo until a full
                        // page load re-seeds the state.
                        setEditing((prev) => (prev ? { ...prev, joining_meter_photo: res.path ?? null } : prev));
                        await reload();
                      }
                      return res;
                    }
                    setJoiningPhotoFile(file);
                    return {};
                  }}
                  onDelete={
                    editing?.joining_meter_photo
                      ? async () => {
                          const res = await deleteJoiningMeterPhoto(editing.id);
                          if (!res.error) {
                            setEditing((prev) => (prev ? { ...prev, joining_meter_photo: null } : prev));
                            await reload();
                          }
                          return res;
                        }
                      : joiningPhotoFile
                      ? async () => { setJoiningPhotoFile(null); return {}; }
                      : undefined
                  }
                />
              </div>
            )}

            {/* Package Tier — predefined + custom packages, all always selectable */}
            {(() => {
              const selectedRoom = form.room_id ? rooms.find((r) => r.id === form.room_id) : null;
              const selectValue = form.custom_package_id ? `custom:${form.custom_package_id}` : `tier:${form.package_tier}`;
              return (
                <div className="space-y-1.5">
                  <Label>Package Tier *</Label>
                  <Select
                    value={selectValue}
                    disabled={!form.is_waiting && !form.room_id}
                    onValueChange={(v) => {
                      if (v.startsWith("custom:")) {
                        const id = v.slice("custom:".length);
                        const custom = customPackages.find((c) => c.id === id);
                        if (!custom) return;
                        const suggested = addWashroomPremium(
                          selectedRoom ? getCustomPackagePrice(customPackages, id, selectedRoom.has_ac) : "",
                          !!selectedRoom?.has_attached_washroom, washroomPremium
                        );
                        const tierDeposit = selectedRoom ? getCustomPackageDeposit(customPackages, id, selectedRoom.has_ac) : 0;
                        const suggestedDeposit = tierDeposit > 0 ? String(tierDeposit) : (configSecurityDeposit > 0 ? String(configSecurityDeposit) : "");
                        // Custom packages always bill as space_only — their price is a flat, all-inclusive
                        // number the owner set directly, so no separate food charge is added on top.
                        setForm({ ...form, package_tier: "space_only", custom_package_id: id, monthly_rent: suggested || form.monthly_rent, security_deposit: suggestedDeposit || form.security_deposit });
                      } else {
                        const tier = v.slice("tier:".length) as PackageTier;
                        const suggested = selectedRoom
                          ? getTierPriceString(selectedRoom, tier, pkgPrices, seaterPrices, washroomPremium)
                          : "";
                        const tierPrices = pkgPrices[tier];
                        const tierDeposit = selectedRoom
                          ? (selectedRoom.has_ac ? (tierPrices?.deposit_ac ?? 0) : (tierPrices?.deposit_no_ac ?? 0))
                          : 0;
                        const suggestedDeposit = tierDeposit > 0 ? String(tierDeposit) : (configSecurityDeposit > 0 ? String(configSecurityDeposit) : "");
                        // Clear any add-on meal selection when switching to a package that
                        // already bundles food — prevents a stale double-charge on save.
                        const clearFood = FOOD_INCLUSIVE_TIERS.has(tier)
                          ? { food_breakfast: false, food_lunch: false, food_dinner: false }
                          : {};
                        setForm({ ...form, package_tier: tier, custom_package_id: null, monthly_rent: suggested || form.monthly_rent, security_deposit: suggestedDeposit || form.security_deposit, ...clearFood });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!form.is_waiting && !form.room_id ? "Select a room first" : "Select package"} />
                    </SelectTrigger>
                    <SelectContent>
                      {SELECTABLE_TIERS.map(({ tier, label }) => {
                        const p = pkgPrices[tier];
                        let price = selectedRoom && p
                          ? (selectedRoom.has_ac ? p.ac : p.no_ac)
                          : null;
                        // Seater price (by capacity + AC) takes priority for "space_only" —
                        // scoped to washroom-flagged rooms only, matching getTierPriceString,
                        // so this hint stays exactly as before for every other room.
                        if (selectedRoom && tier === "space_only" && selectedRoom.has_attached_washroom) {
                          const seater = getSeaterPrice(selectedRoom.capacity, selectedRoom.has_ac, seaterPrices);
                          if (seater !== null) price = seater;
                        }
                        if (price != null && price > 0 && selectedRoom?.has_attached_washroom) price += washroomPremium;
                        return (
                          <SelectItem key={`tier:${tier}`} value={`tier:${tier}`}>
                            <span>{label}</span>
                            {price != null && price > 0 && (
                              <span className="ml-1.5 text-xs text-muted-foreground">Rs. {price.toLocaleString()}</span>
                            )}
                          </SelectItem>
                        );
                      })}
                      {customPackages.map((c) => {
                        let price = selectedRoom ? (selectedRoom.has_ac ? c.ac : c.no_ac) : null;
                        if (price != null && price > 0 && selectedRoom?.has_attached_washroom) price += washroomPremium;
                        return (
                          <SelectItem key={`custom:${c.id}`} value={`custom:${c.id}`}>
                            <span>{c.name}</span>
                            {price != null && price > 0 && (
                              <span className="ml-1.5 text-xs text-muted-foreground">Rs. {price.toLocaleString()}</span>
                            )}
                          </SelectItem>
                        );
                      })}
                      {/* space_food_ac is excluded from SELECTABLE_TIERS for NEW tenants (the
                          modern equivalent is the "space_food" tier on an AC room), but tenants
                          who already carry this tier (still assignable via the public join form's
                          fallback tier list, so not just legacy data) must still see it here as a
                          matching option — otherwise the Select can't display or keep their actual
                          tier and silently shows/reverts to whatever the first item is. */}
                      {editing?.package_tier === "space_food_ac" && (
                        <SelectItem value="tier:space_food_ac">
                          <span>{PACKAGE_TIER_LABELS.space_food_ac}</span>
                        </SelectItem>
                      )}
                      {/* Same mismatch class as space_food_ac above — if this tenant's custom
                          package was since renamed/removed from the hostel's config, it won't
                          be in customPackages, so surface it as an "unavailable" fallback
                          instead of the Select silently reverting to Space Only. */}
                      {editing?.custom_package_id && !customPackages.some((c) => c.id === editing.custom_package_id) && (
                        <SelectItem value={`custom:${editing.custom_package_id}`}>
                          <span>Custom Package (unavailable)</span>
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {!form.is_waiting && !form.room_id && (
                    <p className="text-xs text-muted-foreground/50">Select a room first to see available packages</p>
                  )}
                </div>
              );
            })()}

            {/* Food Add-on — optional, independent of package tier. Only shown if the hostel
                configured rates AND the selected package doesn't already bundle food (avoids
                double-charging once via the tier's flat rate and again via the add-on). */}
            {FOOD_INCLUSIVE_TIERS.has(form.package_tier) ? (
              <p className="text-xs text-muted-foreground/60">
                Food is billed automatically for this package
                {foodMonthlyRate > 0 && (
                  <> — Rs. {foodMonthlyRate.toLocaleString()}/mo added on top of rent (total Rs. {(Number(form.monthly_rent || 0) + foodMonthlyRate).toLocaleString()}/mo, shown as a separate line on the receipt)</>
                )}.
              </p>
            ) : hasFoodAddonRates(foodAddonRates) && (
                <div className="space-y-1.5">
                  <Label>Add Food? <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                  {hasIndividualFoodRates(foodAddonRates) ? (
                    <div className="rounded-xl border border-sidebar-border divide-y divide-sidebar-border overflow-hidden">
                      {([
                        { key: "food_breakfast" as const, label: "Breakfast", rate: foodAddonRates.food_breakfast_rate },
                        { key: "food_lunch" as const, label: "Lunch", rate: foodAddonRates.food_lunch_rate },
                        { key: "food_dinner" as const, label: "Dinner", rate: foodAddonRates.food_dinner_rate },
                      ]).filter((meal) => meal.rate > 0).map((meal) => {
                        const checked = form[meal.key];
                        return (
                          <button
                            key={meal.key}
                            type="button"
                            onClick={() => setForm({ ...form, [meal.key]: !checked })}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors",
                              checked ? "bg-amber/10 text-foreground" : "bg-card text-muted-foreground hover:bg-white/[0.02]"
                            )}
                          >
                            <span className="flex items-center gap-2.5">
                              <span className={cn(
                                "w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center",
                                checked ? "border-amber bg-amber" : "border-sidebar-border"
                              )}>
                                {checked && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
                              </span>
                              {meal.label}
                            </span>
                            <span className={checked ? "text-amber font-medium" : ""}>+{formatCurrency(meal.rate)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    // Bundle-only hostel — no individual meal rates, so offer a single
                    // combined toggle instead of 3 checkboxes with undefined partial pricing.
                    (() => {
                      const checked = form.food_breakfast && form.food_lunch && form.food_dinner;
                      return (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, food_breakfast: !checked, food_lunch: !checked, food_dinner: !checked })}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl border transition-colors",
                            checked ? "bg-amber/10 border-amber/30 text-foreground" : "bg-card border-sidebar-border text-muted-foreground hover:bg-white/[0.02]"
                          )}
                        >
                          <span className="flex items-center gap-2.5">
                            <span className={cn(
                              "w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center",
                              checked ? "border-amber bg-amber" : "border-sidebar-border"
                            )}>
                              {checked && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
                            </span>
                            All Meals (Breakfast + Lunch + Dinner)
                          </span>
                          <span className={checked ? "text-amber font-medium" : ""}>+{formatCurrency(foodAddonRates.food_all_meals_rate)}</span>
                        </button>
                      );
                    })()
                  )}
                  {(form.food_breakfast || form.food_lunch || form.food_dinner) && (
                    <p className="text-xs text-muted-foreground">
                      Food add-on: <span className="text-foreground font-medium">{formatCurrency(calcFoodAddonCharge(form, foodAddonRates))}</span>/mo — billed automatically on top of rent.
                    </p>
                  )}
                </div>
            )}

            {/* Billing type toggle */}
            <div className="flex gap-2">
              <button type="button"
                onClick={() => setForm({ ...form, billing_type: "monthly" })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${form.billing_type === "monthly" ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                Monthly
              </button>
              <button type="button"
                onClick={() => setForm({ ...form, billing_type: "daily" })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${form.billing_type === "daily" ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                Daily
              </button>
            </div>

            {form.billing_type === "monthly" ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Monthly Rent (PKR)</Label>
                  <Input type="number" placeholder="0" value={form.monthly_rent} onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} />
                  {(form.food_breakfast || form.food_lunch || form.food_dinner) && (() => {
                    const foodCharge = calcFoodAddonCharge(form, foodAddonRates);
                    const rent = parseFloat(form.monthly_rent) || 0;
                    return (
                      <p className="text-xs text-amber">
                        + {formatCurrency(foodCharge)} food = {formatCurrency(rent + foodCharge)}/mo total
                      </p>
                    );
                  })()}
                </div>
                <div className="space-y-1.5">
                  <Label>Discount (%)</Label>
                  <Input
                    type="number" min="0" max="100" step="0.01" placeholder="0"
                    value={form.discount_percent}
                    onChange={(e) => setForm({ ...form, discount_percent: e.target.value })}
                  />
                  {(() => {
                    const pct = parseFloat(form.discount_percent);
                    if (!(pct > 0) || pct > 100) return null;
                    const rent = parseFloat(form.monthly_rent) || 0;
                    return (
                      <p className="text-xs text-emerald-400">
                        Effective rent: {formatCurrency(discountedRent(rent, pct))}/month
                      </p>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground">Rent only — never food, AC or the deposit.</p>
                </div>
                <div className="space-y-1.5"><Label>Security Deposit (PKR)</Label><Input type="number" placeholder="0" value={form.security_deposit} onChange={(e) => setForm({ ...form, security_deposit: e.target.value })} /></div>
                {configAcMaintenance > 0 && (
                  <div className="space-y-1.5">
                    <Label>AC Maintenance (PKR / month)</Label>
                    <Input
                      type="number" min="0"
                      placeholder={`Default ${configAcMaintenance}`}
                      value={form.ac_maintenance}
                      onChange={(e) => setForm({ ...form, ac_maintenance: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter 0 to waive it for this tenant.
                    </p>
                  </div>
                )}
                {configRegistrationFee > 0 && (
                  <div className="space-y-1.5">
                    <Label>Registration Fee</Label>
                    <Input type="number" placeholder="0" value={form.registration_fee} onChange={(e) => setForm({ ...form, registration_fee: e.target.value })} />
                    <p className="text-xs text-muted-foreground">One-time, non-refundable.</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Daily Rate (PKR)</Label><Input type="number" placeholder="0" value={form.daily_rate} onChange={(e) => setForm({ ...form, daily_rate: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Security Deposit (PKR)</Label><Input type="number" placeholder="0" value={form.security_deposit} onChange={(e) => setForm({ ...form, security_deposit: e.target.value })} /></div>
                </div>
                {configAcMaintenance > 0 && (
                  <div className="space-y-1.5">
                    <Label>AC Maintenance (PKR / month)</Label>
                    <Input
                      type="number" min="0"
                      placeholder={`Default ${configAcMaintenance}`}
                      value={form.ac_maintenance}
                      onChange={(e) => setForm({ ...form, ac_maintenance: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter 0 to waive it for this tenant.
                    </p>
                  </div>
                )}
                {configRegistrationFee > 0 && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                    <Label>Registration Fee</Label>
                    <Input type="number" placeholder="0" value={form.registration_fee} onChange={(e) => setForm({ ...form, registration_fee: e.target.value })} />
                    <p className="text-xs text-muted-foreground">One-time, non-refundable.</p>
                  </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Check-in Date *</Label><Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Expected Check-out *</Label><Input type="date" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} /></div>
                </div>
                {(() => {
                  const rate = parseFloat(form.daily_rate) || 0;
                  const days = form.check_in && form.check_out
                    ? Math.max(0, Math.round((parseLocalDate(form.check_out).getTime() - parseLocalDate(form.check_in).getTime()) / 86400000))
                    : 0;
                  if (!rate || !days) return null;
                  return (
                    <div className="flex items-center justify-between rounded-lg bg-amber/[0.06] border border-amber/20 px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">{days} day{days !== 1 ? "s" : ""} × {formatCurrency(rate)}/day</span>
                      <span className="text-sm font-bold text-amber">{formatCurrency(days * rate)}</span>
                    </div>
                  );
                })()}
              </>
            )}

            {/* Check-in date for monthly billing. Shown for waiting-list members
                too: a pre-booked bed is booked FROM a date, and without this the
                date was silently forced to today on every save, so "reserve from
                5 August" could not be recorded at all. It also decides which
                months a reservation deposit may be taken for. */}
            {form.billing_type === "monthly" && (
              <div className="space-y-1.5">
                <Label>{form.is_waiting ? "Expected Joining Date" : "Check-in Date *"}</Label>
                <Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} />
                {form.is_waiting && (
                  <p className="text-xs text-muted-foreground">
                    Rent starts from this date. A reservation deposit can only be taken for a month before it.
                  </p>
                )}
              </div>
            )}

            {/* Personal-record fields, deliberately last before Vehicle. An
                owner giving an admission works top-down through room, package
                and rent; these are details filled in afterwards, so putting
                them up front pushed the commercial decisions below the fold.
                Order matches the Approve Application dialog. */}
            <div className="space-y-1.5">
              <Label>Permanent Address</Label>
              <textarea
                rows={2}
                placeholder="House / street, area, city — the tenant's home address"
                value={form.permanent_address}
                onChange={(e) => setForm({ ...form, permanent_address: e.target.value })}
                className="w-full rounded-lg border border-sidebar-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/50 resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Purpose of Visit</Label>
              <Select
                value={form.purpose_of_visit}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    purpose_of_visit: v as VisitPurpose,
                    purpose_of_visit_detail: v === "other" ? form.purpose_of_visit_detail : "",
                  })
                }
              >
                <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                <SelectContent>
                  {VISIT_PURPOSE_OPTIONS.map((pv) => (
                    <SelectItem key={pv} value={pv}>{VISIT_PURPOSE_LABELS[pv]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.purpose_of_visit === "other" && (
                <Input
                  placeholder="Please describe"
                  value={form.purpose_of_visit_detail}
                  onChange={(e) => setForm({ ...form, purpose_of_visit_detail: e.target.value })}
                />
              )}
            </div>

            {/* Required when adding, not when editing: the 671 tenants who
                predate this field have no father name on record, and blocking
                Save would lock every one of them out of an unrelated edit. */}
            <div className="space-y-1.5"><Label>Father Name{editing ? "" : " *"}</Label><Input placeholder="Muhammad Khan" value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} /></div>

            <div className="grid grid-cols-2 gap-4">
              {/* Same add-vs-edit rule as Father Name: 467 of the 671 existing
                  tenants have no emergency contact on record, so gating Save on
                  edit would lock them out of unrelated changes. */}
              <div className="space-y-1.5"><Label>Emergency Contact{editing ? "" : " *"}</Label><Input placeholder="Name" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Emergency Phone{editing ? "" : " *"}</Label><Input placeholder="+92 300 0000000" value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Relationship</Label>
              <Select value={form.emergency_relationship} onValueChange={(v) => setForm({ ...form, emergency_relationship: v })}>
                <SelectTrigger><SelectValue placeholder="Select relationship" /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Vehicle — on-file record for safety verification and resolving
                parking disputes. Always optional, no hostel-level gate. */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Vehicle Type</Label>
                <Select value={form.vehicle_type} onValueChange={(v) => setForm({ ...form, vehicle_type: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Motorcycle">Motorcycle</SelectItem>
                    <SelectItem value="Car">Car</SelectItem>
                    <SelectItem value="Rickshaw">Rickshaw</SelectItem>
                    <SelectItem value="Bicycle">Bicycle</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Plate Number</Label><Input placeholder="e.g. ABC-123" value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Model</Label><Input placeholder="e.g. Honda CD 70" value={form.vehicle_model} onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })} /></div>
            </div>

            <div className="space-y-1.5"><Label>Notes</Label><Input placeholder="Any additional notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          </fieldset>

          {/* Documents — only shown when editing an existing tenant, and hidden
              in view-only mode since DocumentManager's upload/delete controls
              have no read-only variant. Hidden for managers, whose document
              actions are owner/partner-gated. */}
          {editing && !isManager && !viewOnly && (
            <div className="pt-2 border-t border-sidebar-border">
              <DocumentManager
                tenantId={editing.id}
                tenantName={editing.full_name}
                documents={editingDocs}
                onChange={setEditingDocs}
              />
            </div>
          )}
          <DialogFooter>
            {viewOnly ? (
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Close</Button>
            ) : (
              <>
                {/* The RedFlag check is advisory and fails open, so the add always
                    proceeds — but an operator must never read a silent pass as
                    "this person is clean" when nothing was actually checked. */}
                {redflagUnavailable && !editing && (
                  <span className="text-xs text-amber mr-auto self-center">
                    RedFlag check unavailable — not verified
                  </span>
                )}
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving || redflagChecking || transferChecking || transferReadingsMissing || transferBlocked || !form.full_name || (!editing && (!form.father_name.trim() || !form.emergency_contact.trim() || !form.emergency_phone.trim())) || (!form.is_waiting && !form.check_in)}>
                  {transferChecking
                    ? "Checking meters…"
                    : redflagChecking
                    ? "Checking…"
                    : saving
                    ? "Saving…"
                    : editing
                      ? editing.is_waiting && !form.is_waiting
                        ? "Activate Tenant"
                        : "Update"
                      : "Add Tenant"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout Dialog */}
      <Dialog open={!!checkingOut} onOpenChange={(open) => { if (!open) resetCheckoutState(); }}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="w-4 h-4 text-rose-400" />
              Check Out
            </DialogTitle>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground">{checkingOut?.full_name}</span>
              {checkingOut?.room_id && roomMap[checkingOut.room_id] && (
                <Badge variant="outline" className="text-xs border-amber/30 text-amber">
                  Rm {roomMap[checkingOut.room_id].room_number}
                </Badge>
              )}
            </div>
          </DialogHeader>

          {/* UX-F6: disable all options (not footer) while submission is in flight */}
          <div className={cn("space-y-5 py-1", checkoutSubmitting && "pointer-events-none opacity-50")}>
            {/* Notice on file — shown so the owner can see it while confirming checkout */}
            {checkingOut?.intended_checkout_date && (() => {
              const daysNotice = computeDaysNotice(checkingOut);
              const adequate = daysNotice != null && daysNotice >= noticePeriodDays;
              return (
                <div className={cn(
                  "rounded-xl border p-3 flex items-center justify-between gap-2",
                  adequate ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber/20 bg-amber/5"
                )}>
                  <div className="flex items-center gap-1.5 text-sm">
                    <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                    <span>Notice on file: leaving {formatDate(checkingOut.intended_checkout_date)}</span>
                  </div>
                  {daysNotice != null && (
                    <span className={cn("text-xs font-medium whitespace-nowrap", adequate ? "text-emerald-400" : "text-amber")}>
                      {daysNotice}d notice {adequate ? "✓" : "⚠ short"}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Section 1 — Departure Date */}
            <div className="space-y-1.5">
              {/* UX-F7: link label to input with id/htmlFor */}
              <Label htmlFor="checkout-date">Departure Date</Label>
              <input
                id="checkout-date"
                type="date"
                value={checkoutDate}
                onChange={(e) => setCheckoutDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-sidebar-border bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber/50"
              />
            </div>

            {/* Section 2 — meter reading at departure. Shown for an AC room, and
                for every room on a branch that meters all of them. */}
            {checkingOut?.room_id && (roomMap[checkingOut.room_id]?.has_ac || meterAllRooms) && (
              <div className="space-y-2">
                <Label htmlFor="checkout-ac-reading" className="flex items-center gap-1.5">
                  AC Meter Reading at Departure
                  <span className="text-xs text-muted-foreground font-normal">(optional, for accurate billing)</span>
                </Label>

                {checkoutACContextLoading ? (
                  <div className="h-9 w-full rounded-lg bg-white/5 animate-pulse" />
                ) : (
                  <>
                    {checkoutACContext?.prevMonthReading != null ? (
                      <p className="text-xs text-muted-foreground">
                        Previous month ended at:{" "}
                        <span className="text-foreground font-medium">{checkoutACContext.prevMonthReading.toLocaleString()}</span>
                        {checkoutACContext.prevMonthUnits != null && (
                          <span className="ml-2 text-muted-foreground/70">({checkoutACContext.prevMonthUnits.toLocaleString()} units consumed)</span>
                        )}
                      </p>
                    ) : (() => {
                      // Prefer the exact opening the AC Units tab already used this
                      // month (backed out from what it saved) over the generic
                      // move-in-reading fallback — must match checkoutMath's own
                      // priority order, or the message and the estimate disagree.
                      const impliedOpening = (checkoutACContext?.currentMonthReading != null && checkoutACContext?.currentMonthUnits != null)
                        ? checkoutACContext.currentMonthReading - checkoutACContext.currentMonthUnits
                        : null;
                      const suggestedOpening = impliedOpening ?? checkoutACContext?.derivedOpening ?? null;
                      return (
                        <div className="space-y-1.5">
                          <p className="text-xs text-amber/80">
                            {impliedOpening != null
                              ? `No previous month record found — auto-filled from this month's AC Units opening (${impliedOpening.toLocaleString()}); edit it if the meter started elsewhere`
                              : suggestedOpening != null
                                ? `No previous month record found — auto-filled from the move-in reading (${suggestedOpening.toLocaleString()}); edit it if the meter started elsewhere`
                                : "No previous month record found — enter the meter reading at the start of this month"}
                          </p>
                          <input
                            type="number"
                            min="0"
                            max="999999"
                            value={checkoutACOpeningReading}
                            onChange={(e) => setCheckoutACOpeningReading(e.target.value)}
                            placeholder={suggestedOpening != null ? String(suggestedOpening) : "Opening reading (month start)"}
                            className="h-9 w-full rounded-lg border border-amber/30 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/50"
                          />
                        </div>
                      );
                    })()}
                    {checkoutACContext?.currentMonthReading != null && (
                      checkoutACContext.currentMonthVacant ? (
                        // The box below is deliberately EMPTY here: this reading
                        // was taken while the room stood empty, before this tenant
                        // arrived, so it is not their departure reading. Saying
                        // "auto-filled" over an empty box was worse than the
                        // pre-fill it replaced.
                        //
                        // It asserts nothing about the OPENING. The dialog and the
                        // server both rank the previous month's reading first, and
                        // the line above may already be showing a different number
                        // for that field — claiming this one "is the opening" put
                        // two contradictory openings on the same screen. The second
                        // sentence appears only where there is a box to act on.
                        <p className="text-xs text-amber/80">
                          This month&apos;s reading ({checkoutACContext.currentMonthReading.toLocaleString()}) was recorded while the room stood empty, so it is not this tenant&apos;s departure reading — enter the meter as it reads now.
                          {checkoutACContext.prevMonthReading == null && ` If this tenant should not pay for the empty period, set the opening above to ${checkoutACContext.currentMonthReading.toLocaleString()}.`}
                        </p>
                      ) : (
                        // States the room's figure without proposing it. The old
                        // wording ("edit below if the meter has moved since") only
                        // ever invited raising the number, when a departure reading
                        // is almost always LOWER than the room's month-end one.
                        <p className="text-xs text-muted-foreground">
                          This room was read at {checkoutACContext.currentMonthReading.toLocaleString()} for the month. Enter the meter as it read when this member left — usually lower, if they left before the month ended.
                        </p>
                      )
                    )}
                    <input
                      id="checkout-ac-reading"
                      type="number"
                      min="0"
                      max="999999"
                      value={checkoutACReading}
                      onChange={(e) => setCheckoutACReading(e.target.value)}
                      placeholder={checkoutACContext?.prevMonthReading != null ? `> ${checkoutACContext.prevMonthReading.toLocaleString()}` : "Current meter reading at departure"}
                      className="h-9 w-full rounded-lg border border-sidebar-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/50"
                    />
                    {(() => {
                      // Reuse checkoutMath rather than recomputing — a second copy of this
                      // sum is how the summary drifted from what actually got charged.
                      const reading = Number(checkoutACReading);
                      // Same ranking checkoutMath uses, including the opening backed
                      // out of this month's Apply — a different one here quotes a
                      // different number of units than the charge was derived from.
                      const impliedOpening = (checkoutACContext?.currentMonthReading != null && checkoutACContext?.currentMonthUnits != null)
                        ? checkoutACContext.currentMonthReading - checkoutACContext.currentMonthUnits
                        : null;
                      const prev = checkoutACContext?.prevMonthReading
                        ?? (checkoutACOpeningReading.trim() !== "" ? Number(checkoutACOpeningReading) : null)
                        ?? impliedOpening
                        ?? checkoutACContext?.derivedOpening
                        ?? 0;
                      const rate = checkoutACContext?.perUnitRate ?? 0;
                      const count = checkoutACContext?.activeTenantCount ?? 0;
                      if (!checkoutACReading || !Number.isFinite(reading) || rate <= 0 || count <= 0) return null;

                      // Where THIS member's billing in this room began — set for a
                      // mid-month joiner or anyone who transferred in. Silence here
                      // is what made a mistyped reading look like a real answer: the
                      // reading now prices the departure, so a number at or below
                      // their arrival point charges them nothing at all, and the old
                      // line just printed "PKR 0" in reassuring green.
                      const ownJoin = checkoutACContext?.joinReadingsRaw?.find(j => j.tenant_id === checkingOut?.id);
                      const arrivedAt = ownJoin != null ? prev + Math.round(Number(ownJoin.units_at_join)) : null;

                      if (reading < prev) {
                        return (
                          <p className="text-xs text-rose-400">
                            The month opened at {prev.toLocaleString()} — a meter cannot run backwards. Check the number.
                          </p>
                        );
                      }
                      if (arrivedAt != null && reading < arrivedAt) {
                        return (
                          <p className="text-xs text-rose-400">
                            Below the {arrivedAt.toLocaleString()} recorded when they moved into this room — they cannot have left before they arrived. Check the number.
                          </p>
                        );
                      }
                      if (checkoutMath.estimatedACCharge <= 0) {
                        return (
                          <p className="text-xs text-amber">
                            {arrivedAt != null && reading <= arrivedAt
                              ? `No electricity is billed for this room — ${reading.toLocaleString()} is exactly where their billing here started. Enter the meter as it read when they actually left.`
                              : `No electricity is billed — the meter has not moved since the month opened at ${prev.toLocaleString()}.`}
                          </p>
                        );
                      }
                      const units = reading - prev;
                      // Their share stated in units rather than implied by dividing the
                      // room total by the head count. The old wording ("800 room units
                      // · 2 tenants sharing × PKR 50/unit") invited exactly that sum and
                      // it does not reach the figure printed beside it — the split is by
                      // segment, and after a move part of the bill belongs to another room.
                      const shareUnits = Math.round((checkoutMath.estimatedACCharge / rate) * 100) / 100;
                      return (
                        <p className="text-xs text-emerald-400">
                          Room metered {units.toLocaleString()} unit{units === 1 ? "" : "s"} ({prev.toLocaleString()} → {reading.toLocaleString()}) · their share {shareUnits.toLocaleString()} unit{shareUnits === 1 ? "" : "s"} × PKR {rate.toLocaleString()} ={" "}
                          <span className="font-medium">PKR {checkoutMath.estimatedACCharge.toLocaleString()}</span>
                        </p>
                      );
                    })()}
                    {!checkoutACReading && (
                      <p className="text-xs text-amber/70">Skipping this will over-bill remaining tenants at month-end</p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Section 3 — Outstanding Payment */}
            {checkoutPaymentLoading && (
              <div className="space-y-2">
                <div className="h-4 w-40 rounded-md bg-white/5 animate-pulse" />
                <div className="h-28 rounded-xl bg-white/5 animate-pulse" />
              </div>
            )}

            {!checkoutPaymentLoading && checkoutPaymentError && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                <p className="text-sm text-rose-400">Could not load payment data. Retry to continue.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                  onClick={() => {
                    setCheckoutPaymentError(null);
                    setCheckoutPaymentLoading(true);
                    if (checkingOut) fetchCheckoutPayment(checkingOut.id, checkoutDate.slice(0, 7));
                  }}
                >
                  Retry
                </Button>
              </div>
            )}

            {/* Settlement — outstanding + deposit in one combined section */}
            {!checkoutPaymentLoading && !checkoutPaymentError && (checkoutPendingPayment || (checkingOut?.security_deposit ?? 0) > 0) && (
              <div className="space-y-2.5">
                {/* Context line */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {checkoutPendingPayment && (
                    <span>{checkoutPendingPayment.for_month} · <span className="text-foreground font-medium">{formatCurrency(checkoutMath.pending)} outstanding</span></span>
                  )}
                  {(checkingOut?.security_deposit ?? 0) > 0 && (
                    <span>{formatCurrency(checkingOut!.security_deposit)} deposit held</span>
                  )}
                </div>

                {/* Outstanding options */}
                {checkoutPendingPayment && (
                  <>
                    <div
                      onClick={() => setCheckoutPayAction("pay")}
                      className={cn(
                        "border rounded-xl p-3 cursor-pointer transition-all",
                        checkoutPayAction === "pay" ? "border-amber/50 bg-amber/5" : "border-sidebar-border hover:border-sidebar-border/60"
                      )}
                    >
                      <p className="text-sm font-medium">Collect Now</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Tenant pays before leaving — record date and method</p>
                      {checkoutPayAction === "pay" && (
                        <div className="mt-3 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Date</p>
                            <input
                              type="date"
                              value={checkoutPayDate}
                              onChange={(e) => setCheckoutPayDate(e.target.value)}
                              className="h-8 w-full rounded-md border border-sidebar-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber/50"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Method</p>
                            <Select value={checkoutPayMethod} onValueChange={setCheckoutPayMethod}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select method" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Cash</SelectItem>
                                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                                <SelectItem value="jazzcash">JazzCash</SelectItem>
                                <SelectItem value="easypaisa">EasyPaisa</SelectItem>
                                <SelectItem value="sadapay">SadaPay</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RULE 2 — pro-rate the final month. Monthly tenants only;
                        daily tenants are recomputed automatically. Full month is
                        pre-selected and stays selected unless the owner acts. */}
                    {checkoutPayAction === "pay" && checkoutProRateInfo && (
                      <div className="rounded-xl border border-sidebar-border p-3 space-y-2">
                        <div>
                          <p className="text-sm font-medium">Charge for the final month</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Leaving on {formatDate(checkoutDate)} — {checkoutProRateInfo.nights} nights stayed in {checkoutProRateInfo.month}, charged at {formatCurrency(Math.round(checkoutProRateInfo.fullRent / 30))}/day (rent ÷ 30). Food, AC and deposit charges are never pro-rated.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setCheckoutProRate(false)}
                            className={cn(
                              "rounded-lg border p-2.5 text-left transition-all",
                              !checkoutProRate ? "border-amber/50 bg-amber/5" : "border-sidebar-border hover:border-sidebar-border/60"
                            )}
                          >
                            <p className="text-xs text-muted-foreground">Full month</p>
                            <p className="text-sm font-semibold mt-0.5">{formatCurrency(checkoutProRateInfo.fullRent)}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">Charge the whole month anyway</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCheckoutProRate(true)}
                            className={cn(
                              "rounded-lg border p-2.5 text-left transition-all",
                              checkoutProRate ? "border-amber/50 bg-amber/5" : "border-sidebar-border hover:border-sidebar-border/60"
                            )}
                          >
                            <p className="text-xs text-muted-foreground">Days stayed</p>
                            <p className="text-sm font-semibold mt-0.5">{formatCurrency(checkoutProRateInfo.proRatedRent)}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Default — {checkoutProRateInfo.nights} nights
                            </p>
                          </button>
                        </div>
                        {checkoutProRate && (
                          <p className="text-xs text-emerald-400">
                            Rent reduced by {formatCurrency(checkoutProRateInfo.discount)}
                          </p>
                        )}
                      </div>
                    )}

                    <div
                      onClick={() => setCheckoutPayAction("waive")}
                      className={cn(
                        "border rounded-xl p-3 cursor-pointer transition-all",
                        checkoutPayAction === "waive" ? "border-amber/50 bg-amber/5" : "border-sidebar-border hover:border-sidebar-border/60"
                      )}
                    >
                      <p className="text-sm font-medium">Forgive the Dues</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Cancel the remaining balance — no money collected</p>
                    </div>

                  </>
                )}

                {/* Deposit return — logged to the Member Ledger */}
                {(checkingOut?.security_deposit ?? 0) > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {checkoutMath.applied > 0
                        ? <>Refund to tenant — {formatCurrency(checkoutMath.applied)} of the deposit goes to dues, leaving {formatCurrency(checkoutMath.refundable)}</>
                        : <>Refund to tenant (0 = fully forfeited)</>}
                    </p>
                    <input
                      type="number"
                      min={0}
                      max={checkoutMath.refundable}
                      value={checkoutDepositReturned}
                      onChange={(e) => setCheckoutDepositReturned(e.target.value)}
                      placeholder="0"
                      className="h-8 w-full rounded-md border border-sidebar-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber/50"
                    />
                  </div>
                )}

                {/* Notes */}
                <div className="pt-0.5">
                  <textarea
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    placeholder="Notes (optional) — e.g. damage deducted, partial refund reason, etc."
                    rows={2}
                    className="w-full rounded-md border border-sidebar-border bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Live summary */}
            <div className="pt-3 border-t border-sidebar-border/60">
              {(() => {
                const { deposit, basePending, estimatedACCharge, pending, collecting, applied, refundable, toCollect, proRateDiscount } = checkoutMath;
                const refunding = Number(checkoutDepositReturned || 0);
                const forfeiting = Math.max(0, refundable - refunding);

                if (pending === 0 && deposit === 0) {
                  return <p className="text-sm text-muted-foreground">No financial transactions to record</p>;
                }

                return (
                  <div className="rounded-xl bg-sidebar-accent/30 px-3 py-2.5 space-y-1.5">
                    {basePending > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Outstanding{checkoutPayAction === "waive" && <span className="ml-1 text-xs">(waived)</span>}
                        </span>
                        <span className={cn(checkoutPayAction !== "pay" ? "text-muted-foreground line-through" : "")}>
                          {formatCurrency(basePending)}
                        </span>
                      </div>
                    )}
                    {proRateDiscount > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Pro-rated ({checkoutProRateInfo?.nights} nights at rent ÷ 30)
                        </span>
                        <span className="text-emerald-400">− {formatCurrency(proRateDiscount)}</span>
                      </div>
                    )}
                    {estimatedACCharge > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          AC charge (est.){checkoutPayAction === "waive" && <span className="ml-1 text-xs">(waived)</span>}
                        </span>
                        <span className={cn(checkoutPayAction !== "pay" ? "text-muted-foreground line-through" : "")}>
                          {formatCurrency(estimatedACCharge)}
                        </span>
                      </div>
                    )}
                    {deposit > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Deposit held{applied > 0 ? <span className="ml-1 text-xs">(− {formatCurrency(applied)} to dues)</span> : null}
                        </span>
                        <span className={applied > 0 ? "text-emerald-400" : ""}>
                          {formatCurrency(deposit)}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-sidebar-border/40" />

                    {collecting && (
                      toCollect > 0 ? (
                        <div className="flex justify-between text-sm font-semibold">
                          <span className="text-amber">Collect from tenant</span>
                          <span className="text-amber">{formatCurrency(toCollect)}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-sm font-semibold">
                          <span className="text-emerald-400">Deposit covers all dues</span>
                          <span className="text-emerald-400">—</span>
                        </div>
                      )
                    )}
                    {checkoutPayAction === "waive" && basePending > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Balance waived</span>
                        <span className="text-muted-foreground">—</span>
                      </div>
                    )}
                    {deposit > 0 && (
                      <>
                        <div className="flex justify-between text-sm font-semibold">
                          <span className="text-sky-400">Refund to tenant</span>
                          <span className="text-sky-400">{formatCurrency(refunding)}</span>
                        </div>
                        {forfeiting > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Kept by hostel (forfeited)</span>
                            <span className="text-muted-foreground">{formatCurrency(forfeiting)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={resetCheckoutState} disabled={checkoutSubmitting}>Cancel</Button>
            <Button
              onClick={handleCheckout}
              disabled={
                checkoutSubmitting ||
                !checkoutDate ||
                checkoutPaymentLoading ||
                !!checkoutPaymentError ||
                (checkoutPayAction === "pay" && !checkoutPayMethod)
              }
              className="gap-2 bg-rose-500 hover:bg-rose-600 text-white"
            >
              {checkoutSubmitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                : <><LogOut className="w-4 h-4" /> Confirm Check Out</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Reservation Deposit — waiting list only */}
      <Dialog open={!!depositDialogTenant} onOpenChange={(open) => { if (!open) closeDepositDialog(); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-4 h-4 text-violet-400" />
              Record Deposit
            </DialogTitle>
            <DialogDescription>
              {depositDialogTenant?.full_name}
              {depositDialogTenant?.check_in ? ` · joining ${formatDate(depositDialogTenant.check_in)}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className={cn("space-y-4 py-1", depositSubmitting && "pointer-events-none opacity-50")}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="deposit-amount">Amount received (PKR)</Label>
                {!!depositDialogTenant && depositDialogTenant.security_deposit > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Deposit on file: {formatCurrency(depositDialogTenant.security_deposit)}
                  </span>
                )}
              </div>
              <Input
                id="deposit-amount"
                type="number"
                min={0}
                max={depositDialogTenant?.security_deposit || undefined}
                placeholder="0"
                value={depositForm.amount}
                onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="deposit-date">Date received</Label>
                <Input
                  id="deposit-date"
                  type="date"
                  value={depositForm.date}
                  max={formatDateInput(new Date())}
                  onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={depositForm.method} onValueChange={(v) => setDepositForm({ ...depositForm, method: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="jazzcash">JazzCash</SelectItem>
                    <SelectItem value="easypaisa">EasyPaisa</SelectItem>
                    <SelectItem value="sadapay">SadaPay</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deposit-notes">Note (optional)</Label>
              <Input
                id="deposit-notes"
                placeholder="e.g. paid at the gate, brother handed it over"
                value={depositForm.notes}
                onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
              />
            </div>

            {(() => {
              const entered = parseFloat(depositForm.amount);
              const agreed = Number(depositDialogTenant?.security_deposit ?? 0);
              const over = Number.isFinite(entered) && agreed > 0 && entered > agreed;
              const balance = Number.isFinite(entered) && entered > 0 ? Math.max(0, agreed - entered) : 0;
              return (
                <p className={cn(
                  "text-xs rounded-lg border px-3 py-2",
                  over ? "border-rose-500/30 bg-rose-500/5 text-rose-300" : "border-violet-500/20 bg-violet-500/5 text-muted-foreground"
                )}>
                  {over ? (
                    <>
                      {formatCurrency(entered)} is more than the whole deposit of {formatCurrency(agreed)}. Enter{" "}
                      {formatCurrency(agreed)} or less, or change the deposit on their profile first.
                    </>
                  ) : (
                    <>
                      Recorded against {depositForm.date ? formatDate(depositForm.date) : "the date above"} and counted in that month&apos;s
                      collection. Rent still starts on {depositDialogTenant?.check_in ? formatDate(depositDialogTenant.check_in) : "the joining date"}.
                      {balance > 0
                        ? ` The remaining ${formatCurrency(balance)} of the deposit will be charged on the first monthly bill.`
                        : " This deposit will not be charged again on the first bill."}
                    </>
                  )}
                </p>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeDepositDialog} disabled={depositSubmitting}>Cancel</Button>
            <Button
              onClick={handleRecordDeposit}
              disabled={
                depositSubmitting || !depositForm.amount || !depositForm.date ||
                parseFloat(depositForm.amount) > Number(depositDialogTenant?.security_deposit ?? 0)
              }
              className="gap-2 bg-amber hover:bg-amber/90 text-background"
            >
              {depositSubmitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                : <><Banknote className="w-4 h-4" /> Record Deposit</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Give / Cancel Notice Dialog */}
      <Dialog open={!!noticeDialogTenant} onOpenChange={(open) => { if (!open) closeNoticeDialog(); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber" />
              {noticeDialogTenant?.intended_checkout_date ? "Manage Notice" : "Give Notice"}
            </DialogTitle>
            <DialogDescription>{noticeDialogTenant?.full_name}</DialogDescription>
          </DialogHeader>

          <div className={cn("space-y-4 py-1", noticeSubmitting && "pointer-events-none opacity-50")}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="notice-date">Intended checkout date</Label>
                {noticeDialogTenant?.intended_checkout_date && (
                  <span className="text-xs text-muted-foreground">
                    On file: {formatDate(noticeDialogTenant.intended_checkout_date)}
                  </span>
                )}
              </div>
              <Input
                id="notice-date"
                type="date"
                value={noticeDate}
                onChange={(e) => setNoticeDate(e.target.value)}
                min={formatDateInput(new Date())}
              />
            </div>

            {noticeDate && (() => {
              const today = formatDateInput(new Date());
              const daysNotice = Math.round((new Date(noticeDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
              const adequate = daysNotice >= noticePeriodDays;
              return (
                <p className={cn("text-sm rounded-lg border px-3 py-2", adequate ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" : "text-amber border-amber/20 bg-amber/5")}>
                  {daysNotice} days notice {adequate ? "✓ meets" : "⚠ short of"} the {noticePeriodDays}-day policy
                </p>
              );
            })()}
          </div>

          <DialogFooter>
            {noticeDialogTenant?.intended_checkout_date && (
              <Button
                variant="ghost"
                onClick={handleCancelNotice}
                disabled={noticeSubmitting}
                className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              >
                {noticeSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarX className="w-4 h-4" />}
                Cancel Notice
              </Button>
            )}
            <Button variant="ghost" onClick={closeNoticeDialog} disabled={noticeSubmitting}>Close</Button>
            <Button
              onClick={handleGiveNotice}
              disabled={noticeSubmitting || !noticeDate}
              className="gap-2 bg-amber hover:bg-amber/90 text-background"
            >
              {noticeSubmitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                : <><CalendarClock className="w-4 h-4" /> {noticeDialogTenant?.intended_checkout_date ? "Update Notice" : "Save Notice"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Receipt Share Dialog — shown after successful checkout */}
      <Dialog open={!!shareReceipt} onOpenChange={(open) => { if (!open) setShareReceipt(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Checkout Complete
            </DialogTitle>
            <DialogDescription>
              {shareReceipt?.name} has been checked out. Share the receipt below.
            </DialogDescription>
          </DialogHeader>

          {shareReceipt && (() => {
            const receiptUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/r/${shareReceipt.token}`;
            const waPhone = shareReceipt.phone?.replace(/\D/g, "");
            const waMsg = encodeURIComponent(`Dear ${shareReceipt.name}, your payment receipt is ready. Please find it here: ${receiptUrl}`);
            return (
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  className="w-full bg-[#25D366] hover:bg-[#1da851] text-white"
                  onClick={() => {
                    const url = waPhone
                      ? `https://wa.me/${waPhone}?text=${waMsg}`
                      : `https://api.whatsapp.com/send?text=${waMsg}`;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 mr-2 fill-current" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.121.554 4.11 1.523 5.84L0 24l6.336-1.492A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 0 1-5.003-1.374l-.36-.213-3.76.885.936-3.658-.235-.374A9.817 9.817 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182c5.43 0 9.818 4.388 9.818 9.818 0 5.43-4.388 9.818-9.818 9.818z"/>
                  </svg>
                  Share via WhatsApp
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => window.open(receiptUrl, "_blank", "noopener,noreferrer")}
                  >
                    View Receipt
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { navigator.clipboard.writeText(receiptUrl); toast({ title: "Link copied!" }); }}
                  >
                    Copy Link
                  </Button>
                </div>
                <Button variant="ghost" className="w-full" onClick={() => setShareReceipt(null)}>Close</Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Share Form Link Dialog */}
      <Dialog open={shareLinkDialog} onOpenChange={(o) => { if (!o) { setShareLinkDialog(false); setShareLinkPhone(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Application Form</DialogTitle>
            <DialogDescription>
              Share this link with prospective tenants so they can apply for a room. Send via WhatsApp or copy to share anywhere.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const formUrl = hostelSlug ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${hostelSlug}` : "";
            const normPhone = shareLinkPhone.replace(/\D/g, "").replace(/^0/, "92");
            const waMsg = encodeURIComponent(`Hi! Please fill out this application form to apply for a room at ${hostelName ?? "our hostel"}:\n${formUrl}`);
            const waUrl = normPhone.length >= 10
              ? `https://wa.me/${normPhone}?text=${waMsg}`
              : `https://api.whatsapp.com/send?text=${waMsg}`;
            return (
              <div className="space-y-4 py-1">
                {/* Form URL display */}
                <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 flex items-center gap-2">
                  <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate font-mono">{formUrl}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => navigator.clipboard.writeText(formUrl).then(() => toast({ title: "Link copied!" })).catch(() => toast({ title: "Could not copy", description: formUrl, variant: "destructive" }))}
                    title="Copy link"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* QR code */}
                <div className="flex items-center justify-center rounded-xl border border-sidebar-border bg-white p-4">
                  {formQrGenerating ? (
                    <div className="w-[180px] h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                      Generating…
                    </div>
                  ) : formQrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={formQrDataUrl} alt="Application form QR code" className="w-[180px] h-[180px]" />
                  ) : (
                    <div className="w-[180px] h-[180px] flex items-center justify-center text-xs text-rose-400 text-center px-4">
                      Could not generate QR code.
                    </div>
                  )}
                </div>

                {/* Optional phone for direct WhatsApp */}
                <div className="space-y-1.5">
                  <Label>WhatsApp number <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    type="tel"
                    placeholder="e.g. 03001234567"
                    value={shareLinkPhone}
                    onChange={(e) => setShareLinkPhone(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Enter a number to message directly, or leave blank to pick from your contacts.</p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => navigator.clipboard.writeText(formUrl).then(() => toast({ title: "Link copied!" })).catch(() => toast({ title: "Could not copy", description: formUrl, variant: "destructive" }))}
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Link
                  </Button>
                  <Button
                    className="flex-1 gap-2 bg-[#25D366] hover:bg-[#20ba57] text-white"
                    onClick={() => { window.open(waUrl, "_blank", "noopener,noreferrer"); }}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Send on WhatsApp
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  disabled={!formQrDataUrl || formQrDownloading}
                  onClick={async () => {
                    if (!formQrDataUrl) return;
                    setFormQrDownloading(true);
                    try {
                      await downloadQrFlyerPdf({
                        heading: "Scan to Apply",
                        subheading: "Want to book a room? Scan this code to fill out our application form.",
                        hostelName,
                        qrDataUrl: formQrDataUrl,
                        url: formUrl,
                        filename: "application-form-qr.pdf",
                      });
                    } catch {
                      toast({ title: "Download failed", description: "Could not generate PDF.", variant: "destructive" });
                    } finally {
                      setFormQrDownloading(false);
                    }
                  }}
                >
                  <Download className="w-3.5 h-3.5" /> {formQrDownloading ? "Preparing…" : "Download PDF"}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
