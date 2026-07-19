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
import type { Payment, PaymentMethod, PaymentStatus, PackageTier, PackageConfig, PaymentMethodAccount, PartnerTier } from "@/types";
import { buildReminderMessage } from "@/lib/whatsapp-reminder";
import {
  syncMonthAction,
  markPaymentPaidAction,
  markPaymentOverdueAction,
  loadHistoryAction,
  applyRoomACUnitsAction,
  saveACJoinReadingAction,
} from "@/app/actions/payments";
import { createInvoiceLink } from "@/app/actions/tenants";
import { recordPaymentAsPartner } from "@/app/actions/partner";

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
}

interface RoomRow { id: string; room_number: string; floor: number | null; has_ac?: boolean | null; }

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
  acReadings?: { room_id: string; total_units: number; meter_reading?: number | null; per_unit_rate: number; tenant_count: number }[];
  acJoinReadings?: { room_id: string; tenant_id: string; units_at_join: number; for_month: string }[];
  prevMonthACReadings?: { room_id: string; meter_reading: number | null; total_units: number }[];
  // null/undefined = owner (unrestricted). Recording a payment requires
  // standard+; late fee / receipt number overrides and AC billing management
  // stay owner-only (the partner write path doesn't support them).
  partnerTier?: PartnerTier | null;
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

export function PaymentsClient({ hostelId, hostelName = "Hostel", hostelPhone, payments: initialPayments, tenants, rooms, initialMonth, packageConfig, paymentMethods = [], reminderTemplate, acReadings = [], acJoinReadings = [], prevMonthACReadings = [], partnerTier = null }: Props) {
  const isPartner = !!partnerTier;
  const canRecordPayment = !partnerTier || partnerTier !== "read_only";
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
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null); // paymentId
  const [postPaymentWa, setPostPaymentWa] = useState<{ payment: Payment; amountReceivedNow: number } | null>(null);
  const [acUnits, setAcUnits] = useState<Record<string, string>>({});
  const [applyingAC, setApplyingAC] = useState<string | null>(null);
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
    if (acJoinReadings.length === 0) return;
    setJoinUnits(prev => {
      const next = { ...prev };
      acJoinReadings.forEach(r => {
        const k = `${r.tenant_id}_${r.for_month}`;
        if (!(k in next)) {
          const prevReading = prevMonthACReadings.find(pr => pr.room_id === r.room_id)?.meter_reading ?? 0;
          next[k] = String(Math.round(Number(prevReading) + r.units_at_join));
        }
      });
      return next;
    });
  }, [acJoinReadings, prevMonthACReadings]);

  // All payment mutations go through Server Actions — not the browser Supabase client
  const syncMonth = useCallback(async (month: string) => {
    const result = await syncMonthAction(month);
    if (result.error) {
      toast({ title: "Failed to sync payments", description: result.error, variant: "destructive" });
    } else if (result.payments) {
      setPayments(result.payments);
    }
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
      ac_units_consumed: p.ac_units_consumed ? String(Math.round(p.ac_units_consumed)) : "0",
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
      const parsedAc = parseInt(rawAc, 10);
      if (!Number.isInteger(parsedAc) || parsedAc < 0 || parsedAc > MAX_AC_UNITS || String(parsedAc) !== rawAc) {
        toast({
          title: "Invalid AC units",
          description: `AC units consumed must be a whole number between 0 and ${MAX_AC_UNITS}.`,
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

    if (isPartner) {
      // recordPaymentAsPartner doesn't accept a late-fee/receipt-number override
      // (both fields are hidden in the dialog for partners, so nothing typed is
      // silently dropped).
      const result = await recordPaymentAsPartner(
        markDialog.tenant_id,
        amountReceived,
        markForm.method,
        markDialog.for_month,
        isAcTier ? parseInt(markForm.ac_units_consumed, 10) : undefined,
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
        setPostPaymentWa({ payment: result.payment, amountReceivedNow: amountReceived });
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
        setPostPaymentWa({ payment: result.payment, amountReceivedNow: amountReceived });
      }
      return;
    }
  }

  async function markOverdue(p: Payment) {
    const result = await markPaymentOverdueAction(p.id);
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Marked as overdue" });
    await syncMonth(selectedMonth);
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

  async function sendWhatsAppReceipt(p: Payment) {
    setSendingWa(p.id);
    try {
      const result = await createInvoiceLink(p.id);
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

      const waUrl = normPhone
        ? `https://wa.me/${normPhone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;

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
    const total = Number(p.amount) + Number(p.late_fee ?? 0);
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
    });
    const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  async function handleSaveJoinReading(roomId: string, tenantId: string) {
    const key = `${tenantId}_${selectedMonth}`;
    const raw = joinUnits[key] ?? "";
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: "Invalid reading", description: "Enter a non-negative meter reading.", variant: "destructive" });
      return;
    }
    const prevReading = prevMonthACReadings.find(r => r.room_id === roomId)?.meter_reading;
    const openingReading = prevReading == null ? (acOpeningReadings[roomId] ? parseFloat(acOpeningReadings[roomId]) : undefined) : undefined;

    setSavingJoin(tenantId);
    try {
      const result = await saveACJoinReadingAction(roomId, selectedMonth, tenantId, value, openingReading);
      if (!result.success) {
        toast({ title: "Error saving join reading", description: result.error, variant: "destructive" });
      } else {
        toast({ title: "Join reading saved" });
        router.refresh();
      }
    } finally {
      setSavingJoin(null);
    }
  }

  async function applyACUnits(roomId: string) {
    const meterReading = Number(acUnits[roomId] ?? "");
    if (!Number.isFinite(meterReading) || meterReading < 0) return;
    const prevReading = prevMonthACReadings.find(r => r.room_id === roomId)?.meter_reading;
    const openingReading = prevReading == null ? (acOpeningReadings[roomId] ? parseFloat(acOpeningReadings[roomId]) : undefined) : undefined;

    setApplyingAC(roomId);
    try {
      const result = await applyRoomACUnitsAction(roomId, selectedMonth, meterReading, openingReading);
      if (!result.success) {
        toast({ title: "AC Billing Error", description: result.error, variant: "destructive" });
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

  const stats = useMemo(() => {
    const due = activePayments.reduce((s, p) => s + Math.max(0, Number(p.amount)) + Math.max(0, Number(p.late_fee || 0)), 0);
    const collected = activePayments.filter((p) => p.status === "paid" || p.status === "partially_paid").reduce((s, p) => s + Math.max(0, Number(p.amount_paid ?? p.amount)), 0);
    const pending = activePayments.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partially_paid").reduce((s, p) => s + Math.max(0, Number(p.amount) + Number(p.late_fee || 0) - Number(p.amount_paid ?? 0)), 0);
    // AC collected/pending stay paid-only — a partial payment can't be cleanly
    // attributed between rent and AC (which portion did it cover?).
    const acCollected = activePayments.filter((p) => p.status === "paid").reduce((s, p) => s + Math.max(0, Number(p.ac_charge || 0)), 0);
    const acPending = activePayments.filter((p) => p.status === "pending" || p.status === "overdue").reduce((s, p) => s + Math.max(0, Number(p.ac_charge || 0)), 0);
    return { due, collected, pending, acCollected, acPending };
  }, [activePayments]);

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
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-44">Action</span>
      </div>
    );
  }

  function PaymentRow({ p }: { p: Payment }) {
    const room = p.tenant?.room_id ? roomMap[p.tenant.room_id] : null;
    const cfg = statusConfig[p.status];
    const isLate = (p.status === "pending" || p.status === "overdue") && p.for_month < selectedMonth;
    const tierLabel = p.payment_package_tier ? TIER_LABEL[p.payment_package_tier] : "Space Only";
    const total = Number(p.amount) + Number(p.late_fee || 0);

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
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" onClick={() => sendReminder(p)}>
              {WA_ICON} Remind
            </Button>
            {canRecordPayment && (
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20" onClick={() => openMarkPaid(p)}>
                <CheckCircle2 className="w-3 h-3" /> Pay
              </Button>
            )}
          </>
        )}
        {p.status === "partially_paid" && (
          <>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" disabled={sendingWa === p.id} onClick={() => sendWhatsAppReceipt(p)}>
              {WA_ICON} Receipt
            </Button>
            {canRecordPayment && (
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20" onClick={() => openMarkPaid(p)}>
                <CheckCircle2 className="w-3 h-3" /> Collect Rest
              </Button>
            )}
          </>
        )}
        {p.status === "paid" && (
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs gap-1.5 text-[#25D366] hover:text-[#25D366] hover:bg-[#25D366]/10 border border-[#25D366]/25 hover:border-[#25D366]/50" disabled={sendingWa === p.id} onClick={() => sendWhatsAppReceipt(p)}>
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
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{formatCurrency(total)}</p>
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
          <div className="flex items-center justify-end gap-2 w-44">
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
            {cards.map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-5">
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
          <TabsTrigger value="history"><Clock className="w-3.5 h-3.5" /> All History</TabsTrigger>
          {acRooms.length > 0 && !isPartner && (
            <TabsTrigger value="ac"><Zap className="w-3.5 h-3.5" /> AC Billing</TabsTrigger>
          )}
        </TabsList>

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
                const baseline = hasPrevReading ? prevMonthReading : (openingInput ? Number(openingInput) : null);
                const consumptionPreview = currentInput && baseline != null && Number.isFinite(Number(currentInput))
                  ? Math.max(0, Number(currentInput) - baseline)
                  : null;
                return (
                  <div key={room.id} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 space-y-3">
                    {/* Room header + meter reading row */}
                    <div className="flex items-start gap-3">
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
                        ) : (
                          <p className="text-[10px] text-amber/60 mt-0.5">First reading — enter opening value below if needed</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {!hasPrevReading && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">Opening:</span>
                            <Input
                              type="number"
                              min={0}
                              max={999999}
                              placeholder="0"
                              value={openingInput}
                              onChange={e => setAcOpeningReadings(prev => ({ ...prev, [room.id]: e.target.value }))}
                              disabled={acTenantCount === 0}
                              className="w-20 h-7 text-xs text-center disabled:opacity-40"
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
                            className="w-28 h-9 text-sm text-center disabled:opacity-40"
                          />
                          <Button
                            size="sm"
                            className="h-9 px-4 text-xs gap-1.5 bg-amber/10 text-amber border border-amber/25 hover:bg-amber/20 disabled:opacity-40"
                            variant="ghost"
                            disabled={applyingAC === room.id || !currentInput || acTenantCount === 0}
                            onClick={() => applyACUnits(room.id)}
                          >
                            {applyingAC === room.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            Apply
                          </Button>
                        </div>
                        {consumptionPreview != null && (
                          <p className="text-[10px] text-amber/70">{consumptionPreview} units consumed</p>
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
                          <span className="text-[10px] text-muted-foreground/50">— meter reading when they joined</span>
                        </div>
                        {midMonthJoiners.map(tenant => {
                          const joinKey = `${tenant.id}_${selectedMonth}`;
                          const savedJoin = acJoinReadings.find(
                            r => r.room_id === room.id && r.tenant_id === tenant.id && r.for_month === selectedMonth
                          );
                          const inputVal = joinUnits[joinKey] ?? "";
                          const isSaved = !!savedJoin && joinUnits[joinKey] === undefined;
                          const joinRelative = inputVal && baseline != null && Number.isFinite(Number(inputVal))
                            ? Math.max(0, Number(inputVal) - baseline)
                            : null;
                          return (
                            <div key={tenant.id} className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs text-muted-foreground truncate block">{tenant.full_name}</span>
                                {joinRelative != null && (
                                  <span className="text-[10px] text-amber/60">{joinRelative} units from month start</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Input
                                  type="number"
                                  min={0}
                                  max={999999}
                                  placeholder="Reading"
                                  value={inputVal}
                                  onChange={e => setJoinUnits(prev => ({ ...prev, [joinKey]: e.target.value }))}
                                  className="w-28 h-9 text-sm text-center"
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={savingJoin === tenant.id || !joinUnits[joinKey]}
                                  onClick={() => handleSaveJoinReading(room.id, tenant.id)}
                                  className="h-9 px-4 text-xs gap-1.5 bg-amber/10 text-amber border border-amber/25 hover:bg-amber/20 disabled:opacity-40"
                                >
                                  {savingJoin === tenant.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : isSaved
                                    ? <CheckCircle2 className="w-3 h-3" />
                                    : <Zap className="w-3 h-3" />}
                                  {savingJoin !== tenant.id && (isSaved ? "Saved" : "Save")}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Unit allocation per tenant — visible after Apply so the split is verifiable */}
                    {saved && (() => {
                      const acTenants = tenants.filter(t => t.room_id === room.id && t.is_active);
                      const rows = acTenants.map(t => ({
                        name: t.full_name,
                        units: Number(payments.find(p => p.tenant_id === t.id && p.for_month === selectedMonth)?.ac_units_consumed ?? 0),
                        charge: Number(payments.find(p => p.tenant_id === t.id && p.for_month === selectedMonth)?.ac_charge ?? 0),
                      })).filter(r => r.units > 0);
                      if (rows.length === 0) return null;
                      const assignedUnits = rows.reduce((s, r) => s + r.units, 0);
                      const assignedCharge = rows.reduce((s, r) => s + r.charge, 0);
                      const unassignedUnits = Math.max(0, saved.total_units - assignedUnits);
                      const unassignedCharge = Math.round(unassignedUnits * saved.per_unit_rate);
                      const totalCharge = Math.round(saved.total_units * saved.per_unit_rate);
                      return (
                        <div className="border-t border-white/5 pt-2.5 space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Allocated per tenant</p>
                          {rows.map(r => (
                            <div key={r.name} className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground flex-1 min-w-0 truncate">{r.name}</span>
                              <span className="tabular-nums text-foreground">{r.units} units</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="tabular-nums text-emerald-400">{formatCurrency(r.charge)}</span>
                            </div>
                          ))}
                          {unassignedUnits > 0 && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-amber/70 flex-1 min-w-0 truncate">Unassigned (pre-occupancy) · hostel absorbs</span>
                              <span className="tabular-nums text-amber/70">{unassignedUnits} units</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="tabular-nums text-amber/70">{formatCurrency(unassignedCharge)}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-xs pt-0.5 border-t border-white/5 mt-1">
                            <span className="text-muted-foreground flex-1">{unassignedUnits > 0 ? "Total entered" : "Total"}</span>
                            <span className="tabular-nums text-foreground font-medium">{saved.total_units} units</span>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="tabular-nums text-emerald-400 font-medium">{formatCurrency(unassignedUnits > 0 ? totalCharge : assignedCharge)}</span>
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
                const baseRent = (markDialog.amount ?? 0) - food - ac - depositCharge;
                const tenant = tenants.find(t => t.id === markDialog.tenant_id);
                const deposit = tenant?.security_deposit ?? 0;
                const mealsLabel = [tenant?.food_breakfast && "Breakfast", tenant?.food_lunch && "Lunch", tenant?.food_dinner && "Dinner"]
                  .filter(Boolean).join(" + ");
                return (
                  <div className="pt-1.5 border-t border-white/10 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Rent</span><span>{formatCurrency(Math.max(0, baseRent))}</span>
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
                  step="1"
                  value={markForm.ac_units_consumed}
                  onChange={(e) => setMarkForm({ ...markForm, ac_units_consumed: e.target.value })}
                />
                {packageConfig && (
                  <p className="text-xs text-muted-foreground">
                    Rate: {formatCurrency(packageConfig.ac_per_unit_rate)}/unit ·
                    Est. Charge: {formatCurrency((parseInt(markForm.ac_units_consumed, 10) || 0) * packageConfig.ac_per_unit_rate)}
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
            {isPartner ? (
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
                  await sendWhatsAppReceipt(postPaymentWa.payment);
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
    </div>
  );
}
