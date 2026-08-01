"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CreditCard, CheckCircle2, Clock, AlertTriangle, Wallet,
  Banknote, Zap, Loader2, FileText, ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn, formatCurrency, formatDate, formatDateInput } from "@/lib/utils";
import type { Payment, PaymentMethod, PaymentStatus, PackageTier, PackageConfig, PaymentMethodAccount, PartnerTier, StaffPermission } from "@/types";
import { buildReminderMessage } from "@/lib/whatsapp-reminder";
import { countBillableNights } from "@/lib/daily-billing";
import { tenantDueDay, shouldRemindToday } from "@/lib/payment-calc";
import { pktTodayDateString } from "@/lib/pkt-time";
import {
  syncMonthAction,
  markPaymentPaidAction,
  loadHistoryAction,
  applyRoomACUnitsAction,
  saveACJoinReadingAction,
  sendBulkRemindersAction,
  sendDueTodayRemindersAction,
} from "@/app/actions/payments";
import { createInvoiceLink, createInstallmentReceiptLink } from "@/app/actions/tenants";
import { recordPaymentAsPartner } from "@/app/actions/partner";
import { deriveOpeningReading } from "@/lib/ac-billing";
import {
  recordPaymentAsManager,
  applyRoomACUnitsAsManager,
  saveACJoinReadingAsManager,
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
  acReadings?: { room_id: string; total_units: number; meter_reading?: number | null; per_unit_rate: number; tenant_count: number }[];
  acJoinReadings?: { room_id: string; tenant_id: string; units_at_join: number; for_month: string }[];
  prevMonthACReadings?: { room_id: string; meter_reading: number | null; total_units: number }[];
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

// Stable identities. These back the two AC-reading props, which are useEffect
// dependencies — an inline `= []` default would mint a new array on every render
// and drive that effect (and its setState) in a loop for any caller that omits them.
const NO_AC_READINGS: NonNullable<Props["acReadings"]> = [];
const NO_PREV_AC_READINGS: NonNullable<Props["prevMonthACReadings"]> = [];

export function PaymentsClient({ hostelId, hostelName = "Hostel", hostelPhone, payments: initialPayments, tenants, rooms, initialMonth, packageConfig, paymentMethods = [], reminderTemplate, autoReminderEnabled = false, acReadings: initialAcReadings = NO_AC_READINGS, acJoinReadings = [], prevMonthACReadings: initialPrevMonthACReadings = NO_PREV_AC_READINGS, partnerTier = null, managerPermissions = null, waitingTenantIds = [] }: Props) {
  const isPartner = !!partnerTier;
  const isManager = !!managerPermissions;
  const canCollect = managerPermissions?.includes("collect_payments") ?? false;
  // Owners (no partnerTier, no managerPermissions) short-circuit on the first
  // operand exactly as before — this stays true for them unconditionally.
  const canRecordPayment = isManager ? canCollect : (!partnerTier || partnerTier !== "read_only");
  // Managers get the same reduced dialog as partners: the manager write action
  // has no late-fee / receipt-number / back-dating override, so those inputs are
  // hidden rather than silently dropped.
  const hideOverrides = isPartner || isManager;
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
  // The server page only ever fetches these for the current month. Held as
  // state so stepping to another month can swap in that month's records
  // (see handleMonthChange); props stay authoritative for initialMonth.
  const [acReadings, setAcReadings] = useState(initialAcReadings);
  const [prevMonthACReadings, setPrevMonthACReadings] = useState(initialPrevMonthACReadings);
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [search, setSearch] = useState("");
  // joinUnits keyed by `${tenantId}_${month}` — stores the absolute meter reading at join time
  const [joinUnits, setJoinUnits] = useState<Record<string, string>>({});
  const [savingJoin, setSavingJoin] = useState<string | null>(null);
  // acOpeningReadings: per-room opening reading input, shown only when no previous month record exists
  const [acOpeningReadings, setAcOpeningReadings] = useState<Record<string, string>>({});
  const [historyRoomFilter, setHistoryRoomFilter] = useState("all");
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
    if (result.acReadings) setAcReadings(result.acReadings);
    if (result.prevMonthACReadings) setPrevMonthACReadings(result.prevMonthACReadings);
    if (result.payments) {
      setPayments(result.payments);
      return result.payments;
    }
    return null;
  }, []);

  // router.refresh() re-renders the server page for initialMonth only, so its
  // props are adopted only while that month is on screen — otherwise a refresh
  // triggered from another month (e.g. right after Apply) would overwrite that
  // month's readings with the current month's.
  useEffect(() => {
    if (selectedMonth !== initialMonth) return;
    setAcReadings(initialAcReadings);
    setPrevMonthACReadings(initialPrevMonthACReadings);
  }, [selectedMonth, initialMonth, initialAcReadings, initialPrevMonthACReadings]);

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
    await syncMonth(month);
    if (tab === "history") await loadHistory(month);
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
    const remaining = Math.max(0, Number(p.amount) - Number(p.amount_paid ?? 0));
    setMarkDialog(p);
    setMarkForm({
      method: "cash",
      date: formatDateInput(new Date()),
      late_fee: "0",
      notes: "",
      receipt_number: genReceipt(tenantName, p.for_month),
      ac_units_consumed: p.ac_units_consumed ? String(p.ac_units_consumed) : "0",
      amount_received: String(remaining),
    });
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
      );
      if (result.error) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        setSaving(false);
        return;
      }
      const remainingBefore = Math.max(0, Number(markDialog.amount) + Number(markDialog.late_fee ?? 0) - Number(markDialog.amount_paid ?? 0));
      const isPartial = amountReceived < remainingBefore - 0.01;
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
      );
      if (result.error) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        setSaving(false);
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
    });

    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      setSaving(false);
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

      const message = isPartial
        ? `Assalam o Alaikum ${firstName},\n\n` +
          `We've received *${amountFormatted}* for ${p.for_month}. *${remainingFormatted}* remains due.\n\n` +
          readingLine +
          `Download your receipt: ${receiptUrl}\n\n` +
          `Thank you - ${hostelName}`
        : `Assalam o Alaikum ${firstName},\n\n` +
          `Your payment of *${amountFormatted}* for ${p.for_month} has been received.\n\n` +
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
    // Falls back to the derived (move-in-reading-based) opening value when the
    // operator never touched the field — it's pre-filled on screen (see the
    // Opening <Input> below), so Save must honor that same value rather than
    // silently reading blank state.
    const derivedOpeningForRoom = deriveOpeningReading(tenants.filter(t => t.room_id === roomId && t.is_active), selectedMonth);
    const rawOpening = acOpeningReadings[roomId] ?? (derivedOpeningForRoom != null ? String(derivedOpeningForRoom) : "");
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

  async function applyACUnits(roomId: string) {
    if (!canRecordPayment) return;
    const meterReading = Number(acUnits[roomId] ?? "");
    if (!Number.isFinite(meterReading) || meterReading < 0) return;
    const prevReading = prevMonthACReadings.find(r => r.room_id === roomId)?.meter_reading;
    // Falls back to the derived (move-in-reading-based) opening value when the
    // operator never touched the field — it's pre-filled on screen (see the
    // Opening <Input> below), so Apply must honor that same value rather than
    // silently reading blank state.
    const derivedOpeningForRoom = deriveOpeningReading(tenants.filter(t => t.room_id === roomId && t.is_active), selectedMonth);
    const rawOpening = acOpeningReadings[roomId] ?? (derivedOpeningForRoom != null ? String(derivedOpeningForRoom) : "");
    const openingReading = prevReading == null ? (rawOpening ? parseFloat(rawOpening) : undefined) : undefined;

    setApplyingAC(roomId);
    try {
      // Same normalisation as the join-reading path: the manager action signals
      // success with `error: null` and exposes no proRatedCount/unassignedUnits.
      const result = isManager
        ? await (async () => {
            const r = await applyRoomACUnitsAsManager(roomId, selectedMonth, meterReading, openingReading);
            return { ...r, success: !r.error, proRatedCount: undefined as number | undefined, unassignedUnits: undefined as number | undefined };
          })()
        : await applyRoomACUnitsAction(roomId, selectedMonth, meterReading, openingReading);
      if (!result.success) {
        toast({ title: "AC Billing Error", description: result.error ?? "Failed to apply AC units.", variant: "destructive" });
      } else {
        const derivedUnits = result.derivedUnits ?? 0;
        const cleared = derivedUnits === 0;
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

  // Only show AC rooms that have at least one currently active tenant.
  // Rooms where all tenants have checked out are excluded — their mid-month AC was
  // handled at checkout time and there is nothing left to bill at month end.
  const acRooms = useMemo(() => {
    const activeRoomIds = new Set(tenants.map(t => t.room_id).filter(Boolean));
    return rooms
      .filter(r => r.has_ac && activeRoomIds.has(r.id))
      .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [rooms, tenants]);

  // Only include payments for currently active tenants. Checked-out tenants have
  // is_active=false so they're absent from the `tenants` prop — their payment rows
  // (which may still be pending after checkout) should not appear in the monthly view.
  const activeTenantIds = useMemo(() => new Set(tenants.map(t => t.id)), [tenants]);
  const activePayments = useMemo(() => payments.filter(p => activeTenantIds.has(p.tenant_id)), [payments, activeTenantIds]);

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

  const filteredHistory = useMemo(() => {
    if (historyRoomFilter === "all") return allHistory;
    return allHistory.filter(p => p.tenant?.room_id === historyRoomFilter);
  }, [allHistory, historyRoomFilter]);

  const filteredAcRooms = useMemo(() => {
    if (acRoomFilter === "all") return acRooms;
    return acRooms.filter(r => r.id === acRoomFilter);
  }, [acRooms, acRoomFilter]);

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activePayments.filter(p => {
      if (q && !p.tenant?.full_name?.toLowerCase().includes(q)) return false;
      if (roomFilter !== "all" && p.tenant?.room_id !== roomFilter) return false;
      if (statusFilter === "paid") return p.status === "paid";
      if (statusFilter === "unpaid") return p.status === "pending" || p.status === "overdue" || p.status === "partially_paid";
      return true;
    });
  }, [activePayments, roomFilter, statusFilter, search]);

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
  const billablePayments = useMemo(
    () => payments.filter((p) => !waitingTenantIdSet.has(p.tenant_id)),
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
      const acPortion = p.status === "pending" || p.status === "overdue" ? Math.max(0, Number(p.ac_charge || 0)) : 0;
      return s + Math.max(0, outstanding - acPortion);
    }, 0);
    // AC collected/pending stay paid-only — a partial payment can't be cleanly
    // attributed between rent and AC (which portion did it cover?).
    const acCollected = billablePayments.filter((p) => p.status === "paid").reduce((s, p) => s + Math.max(0, Number(p.ac_charge || 0)), 0);
    const acPending = billablePayments.filter((p) => p.status === "pending" || p.status === "overdue").reduce((s, p) => s + Math.max(0, Number(p.ac_charge || 0)), 0);
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
      <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] gap-6 px-5 py-2.5 border-b border-white/5">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Plan</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Amount</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center w-28">Status</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-96">Action</span>
      </div>
    );
  }

  function PaymentRow({ p }: { p: Payment }) {
    const room = p.tenant?.room_id ? roomMap[p.tenant.room_id] : null;
    const cfg = statusConfig[p.status];
    const isLate = (p.status === "pending" || p.status === "overdue") && p.for_month < selectedMonth;
    const tierLabel = p.payment_package_tier ? TIER_LABEL[p.payment_package_tier] : "Space Only";
    const total = Number(p.amount) + Number(p.late_fee || 0);
    const basis = dailyBasis(p);

    const statusColors: Record<PaymentStatus, string> = {
      paid:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      pending: "bg-amber/15 text-amber border-amber/25",
      overdue: "bg-rose-500/15 text-rose-400 border-rose-500/25",
      waived:  "bg-white/5 text-muted-foreground border-white/10",
      partially_paid: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    };

    const actionButtons = (
      <>
        {(p.status === "pending" || p.status === "overdue") && (
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
        {p.status === "partially_paid" && (
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
        {p.status === "paid" && (
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 shrink-0 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" disabled={sendingWa === p.id} onClick={() => sendWhatsAppReceipt(p)}>
            {WA_ICON} Receipt
          </Button>
        )}
        {p.status === "waived" && <span className="text-xs text-muted-foreground px-2">Waived</span>}
      </>
    );

    return (
      <>
        {/* ── Mobile card (< md) ─────────────────────────────── */}
        <div className="md:hidden rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-3 hover:border-white/10 transition-colors">
          {/* Row 1: name + amount */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground leading-tight">{p.tenant?.full_name ?? "—"}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {room && <span className="text-xs text-muted-foreground">Rm {room.room_number}</span>}
                <span className="text-xs text-blue-400">{tierLabel}</span>
                {isLate && <span className="text-xs text-rose-400 font-medium">Late</span>}
              </div>
              {p.payment_date && <p className="text-xs text-muted-foreground mt-0.5">Paid {formatDate(p.payment_date)}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-bold text-foreground">{formatCurrency(total)}</p>
              {basis && <p className="text-xs text-muted-foreground">{dailyBasisLabel(basis)}</p>}
              {Number(p.late_fee) > 0 && <p className="text-xs text-rose-400">+{formatCurrency(p.late_fee)} late</p>}
              {p.status === "partially_paid" && (
                <p className="text-xs text-blue-400">{formatCurrency(Number(p.amount_paid ?? 0))} received</p>
              )}
              <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[p.status]}`}>
                {cfg.label}
              </span>
            </div>
          </div>
          {/* Row 2: actions */}
          {p.status !== "waived" && (
            <div className="flex items-center gap-1.5 pt-0.5 border-t border-white/5">
              {actionButtons}
            </div>
          )}
        </div>

        {/* ── Desktop table row (≥ md) ───────────────────────── */}
        <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] gap-6 items-center px-5 py-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{p.tenant?.full_name ?? "—"}</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {room && <span className="text-xs text-muted-foreground">Rm {room.room_number}</span>}
              {isLate && <span className="text-xs text-rose-400 font-medium">Late</span>}
              {p.payment_date && <span className="text-xs text-muted-foreground">Paid {formatDate(p.payment_date)}</span>}
            </div>
          </div>
          <div className="min-w-0">
            <span className="text-sm text-blue-400 font-medium">{tierLabel}</span>
            {Number(p.ac_charge) > 0 && (
              <div className="mt-0.5">
                <span className="text-xs text-muted-foreground">AC: {formatCurrency(p.ac_charge!)}</span>
              </div>
            )}
            {Number(p.ac_maintenance_charge) > 0 && (
              <div className="mt-0.5">
                <span className="text-xs text-muted-foreground">AC Maintenance: {formatCurrency(p.ac_maintenance_charge!)}</span>
              </div>
            )}
            {Number(p.registration_fee_charge) > 0 && (
              <div className="mt-0.5">
                <span className="text-xs text-muted-foreground">Reg. Fee: {formatCurrency(p.registration_fee_charge!)}</span>
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{formatCurrency(total)}</p>
            {basis && <p className="text-xs text-muted-foreground whitespace-nowrap">{dailyBasisLabel(basis)}</p>}
            {Number(p.late_fee) > 0 && <p className="text-xs text-rose-400">+{formatCurrency(p.late_fee)} late</p>}
            {p.status === "partially_paid" && (
              <p className="text-xs text-blue-400">{formatCurrency(Number(p.amount_paid ?? 0))} received</p>
            )}
          </div>
          <div className="flex justify-center w-28">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColors[p.status]}`}>
              {cfg.label}
            </span>
          </div>
          {/* Fixed width, not min-w — each row is its own independent CSS grid
              (not one shared table grid), so if this column's width varied by
              button count, rows with more buttons would compute a wider auto
              column than rows with fewer, shifting Amount/Status out of
              alignment between rows and against the header. A shared fixed
              width sized for the max case (3 buttons) keeps every row's grid
              identical regardless of how many buttons it actually renders. */}
          <div className="flex items-center justify-end gap-2 w-96">
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
          { label: "Collected",       value: formatCurrency(stats.collected),   icon: Wallet,     color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Pending",         value: formatCurrency(stats.pending),     icon: Clock,      color: "text-amber",       bg: "bg-amber/10 border border-amber/20" },
          ...(hasAc ? [
            { label: "AC Collected",  value: formatCurrency(stats.acCollected), icon: Zap,        color: "text-cyan-400",    bg: "bg-cyan-500/10 border border-cyan-500/20" },
            { label: "AC Pending",    value: formatCurrency(stats.acPending),   icon: Zap,        color: "text-amber",       bg: "bg-amber/10 border border-amber/20" },
          ] : []),
        ];
        return (
          <div className={`grid gap-3 sm:gap-4 ${hasAc ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-1 sm:grid-cols-3"}`}>
            {cards.map(({ label, value, icon: Icon, color, bg }, i) => (
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
                  <div className="flex items-center gap-1">
                    {(["all", "paid", "unpaid"] as const).map((s) => {
                      const count = s === "all" ? activePayments.length
                        : s === "paid" ? activePayments.filter(p => p.status === "paid").length
                        : activePayments.filter(p => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid").length;
                      const label = s === "all" ? "All" : s === "paid" ? "Paid" : "Unpaid";
                      const active = statusFilter === s;
                      return (
                        <button
                          key={s}
                          onClick={() => setStatusFilter(s)}
                          className={cn(
                            "h-7 px-3 rounded-full text-xs font-medium border transition-all",
                            active && s === "paid"   ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" :
                            active && s === "unpaid" ? "bg-amber/15 border-amber/40 text-amber" :
                            active                   ? "bg-sidebar-accent border-sidebar-border text-foreground" :
                            "border-transparent text-muted-foreground hover:text-foreground hover:border-sidebar-border"
                          )}
                        >
                          {label} <span className="ml-1 opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Room filter dropdown */}
                  {roomsInMonth.length > 1 && (
                    <Select value={roomFilter} onValueChange={setRoomFilter}>
                      <SelectTrigger className="h-7 w-40 text-xs">
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

                  {/* Name search */}
                  <div className="relative ml-auto">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search by name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-7 pl-7 text-xs w-40 sm:w-48"
                    />
                  </div>
                </div>
                <PaymentTableHeader />
                <div className="space-y-2 md:space-y-0.5 mt-1">
                  {filteredPayments.map((p) => <PaymentRow key={p.id} p={p} />)}
                </div>
                {filteredPayments.length === 0 && (search || roomFilter !== "all" || statusFilter !== "all") && (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                    {search
                      ? `No results for "${search}"`
                      : `No ${statusFilter !== "all" ? statusFilter : ""} payments${roomFilter !== "all" ? " for this room" : ""}`}
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
                {roomsInHistory.length > 1 && (
                  <div className="flex items-center gap-2 px-2 pt-1 pb-3">
                    <Select value={historyRoomFilter} onValueChange={setHistoryRoomFilter}>
                      <SelectTrigger className="h-7 w-40 text-xs">
                        <SelectValue placeholder="All Rooms" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Rooms</SelectItem>
                        {roomsInHistory.map(r => (
                          <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  {filteredHistory.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-white/[0.03]">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{p.tenant?.full_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.for_month}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                        <p className={`text-xs ${statusConfig[p.status].color}`}>{statusConfig[p.status].label}</p>
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
                      No payments for this room
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
              {acRooms.length > 1 && (
                <div className="ml-auto">
                  <Select value={acRoomFilter} onValueChange={setAcRoomFilter}>
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue placeholder="All Rooms" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Rooms</SelectItem>
                      {acRooms.map(r => (
                        <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {filteredAcRooms.map(room => {
                const saved = acReadings.find(r => r.room_id === room.id);
                const acTenantCount = tenants.filter(t => t.room_id === room.id && t.is_active).length;
                const totalTenants = acTenantCount;
                const midMonthJoiners = tenants.filter(
                  t => t.room_id === room.id && t.is_active && t.check_in.startsWith(selectedMonth)
                );
                const prevMonthReading = prevMonthACReadings.find(r => r.room_id === room.id)?.meter_reading ?? null;
                const hasPrevReading = prevMonthReading != null;
                const currentInput = acUnits[room.id] ?? "";
                const openingInput = acOpeningReadings[room.id] ?? "";
                // Mirrors the server's own fallback (applyRoomACUnitsAction): if this room
                // has no previous-month reading and nobody typed an opening value, the
                // earliest active tenant's move-in meter reading is used automatically —
                // the same number already captured once at tenant creation. Shown here so
                // the operator isn't left guessing what "leave it blank" actually does.
                const roomActiveTenants = tenants.filter(t => t.room_id === room.id && t.is_active);
                const derivedOpening = deriveOpeningReading(roomActiveTenants, selectedMonth);
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
                          {acTenantCount > 0 ? (
                            <span className="text-xs text-amber">
                              {acTenantCount} of {totalTenants} billed for AC
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">No AC-package tenants</span>
                          )}
                        </div>
                        {saved ? (
                          <p className="text-xs text-emerald-400 mt-0.5">
                            Reading: {saved.meter_reading ?? "—"} · {saved.total_units} units consumed · Rs {saved.per_unit_rate}/unit · {saved.tenant_count} tenants billed
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground/50 mt-0.5">No reading for this month yet</p>
                        )}
                        {hasPrevReading ? (
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Previous month ended at {prevMonthReading}</p>
                        ) : derivedOpening != null ? (
                          <p className="text-[10px] text-amber/60 mt-0.5">First reading — auto-using move-in reading {derivedOpening} unless overridden below</p>
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
                              disabled={acTenantCount === 0}
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
                            disabled={acTenantCount === 0}
                            className="flex-1 sm:w-28 h-9 text-sm text-center disabled:opacity-40"
                          />
                          {canRecordPayment && (
                            <Button
                              size="sm"
                              className="h-9 px-4 text-xs gap-1.5 bg-amber/10 text-amber border border-amber/25 hover:bg-amber/20 disabled:opacity-40 shrink-0"
                              variant="ghost"
                              disabled={applyingAC === room.id || !currentInput || acTenantCount === 0}
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
                    {saved && (() => {
                      const acTenants = tenants.filter(t => t.room_id === room.id && t.is_active);
                      const monthRows = payments.filter(p => p.for_month === selectedMonth && p.tenant?.room_id === room.id);
                      const activeIds = new Set(acTenants.map(t => t.id));
                      const rows = acTenants.map(t => {
                        const pay = monthRows.find(p => p.tenant_id === t.id);
                        return {
                          id: t.id,
                          name: t.full_name,
                          units: Number(pay?.ac_units_consumed ?? 0),
                          charge: Number(pay?.ac_charge ?? 0),
                          departed: false,
                        };
                      });
                      // A tenant who checked out mid-month keeps their payment row but
                      // disappears from `tenants` (active-only). Leaving them out made a
                      // month the meter was divided five ways read as a split of four,
                      // and the listed units never added up to the reading.
                      const departedRows = monthRows
                        .filter(p => !activeIds.has(p.tenant_id) && Number(p.ac_charge ?? 0) > 0)
                        .map(p => ({
                          id: p.tenant_id,
                          name: p.tenant?.full_name ?? "Checked out",
                          units: Number(p.ac_units_consumed ?? 0),
                          charge: Number(p.ac_charge ?? 0),
                          departed: true,
                        }));
                      const allRows = [...rows, ...departedRows];
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
                      const overAssignedUnits = Math.round(Math.max(0, assignedUnits - saved.total_units) * 100) / 100;
                      const unassignedCharge = Math.round(unassignedUnits * saved.per_unit_rate);
                      const totalCharge = Math.round(saved.total_units * saved.per_unit_rate);
                      return (
                        <div className="border-t border-white/5 pt-2.5 space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Allocated per tenant</p>
                          {billedRows.map(r => (
                            <div key={r.id} className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground flex-1 min-w-0 truncate">
                                {r.name}
                                {r.departed && <span className="text-muted-foreground/50"> — checked out, charged at departure</span>}
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
                const food = markDialog.food_charge ?? 0;
                const ac = markDialog.ac_charge ?? 0;
                const depositCharge = markDialog.security_deposit_charge ?? 0;
                const registrationFeeCharge = markDialog.registration_fee_charge ?? 0;
                const acMaintenanceCharge = markDialog.ac_maintenance_charge ?? 0;
                const baseRent = (markDialog.amount ?? 0) - food - ac - depositCharge - registrationFeeCharge - acMaintenanceCharge;
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
                    <div className="flex justify-between text-xs font-medium text-foreground">
                      <span>Total</span><span>{formatCurrency(markDialog.amount ?? 0)}</span>
                    </div>
                    {/* Total stays the fixed original bill (matches the receipt and
                        Member Ledger's "Charged" column) — running balance shown as
                        its own line instead of overloading what "Total" means. */}
                    {Number(markDialog.amount_paid ?? 0) > 0 && (
                      <>
                        <div className="flex justify-between text-xs text-emerald-400">
                          <span>Already Paid</span><span>-{formatCurrency(Number(markDialog.amount_paid ?? 0))}</span>
                        </div>
                        <div className="flex justify-between text-xs font-semibold text-amber">
                          <span>Balance Due</span><span>{formatCurrency(Math.max(0, Number(markDialog.amount ?? 0) - Number(markDialog.amount_paid ?? 0)))}</span>
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

            {/* Amount received — supports partial payments. Defaults to the full
                remaining balance; editing it down records a partial payment instead. */}
            {markDialog && (() => {
              const alreadyPaid = Number(markDialog.amount_paid ?? 0);
              const remaining = Math.max(0, Number(markDialog.amount) - alreadyPaid);
              return (
                <div className="space-y-1.5">
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
