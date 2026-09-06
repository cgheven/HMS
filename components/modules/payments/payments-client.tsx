"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CreditCard, CheckCircle2, Clock, AlertTriangle, Wallet,
  Banknote, Zap, Loader2, FileText, ChevronLeft, ChevronRight, Search, Gift, Undo2, Send, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowMenu, type RowMenuItem } from "@/components/ui/row-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn, formatCurrency, formatDate, formatDateInput, formatDateTime, formatDayLong, formatMonthLong } from "@/lib/utils";
import type { Payment, PaymentMethod, PaymentStatus, PackageTier, PackageConfig, PaymentMethodAccount, PartnerTier, StaffPermission } from "@/types";
import { buildReminderMessage } from "@/lib/whatsapp-reminder";
import { countBillableNights } from "@/lib/daily-billing";
import { splitPaymentCharges, computeRentDiscount, combinedDiscountPercent } from "@/lib/payment-calc";
import { MeterPhoto } from "@/components/modules/ac/meter-photo";
import { uploadMonthlyMeterPhoto, deleteMonthlyMeterPhoto } from "@/app/actions/ac-meter-photos";
import { tenantDueDay, shouldRemindToday, hasCollected, effectivePaymentStatus } from "@/lib/payment-calc";
import { pktTodayDateString } from "@/lib/pkt-time";
import {
  syncMonthAction,
  markPaymentPaidAction,
  loadHistoryAction,
  applyRoomACUnitsAction,
  saveACJoinReadingAction,
  sendBulkRemindersAction,
  sendDueTodayRemindersAction,
  undoLastPaymentAction,
} from "@/app/actions/payments";
import { createInvoiceLink, createInstallmentReceiptLink, previewBillLinkAction } from "@/app/actions/tenants";
import { recordPaymentAsPartner } from "@/app/actions/partner";
import { deriveOpeningReading, effectivePrevReading, latestReadingBefore } from "@/lib/ac-billing";
import {
  recordPaymentAsManager,
  applyRoomACUnitsAsManager,
  saveACJoinReadingAsManager,
  undoLastPaymentAsManager,
} from "@/app/actions/managers";

interface TenantRow {
  id: string;
  full_name: string;
  billing_type: "monthly" | "daily";
  monthly_rent: number;
  daily_rate: number;
  check_in: string;
  check_out: string | null;
  room_id: string | null;
  is_active: boolean;
  package_tier: PackageTier;
  security_deposit: number;
  food_breakfast?: boolean;
  food_lunch?: boolean;
  food_dinner?: boolean;
  joining_meter_reading?: number | null;
}

interface RoomRow { id: string; room_number: string; floor: number | null; has_ac?: boolean | null; }

// Mirrors ReminderSummary from lib/reminder-engine.ts — redeclared locally so
// this client component never imports that server-only module.
interface BulkReminderSummary { checked: number; sent: number; skipped: number; failed: number; markFailed: number }

// Migration 099 adds these to hms_payments; the shared Payment type may not carry
// them yet, so read them defensively rather than assume either is present.
type PaymentDaySnapshot = Payment & {
  billed_days?: number | null;
  daily_rate_billed?: number | null;
};

interface Props {
  hostelId: string | null;
  hostelName?: string;
  hostelPhone?: string | null;
  payments: Payment[];
  tenants: TenantRow[];
  rooms: RoomRow[];
  initialMonth: string;
  packageConfig: PackageConfig | null;
  paymentMethods?: PaymentMethodAccount[];
  reminderTemplate?: string | null;
  // Super-Admin-curated flag — the "Send Reminders Now" bulk button only
  // renders when this branch has been granted the automated feature.
  autoReminderEnabled?: boolean;
  /** Branches that bill electricity per room meter EVERY room, not only the ones
   *  with an air conditioner. */
  meterAllRooms?: boolean;
  /** Every month's room readings, not just the one on screen — the AC tab derives
   *  the selected month and the preceding one from this, so stepping months needs
   *  no round trip. */
  acReadings?: { room_id: string; for_month: string; total_units: number; meter_reading?: number | null; per_unit_rate: number; tenant_count: number; meter_photo?: string | null; recorded_while_vacant?: boolean | null }[];
  /** Latest WhatsApp status per tenant id — drives the delivery tick. */
  lastWhatsApp?: Record<string, { status: string; error_code: number | null; created_at: string }>;
  acCheckoutReadings?: {
    room_id: string; for_month: string; meter_reading: number | null;
    /** Set only on a ROOM TRANSFER. The share below was billed to that member at
     *  the moment they moved, and their payment row has since followed them to
     *  the new room — so the AC card cannot find it by room_id and would report
     *  it as units nobody paid for. */
    tenant_id?: string | null; units_consumed?: number | null;
    ac_charge?: number | null; transferred_to_room_id?: string | null;
  }[];
  acJoinReadings?: { room_id: string; tenant_id: string; units_at_join: number; for_month: string }[];
  // Tenants currently on the waiting list — a payment row can outlive an
  // active tenant being edited back to waiting, so the headline stats below
  // exclude these tenants' rows the same way the visible list already does.
  waitingTenantIds?: string[];
  // null/undefined = owner (unrestricted). Recording a payment requires
  // standard+; late fee / receipt number overrides and AC billing management
  // stay owner-only (the partner write path doesn't support them).
  partnerTier?: PartnerTier | null;
  // null/undefined = not a manager (owner or partner path — untouched).
  // A non-null array puts the page in manager mode: identical UI, but every
  // write is routed through the createAdminClient()-backed manager actions and
  // gated on the collect_payments permission.
  managerPermissions?: StaffPermission[] | null;
}

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Cash", bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash", easypaisa: "Easypaisa",
  sadapay: "SadaPay", other: "Other",
};

// Shared with the dashboard and anything else that must not read a reversed
// payment as a real one — see lib/payment-calc.ts.
const displayStatus = (p: Payment): PaymentStatus => effectivePaymentStatus(p);

const statusConfig: Record<PaymentStatus, { label: string; color: string }> = {
  paid: { label: "Paid", color: "text-emerald-400" },
  pending: { label: "Pending", color: "text-amber" },
  overdue: { label: "Overdue", color: "text-rose-400" },
  waived: { label: "Waived", color: "text-muted-foreground" },
  partially_paid: { label: "Partial", color: "text-blue-400" },
};

function genReceipt(tenantName: string, month: string) {
  const initials = tenantName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `HMS-${month.replace("-", "")}-${initials}-${rand}`;
}

// Per-tenant AC units cap for the mark-paid dialog (room-level total capped at 99,999 in applyRoomACUnitsAction)
const MAX_AC_UNITS = 10_000;

/** Substring shared by the owner, manager and partner record-payment actions,
 *  whose full sentences differ. Matched on the stable middle so all three
 *  optimistic-concurrency refusals take the reopen path, not a dead-end toast. */
const REPRICED_ERROR = "re-priced while you were recording";

// One definition of "unpaid", shared by the Monthly View chips and the All History
// chips. Waived is deliberately neither: the money was forgiven, so it is not owed
// and was never collected.
const isUnpaidStatus = (s: PaymentStatus) => s === "pending" || s === "overdue" || s === "partially_paid";

// One template shared by the header and every row. They are separate CSS grids,
// so any drift between the two silently misaligns every column.
const PAYMENT_GRID = "grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.7fr)_minmax(0,1.25fr)_auto_auto]";

type StatusChip = "all" | "paid" | "unpaid" | "partial";

// Partial is a drill-down, not a fourth bucket: those rows stay inside Unpaid so
// "who owes me money" keeps its full answer. Paid + Unpaid still equals All; the
// Partial count is a subset of Unpaid, which the chip's tooltip says outright.
const STATUS_CHIPS: { key: StatusChip; label: string; title?: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "unpaid", label: "Unpaid", title: "Pending, overdue and partially paid" },
  { key: "partial", label: "Partial", title: "Part-paid, balance still owed — also counted under Unpaid" },
];

function countByChip(rows: Payment[], key: StatusChip): number {
  if (key === "all") return rows.length;
  if (key === "paid") return rows.filter(p => p.status === "paid").length;
  if (key === "partial") return rows.filter(p => displayStatus(p) === "partially_paid").length;
  return rows.filter(p => isUnpaidStatus(p.status)).length;
}

// AC is a separate axis from paid/unpaid — it has to compose with the status
// chips, not replace them, so "AC + Paid" (which reconciles to the AC Collected
// tile) and "AC + Unpaid" are both reachable. Matches ac_charge, the exact field
// the AC tiles sum; flat AC maintenance is a different charge and is not metered.
const hasAcCharge = (p: Payment) => Number(p.ac_charge ?? 0) > 0;

// A deposit taken to hold a bed for someone who has not moved in yet. It is
// already-collected money that belongs in the month it was taken, but its
// tenant is on the waiting list — absent from `tenants`, present in
// waitingTenantIds — so both of the filters that scope this page to real
// residents would otherwise drop it from the list AND from Collected.
const isReservationRow = (p: Payment) => p.is_reservation === true;

// What this bill becomes if the operator confirms with the percentage currently
// typed in the Pay dialog. Mirrors hms_recalculate_payment_amount through the
// shared helpers rather than re-deriving rent inline, so the figure shown before
// confirming is the one the trigger will store.
//
// `alreadyPercent` is the discount the row ALREADY carries — the tenant's
// standing concession from admission, which the operator's one-off stacks on top
// of. Showing it is the difference between an operator understanding why their
// 10% took Rs 4,400 off a Rs 22,000 rent and thinking the software is broken.
function previewDiscount(p: Payment, manualPercentRaw: string) {
  const charges = splitPaymentCharges(p);
  // Once money has been collected against a bill the trigger pins the percent it
  // was collected with, so a percentage typed now would be silently ignored. An
  // undone payment leaves the row partially_paid at zero collected and is
  // deliberately included: the bill reopens still discounted.
  const frozen = p.status === "paid" || p.status === "partially_paid";
  // Daily bills carry no rent discount — migration 212 enforces it, because the
  // daily gross-restore cannot tell a discounted amount from a gross one and
  // re-takes the discount on every later write. Offering the field would be an
  // input that silently does nothing.
  const daily = p.tenant?.billing_type === "daily";
  const typed = parseFloat(manualPercentRaw);
  const manual = Number.isFinite(typed) ? typed : 0;
  // The TENANT's live standing discount, not the row's stored copy. A pending
  // row keeps whatever percent it was last priced at, so raising a member's
  // concession from 10% to 15% and collecting the same day would quote 10% at
  // the counter while the trigger settles at 15%. On a frozen row the stored
  // percent IS the answer — it is pinned, and the tenant's current setting no
  // longer applies to it.
  // NULL on the tenant means the concession was REMOVED, not unknown — clearing
  // the field on the member form stores NULL by design. Falling back to the
  // row's stale percent quoted the old discounted total, the desk collected it,
  // and the server booked it as a PART payment while the client toasted success.
  // Every payment source that reaches this component selects the tenant's
  // percent, so there is nothing left for the fallback to rescue.
  const alreadyPercent = frozen
    ? Number(p.discount_percent ?? 0)
    : Number(p.tenant?.discount_percent ?? 0);
  const totalPercent = frozen ? alreadyPercent : combinedDiscountPercent(alreadyPercent, manual);
  const discount = computeRentDiscount(charges.rent, totalPercent, charges.referralDiscount);
  // charges.discount is what the stored (net) amount already has taken out of
  // it; adding it back before subtracting the new one is what stops a second
  // discount compounding on the first.
  const total = Math.max(0, Number(p.amount ?? 0) + charges.discount - discount);
  return {
    frozen,
    daily,
    rent: charges.rent,
    alreadyPercent,
    totalPercent,
    discount,
    total,
    remaining: Math.max(0, total - Number(p.amount_paid ?? 0)),
  };
}

// "5 Aug 2026" from a check-in date, for the "holds a seat from" sub-line.
function fmtJoinDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const parsed = new Date(d.slice(0, 10) + "T00:00:00");
  if (isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

function chipClass(key: StatusChip, active: boolean): string {
  return cn(
    "h-7 px-3 rounded-full text-xs font-medium border transition-all",
    active && key === "paid"    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" :
    active && key === "unpaid"  ? "bg-amber/15 border-amber/40 text-amber" :
    active && key === "partial" ? "bg-blue-500/15 border-blue-500/40 text-blue-400" :
    active                      ? "bg-sidebar-accent border-sidebar-border text-foreground" :
    "border-transparent text-muted-foreground hover:text-foreground hover:border-sidebar-border"
  );
}

// "2026-07" -> "2026-06". Month keys are plain strings here, never Date objects,
// so this stays clear of the process-timezone drift that a Date round-trip invites.
function prevMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// Stable identity. This backs the acReadings prop, which feeds a useMemo and a
// useEffect — an inline `= []` default would mint a new array on every render.
/**
 * Which message-filter bucket a tenant falls into.
 *
 * Four buckets, not six statuses: an owner is asking "did it land, did they
 * read it, and who heard nothing" — queued and sent are both just "on its way",
 * and failed and undelivered are both "did not arrive".
 */
function msgBucket(m: { status: string; error_code: number | null } | undefined): string {
  if (!m) return "none";
  if (m.status === "read" || m.status === "delivered") return "delivered";
  // queued and sent land here too. They are only "not delivered YET" rather
  // than failed, but the alternative — their own dropdown option for a state
  // that usually lasts seconds — gives a transient case the same weight as a
  // dead phone number, and leaving them out of every bucket made those tenants
  // invisible under every filter. The row badge still says "Sent", so the
  // difference is visible where it matters.
  return "failed";
}

/**
 * The last WhatsApp we sent this tenant, as one short phrase.
 *
 * Deliberately only the LATEST message and no history: an owner wants to know
 * "did my reminder land?", and six rows of ticks per tenant answers a question
 * nobody asked.
 *
 * `read` is the only positive worth shouting about; everything else is either
 * neutral or a problem. Note that a tenant can switch read receipts off in
 * WhatsApp, so "Delivered" never becoming "Read" does NOT mean ignored — which
 * is why delivered stays neutral grey rather than looking like a failure.
 */
function waTick(m: { status: string; error_code: number | null } | undefined):
  { label: string; cls: string } | null {
  if (!m) return null;
  switch (m.status) {
    case "read":
      return { label: "Read", cls: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10" };
    case "delivered":
      return { label: "Delivered", cls: "text-muted-foreground border-white/10 bg-white/5" };
    case "sent":
    case "queued":
      return { label: "Sent", cls: "text-muted-foreground border-white/10 bg-white/5" };
    case "undelivered":
      // 131026 is the one an owner can actually act on: the number simply is
      // not on WhatsApp, so every reminder to it has been shouting into a void.
      return {
        label: m.error_code === 131026 ? "Not on WhatsApp" : "Not delivered",
        cls: "text-amber border-amber/25 bg-amber/10",
      };
    case "failed":
      return { label: "Failed", cls: "text-rose-400 border-rose-500/25 bg-rose-500/10" };
    default:
      return null;
  }
}

const NO_AC_CHECKOUTS: { room_id: string; for_month: string; meter_reading: number | null }[] = [];
const NO_AC_READINGS: NonNullable<Props["acReadings"]> = [];

export function PaymentsClient({ hostelId, hostelName = "Hostel", hostelPhone, payments: initialPayments, tenants, rooms, initialMonth, packageConfig, paymentMethods = [], reminderTemplate, autoReminderEnabled = false, meterAllRooms = false, acReadings: allAcReadings = NO_AC_READINGS, acCheckoutReadings = NO_AC_CHECKOUTS, acJoinReadings = [], lastWhatsApp = {}, partnerTier = null, managerPermissions = null, waitingTenantIds = [] }: Props) {
  const isPartner = !!partnerTier;
  const isManager = !!managerPermissions;
  const canCollect = managerPermissions?.includes("collect_payments") ?? false;
  // Owners (no partnerTier, no managerPermissions) short-circuit on the first
  // operand exactly as before — this stays true for them unconditionally.
  const canRecordPayment = isManager ? canCollect : (!partnerTier || partnerTier !== "read_only");
  // Partners still get the reduced dialog — recordPaymentAsPartner has no
  // late-fee / receipt-number / date parameter, so showing those inputs would
  // accept values the server then drops. Managers run the hostel day to day and
  // recordPaymentAsManager takes all three, so they get the owner's dialog.
  const hideOverrides = isPartner;
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [allHistory, setAllHistory] = useState<Payment[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [tab, setTab] = useState("monthly");
  const [markDialog, setMarkDialog] = useState<Payment | null>(null);
  const [markForm, setMarkForm] = useState({
    method: "cash" as PaymentMethod,
    date: formatDateInput(new Date()),
    late_fee: "0",
    notes: "",
    receipt_number: "",
    ac_units_consumed: "0",
    amount_received: "",
    discount_percent: "",
  });
  const [saving, setSaving] = useState(false);
  const [sendingWa, setSendingWa] = useState<string | null>(null); // paymentId
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkReminderSummary | null>(null);
  // "all" = every unpaid tenant regardless of due date (existing bulk button).
  // "due_today" = only tenants whose own due-day cadence lands on today (Due Today tab).
  // Both reuse the same confirm/result dialog pair — only the target action and copy differ.
  const [reminderScope, setReminderScope] = useState<"all" | "due_today">("all");
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null); // paymentId
  const [postPaymentWa, setPostPaymentWa] = useState<{ payment: Payment; amountReceivedNow: number; installmentId?: string } | null>(null);
  const [acUnits, setAcUnits] = useState<Record<string, string>>({});
  const [applyingAC, setApplyingAC] = useState<string | null>(null);
  // True only while a month switch is in flight. The room readings re-derive from
  // props instantly, but the per-tenant payment rows still have to be fetched —
  // without this the allocation block would render the new month's meter against
  // the previous month's rows and briefly show everyone on zero units.
  const [monthLoading, setMonthLoading] = useState(false);
  // Derived, not fetched. Both slices come out of the one all-months prop, so
  // changing month re-filters in place instead of waiting on the server.
  const acReadings = useMemo(
    () => allAcReadings.filter(r => r.for_month === selectedMonth),
    [allAcReadings, selectedMonth]
  );
  // Previous-month rows with the SAME correction the server applies: a row
  // recorded while the room was empty is a snapshot, and if the room was then let
  // and vacated inside that month, the departing tenant's checkout reading is the
  // real closing figure. Without this the card would say "Previous month ended at
  // 460" while Apply billed from 520.
  const prevMonthACReadings = useMemo(() => {
    const pm = prevMonthOf(selectedMonth);
    return allAcReadings
      .filter(r => r.for_month === pm)
      .map(r => ({
        ...r,
        meter_reading: effectivePrevReading(
          r,
          acCheckoutReadings.filter(c => c.room_id === r.room_id && c.for_month === pm)
        ),
      }));
  }, [allAcReadings, acCheckoutReadings, selectedMonth]);
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [msgFilter, setMsgFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusChip>("all");
  const [search, setSearch] = useState("");
  // joinUnits keyed by `${tenantId}_${month}` — stores the absolute meter reading at join time
  const [joinUnits, setJoinUnits] = useState<Record<string, string>>({});
  const [savingJoin, setSavingJoin] = useState<string | null>(null);
  // acOpeningReadings: per-room opening reading input, shown only when no previous month record exists
  const [acOpeningReadings, setAcOpeningReadings] = useState<Record<string, string>>({});
  const [historyRoomFilter, setHistoryRoomFilter] = useState("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<StatusChip>("all");
  const [acOnly, setAcOnly] = useState(false);
  const [historyAcOnly, setHistoryAcOnly] = useState(false);
  // Occupied is the DEFAULT: an operator who ignores this feature sees exactly
  // the list they saw before empty rooms became meterable.
  const [acOccupancy, setAcOccupancy] = useState<"all" | "occupied" | "empty">("occupied");
  const [acRoomFilter, setAcRoomFilter] = useState("all");

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

  // Day basis for a daily-billed row: "11 days × Rs 500". Prefers the snapshot
  // frozen on the payment row; rows predating migration 099 have none, so they
  // fall back to countBillableNights() — the same arithmetic the server billed
  // with. Returns null for monthly tenants, which must render unchanged.
  const dailyBasis = useCallback((p: Payment): { nights: number; rate: number } | null => {
    const snap = p as PaymentDaySnapshot;
    const t = tenants.find((x) => x.id === p.tenant_id);
    const snapDays = snap.billed_days ?? null;
    const snapRate = snap.daily_rate_billed ?? null;
    if (snapDays != null) {
      return { nights: snapDays, rate: Number(snapRate ?? t?.daily_rate ?? 0) };
    }
    if (!t || t.billing_type !== "daily" || !t.check_in) return null;
    const nights = countBillableNights({ checkIn: t.check_in, checkOut: t.check_out, month: p.for_month });
    if (nights <= 0) return null;
    return { nights, rate: Number(t.daily_rate ?? 0) };
  }, [tenants]);

  const dailyBasisLabel = (b: { nights: number; rate: number }) =>
    `${b.nights} day${b.nights === 1 ? "" : "s"} × ${formatCurrency(b.rate)}`;

  // Pre-populate the meter reading input from saved readings on mount / when acReadings changes
  useEffect(() => {
    if (acReadings.length > 0) {
      setAcUnits(prev => {
        const next = { ...prev };
        acReadings.forEach(r => {
          // Not for a month recorded while the room stood empty. hms_tenants.room_id
          // keeps no history, so a tenant MOVED into this room later — whose
          // check_in predates the vacant month — reads as having lived here that
          // month. The card then offers the allocation view over a row written
          // before they arrived, and a pre-filled reading puts "bill them for the
          // empty period" one click away. The number is still on screen in the
          // saved-reading line above, so nothing is hidden; re-applying such a
          // month now takes a deliberately typed reading.
          if (r.recorded_while_vacant) return;
          if (!next[r.room_id] && r.meter_reading != null) {
            next[r.room_id] = String(Math.round(r.meter_reading));
          }
        });
        return next;
      });
    }
  }, [acReadings]);

  // Pre-populate join reading inputs — reconstruct absolute meter reading from relative + prev month
  useEffect(() => {
    // units_at_join is an offset from the month's own opening reading, so only
    // rows for the month currently on screen can be reconstructed — prevMonthACReadings
    // holds that one month's baseline and no other.
    const forThisMonth = acJoinReadings.filter(r => r.for_month === selectedMonth);
    if (forThisMonth.length === 0) return;
    setJoinUnits(prev => {
      const next = { ...prev };
      forThisMonth.forEach(r => {
        const k = `${r.tenant_id}_${r.for_month}`;
        if (!(k in next)) {
          const prevReading = prevMonthACReadings.find(pr => pr.room_id === r.room_id)?.meter_reading ?? 0;
          next[k] = String(Math.round(Number(prevReading) + r.units_at_join));
        }
      });
      return next;
    });
  }, [acJoinReadings, prevMonthACReadings, selectedMonth]);

  // All payment mutations go through Server Actions — not the browser Supabase client
  // Returns the freshly-synced rows so callers can read back the row they just
  // mutated (the manager write action doesn't echo it). Owners ignored the
  // return value before and still do — behaviour is unchanged for them.
  const syncMonth = useCallback(async (month: string): Promise<Payment[] | null> => {
    const result = await syncMonthAction(month);
    if (result.error) {
      toast({ title: "Failed to sync payments", description: result.error, variant: "destructive" });
      return null;
    }
    if (result.payments) {
      setPayments(result.payments);
      return result.payments;
    }
    return null;
  }, []);


  // No auto-sync on mount — server already called getPaymentsPageData(defaultMonth)
  // and passed fresh data as initialPayments. syncMonth is called only on user actions.

  async function loadHistory(month: string) {
    setHistoryLoaded(false);
    const result = await loadHistoryAction(month);
    if (result.error) {
      toast({ title: "Failed to load history", description: result.error, variant: "destructive" });
      return;
    }
    setAllHistory(result.payments ?? []);
    setHistoryLoaded(true);
  }

  async function handleMonthChange(month: string) {
    setSelectedMonth(month);
    setHistoryRoomFilter("all");
    // Meter inputs are per-room, not per-room-per-month — carrying one month's
    // typed reading into the next would silently offer to apply the wrong
    // number. Cleared so the prefill effect refills them from the new month.
    setAcUnits({});
    setAcOpeningReadings({});
    setMonthLoading(true);
    try {
      await syncMonth(month);
      if (tab === "history") await loadHistory(month);
    } finally {
      setMonthLoading(false);
    }
  }

  function stepMonth(dir: -1 | 1) {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const displayMonth = (() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
  })();

  function openMarkPaid(p: Payment) {
    const tenantName = p.tenant?.full_name ?? "";
    // From the PREVIEW, not the stored amount, so every figure in the dialog comes
    // from one source. The stored amount can lag the tenant's live concession —
    // ensureMonthlyPaymentRows only refreshes rows whose status is exactly
    // 'pending', so an OVERDUE bill is never re-priced. It also keeps
    // handleDiscountChange's `untouched` test honest: a mismatched prefill reads
    // as a hand-typed partial, and the amount then stops following the percentage.
    const remaining = previewDiscount(p, "").remaining;
    setMarkDialog(p);
    setMarkForm({
      method: "cash",
      date: formatDateInput(new Date()),
      late_fee: "0",
      notes: "",
      receipt_number: genReceipt(tenantName, p.for_month),
      ac_units_consumed: p.ac_units_consumed ? String(p.ac_units_consumed) : "0",
      amount_received: String(remaining),
      discount_percent: "",
    });
  }

  // Typing a discount changes what there is to collect, so the amount field has
  // to follow it — otherwise the operator confirms the pre-discount figure and
  // the server rejects it as more than the remaining balance. Only when they
  // haven't overridden it themselves: an amount that no longer matches the
  // default is a partial payment being typed, and overwriting that would be
  // worse than leaving it stale.
  function handleDiscountChange(raw: string) {
    if (!markDialog) return;
    const before = previewDiscount(markDialog, markForm.discount_percent).remaining;
    const after = previewDiscount(markDialog, raw).remaining;
    const entered = parseFloat(markForm.amount_received);
    const untouched = Number.isFinite(entered) && Math.abs(entered - before) < 0.01;
    setMarkForm({
      ...markForm,
      discount_percent: raw,
      amount_received: untouched ? String(after) : markForm.amount_received,
    });
  }

  // The referral reconciler is a background writer: it runs on every payments
  // page load and can attach or move a reward while this dialog is open, at
  // which point the server refuses to settle against a total that no longer
  // exists. Toasting alone would leave the operator staring at the stale figure
  // they just failed to collect, so re-read the month and put the dialog back up
  // against the row that actually exists now.
  async function reopenAfterReprice(paymentId: string) {
    const fresh = await syncMonth(selectedMonth);
    const row = fresh?.find((r) => r.id === paymentId) ?? null;
    setMarkDialog(null);
    toast({
      title: "Bill was re-priced",
      description: row
        ? "The total changed while you were recording this. Reopened with the new amount — check it and confirm again."
        : "The total changed while you were recording this. Reopen the payment and try again.",
      variant: "destructive",
    });
    if (row) openMarkPaid(row);
  }

  // Undo restores the bill to exactly what it was before the last installment —
  // amount_before is stored on the row, so nothing is recalculated. The operator
  // then records the payment again with the right number.
  const [undoTarget, setUndoTarget] = useState<Payment | null>(null);
  const [undoing, setUndoing] = useState(false);

  async function handleUndo() {
    if (!undoTarget) return;
    setUndoing(true);
    const result = isManager
      ? await undoLastPaymentAsManager(undoTarget.id)
      : await undoLastPaymentAction(undoTarget.id);
    setUndoing(false);
    if (result.error) {
      toast({ title: "Could not undo", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Payment undone",
      description: `${formatCurrency(result.undone?.amount ?? 0)} reversed. Record it again with the correct amount.`,
    });
    setUndoTarget(null);
    await syncMonth(selectedMonth);
  }

  async function handleMarkPaid() {
    if (!markDialog) return;

    // --- Client-side input validation (F-004, F-005) ---
    const tier = markDialog.payment_package_tier as PackageTier | undefined;
    const isAcTier = (tier === "space_food_ac");

    if (isAcTier) {
      const rawAc = markForm.ac_units_consumed.trim();
      const parsedAc = parseFloat(rawAc);
      if (!Number.isFinite(parsedAc) || parsedAc < 0 || parsedAc > MAX_AC_UNITS) {
        toast({
          title: "Invalid AC units",
          description: `AC units consumed must be a number between 0 and ${MAX_AC_UNITS}.`,
          variant: "destructive",
        });
        return;
      }
    }

    const lateFee = parseFloat(markForm.late_fee);
    if (!Number.isFinite(lateFee) || lateFee < 0) {
      toast({
        title: "Invalid late fee",
        description: "Late fee must be a non-negative number.",
        variant: "destructive",
      });
      return;
    }

    // Blank is "no discount". A collected bill's discount is frozen by the
    // trigger, so nothing typed on one is sent — the input is hidden there too.
    const preview = previewDiscount(markDialog, markForm.discount_percent);
    const rawDiscount = markForm.discount_percent.trim();
    let discountPercent: number | undefined;
    if (rawDiscount !== "" && !preview.frozen) {
      discountPercent = parseFloat(rawDiscount);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        toast({
          title: "Invalid discount",
          description: "Discount must be a percentage between 0 and 100.",
          variant: "destructive",
        });
        return;
      }
    }

    const amountReceived = parseFloat(markForm.amount_received);
    if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
      toast({
        title: "Invalid amount",
        description: "Amount received must be a positive number.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    if (isManager) {
      if (!canCollect) {
        toast({ title: "Not allowed", description: "You don't have permission to collect payments.", variant: "destructive" });
        setSaving(false);
        return;
      }
      const result = await recordPaymentAsManager(
        markDialog.tenant_id,
        amountReceived,
        markForm.method,
        markDialog.for_month,
        isAcTier ? parseFloat(markForm.ac_units_consumed) : undefined,
        markForm.date,
        parseFloat(markForm.late_fee) || 0,
        markForm.receipt_number,
        markForm.notes,
        discountPercent,
      );
      if (result.error) {
        setSaving(false);
        if (result.error.includes(REPRICED_ERROR)) { await reopenAfterReprice(markDialog.id); return; }
        toast({ title: "Error", description: result.error, variant: "destructive" });
        return;
      }
      // The server's own verdict, matching the owner and partner branches. Deriving
      // it from the client preview meant any disagreement between the two printed
      // the wrong toast — success over a bill the server had left part-paid.
      const isPartial = result.payment?.status === "partially_paid";
      toast({ title: isPartial ? "Partial payment recorded" : "Payment recorded! 🎉" });
      setMarkDialog(null);
      setSaving(false);
      await syncMonth(selectedMonth);
      if (result.payment) {
        setPostPaymentWa({ payment: result.payment, amountReceivedNow: amountReceived, installmentId: result.installmentId });
      }
      return;
    }

    if (isPartner) {
      // recordPaymentAsPartner doesn't accept a late-fee/receipt-number override
      // (both fields are hidden in the dialog for partners, so nothing typed is
      // silently dropped).
      const result = await recordPaymentAsPartner(
        markDialog.tenant_id,
        amountReceived,
        markForm.method,
        markDialog.for_month,
        isAcTier ? parseFloat(markForm.ac_units_consumed) : undefined,
        markForm.notes,
        discountPercent,
      );
      if (result.error) {
        setSaving(false);
        if (result.error.includes(REPRICED_ERROR)) { await reopenAfterReprice(markDialog.id); return; }
        toast({ title: "Error", description: result.error, variant: "destructive" });
        return;
      }
      const isPartial = result.payment?.status === "partially_paid";
      toast({ title: isPartial ? "Partial payment recorded" : "Payment recorded! 🎉" });
      setMarkDialog(null);
      setSaving(false);
      await syncMonth(selectedMonth);
      // Same post-payment WhatsApp-share step as the owner path below — uses
      // the fresh post-update row so the dialog reflects the actual new
      // status/amount_paid, not the stale pre-update markDialog.
      if (result.payment) {
        setPostPaymentWa({ payment: result.payment, amountReceivedNow: amountReceived, installmentId: result.installmentId });
      }
      return;
    }

    const result = await markPaymentPaidAction({
      paymentId: markDialog.id,
      method: markForm.method,
      date: markForm.date,
      lateFee: markForm.late_fee,
      notes: markForm.notes,
      receiptNumber: markForm.receipt_number,
      acUnitsConsumed: markForm.ac_units_consumed,
      amountReceived: markForm.amount_received,
      discountPercent: discountPercent === undefined ? undefined : String(discountPercent),
    });

    if (result.error) {
      setSaving(false);
      if (result.error.includes(REPRICED_ERROR)) { await reopenAfterReprice(markDialog.id); return; }
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    } else {
      const isPartial = result.payment?.status === "partially_paid";
      toast({ title: isPartial ? "Partial payment recorded" : "Payment recorded! 🎉" });
      setMarkDialog(null);
      setSaving(false);
      await syncMonth(selectedMonth);
      // Use the fresh post-update row (not the stale pre-update markDialog) so the
      // share dialog and WhatsApp message reflect the actual new status/amount_paid.
      if (result.payment) {
        setPostPaymentWa({ payment: result.payment, amountReceivedNow: amountReceived, installmentId: result.installmentId });
      }
      return;
    }
  }

  // Opens the receipt that would actually be sent. installmentId scopes it to
  // the single transaction just recorded — without it the preview shows the
  // whole-bill cumulative receipt, which is not what the tenant would receive.
  // Reuses the same token minting as the send path, so previewing then sending
  // shares one permanent link rather than creating a second.
  async function openReceiptPreview(p: Payment, installmentId?: string) {
    await showDocPreview("Receipt preview", `${p.tenant?.full_name ?? "Member"} · ${p.for_month}`, async () => {
      const result = installmentId
        ? await createInstallmentReceiptLink(installmentId)
        : await createInvoiceLink(p.id);
      if (result.error || !result.token) return { error: result.error ?? "No receipt available." };
      return { url: `/r/${result.token}` };
    });
  }

  // ── In-app document preview ───────────────────────────────────────────────
  // Shown in a dialog rather than a new tab: previewing is a glance before
  // sending, and bouncing the operator into a separate tab (blank first, then a
  // PDF) costs them their place in the list.
  //
  // The PDF is fetched same-origin and rendered from a blob: URL. It cannot be
  // framed directly — /r/<token> carries X-Frame-Options: DENY and
  // frame-ancestors 'none', which is right for a public receipt and should stay
  // — and a blob has no such headers, so this reads the bytes we are already
  // allowed to read and displays them locally.
  const [docPreview, setDocPreview] = useState<{
    title: string;
    subtitle: string;
    url: string | null;   // blob: URL for the frame
    href: string | null;  // real URL, for "Open in new tab"
    error: string | null;
    /** Page aspect ratio (w/h) read from the PDF itself. */
    ratio: number;
  } | null>(null);

  // These receipts are thermal slips — 250pt wide with a height that grows with
  // the content (lib/receipt-pdf.ts: `PAGE_H = yTop + 10`), so there is no fixed
  // aspect ratio to hard-code. Read the real page box out of the file and size
  // the window to it, so the document fits exactly and never needs zooming.
  const DEFAULT_DOC_RATIO = 250 / 364;
  async function pdfAspectRatio(blob: Blob): Promise<number> {
    try {
      const head = await blob.slice(0, 4096).text();
      const m = head.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      if (!m) return DEFAULT_DOC_RATIO;
      const w = parseFloat(m[1]);
      const h = parseFloat(m[2]);
      if (!(w > 0 && h > 0)) return DEFAULT_DOC_RATIO;
      return w / h;
    } catch {
      return DEFAULT_DOC_RATIO;
    }
  }

  async function showDocPreview(
    title: string,
    subtitle: string,
    resolve: () => Promise<{ url?: string; error?: string }>
  ) {
    setDocPreview({ title, subtitle, url: null, href: null, error: null, ratio: DEFAULT_DOC_RATIO });
    const result = await resolve();
    if (result.error || !result.url) {
      setDocPreview((d) => (d ? { ...d, error: result.error ?? "This document is not available." } : d));
      return;
    }
    try {
      const res = await fetch(result.url);
      if (!res.ok) throw new Error(`The document could not be generated (${res.status}).`);
      const blob = await res.blob();
      const ratio = await pdfAspectRatio(blob);
      setDocPreview((d) => (d ? { ...d, url: URL.createObjectURL(blob), href: result.url!, ratio } : d));
    } catch (err) {
      setDocPreview((d) =>
        d ? { ...d, href: result.url!, error: err instanceof Error ? err.message : "Could not load the document." } : d
      );
    }
  }

  function closeDocPreview() {
    // Release the blob rather than leaking it for the life of the page.
    if (docPreview?.url) URL.revokeObjectURL(docPreview.url);
    setDocPreview(null);
  }

  // An uncollected bill has no receipt, but it does have an invoice — the same
  // document a payment reminder links to.
  async function openBillPreview(p: Payment) {
    await showDocPreview(
      "Invoice preview",
      `${p.tenant?.full_name ?? "Member"} · ${p.for_month}`,
      () => previewBillLinkAction(p.id)
    );
  }

  async function openReceipt(paymentId: string) {
    setGeneratingReceipt(paymentId);
    const result = await createInvoiceLink(paymentId);
    setGeneratingReceipt(null);
    if (result.error) {
      toast({ title: "Failed to open receipt", description: result.error, variant: "destructive" });
      return;
    }
    window.open(`/r/${result.token}`, "_blank", "noopener,noreferrer");
  }

  // installmentId scopes the receipt to the single transaction just recorded.
  // Without it the tenant gets a whole-bill receipt showing the CUMULATIVE
  // amount received, so someone who just handed over Rs 2,000 is given a slip
  // quoting a different number — the opposite of what a receipt is for.
  // hms_payment_installments is an immutable snapshot, so a receipt reissued
  // later still shows what was true at the time.
  async function sendWhatsAppReceipt(p: Payment, installmentId?: string) {
    setSendingWa(p.id);
    try {
      const result = installmentId
        ? await createInstallmentReceiptLink(installmentId)
        : await createInvoiceLink(p.id);
      if (result.error) {
        toast({ title: "Failed to create receipt link", description: result.error, variant: "destructive" });
        return;
      }
      const token = result.token!;
      const origin = window.location.origin;
      const receiptUrl = `${origin}/r/${token}`;

      // Normalise Pakistan phone: 03XX... -> 923XX...
      const rawPhone = p.tenant?.phone ?? "";
      const normPhone = rawPhone.replace(/\D/g, "").replace(/^0/, "92");

      const firstName = p.tenant?.full_name?.split(" ")[0] ?? "there";
      const total = Number(p.amount) + Number(p.late_fee ?? 0);
      const isPartial = p.status === "partially_paid";
      const amountPaidVal = Number(p.amount_paid ?? total);
      const remaining = Math.max(0, total - amountPaidVal);
      const amountFormatted = `Rs. ${amountPaidVal.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
      const remainingFormatted = `Rs. ${remaining.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

      // Only on the tenant's very first month — the reading never changes, so
      // repeating it in every month's WhatsApp text afterward would just be noise.
      // The receipt PDF (linked below) still shows it every month as the permanent record.
      const isFirstMonth = p.tenant?.check_in?.slice(0, 7) === p.for_month;
      const readingLine = isFirstMonth && p.tenant?.joining_meter_reading != null
        ? `AC meter reading at move-in: *${p.tenant.joining_meter_reading}* units — noted for your records.\n\n`
        : "";

      // "for 2026-07" reads to a tenant as a database key, not a month.
      const monthLabel = formatMonthLong(p.for_month);

      // A reservation is not a month's rent, and the ordinary wording told the
      // tenant their July bill was settled when July's rent had not even been
      // raised yet. Say what the money actually bought: a held bed, with rent
      // starting on the joining date.
      const joinDate = isReservationRow(p) && p.tenant?.check_in ? formatDayLong(p.tenant.check_in) : null;
      const message = isReservationRow(p)
        ? `Assalam o Alaikum ${firstName},\n\n` +
          `We've received *${amountFormatted}* as your security deposit to reserve your bed. ` +
          `This is not a rent payment${joinDate ? ` — your rent begins when you move in on *${joinDate}*` : " — your rent begins when you move in"}.\n\n` +
          `Download your receipt: ${receiptUrl}\n\n` +
          `Thank you - ${hostelName}`
        : isPartial
        ? `Assalam o Alaikum ${firstName},\n\n` +
          `We've received *${amountFormatted}* for ${monthLabel}. *${remainingFormatted}* remains due.\n\n` +
          readingLine +
          `Download your receipt: ${receiptUrl}\n\n` +
          `Thank you - ${hostelName}`
        : `Assalam o Alaikum ${firstName},\n\n` +
          `Your payment of *${amountFormatted}* for ${monthLabel} has been received.\n\n` +
          readingLine +
          `Download your receipt: ${receiptUrl}\n\n` +
          `Thank you - ${hostelName}`;

      // wa.me needs the number in the path; the phone-less form is
      // api.whatsapp.com/send, not "wa.me/?text=" (which opens nothing).
      const waUrl = normPhone
        ? `https://wa.me/${normPhone}?text=${encodeURIComponent(message)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;

      window.open(waUrl, "_blank", "noopener,noreferrer");
      toast({ title: "WhatsApp opened", description: "Receipt link copied into the chat." });
    } finally {
      setSendingWa(null);
    }
  }

  async function sendReminder(p: Payment) {
    const rawPhone = (p.tenant as { phone?: string | null } | null)?.phone ?? "";
    if (!rawPhone) {
      toast({ title: "No phone number", description: "This tenant has no phone on file.", variant: "destructive" });
      return;
    }
    const digits = rawPhone.replace(/\D/g, "").replace(/^0/, "92");
    if (!digits) {
      toast({ title: "Invalid phone", variant: "destructive" });
      return;
    }
    // Remaining balance, not the full bill — a partially_paid tenant has already
    // handed over real money; reminding for the original total would ask them
    // to pay something they've already covered.
    const total = Math.max(0, Number(p.amount) + Number(p.late_fee ?? 0) - Number(p.amount_paid ?? 0));
    const tenantDeposit = tenants.find(t => t.id === p.tenant_id)?.security_deposit ?? 0;
    const message = buildReminderMessage({
      template: reminderTemplate,
      tenantName: p.tenant?.full_name ?? "Tenant",
      amount: total,
      month: p.for_month,
      hostelName,
      accounts: paymentMethods,
      ac_charge: (p.ac_charge ?? 0) > 0 ? Number(p.ac_charge) : undefined,
      ac_units: (p.ac_units_consumed ?? 0) > 0 ? Number(p.ac_units_consumed) : undefined,
      ac_rate: packageConfig?.ac_per_unit_rate ?? undefined,
      security_deposit: tenantDeposit > 0 ? tenantDeposit : undefined,
      ac_maintenance_charge: (p.ac_maintenance_charge ?? 0) > 0 ? Number(p.ac_maintenance_charge) : undefined,
      registration_fee_charge: (p.registration_fee_charge ?? 0) > 0 ? Number(p.registration_fee_charge) : undefined,
      referral_discount: (p.referral_discount ?? 0) > 0 ? Number(p.referral_discount) : undefined,
    });
    const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  // Bulk-sends the same automated WhatsApp reminder the daily cron sends —
  // via the Meta WhatsApp Business API, no browser tabs. "all" targets every
  // tenant still pending/overdue/partially-paid this month regardless of their
  // personal due-day cadence; "due_today" targets only whoever's own due-day
  // cadence lands on today (same filter the Due Today tab displays). A
  // per-tenant "already reminded today" guard on the server means this can be
  // clicked again later without double-messaging anyone who already got one today.
  async function confirmSendBulkReminders() {
    setSendingBulk(true);
    try {
      const result = reminderScope === "due_today"
        ? await sendDueTodayRemindersAction(selectedMonth)
        : await sendBulkRemindersAction(selectedMonth);
      if (result.error) {
        setBulkConfirmOpen(false);
        toast({ title: "Failed to send reminders", description: result.error, variant: "destructive" });
        return;
      }
      setBulkConfirmOpen(false);
      setBulkResult(result.data ?? null);
      router.refresh();
    } finally {
      setSendingBulk(false);
    }
  }

  async function handleSaveJoinReading(roomId: string, tenantId: string) {
    if (!canRecordPayment) return;
    const key = `${tenantId}_${selectedMonth}`;
    // Falls back to the tenant's own move-in reading when the operator never
    // touched the field — it's pre-filled on screen, so Save must honor that
    // same value rather than silently reading blank state.
    const autoReading = tenants.find(t => t.id === tenantId)?.joining_meter_reading;
    const raw = joinUnits[key] ?? (autoReading != null ? String(autoReading) : "");
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: "Invalid reading", description: "Enter a non-negative meter reading.", variant: "destructive" });
      return;
    }
    const prevReading = prevMonthACReadings.find(r => r.room_id === roomId)?.meter_reading;
    // Falls back to whatever the Opening box is showing when the operator never
    // touched it, so Save can't silently bill against a different baseline.
    const baselineOpening = openingBaselineFor(roomId).value;
    const rawOpening = acOpeningReadings[roomId] ?? (baselineOpening != null ? String(baselineOpening) : "");
    const openingReading = prevReading == null ? (rawOpening ? parseFloat(rawOpening) : undefined) : undefined;

    setSavingJoin(tenantId);
    try {
      // The manager action reports success as `error: null`; the owner action
      // uses `success`. Normalise to a single error string either way.
      const err = isManager
        ? (await saveACJoinReadingAsManager(roomId, selectedMonth, tenantId, value, openingReading)).error
        : await (async () => {
            const r = await saveACJoinReadingAction(roomId, selectedMonth, tenantId, value, openingReading);
            return r.success ? null : (r.error ?? "Failed to save join reading.");
          })();
      if (err) {
        toast({ title: "Error saving join reading", description: err, variant: "destructive" });
      } else {
        toast({ title: "Join reading saved" });
        router.refresh();
      }
    } finally {
      setSavingJoin(null);
    }
  }

  // The opening this month's Apply actually used, backed out from what it saved
  // (meter_reading - total_units). Once a reading exists this is the only correct
  // baseline: deriveOpeningReading() answers a different question — "where does
  // this room's tracked history start" — and the two disagree whenever the
  // operator typed an opening by hand. lib/tenant-checkout.ts has always
  // preferred the implied value for exactly this reason; the AC tab did not, so
  // the Opening box redrew from move-in readings on every load and looked like it
  // had thrown the edit away.
  const openingBaselineFor = useCallback((roomId: string): { value: number | null; carried: boolean } => {
    const savedRow = acReadings.find(r => r.room_id === roomId);
    if (savedRow && savedRow.meter_reading != null && savedRow.total_units != null) {
      return { value: Math.round(Number(savedRow.meter_reading)) - Math.round(Number(savedRow.total_units)), carried: false };
    }
    // The vacancy test runs FIRST. deriveOpeningReading takes the minimum
    // joining_meter_reading of everyone active in the room, excluding only those
    // whose check-in month equals this month — so a tenant arriving NEXT month
    // is included, and back-filling an empty August would open it at a reading
    // that tenant recorded in September. Half the vacancy's units then vanish,
    // or Apply is refused outright as "below the opening reading".
    //
    // Gated on the SELECTED MONTH, not today: a room empty all of August is what
    // this fallback exists for, and "is it empty right now" gets that wrong the
    // moment someone moves in. Inline rather than from acRoomMeta because this
    // callback is declared above that memo.
    const [fbY, fbM] = selectedMonth.split("-").map(Number);
    const fbNextMonthStart = fbM === 12 ? `${fbY + 1}-01-01` : `${fbY}-${String(fbM + 1).padStart(2, "0")}-01`;
    const isEmpty = !tenants.some(t => t.room_id === roomId && t.check_in < fbNextMonthStart);

    const derived = deriveOpeningReading(tenants.filter(t => t.room_id === roomId && t.is_active), selectedMonth);
    // Occupied rooms are untouched: isEmpty is false for every one of them, so
    // they take the same deriveOpeningReading value they always did.
    if (!isEmpty) return { value: derived, carried: false };

    // An empty room has no tenant to derive an opening from, and may
    // legitimately have skipped a month — so carry forward its most recent
    // earlier reading. Occupied rooms keep the strict previous-month rule:
    // loosening it for them would turn a room last read three months ago into
    // one large catch-up bill.
    // allAcReadings, NOT acReadings: the latter is already filtered to the
    // selected month (line 322), so feeding it to a "strictly before this month"
    // helper always yielded null. The box then rendered blank, and an operator
    // taking that at face value and typing 0 would send an explicit opening of
    // 0 — which wins over the server's own fallback and records the entire
    // absolute meter reading as one month's consumption.
    // carried: this is an earlier month's absolute meter reading, NOT anyone's
    // move-in reading. Labelling it as one made an operator who knew no tenant
    // ever recorded that number read it as corrupt data.
    const value = latestReadingBefore(
      allAcReadings
        .filter(r => r.room_id === roomId)
        .map(r => ({ for_month: r.for_month, meter_reading: r.meter_reading ?? null })),
      selectedMonth
    );
    // derived only as a last resort here: on an empty room it can only come from
    // a tenant who has not arrived yet, but a wrong-ish opening still beats the
    // blank box that invites someone to type 0.
    return value != null ? { value, carried: true } : { value: derived, carried: false };
  }, [acReadings, allAcReadings, tenants, selectedMonth]);

  async function applyACUnits(roomId: string) {
    if (!canRecordPayment) return;
    const meterReading = Number(acUnits[roomId] ?? "");
    if (!Number.isFinite(meterReading) || meterReading < 0) return;
    const prevReading = prevMonthACReadings.find(r => r.room_id === roomId)?.meter_reading;
    // Falls back to whatever the Opening box is showing when the operator never
    // touched it. Using the move-in-derived value here instead would re-apply the
    // month against a baseline nobody chose — Room 3 sat on a saved opening of 0
    // while this resolved to 1, so a no-op Apply would have silently rebilled the
    // month at 62 units instead of 63.
    const baselineOpening = openingBaselineFor(roomId).value;
    const rawOpening = acOpeningReadings[roomId] ?? (baselineOpening != null ? String(baselineOpening) : "");
    const openingReading = prevReading == null ? (rawOpening ? parseFloat(rawOpening) : undefined) : undefined;

    setApplyingAC(roomId);
    try {
      // Same normalisation as the join-reading path: the manager action signals
      // success with `error: null` and exposes no proRatedCount/unassignedUnits.
      const result = isManager
        ? await (async () => {
            const r = await applyRoomACUnitsAsManager(roomId, selectedMonth, meterReading, openingReading);
            return { ...r, success: !r.error, proRatedCount: undefined as number | undefined, unassignedUnits: undefined as number | undefined, reopenedCount: undefined as number | undefined };
          })()
        : await applyRoomACUnitsAction(roomId, selectedMonth, meterReading, openingReading);
      if (!result.success) {
        toast({ title: "AC Billing Error", description: result.error ?? "Failed to apply AC units.", variant: "destructive" });
      } else {
        const derivedUnits = result.derivedUnits ?? 0;
        // A vacant room writes no payment rows, so none of the tenant-facing
        // wording below applies — the units are the hostel's own cost.
        if (result.vacant) {
          toast({
            title: "Reading recorded — hostel cost",
            description: `${derivedUnits} unit${derivedUnits === 1 ? "" : "s"} with nobody in the room. Charged to no tenant, and the meter now carries forward for whoever moves in next.`,
          });
          await syncMonth(selectedMonth);
          // router.refresh() as well: syncMonth only replaces payment state, and
          // the AC readings arrive as a PROP from getPaymentsPageData. Without
          // this the card still reads "No reading for this month yet" straight
          // after a successful save, which reads as failure.
          router.refresh();
          return;
        }

        const cleared = derivedUnits === 0;
        // A bill that was already settled and is now short by this AC gets reopened
        // as partially paid — say so, or the balance appears from nowhere.
        if (result.reopenedCount && result.reopenedCount > 0) {
          toast({
            title: `${result.reopenedCount} paid bill${result.reopenedCount === 1 ? "" : "s"} reopened`,
            description: `Settled before this reading, so the AC just applied is still outstanding. Now shown as Partial with the balance collectable.`,
          });
        }
        toast({
          title: cleared ? "AC charge cleared" : "AC units applied",
          description: cleared
            ? "AC charges removed for all tenants in this room."
            : result.proRatedCount && result.proRatedCount > 0
              ? `${result.eligibleCount} tenant${result.eligibleCount === 1 ? "" : "s"} · ${derivedUnits} units consumed · ${result.proRatedCount} with segment billing${result.unassignedUnits ? ` · ${result.unassignedUnits} units unassigned` : ""}`
              : `${result.eligibleCount} tenant${result.eligibleCount === 1 ? "" : "s"} · ${derivedUnits} units consumed · ${result.perTenantUnits} units each · Rs ${result.perTenantCharge?.toLocaleString()} each`,
        });
        await syncMonth(selectedMonth);
        router.refresh();
      }
    } finally {
      setApplyingAC(null);
    }
  }

  // EVERY metered room, occupied or not. Empty rooms were excluded until now, so
  // consumption by staff, a guest, or lights left on had nowhere to go — and the
  // meter chain broke, leaving the next tenant to inherit units used before they
  // arrived. has_ac is the physical fact; meterAllRooms is the billing rule.
  // Which rooms had someone LIVING in them during the MONTH ON SCREEN — the one
  // occupancy answer, used by the chips, the room list and each card alike.
  // "Is anyone there right now" is a different question and gets this wrong in
  // both directions: back-filling August in September files an empty-in-August
  // room under Occupied, and a room whose tenants left on the 20th reads empty
  // for a month it was lived in.
  const acRoomOccupiedInMonth = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const nextMonthStart = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const occupied = new Set<string>();
    // Deliberately NO check_out bound, because the server has none: its eligible
    // set is `is_active = true AND check_in < firstOfNextMonth`. The tenants prop
    // is active-only, so a past check_out on an active row means a DAILY GUEST —
    // the app stores their departure date while leaving them active until someone
    // runs the Checkout dialog, which for daily guests routinely never happens.
    // Excluding them told the operator the room was Empty while the server still
    // saw an occupant, so Apply took the OCCUPIED path and billed that guest for
    // a month they had already left.
    for (const t of tenants) {
      if (!t.room_id) continue;
      if (t.check_in >= nextMonthStart) continue;
      occupied.add(t.room_id);
    }
    // Departed tenants are gone from the roster above (it is active-only), so
    // their month is read off their payment row instead. Keyed on RESIDENCY, not
    // on an AC charge: checkout only charges AC on a has_ac room, so on a
    // meter-all-rooms branch a metered non-AC room's leaver carries none, and
    // the room then read as empty for a month it was lived in.
    //
    // check_in bounds it, and that bound is load-bearing: stepping to a past
    // month runs ensureMonthlyPaymentRows, which generates rows for tenants who
    // only arrived later — counting those made a genuinely vacant month claim it
    // had residents.
    for (const p of payments) {
      if (p.for_month !== selectedMonth) continue;
      const rid = p.tenant?.room_id;
      if (!rid) continue;
      const ci = p.tenant?.check_in;
      if (ci && ci >= nextMonthStart) continue;
      occupied.add(rid);
    }
    return occupied;
  }, [tenants, payments, selectedMonth]);

  const acRooms = useMemo(() => {
    return rooms
      .filter(r => r.has_ac || meterAllRooms)
      // Empty metered rooms used to be hidden from managers, because the manager
      // action refused a non-AC room and there was nothing to do in one. It does
      // not refuse any more, and an empty metered room is exactly where a reading
      // has to be recorded — its units are the hostel's own cost and the meter
      // has to carry forward for whoever moves in next. Both tiers see the same
      // list now.
      .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [rooms, meterAllRooms]);

  const acRoomMeta = useMemo(() => {
    const m = new Map<string, { occupied: boolean }>();
    for (const r of acRooms) m.set(r.id, { occupied: acRoomOccupiedInMonth.has(r.id) });
    return m;
  }, [acRooms, acRoomOccupiedInMonth]);

  // Only include payments for currently active tenants. Checked-out tenants have
  // is_active=false so they're absent from the `tenants` prop — their payment rows
  // (which may still be pending after checkout) should not appear in the monthly view.
  const activeTenantIds = useMemo(() => new Set(tenants.map(t => t.id)), [tenants]);
  const activePayments = useMemo(
    () => payments.filter(p => activeTenantIds.has(p.tenant_id) || isReservationRow(p)),
    [payments, activeTenantIds]
  );

  // Feeds both the "Send Reminders" button's disabled state and the confirm
  // dialog's tenant count — read fresh on every render, not cached from
  // whenever the dialog happened to open.
  const unpaidCount = useMemo(
    () => activePayments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid").length,
    [activePayments]
  );

  // "Due today" only means something for the real current month — a tenant's
  // due day is a day-of-month, and comparing it against today's real
  // day-of-month while viewing a different month's payment rows would show
  // an unrelated month's tenants as if they were due right now.
  const currentRealMonth = useMemo(() => pktTodayDateString().slice(0, 7), []);
  const isViewingCurrentMonth = selectedMonth === currentRealMonth;
  const dueTodayPayments = useMemo(() => {
    if (!isViewingCurrentMonth) return [];
    const todayDayOfMonth = Number(pktTodayDateString().slice(8, 10));
    return activePayments.filter((p) => {
      if (p.status !== "pending" && p.status !== "overdue" && p.status !== "partially_paid") return false;
      const checkIn = p.tenant?.check_in;
      if (!checkIn) return false;
      return shouldRemindToday(tenantDueDay(checkIn, selectedMonth), todayDayOfMonth);
    });
  }, [activePayments, isViewingCurrentMonth, selectedMonth]);

  // Rooms that have at least one payment this month — for the Room filter
  const roomsInMonth = useMemo(() => {
    const ids = new Set(activePayments.map(p => p.tenant?.room_id).filter(Boolean));
    return rooms.filter(r => ids.has(r.id)).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [activePayments, rooms]);

  // Rooms that appear in the full history — for the History tab room filter
  const roomsInHistory = useMemo(() => {
    const ids = new Set(allHistory.map(p => p.tenant?.room_id).filter(Boolean));
    return rooms.filter(r => ids.has(r.id)).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [allHistory, rooms]);

  const historyByRoom = useMemo(() => {
    if (historyRoomFilter === "all") return allHistory;
    return allHistory.filter(p => p.tenant?.room_id === historyRoomFilter);
  }, [allHistory, historyRoomFilter]);

  const historyBase = useMemo(
    () => (historyAcOnly ? historyByRoom.filter(hasAcCharge) : historyByRoom),
    [historyByRoom, historyAcOnly]
  );

  const filteredHistory = useMemo(() => {
    const base = historyBase;
    if (historyStatusFilter === "paid") return base.filter(p => p.status === "paid");
    if (historyStatusFilter === "partial") return base.filter(p => displayStatus(p) === "partially_paid");
    if (historyStatusFilter === "unpaid") return base.filter(p => isUnpaidStatus(p.status));
    return base;
  }, [historyBase, historyStatusFilter]);

  // The rooms the current chip admits. The Select lists exactly these, so the
  // dropdown can never offer a room the chip has filtered out.
  const occupancyAcRooms = useMemo(
    () =>
      acOccupancy === "all"
        ? acRooms
        : acRooms.filter(r => (acRoomMeta.get(r.id)?.occupied ?? false) === (acOccupancy === "occupied")),
    [acRooms, acOccupancy, acRoomMeta]
  );

  const filteredAcRooms = useMemo(() => {
    if (acRoomFilter === "all") return occupancyAcRooms;
    return occupancyAcRooms.filter(r => r.id === acRoomFilter);
  }, [occupancyAcRooms, acRoomFilter]);

  // Split so the chips can count the rows they would actually reveal. Counting
  // the whole month regardless of the room and AC filters read as a bug: Room 5
  // listed two partial bills under a chip saying "Partial 3", the third being a
  // tenant in another room.
  const monthlyScope = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activePayments.filter(p => {
      if (q && !p.tenant?.full_name?.toLowerCase().includes(q)) return false;
      if (roomFilter !== "all" && p.tenant?.room_id !== roomFilter) return false;
      if (msgFilter !== "all") {
        const m = p.tenant_id ? lastWhatsApp[p.tenant_id] : undefined;
        // Read is a subset of Delivered, not a rival to it: a read message did
        // reach the phone, so it belongs under both — an owner filtering
        // "Delivered" and not seeing the ones that were read would be baffling.
        if (msgFilter === "read" ? m?.status !== "read" : msgBucket(m) !== msgFilter) return false;
      }
      return true;
    });
  }, [activePayments, roomFilter, search, msgFilter, lastWhatsApp]);

  // Everything the status chips are counted against — scope narrowed by the AC
  // toggle, but never by the chips themselves.
  const monthlyBase = useMemo(
    () => (acOnly ? monthlyScope.filter(hasAcCharge) : monthlyScope),
    [monthlyScope, acOnly]
  );

  const filteredPayments = useMemo(() => {
    if (statusFilter === "paid") return monthlyBase.filter(p => p.status === "paid");
    if (statusFilter === "partial") return monthlyBase.filter(p => displayStatus(p) === "partially_paid");
    if (statusFilter === "unpaid") return monthlyBase.filter(p => isUnpaidStatus(p.status));
    return monthlyBase;
  }, [monthlyBase, statusFilter]);

  // Headline stats deliberately use ALL payment rows for the month, not just
  // activePayments — a checked-out tenant's unpaid/paid balance for a month
  // they actually stayed is real money and must match the Dashboard's figures
  // (which never filtered by tenant-active status). activePayments remains
  // the source for the tenant-facing list/filters/reminders below, where
  // showing only current residents is the correct scope.
  //
  // A tenant currently on the waiting list is different from a checked-out
  // one, though: they were never actually billable, so a row that survived
  // from before they were moved back to waiting (see tenants-client.tsx's
  // active → waiting edit path) must not inflate these totals.
  const waitingTenantIdSet = useMemo(() => new Set(waitingTenantIds), [waitingTenantIds]);
  // A reservation deposit is the one exception: its tenant is on the waiting
  // list by definition, but the money was genuinely collected, so it has to
  // reach Total Due and Collected like any other paid row.
  const billablePayments = useMemo(
    () => payments.filter((p) => !waitingTenantIdSet.has(p.tenant_id) || isReservationRow(p)),
    [payments, waitingTenantIdSet]
  );
  const stats = useMemo(() => {
    // Waived rows are excluded here the same way Collected/Pending already
    // exclude them below — otherwise Total Due drifts above
    // Collected + Pending whenever anything for the month has been waived.
    const due = billablePayments.filter((p) => p.status !== "waived").reduce((s, p) => s + Math.max(0, Number(p.amount)) + Math.max(0, Number(p.late_fee || 0)), 0);
    // AC has its own Collected/Pending tiles below, so it's subtracted out
    // here to avoid counting it twice. Only subtracted for statuses where the
    // AC portion is unambiguous (status === "paid" ⇒ fully collected;
    // pending/overdue ⇒ fully outstanding) — a partially_paid row can't be
    // cleanly attributed between rent and AC (which portion did it cover?),
    // so its AC charge stays bundled into these totals, same as before.
    const collected = billablePayments.filter((p) => p.status === "paid" || p.status === "partially_paid").reduce((s, p) => {
      const paid = Math.max(0, Number(p.amount_paid ?? p.amount));
      const acPortion = p.status === "paid" ? Math.max(0, Number(p.ac_charge || 0)) : 0;
      return s + Math.max(0, paid - acPortion);
    }, 0);
    const pending = billablePayments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid").reduce((s, p) => {
      const outstanding = Math.max(0, Number(p.amount) + Number(p.late_fee || 0) - Number(p.amount_paid ?? 0));
      // displayStatus, not p.status: a REVERSED bill is stored partially_paid
      // while holding nothing, and its AC is unambiguously outstanding. A
      // genuinely part-paid bill keeps the bundled treatment below, because
      // nothing records whether that money went to rent or to AC.
      const acPortion = displayStatus(p) === "pending" || p.status === "overdue" ? Math.max(0, Number(p.ac_charge || 0)) : 0;
      return s + Math.max(0, outstanding - acPortion);
    }, 0);
    // AC collected/pending stay paid-only — a partial payment can't be cleanly
    // attributed between rent and AC (which portion did it cover?).
    const acCollected = billablePayments.filter((p) => p.status === "paid").reduce((s, p) => s + Math.max(0, Number(p.ac_charge || 0)), 0);
    // Same rule: a reversed bill owes all of its AC. Without this both AC totals
    // fell to zero after an undo and the whole AC section disappeared from the
    // page (hasAc below), hiding money that is genuinely owed.
    const acPending = billablePayments.filter((p) => displayStatus(p) === "pending" || p.status === "overdue").reduce((s, p) => s + Math.max(0, Number(p.ac_charge || 0)), 0);
    return { due, collected, pending, acCollected, acPending };
  }, [billablePayments]);

  const TIER_LABEL: Record<string, string> = {
    space_only: "Space Only",
    space_food: "Space + 2 Meals",
    space_3meals: "Space + 3 Meals",
    space_food_ac: "Space + Meals + AC",
    space_meals_cooler: "Space + Meals + Cooler",
  };

  const WA_ICON = (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );

  // Desktop-only table header
  function PaymentTableHeader() {
    return (
      <div className={cn("hidden md:grid gap-x-6 px-5 py-2.5 border-b border-white/5", PAYMENT_GRID)}>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Plan</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Rent</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">AC</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Total</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center w-28">Status</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-[22rem]">Action</span>
      </div>
    );
  }

  function PaymentRow({ p }: { p: Payment }) {
    const room = p.tenant?.room_id ? roomMap[p.tenant.room_id] : null;
    const cfg = statusConfig[displayStatus(p)];
    const isReservation = isReservationRow(p);
    const isLate = (p.status === "pending" || p.status === "overdue") && p.for_month < selectedMonth;
    // A reservation has no package tier — falling through to "Space Only" would
    // present a bed booking as a monthly plan the tenant is not on yet.
    const tierLabel = isReservation
      ? "Seat Reservation"
      : p.payment_package_tier ? TIER_LABEL[p.payment_package_tier] : "Space Only";
    const joinsOn = isReservation ? fmtJoinDate(p.tenant?.check_in) : null;
    const total = Number(p.amount) + Number(p.late_fee || 0);
    // Rent and metered AC get their own columns; everything else (food, deposit,
    // registration fee, AC maintenance) is itemised under Total so Rent + AC and
    // the total never look like they disagree.
    const charges = splitPaymentCharges(p);
    const basis = dailyBasis(p);

    const statusColors: Record<PaymentStatus, string> = {
      paid:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      pending: "bg-amber/15 text-amber border-amber/25",
      overdue: "bg-rose-500/15 text-rose-400 border-rose-500/25",
      waived:  "bg-white/5 text-muted-foreground border-white/10",
      partially_paid: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    };

    // The inline buttons are exactly what clients already know — Remind, Pay,
    // Receipt, Collect Rest, in their existing places. Everything new goes in
    // the overflow menu instead, so the familiar row does not change shape.
    // Driven by the EFFECTIVE status throughout. A reversed bill holds no money,
    // so it must behave exactly like an unpaid one: no receipt to preview, no
    // receipt to WhatsApp ("We've received Rs. 0"), and an invoice instead.
    const view = displayStatus(p);
    const menuItems: RowMenuItem[] = [];
    if (view === "pending" || view === "overdue") {
      menuItems.push({
        label: "Preview Invoice",
        icon: <FileText className="w-3.5 h-3.5" />,
        onSelect: () => openBillPreview(p),
      });
    }
    if (view === "paid" || view === "partially_paid") {
      menuItems.push({
        label: "Preview Receipt",
        icon: <FileText className="w-3.5 h-3.5" />,
        onSelect: () => openReceiptPreview(p),
      });
      if (canRecordPayment) {
        menuItems.push({
          label: "Undo Payment",
          icon: <Undo2 className="w-3.5 h-3.5" />,
          danger: true,
          onSelect: () => setUndoTarget(p),
        });
      }
    }

    const actionButtons = (
      <>
        {(view === "pending" || view === "overdue") && (
          <>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" onClick={() => sendReminder(p)}>
              {WA_ICON} Remind
            </Button>
            {canRecordPayment && (
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20" onClick={() => openMarkPaid(p)}>
                <CheckCircle2 className="w-3 h-3" /> Pay
              </Button>
            )}
          </>
        )}
        {view === "partially_paid" && (
          <>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" onClick={() => sendReminder(p)}>
              {WA_ICON} Remind
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" disabled={sendingWa === p.id} onClick={() => sendWhatsAppReceipt(p)}>
              {WA_ICON} Receipt
            </Button>
            {canRecordPayment && (
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20" onClick={() => openMarkPaid(p)}>
                <CheckCircle2 className="w-3 h-3" /> Collect Rest
              </Button>
            )}
          </>
        )}
        {view === "paid" && (
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" disabled={sendingWa === p.id} onClick={() => sendWhatsAppReceipt(p)}>
            {WA_ICON} Receipt
          </Button>
        )}
        {p.status === "waived" && <span className="text-xs text-muted-foreground px-2">Waived</span>}
        {p.status !== "waived" && <RowMenu items={menuItems} />}
      </>
    );

    return (
      <>
        {/* ── Mobile card (< md) ─────────────────────────────── */}
        <div className="md:hidden rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-3 hover:border-white/10 transition-colors">
          {/* Row 1: name + amount */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-foreground leading-tight">{p.tenant?.full_name ?? "—"}</p>
                {(() => {
                  const tick = waTick(p.tenant_id ? lastWhatsApp[p.tenant_id] : undefined);
                  if (!tick) return null;
                  const when = p.tenant_id ? lastWhatsApp[p.tenant_id]?.created_at : undefined;
                  return (
                    <span
                      className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap", tick.cls)}
                      title={when ? `Last WhatsApp ${formatDateTime(when)}` : undefined}
                    >
                      {tick.label}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {room && <span className="text-xs text-muted-foreground">Rm {room.room_number}</span>}
                <span className={cn("text-xs", isReservation ? "text-violet-400" : "text-blue-400")}>{tierLabel}</span>
                {isLate && <span className="text-xs text-rose-400 font-medium">Late</span>}
              </div>
              {p.payment_date && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isReservation ? "Collected" : "Paid"} {formatDate(p.payment_date)}
                </p>
              )}
              {joinsOn && <p className="text-xs text-muted-foreground mt-0.5">Holds a bed from {joinsOn}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-bold text-foreground">{formatCurrency(total)}</p>
              {basis && <p className="text-xs text-muted-foreground">{dailyBasisLabel(basis)}</p>}
              {/* One line each. Joined with a separator these were the widest
                  element in the card, so the nowrap forced the right column wide
                  enough to crowd the plan label beside it. */}
              {isReservation
                ? <p className="text-xs text-violet-400 whitespace-nowrap">Reservation deposit</p>
                : <p className="text-xs text-muted-foreground whitespace-nowrap">Rent {formatCurrency(charges.rent)}</p>}
              {charges.ac > 0 && (
                <p className="text-xs text-cyan-400 whitespace-nowrap">
                  AC {formatCurrency(charges.ac)}
                  {charges.acMaintenance > 0 && (
                    <span className="text-muted-foreground"> +{formatCurrency(charges.acMaintenance)} mnt</span>
                  )}
                </p>
              )}
              {charges.ac === 0 && charges.acMaintenance > 0 && (
                <p className="text-xs text-muted-foreground whitespace-nowrap">AC mnt {formatCurrency(charges.acMaintenance)}</p>
              )}
              {charges.food > 0 && <p className="text-xs text-muted-foreground whitespace-nowrap">incl. {formatCurrency(charges.food)} food</p>}
              {!isReservation && charges.deposit > 0 && <p className="text-xs text-violet-400 whitespace-nowrap">incl. {formatCurrency(charges.deposit)} deposit</p>}
              {charges.registrationFee > 0 && <p className="text-xs text-muted-foreground whitespace-nowrap">incl. {formatCurrency(charges.registrationFee)} reg.</p>}
              {charges.referralDiscount > 0 && (
                <p className="text-xs text-emerald-400 whitespace-nowrap flex items-center justify-end gap-1">
                  <Gift className="w-3 h-3 shrink-0" />Referral −{formatCurrency(charges.referralDiscount)}
                </p>
              )}
              {/* splitPaymentCharges reports GROSS rent, so without this line a
                  phone shows Rent 22,000 above Total 19,800 and nothing accounts
                  for the gap. Managers collect on phones. */}
              {charges.discount > 0 && (
                <p className="text-xs text-emerald-400 whitespace-nowrap">
                  Discount {Number(p.discount_percent ?? 0)}% −{formatCurrency(charges.discount)}
                </p>
              )}
              {Number(p.late_fee) > 0 && <p className="text-xs text-rose-400">+{formatCurrency(p.late_fee)} late</p>}
              {displayStatus(p) === "partially_paid" && (
                <p className="text-xs text-blue-400">{formatCurrency(Number(p.amount_paid ?? 0))} received</p>
              )}
              <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[displayStatus(p)]}`}>
                {cfg.label}
              </span>
            </div>
          </div>
          {/* Row 2: actions. flex-wrap because this is the narrow view and Undo
              took the row to four buttons — without it they compress past
              legibility on a phone instead of dropping to a second line. */}
          {p.status !== "waived" && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 border-t border-white/5">
              {actionButtons}
            </div>
          )}
        </div>

        {/* ── Desktop table row (≥ md) ───────────────────────── */}
        <div className={cn("hidden md:grid gap-x-6 items-center px-5 py-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5", PAYMENT_GRID)}>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{p.tenant?.full_name ?? "—"}</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {room && <span className="text-xs text-muted-foreground">Rm {room.room_number}</span>}
              {isLate && <span className="text-xs text-rose-400 font-medium">Late</span>}
              {(() => {
                const tick = waTick(p.tenant_id ? lastWhatsApp[p.tenant_id] : undefined);
                if (!tick) return null;
                const when = p.tenant_id ? lastWhatsApp[p.tenant_id]?.created_at : undefined;
                return (
                  <span
                    className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap", tick.cls)}
                    title={when ? `Last WhatsApp ${formatDateTime(when)}` : undefined}
                  >
                    {tick.label}
                  </span>
                );
              })()}
              {p.payment_date && (
                <span className="text-xs text-muted-foreground">
                  {isReservation ? "Collected" : "Paid"} {formatDate(p.payment_date)}
                </span>
              )}
              {joinsOn && <span className="text-xs text-muted-foreground">Bed held from {joinsOn}</span>}
            </div>
          </div>
          <div className="min-w-0">
            <span className={cn("text-sm font-medium", isReservation ? "text-violet-400" : "text-blue-400")}>{tierLabel}</span>
          </div>

          {/* Rent — base rent only. Deposit is refundable and food is a separate
              service, so folding either in here would overstate rental income.
              A reservation has no rent at all; a bare "Rs 0" here reads as an
              unbilled month rather than a booking that was never a month. */}
          <div className="text-right">
            {isReservation ? (
              <p className="text-sm text-muted-foreground/30">—</p>
            ) : (
              <>
                <p className="text-sm text-foreground tabular-nums">{formatCurrency(charges.rent)}</p>
                {basis && <p className="text-[10px] leading-tight text-muted-foreground">{dailyBasisLabel(basis)}</p>}
              </>
            )}
          </div>

          {/* AC — metered electricity only, the figure the AC Collected tile counts.
              Flat AC maintenance used to hang below this as "+Rs 3,000 mnt", which is
              wider than this column ever gets: nowrap meant it spilled left over Rent.
              It belongs with the other fixed extras under Total anyway. */}
          <div className="text-right">
            {charges.ac > 0 ? (
              <p className="text-sm text-cyan-400 tabular-nums">{formatCurrency(charges.ac)}</p>
            ) : (
              <p className="text-sm text-muted-foreground/30">—</p>
            )}
          </div>

          {/* Sub-lines wrap rather than nowrap. Held on one line they were wider than
              the column and bled into Status, which is what made these read as merged. */}
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(total)}</p>
            {charges.food > 0 && <p className="text-[10px] leading-tight text-muted-foreground">incl. {formatCurrency(charges.food)} food</p>}
            {charges.deposit > 0 && (
              <p className="text-[10px] leading-tight text-violet-400">
                {isReservation ? "reservation deposit" : `incl. ${formatCurrency(charges.deposit)} deposit`}
              </p>
            )}
            {charges.acMaintenance > 0 && <p className="text-[10px] leading-tight text-muted-foreground">incl. {formatCurrency(charges.acMaintenance)} AC mnt</p>}
            {charges.registrationFee > 0 && <p className="text-[10px] leading-tight text-muted-foreground">incl. {formatCurrency(charges.registrationFee)} reg.</p>}
            {/* Rent above stays GROSS (splitPaymentCharges adds the discount back),
                so this line is what reconciles Rent + AC + extras with Total. */}
            {charges.referralDiscount > 0 && (
              <p className="text-[10px] leading-tight text-emerald-400 flex items-center justify-end gap-1">
                <Gift className="w-2.5 h-2.5 shrink-0" />Referral −{formatCurrency(charges.referralDiscount)}
              </p>
            )}
            {/* Same reason as the referral line above: Rent is gross, so the rent
                discount has to show or the row does not reconcile. */}
            {charges.discount > 0 && (
              <p className="text-[10px] leading-tight text-emerald-400">
                Discount {Number(p.discount_percent ?? 0)}% −{formatCurrency(charges.discount)}
              </p>
            )}
            {Number(p.late_fee) > 0 && <p className="text-[10px] leading-tight text-rose-400">+{formatCurrency(p.late_fee)} late</p>}
            {displayStatus(p) === "partially_paid" && (
              <p className="text-[10px] leading-tight text-blue-400">{formatCurrency(Number(p.amount_paid ?? 0))} received</p>
            )}
          </div>
          <div className="flex justify-center w-28">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColors[displayStatus(p)]}`}>
              {cfg.label}
            </span>
          </div>
          {/* Fixed width, not min-w — each row is its own independent CSS grid
              (not one shared table grid), so if this column's width varied by
              button count, rows with more buttons would compute a wider auto
              column than rows with fewer, shifting Amount/Status out of
              alignment between rows and against the header. A shared fixed
              width sized for the max case keeps every row's grid identical
              regardless of how many buttons it actually renders.

              22rem: the original three inline buttons (Remind · Receipt ·
              Collect Rest) at 20rem, plus the 32px overflow menu and its gap.
              Anything added from here belongs in that menu, not in the row —
              this width grew from 20 to 29rem in one afternoon before the menu
              existed, and every growth shifts Amount and Status. */}
          <div className="flex items-center justify-end gap-2 w-[22rem]">
            {actionButtons}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-serif font-normal tracking-tight">Payments</h1>
          <div className="flex items-center shrink-0 rounded-lg border border-sidebar-border bg-sidebar-accent/30">
            <button onClick={() => stepMonth(-1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-medium px-1 min-w-[6rem] text-center">{displayMonth}</span>
            <button onClick={() => stepMonth(1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Monthly rent collection</p>
      </div>

      {/* Stats */}
      {(() => {
        const hasAc = (stats.acCollected + stats.acPending) > 0;
        const cards = [
          { label: "Total Due",       value: formatCurrency(stats.due),        icon: CreditCard, color: "text-foreground",   bg: "bg-white/5 border border-white/10" },
          // The sub-line exists because "Collected" means two different things
          // across the app: this card strips metered AC into its own tile, while
          // the Dashboard's Collected is the whole cash figure. Spelling out
          // "+ AC = received" here reconciles the two on sight, instead of
          // leaving a Rs 12,325 gap between screens that reads as a bug.
          {
            label: "Collected",
            value: formatCurrency(stats.collected),
            // Deliberately terse: the AC figure itself is already on the AC Collected
            // tile two cards along, so this only has to carry the combined total.
            // Spelling both out wrapped onto a second line, which stretched this
            // card and pulled every other card in the row taller with it.
            sub: stats.acCollected > 0
              ? `+ AC = ${formatCurrency(stats.collected + stats.acCollected)}`
              : undefined,
            icon: Wallet, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20",
          },
          { label: "Pending",         value: formatCurrency(stats.pending),     icon: Clock,      color: "text-amber",       bg: "bg-amber/10 border border-amber/20" },
          ...(hasAc ? [
            { label: "AC Collected",  value: formatCurrency(stats.acCollected), icon: Zap,        color: "text-cyan-400",    bg: "bg-cyan-500/10 border border-cyan-500/20" },
            { label: "AC Pending",    value: formatCurrency(stats.acPending),   icon: Zap,        color: "text-amber",       bg: "bg-amber/10 border border-amber/20" },
          ] : []),
        ];
        return (
          <div className={`grid gap-3 sm:gap-4 ${hasAc ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-1 sm:grid-cols-3"}`}>
            {cards.map(({ label, value, sub, icon: Icon, color, bg }, i) => (
              <div
                key={label}
                className={`rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5 ${
                  // 5 cards can't split evenly across a 2-col mobile grid — the
                  // last one (AC Pending) was left alone with blank space beside it.
                  hasAc && i === cards.length - 1 ? "col-span-2 sm:col-span-1" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${bg} shrink-0 mt-0.5`}>
                    <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
                    <p className={`text-base sm:text-xl font-bold leading-none mt-1.5 ${color}`}>{value}</p>
                    {sub && (
                      <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight mt-1.5 whitespace-nowrap">{sub}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v === "history") loadHistory(selectedMonth); if (v !== "monthly") { setRoomFilter("all"); setStatusFilter("all"); setSearch(""); } }}>
        <TabsList>
          <TabsTrigger value="monthly"><Banknote className="w-3.5 h-3.5" /> Monthly View</TabsTrigger>
          <TabsTrigger value="duetoday">
            <AlertTriangle className="w-3.5 h-3.5" /> Due Today
            {isViewingCurrentMonth && dueTodayPayments.length > 0 && (
              <span className="ml-1 rounded-full bg-amber/20 text-amber px-1.5 text-[10px] font-semibold leading-4">{dueTodayPayments.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history"><Clock className="w-3.5 h-3.5" /> All History</TabsTrigger>
          {acRooms.length > 0 && (
            <TabsTrigger value="ac"><Zap className="w-3.5 h-3.5" /> AC Billing</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="duetoday">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {!isViewingCurrentMonth ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-center px-6">
                <AlertTriangle className="w-10 h-10 opacity-20" />
                <p className="text-sm">Due Today only applies to the current month</p>
                <p className="text-xs">Switch the month picker above to {currentRealMonth} to see who&apos;s due today</p>
              </div>
            ) : dueTodayPayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 opacity-20" />
                <p className="text-sm">Nobody is due today</p>
                <p className="text-xs">Tenants show up here on their own due-day cadence, not the whole unpaid list</p>
              </div>
            ) : (
              <div className="p-2">
                <div className="flex flex-wrap items-center justify-end gap-2 px-2 pt-1 pb-3">
                  {autoReminderEnabled && canRecordPayment && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 text-xs gap-1.5 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10 hover:text-[#25D366]"
                      onClick={() => { setReminderScope("due_today"); setBulkConfirmOpen(true); }}
                    >
                      {WA_ICON}
                      Send Reminders to Due Today
                    </Button>
                  )}
                </div>
                <PaymentTableHeader />
                <div className="space-y-2 md:space-y-0.5 mt-1">
                  {dueTodayPayments.map((p) => <PaymentRow key={p.id} p={p} />)}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="monthly">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {activePayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <CreditCard className="w-10 h-10 opacity-20" />
                <p className="text-sm">No payment records for this month</p>
                <p className="text-xs">Add active tenants to start tracking payments</p>
              </div>
            ) : (
              <div className="p-2">
                {/* Filters bar */}
                <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-3">
                  {/* Status chips */}
                  <div className="flex flex-wrap items-center gap-1">
                    {STATUS_CHIPS.map(({ key, label, title }) => {
                      const count = countByChip(monthlyBase, key);
                      // A drill-down with nothing to drill into is noise — the chip
                      // only appears once the month actually has a partial payment.
                      if (key === "partial" && count === 0 && statusFilter !== "partial") return null;
                      const active = statusFilter === key;
                      return (
                        <button
                          key={key}
                          title={title}
                          onClick={() => setStatusFilter(key)}
                          className={chipClass(key, active)}
                        >
                          {label} <span className="ml-1 opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* AC toggle — composes with the status chips above, so AC + Paid
                      lists exactly the rows behind the AC Collected tile. */}
                  {monthlyScope.some(hasAcCharge) && (
                    <button
                      onClick={() => setAcOnly(v => !v)}
                      title="Only rows with metered AC — combine with Paid to reconcile the AC Collected tile"
                      className={cn(
                        "h-7 px-3 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
                        acOnly
                          ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                          : "border-sidebar-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Zap className="w-3 h-3 shrink-0" />
                      AC <span className="opacity-60">{monthlyScope.filter(hasAcCharge).length}</span>
                    </button>
                  )}

                  {/* WhatsApp delivery filter. Counts are computed on the
                      room/search scope but IGNORE the message filter itself, so
                      the numbers stay put while you switch between options
                      instead of collapsing to the one you picked. */}
                  {(() => {
                    const scope = activePayments.filter(p => {
                      const q = search.trim().toLowerCase();
                      if (q && !p.tenant?.full_name?.toLowerCase().includes(q)) return false;
                      if (roomFilter !== "all" && p.tenant?.room_id !== roomFilter) return false;
                      return true;
                    });
                    const n = (b: string) =>
                      scope.filter(p => msgBucket(p.tenant_id ? lastWhatsApp[p.tenant_id] : undefined) === b).length;
                    const counts = {
                      delivered: n("delivered"),
                      read: scope.filter(p => (p.tenant_id ? lastWhatsApp[p.tenant_id]?.status : undefined) === "read").length,
                      failed: n("failed"),
                      // No message on record at all — distinct from "never
                      // arrived", where we tried and WhatsApp refused.
                      none: n("none"),
                    };
                    // Nobody has been messaged at all — a filter that cannot
                    // narrow anything is just clutter.
                    if (counts.none === scope.length) return null;
                    return (
                      <Select value={msgFilter} onValueChange={setMsgFilter}>
                        <SelectTrigger className="h-7 text-xs flex-1 min-w-[9rem] sm:flex-none sm:w-44">
                          <SelectValue placeholder="Any message status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All messages</SelectItem>
                          <SelectItem value="delivered">Delivered ({counts.delivered})</SelectItem>
                          <SelectItem value="read">Read ({counts.read})</SelectItem>
                          <SelectItem value="failed">Not delivered ({counts.failed})</SelectItem>
                          <SelectItem value="none">Never sent ({counts.none})</SelectItem>
                        </SelectContent>
                      </Select>
                    );
                  })()}

                  {/* Room filter dropdown */}
                  {roomsInMonth.length > 1 && (
                    <Select value={roomFilter} onValueChange={setRoomFilter}>
                      <SelectTrigger className="h-7 text-xs flex-1 min-w-[8rem] sm:flex-none sm:w-40">
                        <SelectValue placeholder="All Rooms" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Rooms</SelectItem>
                        {roomsInMonth.map(r => (
                          <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Bulk auto-reminder — only for branches Super Admin has granted this to */}
                  {autoReminderEnabled && canRecordPayment && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 text-xs gap-1.5 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10 hover:text-[#25D366]"
                      disabled={unpaidCount === 0}
                      onClick={() => { setReminderScope("all"); setBulkConfirmOpen(true); }}
                    >
                      {WA_ICON}
                      Send Reminders
                    </Button>
                  )}

                  {/* Name search — ml-auto only once there is room to sit beside the
                      filters. On a phone it wraps to its own line, and a right-pushed
                      half-width box there just leaves a dead gap to its left. */}
                  <div className="relative w-full sm:w-auto sm:ml-auto">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search by name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-7 pl-7 text-xs w-full sm:w-48"
                    />
                  </div>
                </div>
                <PaymentTableHeader />
                <div className="space-y-2 md:space-y-0.5 mt-1">
                  {filteredPayments.map((p) => <PaymentRow key={p.id} p={p} />)}
                </div>
                {filteredPayments.length === 0 && (search || roomFilter !== "all" || statusFilter !== "all" || acOnly || msgFilter !== "all") && (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                    {search
                      ? `No results for "${search}"`
                      : `No ${statusFilter !== "all" ? statusFilter : ""}${acOnly ? " AC" : ""} payments${roomFilter !== "all" ? " for this room" : ""}`}
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {!historyLoaded ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading history…</div>
            ) : allHistory.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">No payment history yet</div>
            ) : (
              <div className="p-2">
                <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-3">
                  {/* Status chips — same wording, colours and meaning as Monthly View.
                      Counts follow the room selection, so they always describe the
                      rows actually on screen. */}
                  <div className="flex flex-wrap items-center gap-1">
                    {STATUS_CHIPS.map(({ key, label, title }) => {
                      const count = countByChip(historyBase, key);
                      if (key === "partial" && count === 0 && historyStatusFilter !== "partial") return null;
                      const active = historyStatusFilter === key;
                      return (
                        <button
                          key={key}
                          title={title}
                          onClick={() => setHistoryStatusFilter(key)}
                          className={chipClass(key, active)}
                        >
                          {label} <span className="opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* AC toggle — composes with the status chips above, so AC + Paid
                      lists exactly the rows behind the AC Collected tile. */}
                  {historyByRoom.some(hasAcCharge) && (
                    <button
                      onClick={() => setHistoryAcOnly(v => !v)}
                      title="Only rows with metered AC — combine with Paid to reconcile the AC Collected tile"
                      className={cn(
                        "h-7 px-3 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
                        historyAcOnly
                          ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                          : "border-sidebar-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Zap className="w-3 h-3 shrink-0" />
                      AC <span className="opacity-60">{historyByRoom.filter(hasAcCharge).length}</span>
                    </button>
                  )}

                  {roomsInHistory.length > 1 && (
                    <Select value={historyRoomFilter} onValueChange={setHistoryRoomFilter}>
                      <SelectTrigger className="h-7 text-xs flex-1 min-w-[8rem] sm:flex-none sm:w-40">
                        <SelectValue placeholder="All Rooms" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Rooms</SelectItem>
                        {roomsInHistory.map(r => (
                          <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-1">
                  {filteredHistory.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-white/[0.03]">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{p.tenant?.full_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.for_month}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                        <p className={`text-xs ${statusConfig[displayStatus(p)].color}`}>{statusConfig[displayStatus(p)].label}</p>
                      </div>
                      {p.status === "paid" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                          title="View Receipt"
                          disabled={generatingReceipt === p.id}
                          onClick={() => openReceipt(p.id)}
                        >
                          {generatingReceipt === p.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <FileText className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                    </div>
                  ))}
                  {filteredHistory.length === 0 && (
                    <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                      No {historyStatusFilter !== "all" ? historyStatusFilter : ""}{historyAcOnly ? " AC" : ""} payments{historyRoomFilter !== "all" ? " for this room" : ""}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="ac">
          <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Zap className="w-4 h-4 text-amber" />
              <h3 className="text-sm font-semibold">AC Billing</h3>
              <span className="text-xs text-muted-foreground">— enter total units consumed per room for {selectedMonth}</span>
              {occupancyAcRooms.length > 1 && (
                <div className="ml-auto">
                  <Select value={acRoomFilter} onValueChange={setAcRoomFilter}>
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue placeholder="All Rooms" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Rooms</SelectItem>
                      {/* occupancyAcRooms, not acRooms: listing every metered room
                          while the Occupied chip was active offered empty rooms in a
                          dropdown that had just been told to hide them. */}
                      {occupancyAcRooms.map(r => (
                        <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {/* Occupancy filter. Occupied is the default, so the list an operator
                sees on arrival is exactly the one they saw before empty rooms
                became meterable. Counts come from acRooms, never
                filteredAcRooms, or each chip would report the current filter. */}
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {([
                ["occupied", "Occupied"],
                ["empty", "Empty"],
                ["all", "All"],
              ] as const).map(([key, label]) => {
                const n =
                  key === "all"
                    ? acRooms.length
                    : acRooms.filter(r => (acRoomMeta.get(r.id)?.occupied ?? false) === (key === "occupied")).length;
                const active = acOccupancy === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setAcOccupancy(key); setAcRoomFilter("all"); }}
                    className={`h-7 px-3 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                        : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/[0.04]"
                    }`}
                  >
                    {label}<span className="ml-1 opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {filteredAcRooms.length === 0 && (
                <p className="text-xs text-muted-foreground/70 py-6 text-center">
                  No rooms match this filter.
                </p>
              )}
              {filteredAcRooms.map(room => {
                const saved = acReadings.find(r => r.room_id === room.id);
                const acTenantCount = tenants.filter(t => t.room_id === room.id && t.is_active).length;
                const someoneLivedHereThisMonth = acRoomOccupiedInMonth.has(room.id);
                // The STORED verdict, which only the server writes and only after
                // its own guards passed. Null when no reading exists — genuinely
                // unknown, and asserting vacancy from an absence is how the Empty
                // pill ended up on months that were lived in.
                const savedVacant = saved ? (saved.recorded_while_vacant ?? Number(saved.tenant_count ?? 0) === 0) : null;
                const monthWasVacant = savedVacant === true && !someoneLivedHereThisMonth;
                const totalTenants = acTenantCount;
                const prevMonthReading = prevMonthACReadings.find(r => r.room_id === room.id)?.meter_reading ?? null;
                const hasPrevReading = prevMonthReading != null;
                // Every arrival this month, as on main. A typed join reading is
                // always honoured by the billing, so the box that shows and edits
                // it must always be here — hiding it for a day-one arrival left a
                // stored row silently affecting the split with no way to see or
                // clear it.
                const midMonthJoiners = tenants.filter(
                  t => t.room_id === room.id && t.is_active && t.check_in.startsWith(selectedMonth)
                );
                const currentInput = acUnits[room.id] ?? "";
                const openingInput = acOpeningReadings[room.id] ?? "";
                // Once this month has been applied, the opening it used is the one that
                // matters — read back out of the saved row. Only before any apply does
                // the move-in-derived value stand in, and it is labelled as such below.
                const { value: derivedOpening, carried: openingCarried } = openingBaselineFor(room.id);
                const baseline = hasPrevReading ? prevMonthReading : (openingInput ? Number(openingInput) : derivedOpening);
                const consumptionPreview = currentInput && baseline != null && Number.isFinite(Number(currentInput))
                  ? Math.max(0, Number(currentInput) - baseline)
                  : null;
                return (
                  <div key={room.id} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 space-y-3">
                    {/* Room header + meter reading row */}
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">Room {room.room_number}</span>
                          {monthWasVacant ? (
                            <>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber/10 text-amber border border-amber/20">Empty</span>
                              <span className="text-xs text-muted-foreground/60">units recorded, charged to nobody</span>
                            </>
                          ) : !someoneLivedHereThisMonth ? (
                            // The month-aware set calls this room empty, so the
                            // today-based head count below must not speak. Room
                            // empty through August, let on 3 September, operator
                            // back-fills August: the card sat under the Empty chip
                            // headed "1 of 1 billed for AC".
                            <span className="text-xs text-muted-foreground/60">No tenants recorded for this month</span>
                          ) : acTenantCount > 0 ? (
                            <span className="text-xs text-amber">
                              {acTenantCount} of {totalTenants} billed for AC
                            </span>
                          ) : (
                            // Lived in this month but empty now — everyone left
                            // mid-month and was billed at the door.
                            <span className="text-xs text-muted-foreground/60">Vacated this month — billed at checkout</span>
                          )}
                        </div>
                        {saved ? (
                          <p className="text-xs text-emerald-400 mt-0.5">
                            Reading: {saved.meter_reading ?? "—"} · {saved.total_units} units consumed
                            {/* per_unit_rate is NOT NULL (migration 044) so it is stored
                                regardless, but quoting a tenant recovery rate on a reading
                                nobody was billed for invites the reader to multiply. */}
                            {!monthWasVacant && ` · Rs ${saved.per_unit_rate}/unit · ${saved.tenant_count} tenants billed`}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground/50 mt-0.5">No reading for this month yet</p>
                        )}

                        {/* Evidence for the number above. Anchored to the room's
                            reading row, not to each tenant, because one meter is
                            split across everyone in the room — a per-tenant copy
                            would be the same dial uploaded three times, free to
                            drift apart. */}
                        <MeterPhoto
                          className="mt-2"
                          label="meter photo"
                          path={saved?.meter_photo ?? null}
                          disabledReason={!saved ? "Apply this month's reading first, then attach the photo." : undefined}
                          onUpload={canRecordPayment ? async (file) => {
                            const fd = new FormData();
                            fd.append("file", file);
                            const res = await uploadMonthlyMeterPhoto(room.id, selectedMonth, fd);
                            if (!res.error) router.refresh();
                            return res;
                          } : undefined}
                          onDelete={canRecordPayment ? async () => {
                            const res = await deleteMonthlyMeterPhoto(room.id, selectedMonth);
                            if (!res.error) router.refresh();
                            return res;
                          } : undefined}
                        />
                        {hasPrevReading ? (
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Previous month ended at {prevMonthReading}</p>
                        ) : derivedOpening != null ? (
                          <p className="text-[10px] text-amber/60 mt-0.5">
                            {saved
                              ? `Opening ${derivedOpening} — the value this month was applied with`
                              : openingCarried
                                ? `Carrying forward the last recorded reading ${derivedOpening} unless overridden below`
                                : `First reading — auto-using move-in reading ${derivedOpening} unless overridden below`}
                          </p>
                        ) : (
                          <p className="text-[10px] text-amber/60 mt-0.5">First reading — enter opening value below if needed</p>
                        )}
                      </div>
                      <div className="flex flex-col items-stretch sm:items-end gap-1.5 sm:shrink-0">
                        {!hasPrevReading && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">Opening:</span>
                            <Input
                              type="number"
                              min={0}
                              max={999999}
                              placeholder="0"
                              value={acOpeningReadings[room.id] ?? (derivedOpening != null ? String(derivedOpening) : "")}
                              onChange={e => setAcOpeningReadings(prev => ({ ...prev, [room.id]: e.target.value }))}
                              className="flex-1 sm:w-20 h-7 text-xs text-center disabled:opacity-40"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={999999}
                            placeholder="Reading"
                            value={currentInput}
                            onChange={e => setAcUnits(prev => ({ ...prev, [room.id]: e.target.value }))}
                            className="flex-1 sm:w-28 h-9 text-sm text-center disabled:opacity-40"
                          />
                          {canRecordPayment && (
                            <Button
                              size="sm"
                              className="h-9 px-4 text-xs gap-1.5 bg-amber/10 text-amber border border-amber/25 hover:bg-amber/20 disabled:opacity-40 shrink-0"
                              variant="ghost"
                              // Lived in this month but nobody billable now — every
                              // tenant checked out mid-month. The server refuses
                              // both paths here: the vacant branch sees their
                              // residency, and the occupied branch has an empty
                              // eligible set. Offering the button would be a
                              // prominent action that can only ever fail.
                              // No `isManager && !room.has_ac` here any more. The
                              // button was greyed out for a manager on every
                              // metered room without an air conditioner — which on
                              // a branch that meters all of them is every room —
                              // mirroring a refusal the server no longer makes.
                              // The two tiers now bill the same rooms.
                              disabled={applyingAC === room.id || !currentInput || (someoneLivedHereThisMonth && acTenantCount === 0)}
                              title={
                                someoneLivedHereThisMonth && acTenantCount === 0
                                  ? "Everyone who lived here this month has checked out — their AC was settled at the door, so there is nothing left to apply."
                                  : saved?.recorded_while_vacant && someoneLivedHereThisMonth
                                    ? "This month was recorded with nobody in the room. Applying now bills its units to whoever is in the room today — check they actually lived here that month."
                                    : undefined
                              }
                              onClick={() => applyACUnits(room.id)}
                            >
                              {applyingAC === room.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              Apply
                            </Button>
                          )}
                        </div>
                        {consumptionPreview != null && (
                          <p className="text-[10px] text-amber/70 sm:text-right">{consumptionPreview} units consumed</p>
                        )}
                      </div>
                    </div>

                    {/* Mid-month joiner readings */}
                    {midMonthJoiners.length > 0 && (
                      <div className="border-t border-white/5 pt-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                            Mid-month joiners
                          </p>
                          <span className="text-[10px] text-muted-foreground/50">— auto-filled from their move-in reading; edit only to correct it</span>
                        </div>
                        {midMonthJoiners.map(tenant => {
                          const joinKey = `${tenant.id}_${selectedMonth}`;
                          const savedJoin = acJoinReadings.find(
                            r => r.room_id === room.id && r.tenant_id === tenant.id && r.for_month === selectedMonth
                          );
                          // Already captured once at tenant creation — default the field
                          // to that reading so nobody has to look it up and retype it.
                          // Explicitly typing a different value still overrides it.
                          const autoReading = tenant.joining_meter_reading;
                          const inputVal = joinUnits[joinKey] ?? (autoReading != null ? String(autoReading) : "");
                          const isSaved = !!savedJoin && joinUnits[joinKey] === undefined;
                          const joinRelative = inputVal && baseline != null && Number.isFinite(Number(inputVal))
                            ? Math.max(0, Number(inputVal) - baseline)
                            : null;
                          return (
                            <div key={tenant.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs text-muted-foreground truncate block">{tenant.full_name}</span>
                                {joinRelative != null && (
                                  <span className="text-[10px] text-amber/60">{joinRelative} units from month start</span>
                                )}
                                {isSaved && (
                                  <span className="text-[10px] text-muted-foreground/50">Saved from move-in reading — edit to correct</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 sm:shrink-0">
                                <Input
                                  type="number"
                                  min={0}
                                  max={999999}
                                  placeholder="Reading"
                                  value={inputVal}
                                  onChange={e => setJoinUnits(prev => ({ ...prev, [joinKey]: e.target.value }))}
                                  className="flex-1 sm:w-28 h-9 text-sm text-center"
                                />
                                {canRecordPayment && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={savingJoin === tenant.id || !inputVal || isSaved}
                                    onClick={() => handleSaveJoinReading(room.id, tenant.id)}
                                    className="h-9 px-4 text-xs gap-1.5 bg-amber/10 text-amber border border-amber/25 hover:bg-amber/20 disabled:opacity-40 shrink-0"
                                  >
                                    {savingJoin === tenant.id
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : isSaved
                                      ? <CheckCircle2 className="w-3 h-3" />
                                      : <Zap className="w-3 h-3" />}
                                    {savingJoin !== tenant.id && (isSaved ? "Saved" : "Save")}
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Unit allocation per tenant — visible after Apply so the split is verifiable */}
                    {saved && !monthLoading && (() => {
                      // The SERVER's verdict decides this footer, before anything
                      // is derived from who sits in the room today. The allocation
                      // below joins tenants on their CURRENT room, so the moment a
                      // vacant month's room is re-let it acquires tenant rows for
                      // that month — and the footer went on to print "not billed ·
                      // 0 units", "re-apply to bill the tenants above" and a rupee
                      // total for units consumed before those tenants arrived.
                      // That is precisely the harm this feature exists to prevent,
                      // and it was permanent, not transient.
                      // monthWasVacant, NOT savedVacant: the header two lines up
                      // uses it, and keying the footer on the stored flag alone
                      // made the same card say "1 of 1 billed for AC" above and
                      // "Nobody in the room" below. It also swallowed the
                      // "re-apply to bill the tenants above" prompt, which is the
                      // only warning that a resident's units are unbilled.
                      //
                      // This does not reopen the round-7 defect: there the room is
                      // re-let in a LATER month, and acRoomOccupiedInMonth is
                      // month-aware — the new tenant's check_in is past the vacant
                      // month and their rows for it carry no AC charge, so
                      // monthWasVacant stays true and the short-circuit holds.
                      if (monthWasVacant) {
                        const vacantUnits = Math.round(Number(saved.total_units ?? 0) * 100) / 100;
                        if (vacantUnits <= 0) return null;
                        return (
                          <div className="pt-2 mt-2 border-t border-white/5 flex items-center gap-2 text-xs">
                            <span className="text-amber/70 flex-1 min-w-0 truncate">Nobody in the room — hostel&apos;s own cost</span>
                            <span className="tabular-nums text-amber/70">{vacantUnits} units</span>
                          </div>
                        );
                      }
                      const acTenants = tenants.filter(t => t.room_id === room.id && t.is_active);
                      const monthRows = payments.filter(p => p.for_month === selectedMonth && p.tenant?.room_id === room.id);
                      const activeIds = new Set(acTenants.map(t => t.id));
                      // ac_units_consumed on a payment row is the member's WHOLE MONTH
                      // across every room they lived in — after a move it holds the room
                      // they left as well as this one. This card is an account of ONE
                      // room's meter, so anything earned in a room they have moved out of
                      // comes back out first. Without it the room listed more units than
                      // it metered (350 + 550 against an 800-unit meter) and told the
                      // operator to press Apply, which recomputes the same figure.
                      // Mirrors carriedTransferCharges (lib/ac-transfer.ts) on the server.
                      const carriedFor = (tenantId: string) => acCheckoutReadings.reduce(
                        (acc, c) => (
                          c.for_month === selectedMonth &&
                          c.transferred_to_room_id != null &&
                          c.tenant_id === tenantId &&
                          c.room_id !== room.id
                        )
                          ? { units: acc.units + Number(c.units_consumed ?? 0), charge: acc.charge + Number(c.ac_charge ?? 0), from: [...acc.from, c.room_id] }
                          : acc,
                        { units: 0, charge: 0, from: [] as string[] }
                      );
                      const rows = acTenants.map(t => {
                        const pay = monthRows.find(p => p.tenant_id === t.id);
                        const carried = carriedFor(t.id);
                        return {
                          id: t.id,
                          name: t.full_name,
                          units: Math.round((Number(pay?.ac_units_consumed ?? 0) - carried.units) * 100) / 100,
                          charge: Number(pay?.ac_charge ?? 0) - carried.charge,
                          departed: false,
                          carried,
                        };
                      });
                      // A tenant who checked out mid-month keeps their payment row but
                      // disappears from `tenants` (active-only). Leaving them out made a
                      // month the meter was divided five ways read as a split of four,
                      // and the listed units never added up to the reading.
                      const departedRows = monthRows
                        .filter(p => !activeIds.has(p.tenant_id) && Number(p.ac_charge ?? 0) > 0)
                        .map(p => {
                          const carried = carriedFor(p.tenant_id);
                          return {
                            id: p.tenant_id,
                            name: p.tenant?.full_name ?? "Checked out",
                            units: Math.round((Number(p.ac_units_consumed ?? 0) - carried.units) * 100) / 100,
                            charge: Number(p.ac_charge ?? 0) - carried.charge,
                            departed: true,
                            carried,
                          };
                        });
                      // A member who TRANSFERRED out of this room is invisible to both
                      // lists above: they are still active, and their payment row has
                      // followed them to the new room, so `monthRows` (matched on the
                      // tenant's CURRENT room_id) never contains them. Their share of
                      // THIS room was billed at the moment they moved and is sitting on
                      // that same row. Without it the card subtracted their units from
                      // the meter and announced the difference as "hostel absorbs" —
                      // telling the owner they were eating money they had in fact
                      // already charged. Read from the move's own breakpoint, which is
                      // the only record left in this room.
                      const movedRows = acCheckoutReadings
                        .filter(c =>
                          c.room_id === room.id &&
                          c.for_month === selectedMonth &&
                          c.transferred_to_room_id != null &&
                          Number(c.ac_charge ?? 0) > 0
                        )
                        .map(c => ({
                          id: `moved-${c.tenant_id}`,
                          name: tenants.find(t => t.id === c.tenant_id)?.full_name ?? "Moved rooms",
                          units: Number(c.units_consumed ?? 0),
                          charge: Number(c.ac_charge ?? 0),
                          departed: true,
                          moved: true,
                          carried: { units: 0, charge: 0, from: [] as string[] },
                        }));
                      const allRows = [
                        ...rows.map(r => ({ ...r, moved: false })),
                        ...departedRows.map(r => ({ ...r, moved: false })),
                        ...movedRows,
                      ];
                      // Tenants on 0 units used to be filtered out here. That hid the
                      // commonest real fault: a tenant present in the room who was
                      // never billed (joined after the last apply, or the roster
                      // changed since). The operator only saw "unassigned — hostel
                      // absorbs" and had no way to tell the difference between
                      // genuine pre-occupancy usage and someone simply missing.
                      const unbilled = rows.filter(r => r.units === 0);
                      const billedRows = allRows.filter(r => r.units > 0);
                      if (allRows.length === 0) return null;
                      const assignedUnits = Math.round(allRows.reduce((s, r) => s + r.units, 0) * 100) / 100;
                      const assignedCharge = allRows.reduce((s, r) => s + r.charge, 0);
                      const unassignedUnits = Math.max(0, saved.total_units - assignedUnits);
                      // The sum of the per-tenant rows exceeding the meter means the room
                      // is being billed for units it never consumed. Surfaced rather than
                      // clamped away — it is the one number that proves a split is wrong.
                      //
                      // Ignored below a tenth of a unit: shares are stored to 2dp, so a
                      // room can legitimately land a hundredth over. Flagging that told the
                      // operator to press Apply to fix Rs 1, which Apply cannot do, and the
                      // warning came straight back.
                      const overAssignedRaw = Math.round(Math.max(0, assignedUnits - saved.total_units) * 100) / 100;
                      const overAssignedUnits = overAssignedRaw >= 0.1 ? overAssignedRaw : 0;
                      const unassignedCharge = Math.round(unassignedUnits * saved.per_unit_rate);
                      const totalCharge = Math.round(saved.total_units * saved.per_unit_rate);
                      return (
                        <div className="border-t border-white/5 pt-2.5 space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Allocated per tenant</p>
                          {billedRows.map(r => (
                            <div key={r.id} className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground flex-1 min-w-0 truncate">
                                {r.name}
                                {r.departed && (
                                  <span className="text-muted-foreground/50">
                                    {r.moved ? " — moved rooms, charged at the move" : " — checked out, charged at departure"}
                                  </span>
                                )}
                                {/* Their bill is higher than this line, and the operator
                                    will compare the two. Say why here rather than leave
                                    the difference looking like an error. */}
                                {r.carried.units > 0 && (
                                  <span className="text-muted-foreground/50">
                                    {" "}— plus {r.carried.units} units from room{r.carried.from.length > 1 ? "s" : ""}{" "}
                                    {r.carried.from.map(id => rooms.find(rm => rm.id === id)?.room_number ?? "?").join(", ")}, on the same bill
                                  </span>
                                )}
                              </span>
                              <span className="tabular-nums text-foreground">{r.units} units</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="tabular-nums text-emerald-400">{formatCurrency(r.charge)}</span>
                            </div>
                          ))}
                          {unbilled.map(r => (
                            <div key={r.id} className="flex items-center gap-2 text-xs">
                              <span className="text-rose-400/80 flex-1 min-w-0 truncate">{r.name} — not billed</span>
                              <span className="tabular-nums text-rose-400/80">0 units</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="tabular-nums text-rose-400/80">{formatCurrency(0)}</span>
                            </div>
                          ))}
                          {unassignedUnits > 0 && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-amber/70 flex-1 min-w-0 truncate">
                                {unbilled.length > 0
                                  ? "Unassigned — re-apply to bill the tenants above"
                                  : "Unassigned (pre-occupancy) · hostel absorbs"}
                              </span>
                              <span className="tabular-nums text-amber/70">{unassignedUnits} units</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="tabular-nums text-amber/70">{formatCurrency(unassignedCharge)}</span>
                            </div>
                          )}
                          {overAssignedUnits > 0 && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-rose-400 flex-1 min-w-0 truncate">
                                Billed above the meter — press Apply to recalculate
                              </span>
                              <span className="tabular-nums text-rose-400">+{overAssignedUnits} units</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="tabular-nums text-rose-400">{formatCurrency(Math.round(overAssignedUnits * saved.per_unit_rate))}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-xs pt-0.5 border-t border-white/5 mt-1">
                            <span className="text-muted-foreground flex-1">{unassignedUnits > 0 ? "Total entered" : "Total"}</span>
                            <span className="tabular-nums text-foreground font-medium">{saved.total_units} units</span>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="tabular-nums text-emerald-400 font-medium">{formatCurrency(unassignedUnits > 0 || overAssignedUnits > 0 ? totalCharge : assignedCharge)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Enter the <span className="text-foreground">current meter reading</span> (cumulative) — consumption is auto-derived from last month&apos;s reading. Mid-month joiners get the meter reading at the time they joined.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Mark Paid Dialog */}
      <Dialog open={!!markDialog} onOpenChange={(o) => !o && setMarkDialog(null)}>
        <DialogContent className="sm:max-w-sm flex flex-col max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 pr-1">
            <div className="rounded-lg bg-white/5 px-3 py-2.5 space-y-1.5">
              {/* Tenant + month inline */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium leading-none">{markDialog?.tenant?.full_name}</p>
                <p className="text-xs text-muted-foreground shrink-0">{markDialog?.for_month}</p>
              </div>
              {/* Charge breakdown — key/value rows */}
              {markDialog && (() => {
                const {
                  rent: baseRent, food, ac,
                  deposit: depositCharge,
                  registrationFee: registrationFeeCharge,
                  acMaintenance: acMaintenanceCharge,
                  referralDiscount,
                } = splitPaymentCharges(markDialog);
                const preview = previewDiscount(markDialog, markForm.discount_percent);
                const tenant = tenants.find(t => t.id === markDialog.tenant_id);
                const deposit = tenant?.security_deposit ?? 0;
                const mealsLabel = [tenant?.food_breakfast && "Breakfast", tenant?.food_lunch && "Lunch", tenant?.food_dinner && "Dinner"]
                  .filter(Boolean).join(" + ");
                // Daily rows label the rent line with the day basis, but keep the
                // subtraction-derived figure so the breakdown still sums to Total.
                const basis = dailyBasis(markDialog);
                return (
                  <div className="pt-1.5 border-t border-white/10 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{basis ? dailyBasisLabel(basis) : "Rent"}</span><span>{formatCurrency(Math.max(0, baseRent))}</span>
                    </div>
                    {food > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Food{mealsLabel ? ` (${mealsLabel})` : ""}</span><span>{formatCurrency(food)}</span>
                      </div>
                    )}
                    {ac > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>AC</span><span>{formatCurrency(ac)}</span>
                      </div>
                    )}
                    {depositCharge > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Security Deposit</span><span>{formatCurrency(depositCharge)}</span>
                      </div>
                    )}
                    {registrationFeeCharge > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Registration Fee</span><span>{formatCurrency(registrationFeeCharge)}</span>
                      </div>
                    )}
                    {acMaintenanceCharge > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>AC Maintenance</span><span>{formatCurrency(acMaintenanceCharge)}</span>
                      </div>
                    )}
                    {/* Rent above is gross, so the discount has to appear as its own
                        deduction for the lines to sum to the stored (net) Total. */}
                    {referralDiscount > 0 && (
                      <div className="flex justify-between gap-2 text-xs text-emerald-400">
                        <span className="flex items-center gap-1 min-w-0">
                          <Gift className="w-3 h-3 shrink-0" /><span className="truncate">Referral Discount</span>
                        </span>
                        <span className="shrink-0 tabular-nums">−{formatCurrency(referralDiscount)}</span>
                      </div>
                    )}
                    {/* Live: this is the standing discount plus whatever percentage
                        is typed below, so the operator sees the bill move before
                        they confirm it rather than after. */}
                    {preview.discount > 0 && (
                      <div className="flex justify-between gap-2 text-xs text-emerald-400">
                        <span className="flex items-center gap-1 min-w-0">
                          <span className="truncate">Discount ({preview.totalPercent}% of rent)</span>
                        </span>
                        <span className="shrink-0 tabular-nums">−{formatCurrency(preview.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs font-medium text-foreground">
                      <span>Total</span><span>{formatCurrency(preview.total)}</span>
                    </div>
                    {/* Total is the whole bill (what the receipt and the Member
                        Ledger's "Charged" column show), including any discount
                        being typed below — the running balance stays its own line
                        instead of overloading what "Total" means. */}
                    {Number(markDialog.amount_paid ?? 0) > 0 && (
                      <>
                        <div className="flex justify-between text-xs text-emerald-400">
                          <span>Already Paid</span><span>-{formatCurrency(Number(markDialog.amount_paid ?? 0))}</span>
                        </div>
                        <div className="flex justify-between text-xs font-semibold text-amber">
                          <span>Balance Due</span><span>{formatCurrency(preview.remaining)}</span>
                        </div>
                      </>
                    )}
                    {/* "Deposit Held" is only shown when the deposit ISN'T part of this
                        bill — for the first month it's already itemized above as its
                        own line within Total, so repeating it here would double it up. */}
                    {deposit > 0 && depositCharge === 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground border-t border-white/10 pt-1">
                        <span>Deposit Held</span><span>{formatCurrency(deposit)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Discount — a one-off percentage of RENT for this bill only (a
                tenant away most of the month). It stacks on the tenant's standing
                discount from admission; the trigger adds the two and clamps to
                100. Sits above Amount Received because it moves that figure. */}
            {markDialog && (() => {
              const preview = previewDiscount(markDialog, markForm.discount_percent);
              // A reservation bills only the deposit and registration fee, and a
              // rent-only discount on a bill with no rent is a silent no-op.
              if (preview.rent <= 0) return null;
              if (preview.daily) {
                return (
                  <p className="text-xs text-muted-foreground/70">
                    Discounts apply to monthly rent, so they cannot be given on a nightly bill. Adjust the nightly
                    rate on the member instead.
                  </p>
                );
              }
              if (preview.frozen) {
                // Always say something. Returning null when the pinned percent is
                // 0 left an operator staring at a dialog with no discount field
                // and no reason given — reachable on any undone payment, which
                // leaves the row partially_paid at zero collected. Their only
                // lever is then Amount Received, and short-entering it leaves a
                // phantom balance the reminder cron chases.
                return preview.alreadyPercent > 0 ? (
                  <p className="text-xs text-emerald-400">
                    {preview.alreadyPercent}% discount ({formatCurrency(preview.discount)}) is fixed on this bill — money has
                    already been collected against it, so it keeps the discount it was collected with.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground/70">
                    This bill&apos;s price is fixed — money has been collected against it, so a discount can no
                    longer be applied here. Set it on the member instead, and it will apply to their next bill.
                  </p>
                );
              }
              return (
                <div className="space-y-1.5">
                  <Label>Discount (%) — rent only</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    min="0"
                    max="100"
                    step="0.01"
                    value={markForm.discount_percent}
                    onChange={(e) => handleDiscountChange(e.target.value)}
                  />
                  {preview.alreadyPercent > 0 && (
                    <p className="text-xs text-emerald-400">
                      {preview.alreadyPercent}% standing discount is already on this bill — anything entered here stacks on top of it.
                    </p>
                  )}
                  {preview.discount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {preview.totalPercent}% of {formatCurrency(preview.rent)} rent = −{formatCurrency(preview.discount)} · new total {formatCurrency(preview.total)}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Amount received — supports partial payments. Defaults to the full
                remaining balance (net of the discount above); editing it down
                records a partial payment instead. */}
            {markDialog && (() => {
              const remaining = previewDiscount(markDialog, markForm.discount_percent).remaining;
              const { referralDiscount } = splitPaymentCharges(markDialog);
              return (
                <div className="space-y-1.5">
                  {/* Above the input, not below it: the number they are about to
                      type is smaller than the rent they agreed, and they need to
                      know why before they type it, not after. */}
                  {referralDiscount > 0 && (
                    <p className="text-xs text-emerald-400">
                      {formatCurrency(referralDiscount)} referral discount already applied.
                    </p>
                  )}
                  <Label>Amount Received (PKR)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={markForm.amount_received}
                    onChange={(e) => setMarkForm({ ...markForm, amount_received: e.target.value })}
                  />
                  {(() => {
                    const entered = parseFloat(markForm.amount_received);
                    if (Number.isFinite(entered) && entered > 0 && entered < remaining) {
                      return <p className="text-xs text-amber">Partial payment — {formatCurrency(remaining - entered)} will remain due after this.</p>;
                    }
                    return null;
                  })()}
                </div>
              );
            })()}

            {/* AC units consumed — only for space_food_ac (F-003, F-004) */}
            {markDialog?.payment_package_tier === "space_food_ac" && (
              <div className="space-y-1.5">
                <Label>AC Units Consumed (kWh)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  max={String(MAX_AC_UNITS)}
                  step="0.01"
                  value={markForm.ac_units_consumed}
                  onChange={(e) => setMarkForm({ ...markForm, ac_units_consumed: e.target.value })}
                />
                {packageConfig && (
                  <p className="text-xs text-muted-foreground">
                    Rate: {formatCurrency(packageConfig.ac_per_unit_rate)}/unit ·
                    Est. Charge: {formatCurrency((parseFloat(markForm.ac_units_consumed) || 0) * packageConfig.ac_per_unit_rate)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground/60">Final amount is calculated server-side using the current rate.</p>
              </div>
            )}

            <div className="space-y-1.5"><Label>Payment Method</Label>
              <Select value={markForm.method} onValueChange={(v) => setMarkForm({ ...markForm, method: v as PaymentMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hideOverrides ? (
              <p className="text-xs text-muted-foreground/70">
                Recorded with today&apos;s date. Late fee and receipt number overrides aren&apos;t available here — ask the owner if either is needed.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Payment Date</Label><Input type="date" value={markForm.date} onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })} /></div>
                  {/* F-005: min="0" prevents negative late fees in the UI */}
                  <div className="space-y-1.5"><Label>Late Fee (PKR)</Label><Input type="number" placeholder="0" min="0" step="0.01" value={markForm.late_fee} onChange={(e) => setMarkForm({ ...markForm, late_fee: e.target.value })} /></div>
                </div>
                <div className="space-y-1.5"><Label>Receipt No.</Label><Input value={markForm.receipt_number} onChange={(e) => setMarkForm({ ...markForm, receipt_number: e.target.value })} /></div>
              </>
            )}
            <div className="space-y-1.5"><Label>Notes</Label><Input placeholder="Optional" value={markForm.notes} onChange={(e) => setMarkForm({ ...markForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDialog(null)}>Cancel</Button>
            <Button onClick={handleMarkPaid} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving ? "Saving…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document preview — stays in the app, no tab hop */}
      <Dialog open={!!docPreview} onOpenChange={(o) => !o && closeDocPreview()}>
        {/* Width is derived from the document, not fixed: the dialog is exactly
            as wide as the page is at 70vh tall, so the whole slip is visible at
            once with no zooming and no letterboxing around a narrow receipt in a
            wide box.
            BOTH terms are viewport units on purpose. An earlier version paired
            max-w-fit here (width from the children) with min(100%, …) on the
            frame (width from the parent) — neither had a definite size, the
            circular reference collapsed, and the dialog rendered as a small box
            on desktop. Mobile hid it because 92vw gave the dialog a definite
            width to resolve against. */}
        <DialogContent
          className="w-auto max-w-none"
          style={{ width: `min(92vw, calc(70vh * ${docPreview?.ratio ?? 250 / 364} + 3rem))` }}
        >
          <DialogHeader>
            <DialogTitle>{docPreview?.title}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{docPreview?.subtitle}</p>
          </DialogHeader>

          {/* width, not height, is the driver — with a fixed height the derived
              width stayed wider than the dialog on a phone and the page spilled
              out to the right. min() takes whichever limit is tighter: the
              document's natural width at 70vh on a desktop, or the dialog's own
              width on a narrow screen. Height then follows from the ratio, so
              the page always fits both axes. */}
          <div
            className="rounded-xl border border-sidebar-border bg-background/60 overflow-hidden mx-auto max-w-full"
            style={{
              aspectRatio: `${docPreview?.ratio ?? 250 / 364}`,
              width: `min(100%, calc(70vh * ${docPreview?.ratio ?? 250 / 364}))`,
              maxHeight: "70vh",
            }}
          >
            {docPreview?.error ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                <AlertTriangle className="w-8 h-8 text-amber/70" />
                <p className="text-sm text-foreground">Could not show this document</p>
                <p className="text-xs text-muted-foreground max-w-sm">{docPreview.error}</p>
              </div>
            ) : docPreview?.url ? (
              // #toolbar=0&navpanes=0: desktop Chrome/Edge wrap an embedded PDF
              // in their own viewer — a grey toolbar across the top and a
              // thumbnail side panel — which is chrome nobody asked for inside a
              // dialog that already has a header and its own buttons. Mobile
              // browsers render none of it, which is why only the web view looked
              // wrong. view=Fit fits the WHOLE page — FitH fits only the width,
              // which is what left the bottom of the slip cut off.
              <iframe
                src={`${docPreview.url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                title={docPreview.title}
                className="w-full h-full border-0"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-amber" />
                <p className="text-xs text-muted-foreground">Preparing document…</p>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2">
            {/* Kept as an escape hatch: some mobile browsers will not render a
                PDF in an iframe, and printing wants the real page anyway. */}
            {docPreview?.href && (
              <Button variant="outline" onClick={() => window.open(docPreview.href!, "_blank", "noopener,noreferrer")}>
                Open in new tab
              </Button>
            )}
            <Button onClick={closeDocPreview}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Undo — shows exactly what is being reversed before it happens */}
      <Dialog open={!!undoTarget} onOpenChange={(o) => !o && setUndoTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Undo last payment?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-sidebar-border bg-background/50 px-4 py-3">
              <p className="text-sm font-medium text-foreground">{undoTarget?.tenant?.full_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{undoTarget?.for_month}</p>
              <p className="text-lg font-bold text-foreground mt-1">
                {formatCurrency(Number(undoTarget?.amount_paid ?? 0))}
                <span className="text-xs font-normal text-muted-foreground"> collected so far</span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              This reverses the most recent payment on this bill and puts it back as it was. Record
              it again with the correct amount. The undo is written to the activity log.
            </p>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setUndoTarget(null)} disabled={undoing}>Cancel</Button>
            <Button onClick={handleUndo} disabled={undoing} className="gap-1.5">
              {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
              {undoing ? "Undoing…" : "Undo payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-Payment WhatsApp Receipt Dialog */}
      <Dialog open={!!postPaymentWa} onOpenChange={(o) => !o && setPostPaymentWa(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-emerald-400">Payment Recorded!</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-center">
              <p className="text-sm font-medium text-foreground">{postPaymentWa?.payment.tenant?.full_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{postPaymentWa?.payment.for_month}</p>
              {/* Amount actually received THIS transaction — not the full bill total,
                  which would misrepresent a partial payment as fully settled. */}
              <p className="text-lg font-bold text-emerald-400 mt-1">
                {formatCurrency(postPaymentWa?.amountReceivedNow ?? 0)}
              </p>
              {postPaymentWa?.payment.status === "partially_paid" && (
                <p className="text-xs text-blue-400 mt-1">
                  {formatCurrency(Number(postPaymentWa.payment.amount_paid ?? 0))} received so far · {formatCurrency(Math.max(0, Number(postPaymentWa.payment.amount) + Number(postPaymentWa.payment.late_fee ?? 0) - Number(postPaymentWa.payment.amount_paid ?? 0)))} remaining
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground text-center">Share the receipt with the tenant via WhatsApp?</p>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setPostPaymentWa(null)}>Skip</Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                if (postPaymentWa) openReceiptPreview(postPaymentWa.payment, postPaymentWa.installmentId);
              }}
            >
              <FileText className="w-3.5 h-3.5" />
              Preview
            </Button>
            <Button
              disabled={sendingWa === postPaymentWa?.payment.id}
              onClick={async () => {
                if (postPaymentWa) {
                  await sendWhatsAppReceipt(postPaymentWa.payment, postPaymentWa.installmentId);
                  setPostPaymentWa(null);
                }
              }}
              className="flex-1 gap-2 bg-[#25D366] hover:bg-[#20ba57] text-white"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Send Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Send Reminders — Confirm */}
      <Dialog open={bulkConfirmOpen} onOpenChange={(o) => !sendingBulk && setBulkConfirmOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#25D366]/15 text-[#25D366] shrink-0">{WA_ICON}</span>
              Send Reminders
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {reminderScope === "due_today" ? (
              <p className="text-sm text-muted-foreground">
                Send an automated WhatsApp reminder to{" "}
                <span className="text-foreground font-semibold">{dueTodayPayments.length}</span>{" "}
                tenant{dueTodayPayments.length === 1 ? "" : "s"} due today — not the full unpaid list?
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Send an automated WhatsApp reminder to all{" "}
                <span className="text-foreground font-semibold">{unpaidCount}</span>{" "}
                tenant{unpaidCount === 1 ? "" : "s"} with dues pending for{" "}
                <span className="text-foreground font-medium">{displayMonth}</span>?
              </p>
            )}
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Anyone already reminded today, on the waiting list, or checked out is skipped
                automatically — this can&apos;t double-message a tenant.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkConfirmOpen(false)} disabled={sendingBulk}>
              Cancel
            </Button>
            <Button
              onClick={confirmSendBulkReminders}
              disabled={sendingBulk}
              className="gap-2 bg-[#25D366] hover:bg-[#20ba57] text-white"
            >
              {sendingBulk ? <Loader2 className="w-4 h-4 animate-spin" /> : WA_ICON}
              {sendingBulk ? "Sending…" : "Send Reminders"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Send Reminders — Result */}
      <Dialog open={!!bulkResult} onOpenChange={(o) => !o && setBulkResult(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className={(bulkResult?.sent ?? 0) > 0 ? "text-emerald-400" : ""}>
              {(bulkResult?.sent ?? 0) > 0 ? "Reminders Sent" : "No Reminders Sent"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">{bulkResult?.sent ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">
                reminder{bulkResult?.sent === 1 ? "" : "s"} sent to WhatsApp
              </p>
            </div>
            <div className="space-y-1.5 text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Skipped — already reminded today, waiting list, checked out, or no phone on file</span>
                <span className="text-foreground font-medium shrink-0 ml-3">{bulkResult?.skipped ?? 0}</span>
              </div>
              {(bulkResult?.failed ?? 0) > 0 && (
                <div className="flex items-center justify-between text-rose-400 pt-1.5 border-t border-white/10">
                  <span>Rejected by WhatsApp</span>
                  <span className="font-medium shrink-0 ml-3">{bulkResult?.failed}</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/70 text-center">
              This confirms the message was accepted by WhatsApp — not that the tenant has read it.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setBulkResult(null)} className="w-full">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
