"use client";
import { useState, useMemo, useEffect } from "react";
import {
  Plus, Users, BedDouble, Search, Edit2, Trash2,
  LogOut, Clock, UserCheck, Phone, Mail, CreditCard, History,
  ClipboardList, CheckCircle2, XCircle, Link2, Loader2, ShieldCheck,
  FileSpreadsheet, FileText, ExternalLink, Banknote, Copy,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput, capitalize, cn } from "@/lib/utils";
import type { Tenant, Room, SpaceType, PackageTier, TenantApplication, ApplicationStatus, TenantDocument, PaymentMethod, CheckoutInput, PackagePrices, WaitlistEntry } from "@/types";
import { PhotoPicker } from "./photo-picker";
import { TenantTimeline } from "./tenant-timeline";
import { DocumentManager } from "./document-manager";
import { updateApplicationStatus, convertToTenant, type ConvertFormData } from "@/app/actions/applications";
import { backfillTenantPaymentsAction, checkoutTenantAction, createInvoiceLink, getACCheckoutContextAction } from "@/app/actions/tenants";

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

// Segment-based AC charge calculation — mirrors the month-end billing algorithm.
// priorCheckoutUnits: units_consumed values of tenants who already checked out this month.
// Each is a boundary at which the tenant count dropped by 1.
function computeACSegmentCharge(
  units: number,
  priorCheckoutUnits: number[],
  totalStart: number,
  rate: number,
): number {
  if (units <= 0 || totalStart <= 0 || rate <= 0) return 0;
  const boundaries = [
    0,
    ...priorCheckoutUnits.filter(u => u > 0 && u < units).sort((a, b) => a - b),
    units,
  ];
  let share = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const checkoutsBefore = priorCheckoutUnits.filter(u => u <= segStart).length;
    const tenants = totalStart - checkoutsBefore;
    if (tenants > 0) share += (boundaries[i + 1] - segStart) / tenants;
  }
  return Math.round(share * rate);
}

function getPkgPrice(prices: Partial<Record<PackageTier, { no_ac: number; ac: number }>>, tier: PackageTier, hasAc: boolean): string {
  const p = prices[tier];
  if (!p) return "";
  const val = hasAc ? p.ac : p.no_ac;
  return val > 0 ? String(val) : "";
}

const emptyForm = {
  full_name: "", phone: "", email: "", cnic: "",
  type: "general" as SpaceType,
  package_tier: "space_only" as PackageTier,
  room_id: "", bed_number: "",
  check_in: formatDateInput(new Date()),
  billing_type: "monthly" as "monthly" | "daily",
  monthly_rent: "", daily_rate: "", check_out: "", security_deposit: "0",
  emergency_contact: "", emergency_relationship: "", emergency_phone: "", notes: "",
  is_waiting: false,
  photo_url: "" as string,
};

// ---------------------------------------------------------------------------
// TenantRow — module scope so React preserves identity across parent re-renders
// (UX-F1: defining inside render causes unmount/remount on every parent state change)
// ---------------------------------------------------------------------------

interface TenantRowProps {
  t: Tenant;
  showCheckout?: boolean;
  showActivate?: boolean;
  roomMap: Record<string, Room>;
  onTimeline: (t: Tenant) => void;
  onCheckout: (t: Tenant) => void;
  onActivate: (t: Tenant) => void;
  onEdit: (t: Tenant) => void;
  onDelete: (t: Tenant) => void;
}

function TenantRow({ t, showCheckout = false, showActivate = false, roomMap, onTimeline, onCheckout, onActivate, onEdit, onDelete }: TenantRowProps) {
  const room = t.room_id ? roomMap[t.room_id] : null;
  const initials = t.full_name[0].toUpperCase();
  return (
    <div className="flex items-center gap-3 px-3 py-3.5 sm:px-4 sm:py-3 rounded-xl hover:bg-white/[0.03] transition-colors">
      <button
        type="button"
        onClick={() => onTimeline(t)}
        className="w-9 h-9 rounded-full shrink-0 overflow-hidden border border-amber/20 bg-amber/10 flex items-center justify-center hover:opacity-80 transition-opacity"
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
        onClick={() => onTimeline(t)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{t.full_name}</p>
          <Badge variant="secondary" className="text-xs capitalize shrink-0">{t.type}</Badge>
          {t.billing_type === "daily" && <Badge variant="warning" className="text-xs shrink-0">Daily</Badge>}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0 mt-0.5 items-center">
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
        </div>
      </button>

      <div className="text-right shrink-0 hidden md:block">
        {t.billing_type === "daily"
          ? <p className="text-sm font-semibold text-foreground">{formatCurrency(t.daily_rate)}<span className="text-xs text-muted-foreground font-normal">/day</span></p>
          : <p className="text-sm font-semibold text-foreground">{formatCurrency(t.monthly_rent)}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
        }
        {t.security_deposit > 0 && <p className="text-xs text-muted-foreground">Dep: {formatCurrency(t.security_deposit)}</p>}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
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
        <Button variant="ghost" size="icon" className="hidden sm:flex h-8 w-8 text-muted-foreground hover:text-foreground" title="History" onClick={() => onTimeline(t)}>
          <History className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(t)}>
          <Edit2 className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(t)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TenantsClient({ hostelId, active: initialActive, waiting: initialWaiting, checkedOut: initialCheckedOut, rooms: initialRooms, applications: initialApplications = [], hostelSlug, hostelName, waitlistEntries: initialWaitlistEntries = [] }: Props) {
  const [active, setActive] = useState(initialActive);
  const [waiting, setWaiting] = useState(initialWaiting);
  const [checkedOut, setCheckedOut] = useState(initialCheckedOut);
  const [rooms, setRooms] = useState(initialRooms);
  const [applications, setApplications] = useState<TenantApplication[]>(initialApplications);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>(initialWaitlistEntries);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [checkingOut, setCheckingOut] = useState<Tenant | null>(null);
  const [checkoutDate, setCheckoutDate] = useState(formatDateInput(new Date()));
  const [checkoutPendingPayment, setCheckoutPendingPayment] = useState<{ id: string; for_month: string; amount: number; ac_charge: number; ac_units_consumed: number | null } | null>(null);
  const [checkoutPaymentLoading, setCheckoutPaymentLoading] = useState(false);
  const [checkoutPaymentError, setCheckoutPaymentError] = useState<string | null>(null);
  const [checkoutPayAction, setCheckoutPayAction] = useState<"pay" | "waive">("pay");
  const [checkoutPayDate, setCheckoutPayDate] = useState(formatDateInput(new Date()));
  const [checkoutPayMethod, setCheckoutPayMethod] = useState<string>("cash");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutACReading, setCheckoutACReading] = useState("");
  const [checkoutACOpeningReading, setCheckoutACOpeningReading] = useState("");
  const [checkoutACContext, setCheckoutACContext] = useState<{
    prevMonthReading: number | null;
    prevMonthUnits: number | null;
    perUnitRate: number;
    activeTenantCount: number;
    priorCheckoutUnits: number[];
  } | null>(null);
  const [checkoutACContextLoading, setCheckoutACContextLoading] = useState(false);
  const [shareReceipt, setShareReceipt] = useState<{ name: string; phone: string | null; token: string } | null>(null);
  const [shareLinkDialog, setShareLinkDialog] = useState(false);
  const [shareLinkPhone, setShareLinkPhone] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTenant, setDeleteTenant] = useState<Tenant | null>(null);
  const [pkgPrices, setPkgPrices] = useState<Partial<Record<PackageTier, PackagePrices>>>({});
  const [configSecurityDeposit, setConfigSecurityDeposit] = useState<number>(0);

  useEffect(() => {
    if (!hostelId) return;
    const supabase = createClient();
    supabase.from("hms_package_configs")
      .select("package_prices, security_deposit")
      .eq("hostel_id", hostelId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.package_prices) {
          setPkgPrices(data.package_prices as Partial<Record<PackageTier, PackagePrices>>);
        }
        if (data?.security_deposit) {
          setConfigSecurityDeposit(Number(data.security_deposit));
        }
      });
  }, [hostelId]);
  const [timelineTenant, setTimelineTenant] = useState<Tenant | null>(null);
  const [appActionLoading, setAppActionLoading] = useState<string | null>(null);
  const [approvingApp, setApprovingApp] = useState<TenantApplication | null>(null);
  const [approveForm, setApproveForm] = useState<ConvertFormData>({
    type: "general",
    package_tier: "space_only",
    billing_type: "monthly",
    monthly_rent: 0,
    daily_rate: 0,
    security_deposit: 0,
    check_in: formatDateInput(new Date()),
    room_id: null,
    bed_number: null,
    is_waiting: true,
    notes: null,
  });
  const [approveSaving, setApproveSaving] = useState(false);
  const [editingDocs, setEditingDocs] = useState<TenantDocument[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "student" | "professional" | "general">("all");
  const [depositFilter, setDepositFilter] = useState(false);
  const [roomFilter, setRoomFilter] = useState<string>("all"); // room_id or "all"
  const [exportLoading, setExportLoading] = useState<"excel" | "pdf" | null>(null);

  // Rooms with remaining capacity
  const availableRooms = useMemo(
    () => rooms.filter((r) => r.status !== "maintenance" && r.occupied < r.capacity),
    [rooms]
  );

  async function reload() {
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
    setRooms((rms ?? []) as Room[]);
  }

  async function reloadApplications() {
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
    // Match room_preference (room number string) to an actual room
    const matchedRoom = app.room_preference
      ? rooms.find((r) => r.room_number === app.room_preference) ?? null
      : null;
    setApproveForm({
      type: matchedRoom?.type ?? app.room_preference ?? "general",
      package_tier: app.package_tier ?? "space_only",
      billing_type: "monthly",
      monthly_rent: matchedRoom?.monthly_rent ?? 0,
      daily_rate: 0,
      security_deposit: 10000,
      check_in: app.move_in_date ?? formatDateInput(new Date()),
      room_id: matchedRoom?.id ?? null,
      bed_number: null,
      is_waiting: matchedRoom === null, // auto-switch to Active if room found
      notes: app.notes ?? null,
    });
  }

  async function handleApproveApp() {
    if (!approvingApp) return;
    setApproveSaving(true);
    const result = await convertToTenant(approvingApp.id, approveForm);
    if (result.success) {
      // If room assigned, update occupancy
      if (!approveForm.is_waiting && approveForm.room_id) {
        const room = rooms.find((r) => r.id === approveForm.room_id);
        if (room) {
          const supabase = createClient();
          const newOcc = room.occupied + 1;
          await supabase.from("hms_rooms").update({
            occupied: newOcc,
            status: newOcc >= room.capacity ? "occupied" : "available",
          }).eq("id", approveForm.room_id);
        }
      }
      toast({ title: approveForm.is_waiting ? "Added to waiting list" : "Tenant activated", description: `${approvingApp.full_name} has been added.` });
      setApprovingApp(null);
      await Promise.all([reload(), reloadApplications()]);
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
    setApproveSaving(false);
  }

  function formatCnic(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 13);
    if (digits.length <= 5) return digits;
    if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, security_deposit: configSecurityDeposit > 0 ? String(configSecurityDeposit) : "" });
    setEditingDocs([]);
    setDialogOpen(true);
  }

  function openEdit(t: Tenant, forceActive = false) {
    setEditing(t);
    setEditingDocs(t.documents ?? []);
    setForm({
      full_name: t.full_name,
      phone: t.phone ?? "",
      email: t.email ?? "",
      cnic: t.cnic ?? "",
      type: t.type,
      package_tier: t.package_tier ?? "space_only",
      room_id: t.room_id ?? "",
      bed_number: t.bed_number ?? "",
      check_in: t.check_in ?? formatDateInput(new Date()),
      billing_type: t.billing_type ?? "monthly",
      monthly_rent: t.monthly_rent.toString(),
      daily_rate: t.daily_rate?.toString() ?? "0",
      check_out: t.check_out ?? "",
      security_deposit: t.security_deposit?.toString() ?? "0",
      emergency_contact: t.emergency_contact ?? "",
      emergency_relationship: t.emergency_relationship ?? "",
      emergency_phone: t.emergency_phone ?? "",
      notes: t.notes ?? "",
      is_waiting: forceActive ? false : t.is_waiting,
      photo_url: t.photo_url ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!hostelId || !form.full_name) return;
    if (!form.is_waiting && !form.check_in) return;
    if (form.cnic && !/^\d{5}-\d{7}-\d$/.test(form.cnic)) {
      toast({ title: "Invalid CNIC", description: "Format must be XXXXX-XXXXXXX-X (13 digits)", variant: "destructive" });
      return;
    }
    setSaving(true);
    const supabase = createClient();

    const payload = {
      hostel_id: hostelId,
      full_name: form.full_name,
      phone: form.phone || null,
      email: form.email || null,
      cnic: form.cnic || null,
      type: form.type,
      package_tier: form.package_tier,
      room_id: form.is_waiting || !form.room_id ? null : form.room_id,
      bed_number: form.bed_number || null,
      check_in: form.is_waiting ? formatDateInput(new Date()) : form.check_in,
      check_out: form.billing_type === "daily" && form.check_out ? form.check_out : null,
      billing_type: form.billing_type,
      monthly_rent: form.billing_type === "monthly" ? parseFloat(form.monthly_rent) || 0 : 0,
      daily_rate: form.billing_type === "daily" ? parseFloat(form.daily_rate) || 0 : 0,
      security_deposit: parseFloat(form.security_deposit) || 0,
      emergency_contact: form.emergency_contact || null,
      emergency_relationship: form.emergency_relationship || null,
      emergency_phone: form.emergency_phone || null,
      notes: form.notes || null,
      is_waiting: form.is_waiting,
      is_active: !form.is_waiting,
      photo_url: form.photo_url || null,
    };

    const prevRoomId = editing?.room_id;
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
    } else if (editing && prevRoomId !== newRoomId) {
      // Room changed — update both old and new
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

    toast({
      title: editing
        ? editing.is_waiting && !form.is_waiting
          ? `${form.full_name} activated`
          : "Tenant updated"
        : form.is_waiting
          ? "Added to waiting list"
          : "Tenant added",
    });
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
    setCheckoutPayDate(formatDateInput(new Date()));
    setCheckoutPayMethod("cash");
    setCheckoutNotes("");
    setCheckoutSubmitting(false);
    setCheckoutACReading("");
    setCheckoutACOpeningReading("");
    setCheckoutACContext(null);
    setCheckoutACContextLoading(false);
  }

  // Bundles all checkout-dialog setup so TenantRow (module scope) can call a single callback
  function openCheckout(t: Tenant) {
    const today = formatDateInput(new Date());
    setCheckingOut(t);
    setCheckoutDate(today);
    setCheckoutPayDate(today);
    setCheckoutPayAction("pay");
    setCheckoutPayMethod("cash");
    setCheckoutPendingPayment(null);
    setCheckoutPaymentError(null);
    setCheckoutPaymentLoading(true);
    setCheckoutACReading("");
    setCheckoutACOpeningReading("");
    setCheckoutACContext(null);
    fetchCheckoutPayment(t.id);

    // Load AC context if the room has AC
    const room = t.room_id ? roomMap[t.room_id] : null;
    if (room?.has_ac) {
      setCheckoutACContextLoading(true);
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      getACCheckoutContextAction(t.room_id!, month).then((ctx) => {
        if (!ctx.error) setCheckoutACContext(ctx);
        setCheckoutACContextLoading(false);
      });
    }
  }

  async function fetchCheckoutPayment(tenantId: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_payments")
      .select("id, for_month, amount, late_fee, ac_charge, ac_units_consumed")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId ?? "")
      .in("status", ["pending", "overdue"])
      .order("for_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setCheckoutPaymentError(error.message);
    } else if (data) {
      // UX-F10: only surface a payment section when there is a real amount to collect
      const amount = Number(data.amount) + Number(data.late_fee ?? 0);
      if (amount > 0) {
        setCheckoutPendingPayment({
          id: data.id,
          for_month: data.for_month,
          amount,
          ac_charge: Number(data.ac_charge ?? 0),
          ac_units_consumed: data.ac_units_consumed != null ? Number(data.ac_units_consumed) : null,
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
      ...(acReadingNum !== undefined && Number.isFinite(acReadingNum) ? { acCheckoutReading: acReadingNum } : {}),
      ...(checkoutACContext?.prevMonthReading == null && checkoutACOpeningReading.trim() !== ""
        ? { acOpeningReading: Number(checkoutACOpeningReading) }
        : {}),
    };

    const result = await checkoutTenantAction(input);

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

    // Surface AC billing warning if the checkpoint record could not be stored
    if (result.warning) {
      toast({ title: "Warning", description: result.warning, variant: "destructive" });
    }

    // If payment was collected, generate receipt link and open share dialog
    if (collectedPaymentId) {
      const linkResult = await createInvoiceLink(collectedPaymentId);
      if (linkResult.token) {
        setShareReceipt({ name, phone, token: linkResult.token });
      } else {
        toast({ title: `${name} checked out`, description: "Payment collected." });
      }
    } else {
      toast({ title: `${name} has been checked out successfully.` });
    }

    reload(); // refresh room occupancy counts in background
  }

  async function handleDelete(t: Tenant) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_tenants").delete().eq("id", t.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (t.room_id && t.is_active) {
      const room = rooms.find((r) => r.id === t.room_id);
      if (room) {
        const newOcc = Math.max(0, room.occupied - 1);
        await createClient().from("hms_rooms").update({ occupied: newOcc, status: newOcc < room.capacity ? "available" : "occupied" }).eq("id", t.room_id);
      }
    }
    toast({ title: "Deleted" });
    await reload();
  }

  function filterList(list: Tenant[]) {
    let result = typeFilter !== "all" ? list.filter((t) => t.type === typeFilter) : list;
    if (depositFilter) result = result.filter((t) => Number(t.security_deposit) > 0);
    if (roomFilter !== "all") result = result.filter((t) => t.room_id === roomFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.full_name.toLowerCase().includes(q) ||
        (t.phone ?? "").includes(q) ||
        (t.cnic ?? "").includes(q)
      );
    }
    return result;
  }

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

  function getCurrentFilteredList() {
    const map: Record<string, Tenant[]> = { active, waiting, checkedout: checkedOut };
    return filterList(map[tab] ?? active);
  }

  async function exportExcel() {
    setExportLoading("excel");
    try {
      const XLSX = await import("xlsx");
      const rows = getCurrentFilteredList().map((t) => {
        const room = t.room_id ? roomMap[t.room_id] : null;
        return {
          Name: t.full_name,
          Phone: t.phone ?? "",
          Email: t.email ?? "",
          CNIC: t.cnic ?? "",
          Type: capitalize(t.type),
          Package: PACKAGE_TIER_LABELS[t.package_tier as PackageTier] ?? t.package_tier,
          Room: room ? `Rm ${room.room_number}` : "",
          Bed: t.bed_number ?? "",
          "Monthly Rent (PKR)": t.monthly_rent,
          "Security Deposit (PKR)": t.security_deposit,
          "Check In": t.check_in ?? "",
          "Check Out": t.check_out ?? "",
        };
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

      const rows = getCurrentFilteredList().map((t) => {
        const room = t.room_id ? roomMap[t.room_id] : null;
        return [
          t.full_name,
          t.phone ?? "—",
          t.cnic ?? "—",
          capitalize(t.type),
          PACKAGE_TIER_LABELS[t.package_tier as PackageTier] ?? t.package_tier,
          room ? `Rm ${room.room_number}${t.bed_number ? ` · ${t.bed_number}` : ""}` : "—",
          t.monthly_rent ? `Rs ${t.monthly_rent.toLocaleString()}` : "—",
          t.security_deposit > 0 ? `Rs ${t.security_deposit.toLocaleString()}` : "—",
          t.check_in ?? "—",
        ];
      });

      autoTable(doc, {
        startY: 28,
        head: [["Name", "Phone", "CNIC", "Type", "Package", "Room", "Rent", "Deposit", "Check In"]],
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
          <Button
            variant="outline"
            onClick={() => { if (hostelSlug) setShareLinkDialog(true); else toast({ title: "No form link yet", description: "Contact support to set up your hostel slug.", variant: "destructive" }); }}
            className="gap-2 h-9 text-sm flex-1 sm:flex-none"
          >
            <Link2 className="w-4 h-4" /> Share Application Form
          </Button>
          <Button onClick={openAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold flex-1 sm:flex-none">
            <Plus className="w-4 h-4" /> Add Tenant
          </Button>
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
          <Input placeholder="Search by name, phone, CNIC…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {tab !== "applications" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-xs" disabled={!!exportLoading} onClick={exportExcel} title="Export to Excel">
              {exportLoading === "excel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />}
              <span className="hidden sm:inline">Excel</span>
            </Button>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-xs" disabled={!!exportLoading} onClick={exportPDF} title="Export to PDF">
              {exportLoading === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-rose-400" />}
              <span className="hidden sm:inline">PDF</span>
            </Button>
          </div>
        )}
      </div>

      {/* Filter chips — single scrollable row, never wraps */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex items-center gap-1.5 w-max">
          {(["all", "student", "professional", "general"] as const).map((type) => {
            const allTenants = [...active, ...waiting, ...checkedOut];
            const count = type === "all" ? allTenants.length : allTenants.filter((t) => t.type === type).length;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap",
                  typeFilter === type
                    ? "bg-amber/15 border-amber/30 text-amber"
                    : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                )}
              >
                {type === "all" ? "All" : capitalize(type)}
                <span className="ml-1 opacity-50 tabular-nums">({count})</span>
              </button>
            );
          })}

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

          {/* Room filter — dropdown */}
          {(() => {
            const allTenants = [...active, ...waiting, ...checkedOut];
            const occupiedRooms = rooms
              .filter((r) => allTenants.some((t) => t.room_id === r.id))
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
                      const count = allTenants.filter((t) => t.room_id === r.id).length;
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
                  key={t.id} t={t} showCheckout
                  roomMap={roomMap}
                  onTimeline={setTimelineTenant}
                  onCheckout={openCheckout}
                  onActivate={(tenant) => openEdit(tenant, true)}
                  onEdit={openEdit}
                  onDelete={setDeleteTenant}
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
                      key={t.id} t={t} showActivate
                      roomMap={roomMap}
                      onTimeline={setTimelineTenant}
                      onCheckout={openCheckout}
                      onActivate={(tenant) => openEdit(tenant, true)}
                      onEdit={openEdit}
                      onDelete={setDeleteTenant}
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
                          <button
                            onClick={async () => {
                              const supabase = createClient();
                              const { error } = await supabase.from("hms_waitlist").delete().eq("id", entry.id);
                              if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                              else setWaitlistEntries((prev) => prev.filter((e) => e.id !== entry.id));
                            }}
                            className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                            title="Remove from waitlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
                  roomMap={roomMap}
                  onTimeline={setTimelineTenant}
                  onCheckout={openCheckout}
                  onActivate={(tenant) => openEdit(tenant, true)}
                  onEdit={openEdit}
                  onDelete={setDeleteTenant}
                />
              ))}
              </div>
            )}
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
                            {app.status === "pending" && (
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin">
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
                <p className="text-sm font-semibold text-foreground">{approvingApp.full_name}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {approvingApp.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{approvingApp.phone}</span>}
                  {approvingApp.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{approvingApp.email}</span>}
                  {approvingApp.cnic && <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{approvingApp.cnic}</span>}
                </div>
                {approvingApp.notes && (
                  <p className="text-xs text-muted-foreground italic mt-1">"{approvingApp.notes}"</p>
                )}
              </div>

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

              {/* Type + Package */}
              <div className="grid grid-cols-2 gap-4">
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
                <div className="space-y-1.5">
                  <Label>Package Tier</Label>
                  <Select value={approveForm.package_tier} onValueChange={(v) => {
                    const tier = v as PackageTier;
                    const approveRoom = approveForm.room_id ? rooms.find((r) => r.id === approveForm.room_id) : null;
                    const tierPrices = pkgPrices[tier];
                    const tierDeposit = approveRoom
                      ? (approveRoom.has_ac ? (tierPrices?.deposit_ac ?? 0) : (tierPrices?.deposit_no_ac ?? 0))
                      : 0;
                    const suggestedDeposit = tierDeposit > 0 ? tierDeposit : (configSecurityDeposit > 0 ? configSecurityDeposit : approveForm.security_deposit);
                    setApproveForm({ ...approveForm, package_tier: tier, security_deposit: suggestedDeposit });
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(PACKAGE_TIER_LABELS) as [PackageTier, string][]).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

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
                </div>
                <div className="space-y-1.5">
                  <Label>Security Deposit (PKR)</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={approveForm.security_deposit || ""}
                    onChange={(e) => setApproveForm({ ...approveForm, security_deposit: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              {/* Room + Bed (only for active) */}
              {!approveForm.is_waiting && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Room</Label>
                    <Select
                      value={approveForm.room_id ?? ""}
                      onValueChange={(v) => {
                        const approveRoom = rooms.find((r) => r.id === v);
                        const tierPrices = pkgPrices[approveForm.package_tier as PackageTier];
                        const tierDeposit = approveRoom
                          ? (approveRoom.has_ac ? (tierPrices?.deposit_ac ?? 0) : (tierPrices?.deposit_no_ac ?? 0))
                          : 0;
                        const suggestedDeposit = tierDeposit > 0 ? tierDeposit : (configSecurityDeposit > 0 ? configSecurityDeposit : approveForm.security_deposit);
                        setApproveForm({
                          ...approveForm,
                          room_id: v || null,
                          monthly_rent: approveRoom?.monthly_rent ?? approveForm.monthly_rent,
                          security_deposit: suggestedDeposit,
                        });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
                      <SelectContent>
                        {availableRooms.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            Rm {r.room_number} · {r.capacity - r.occupied} free · {formatCurrency(r.monthly_rent)}/mo
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

              {/* Check-in */}
              <div className="space-y-1.5">
                <Label>Check-in Date</Label>
                <Input
                  type="date"
                  value={approveForm.check_in}
                  onChange={(e) => setApproveForm({ ...approveForm, check_in: e.target.value })}
                />
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

      <ConfirmDialog
        open={!!deleteTenant}
        title={`Delete ${deleteTenant?.full_name ?? "tenant"}?`}
        description="This tenant and all associated payment records will be permanently deleted."
        onConfirm={() => { if (deleteTenant) { handleDelete(deleteTenant); setDeleteTenant(null); } }}
        onCancel={() => setDeleteTenant(null)}
      />

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? editing.is_waiting
                  ? "Activate / Edit Tenant"
                  : "Edit Tenant"
                : "Add Tenant"}
            </DialogTitle>
          </DialogHeader>
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

            {/* Photo picker */}
            {hostelId && (
              <div className="space-y-1.5">
                <Label>Photo</Label>
                <PhotoPicker
                  value={form.photo_url || null}
                  onChange={(url) => setForm({ ...form, photo_url: url })}
                  hostelId={hostelId}
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
                {form.cnic && !/^\d{5}-\d{7}-\d$/.test(form.cnic) && (
                  <p className="text-xs text-rose-400">Format: XXXXX-XXXXXXX-X</p>
                )}
              </div>
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

            {/* Room + Bed — must come before Package Tier so AC status is known */}
            {!form.is_waiting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Room *</Label>
                  <Select value={form.room_id} onValueChange={(v) => {
                    const room = rooms.find((r) => r.id === v);
                    const pkgSuggested = room ? getPkgPrice(pkgPrices, form.package_tier, room.has_ac) : "";
                    const fallback = room?.monthly_rent?.toString() ?? "";
                    const tierPrices = pkgPrices[form.package_tier];
                    const tierDeposit = room
                      ? (room.has_ac ? (tierPrices?.deposit_ac ?? 0) : (tierPrices?.deposit_no_ac ?? 0))
                      : 0;
                    const suggestedDeposit = tierDeposit > 0 ? String(tierDeposit) : (configSecurityDeposit > 0 ? String(configSecurityDeposit) : "");
                    const deposit = !form.security_deposit ? suggestedDeposit : form.security_deposit;
                    setForm({ ...form, room_id: v, monthly_rent: pkgSuggested || fallback || form.monthly_rent, security_deposit: deposit });
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

            {/* Package Tier — filtered by room's AC status */}
            {(() => {
              const selectedRoom = form.room_id ? rooms.find((r) => r.id === form.room_id) : null;
              const visibleTiers = SELECTABLE_TIERS.filter((t) => {
                // For waiting list (no room), show all; for a room, filter by AC
                if (!selectedRoom) return true;
                const p = pkgPrices[t.tier];
                if (!p) return true; // no price config — still show, admin can override rent
                return selectedRoom.has_ac ? p.ac > 0 : p.no_ac > 0;
              });
              return (
                <div className="space-y-1.5">
                  <Label>Package Tier *</Label>
                  <Select
                    value={form.package_tier}
                    disabled={!form.is_waiting && !form.room_id}
                    onValueChange={(v) => {
                      const tier = v as PackageTier;
                      const suggested = selectedRoom ? getPkgPrice(pkgPrices, tier, selectedRoom.has_ac) : "";
                      const tierPrices = pkgPrices[tier];
                      const tierDeposit = selectedRoom
                        ? (selectedRoom.has_ac ? (tierPrices?.deposit_ac ?? 0) : (tierPrices?.deposit_no_ac ?? 0))
                        : 0;
                      const suggestedDeposit = tierDeposit > 0 ? String(tierDeposit) : (configSecurityDeposit > 0 ? String(configSecurityDeposit) : "");
                      setForm({ ...form, package_tier: tier, monthly_rent: suggested || form.monthly_rent, security_deposit: suggestedDeposit || form.security_deposit });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!form.is_waiting && !form.room_id ? "Select a room first" : "Select package"} />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleTiers.map(({ tier, label }) => {
                        const p = pkgPrices[tier];
                        const price = selectedRoom && p
                          ? (selectedRoom.has_ac ? p.ac : p.no_ac)
                          : null;
                        return (
                          <SelectItem key={tier} value={tier}>
                            <span>{label}</span>
                            {price != null && price > 0 && (
                              <span className="ml-1.5 text-xs text-muted-foreground">Rs. {price.toLocaleString()}</span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {!form.is_waiting && !form.room_id && (
                    <p className="text-xs text-muted-foreground/50">Select a room first to see available packages</p>
                  )}
                </div>
              );
            })()}

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
                <div className="space-y-1.5"><Label>Monthly Rent (PKR)</Label><Input type="number" placeholder="0" value={form.monthly_rent} onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Security Deposit (PKR)</Label><Input type="number" placeholder="0" value={form.security_deposit} onChange={(e) => setForm({ ...form, security_deposit: e.target.value })} /></div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Daily Rate (PKR)</Label><Input type="number" placeholder="0" value={form.daily_rate} onChange={(e) => setForm({ ...form, daily_rate: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Security Deposit (PKR)</Label><Input type="number" placeholder="0" value={form.security_deposit} onChange={(e) => setForm({ ...form, security_deposit: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Check-in Date *</Label><Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Expected Check-out *</Label><Input type="date" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} /></div>
                </div>
                {(() => {
                  const rate = parseFloat(form.daily_rate) || 0;
                  const days = form.check_in && form.check_out
                    ? Math.max(0, Math.round((new Date(form.check_out).getTime() - new Date(form.check_in).getTime()) / 86400000) + 1)
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

            {/* Check-in date for monthly billing */}
            {!form.is_waiting && form.billing_type === "monthly" && (
              <div className="space-y-1.5"><Label>Check-in Date *</Label><Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Emergency Contact</Label><Input placeholder="Name" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Emergency Phone</Label><Input placeholder="+92 300 0000000" value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Relationship</Label>
              <Select value={form.emergency_relationship} onValueChange={(v) => setForm({ ...form, emergency_relationship: v })}>
                <SelectTrigger><SelectValue placeholder="Select relationship" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Father">Father</SelectItem>
                  <SelectItem value="Mother">Mother</SelectItem>
                  <SelectItem value="Brother">Brother</SelectItem>
                  <SelectItem value="Sister">Sister</SelectItem>
                  <SelectItem value="Spouse">Spouse</SelectItem>
                  <SelectItem value="Friend">Friend</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5"><Label>Notes</Label><Input placeholder="Any additional notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>

          {/* Documents — only shown when editing an existing tenant */}
          {editing && (
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name || (!form.is_waiting && !form.check_in)}>
              {saving
                ? "Saving…"
                : editing
                  ? editing.is_waiting && !form.is_waiting
                    ? "Activate Tenant"
                    : "Update"
                  : "Add Tenant"}
            </Button>
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

            {/* Section 2 — AC Meter Reading (only for AC rooms) */}
            {checkingOut?.room_id && roomMap[checkingOut.room_id]?.has_ac && (
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
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-xs text-amber/80">No previous month record found — enter the meter reading at the start of this month</p>
                        <input
                          type="number"
                          min="0"
                          max="999999"
                          value={checkoutACOpeningReading}
                          onChange={(e) => setCheckoutACOpeningReading(e.target.value)}
                          placeholder="Opening reading (month start)"
                          className="h-9 w-full rounded-lg border border-amber/30 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/50"
                        />
                      </div>
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
                      const reading = Number(checkoutACReading);
                      const prevFromRecord = checkoutACContext?.prevMonthReading;
                      const prevFromOpening = checkoutACOpeningReading.trim() !== "" ? Number(checkoutACOpeningReading) : null;
                      const prev = prevFromRecord ?? prevFromOpening ?? 0;
                      const rate = checkoutACContext?.perUnitRate ?? 0;
                      const count = checkoutACContext?.activeTenantCount ?? 0;
                      const priorUnits = checkoutACContext?.priorCheckoutUnits ?? [];
                      if (!checkoutACReading || !Number.isFinite(reading) || reading <= prev || rate <= 0 || count <= 0) return null;
                      const units = reading - prev;
                      const charge = computeACSegmentCharge(units, priorUnits, count, rate);
                      return (
                        <p className="text-xs text-emerald-400">
                          {units.toLocaleString()} units ÷ {count} tenant{count > 1 ? "s" : ""} × PKR {rate.toLocaleString()}/unit = est.{" "}
                          <span className="font-medium">PKR {charge.toLocaleString()}</span>
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
                    if (checkingOut) fetchCheckoutPayment(checkingOut.id);
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
                    <span>{checkoutPendingPayment.for_month} · <span className="text-foreground font-medium">{formatCurrency(checkoutPendingPayment.amount)} outstanding</span></span>
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

                {/* Notes */}
                <div className="pt-0.5">
                  <textarea
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    placeholder="Notes (optional) — e.g. deposit returned in cash, damage deducted, etc."
                    rows={2}
                    className="w-full rounded-md border border-sidebar-border bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber/40 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Live summary */}
            <div className="pt-3 border-t border-sidebar-border/60">
              {(() => {
                const deposit = checkingOut?.security_deposit ?? 0;
                const basePending = checkoutPendingPayment?.amount ?? 0;

                // Estimated AC charge from current meter reading inputs
                const acReading = checkoutACReading.trim() !== "" ? Number(checkoutACReading) : NaN;
                const acPrev = checkoutACContext?.prevMonthReading
                  ?? (checkoutACOpeningReading.trim() !== "" ? Number(checkoutACOpeningReading) : null)
                  ?? 0;
                const acRate = checkoutACContext?.perUnitRate ?? 0;
                const acCount = checkoutACContext?.activeTenantCount ?? 0;
                const roomHasAC = !!(checkingOut?.room_id && roomMap[checkingOut.room_id]?.has_ac);
                const estimatedACCharge = (
                  roomHasAC && Number.isFinite(acReading) && acReading > acPrev && acRate > 0 && acCount > 0
                ) ? computeACSegmentCharge(acReading - acPrev, checkoutACContext?.priorCheckoutUnits ?? [], acCount, acRate) : 0;

                const pending = basePending + estimatedACCharge;
                const collecting = pending > 0 && checkoutPayAction === "pay";
                const applied    = collecting && deposit > 0 ? Math.min(deposit, pending) : 0;
                const toCollect  = Math.max(0, pending - applied);
                const depositCoversAll = collecting && applied >= pending;

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
                          Deposit{collecting ? <span className="ml-1 text-xs">(applied)</span> : null}
                        </span>
                        <span className={collecting ? "text-emerald-400" : ""}>
                          {collecting ? `− ${formatCurrency(applied)}` : formatCurrency(deposit)}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-sidebar-border/40" />
                    {depositCoversAll ? (
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-emerald-400">Deposit covers all dues</span>
                        <span className="text-emerald-400">—</span>
                      </div>
                    ) : collecting ? (
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-amber">Collect from tenant</span>
                        <span className="text-amber">{formatCurrency(toCollect)}</span>
                      </div>
                    ) : checkoutPayAction === "waive" ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Balance waived</span>
                        <span className="text-muted-foreground">—</span>
                      </div>
                    ) : null}
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

      {/* Tenant Timeline / History Dialog */}
      {timelineTenant && (
        <TenantTimeline
          tenant={timelineTenant}
          room={timelineTenant.room_id ? (roomMap[timelineTenant.room_id] ?? null) : null}
          open={!!timelineTenant}
          onClose={() => setTimelineTenant(null)}
        />
      )}

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
                      : `https://wa.me/?text=${waMsg}`;
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
              : `https://wa.me/?text=${waMsg}`;
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
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
