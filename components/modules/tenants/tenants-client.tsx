"use client";
import { useState, useMemo } from "react";
import {
  Plus, Users, BedDouble, Search, Edit2, Trash2,
  LogOut, Clock, UserCheck, Phone, Mail, CreditCard, History,
  ClipboardList, CheckCircle2, XCircle, Link2, Loader2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateInput, capitalize } from "@/lib/utils";
import type { Tenant, Room, SpaceType, PackageTier, TenantApplication, ApplicationStatus } from "@/types";
import { PhotoPicker } from "./photo-picker";
import { TenantTimeline } from "./tenant-timeline";
import { updateApplicationStatus, convertToTenant, type ConvertFormData } from "@/app/actions/applications";

interface Props {
  hostelId: string | null;
  active: Tenant[];
  waiting: Tenant[];
  checkedOut: Tenant[];
  rooms: Room[];
  applications?: TenantApplication[];
  hostelSlug?: string | null;
}

const PACKAGE_TIER_LABELS: Record<PackageTier, string> = {
  space_only: "Space Only",
  space_food: "Space + 2 Meals",
  space_3meals: "Space + 3 Meals",
  space_food_ac: "Space + Meals + AC",
  space_meals_cooler: "Space + Meals + Cooler",
};

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

export function TenantsClient({ hostelId, active: initialActive, waiting: initialWaiting, checkedOut: initialCheckedOut, rooms: initialRooms, applications: initialApplications = [], hostelSlug }: Props) {
  const [active, setActive] = useState(initialActive);
  const [waiting, setWaiting] = useState(initialWaiting);
  const [checkedOut, setCheckedOut] = useState(initialCheckedOut);
  const [rooms, setRooms] = useState(initialRooms);
  const [applications, setApplications] = useState<TenantApplication[]>(initialApplications);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [checkingOut, setCheckingOut] = useState<Tenant | null>(null);
  const [checkoutDate, setCheckoutDate] = useState(formatDateInput(new Date()));
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTenant, setDeleteTenant] = useState<Tenant | null>(null);
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
    setApproveForm({
      type: app.room_preference ?? "general",
      package_tier: app.package_tier ?? "space_only",
      billing_type: "monthly",
      monthly_rent: 0,
      daily_rate: 0,
      security_deposit: 0,
      check_in: app.move_in_date ?? formatDateInput(new Date()),
      room_id: null,
      bed_number: null,
      is_waiting: true,
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

  function copyJoinLink() {
    if (!hostelSlug) {
      toast({ title: "No form link yet", description: "Contact support to set up your hostel slug.", variant: "destructive" });
      return;
    }
    const url = `${window.location.origin}/join/${hostelSlug}`;
    window.open(url, "_blank", "noopener,noreferrer");
    navigator.clipboard.writeText(url).catch(() => null);
    toast({ title: "Form opened + link copied!", description: url });
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(t: Tenant) {
    setEditing(t);
    setForm({
      full_name: t.full_name,
      phone: t.phone ?? "",
      email: t.email ?? "",
      cnic: t.cnic ?? "",
      type: t.type,
      package_tier: t.package_tier ?? "space_only",
      room_id: t.room_id ?? "",
      bed_number: t.bed_number ?? "",
      check_in: t.check_in,
      billing_type: t.billing_type ?? "monthly",
      monthly_rent: t.monthly_rent.toString(),
      daily_rate: t.daily_rate?.toString() ?? "0",
      check_out: t.check_out ?? "",
      security_deposit: t.security_deposit?.toString() ?? "0",
      emergency_contact: t.emergency_contact ?? "",
      emergency_relationship: t.emergency_relationship ?? "",
      emergency_phone: t.emergency_phone ?? "",
      notes: t.notes ?? "",
      is_waiting: t.is_waiting,
      photo_url: t.photo_url ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!hostelId || !form.full_name) return;
    if (!form.is_waiting && !form.check_in) return;
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

    const { error } = editing
      ? await supabase.from("hms_tenants").update(payload).eq("id", editing.id)
      : await supabase.from("hms_tenants").insert(payload);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
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

    toast({ title: editing ? "Tenant updated" : form.is_waiting ? "Added to waiting list" : "Tenant added" });
    setDialogOpen(false);
    await reload();
    setSaving(false);
  }

  async function handleCheckout() {
    if (!checkingOut) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_tenants").update({
      check_out: checkoutDate, is_active: false, is_waiting: false,
    }).eq("id", checkingOut.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Decrement room occupancy
    if (checkingOut.room_id) {
      const room = rooms.find((r) => r.id === checkingOut.room_id);
      if (room) {
        const newOcc = Math.max(0, room.occupied - 1);
        await supabase.from("hms_rooms").update({ occupied: newOcc, status: newOcc < room.capacity ? "available" : "occupied" }).eq("id", checkingOut.room_id);
      }
    }

    toast({ title: "Tenant checked out" });
    setCheckoutDialogOpen(false);
    setCheckingOut(null);
    await reload();
    setSaving(false);
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
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((t) => t.full_name.toLowerCase().includes(q) || (t.phone ?? "").includes(q) || (t.cnic ?? "").includes(q));
  }

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

  const stats = {
    active: active.length,
    waiting: waiting.length,
    vacantRooms: rooms.filter((r) => r.status === "available").length,
  };

  function TenantRow({ t, showCheckout = false }: { t: Tenant; showCheckout?: boolean }) {
    const room = t.room_id ? roomMap[t.room_id] : null;
    const initials = t.full_name[0].toUpperCase();
    return (
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4 rounded-xl hover:bg-white/[0.03] transition-colors">
        {/* Avatar */}
        <button
          type="button"
          onClick={() => setTimelineTenant(t)}
          className="w-9 h-9 rounded-full shrink-0 overflow-hidden border border-amber/20 bg-amber/10 flex items-center justify-center hover:opacity-80 transition-opacity"
        >
          {t.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.photo_url} alt={t.full_name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-amber">{initials}</span>
          )}
        </button>

        {/* Info */}
        <button
          type="button"
          onClick={() => setTimelineTenant(t)}
          className="flex-1 min-w-0 text-left"
        >
          {/* Name row — truncate prevents wrapping */}
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{t.full_name}</p>
            <Badge variant="secondary" className="text-xs capitalize shrink-0">{t.type}</Badge>
            {t.billing_type === "daily" && <Badge variant="warning" className="text-xs shrink-0">Daily</Badge>}
          </div>
          {/* Meta row — whitespace-nowrap per item so nothing splits mid-word */}
          <div className="flex flex-wrap gap-x-2 gap-y-0 mt-0.5">
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
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                In: {formatDate(t.check_in)}
              </span>
            )}
            {t.check_out && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Out: {formatDate(t.check_out)}
              </span>
            )}
          </div>
        </button>

        {/* Rent — only on md+ */}
        <div className="text-right shrink-0 hidden md:block">
          {t.billing_type === "daily"
            ? <p className="text-sm font-semibold text-foreground">{formatCurrency(t.daily_rate)}<span className="text-xs text-muted-foreground font-normal">/day</span></p>
            : <p className="text-sm font-semibold text-foreground">{formatCurrency(t.monthly_rent)}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
          }
          {t.security_deposit > 0 && <p className="text-xs text-muted-foreground">Dep: {formatCurrency(t.security_deposit)}</p>}
        </div>

        {/* Actions — Check Out is icon-only on mobile */}
        <div className="flex items-center gap-0.5 shrink-0">
          {showCheckout && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20"
              onClick={() => { setCheckingOut(t); setCheckoutDate(formatDateInput(new Date())); setCheckoutDialogOpen(true); }}
              title="Check Out"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline text-xs ml-1.5">Check Out</span>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="History" onClick={() => setTimelineTenant(t)}>
            <History className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTenant(t)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  }

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
            onClick={copyJoinLink}
            className="gap-2 h-9 text-sm flex-1 sm:flex-none"
            title={hostelSlug ? `Copy /join/${hostelSlug}` : "Enable listing to get a join link"}
          >
            <Link2 className="w-4 h-4" /> Share Form Link
          </Button>
          <Button onClick={openAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold flex-1 sm:flex-none">
            <Plus className="w-4 h-4" /> Add Tenant
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Active Tenants", value: stats.active, icon: UserCheck, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Waiting List", value: stats.waiting, icon: Clock, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
          { label: "Vacant Rooms", value: stats.vacantRooms, icon: BedDouble, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${bg} shrink-0`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold text-foreground leading-none mt-0.5">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by name, phone, CNIC…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="flex w-max min-w-full gap-0.5">
            <TabsTrigger value="active" className="flex-1 gap-1.5 whitespace-nowrap">
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Active</span>
              <span className="text-muted-foreground">({active.length})</span>
            </TabsTrigger>
            <TabsTrigger value="waiting" className="flex-1 gap-1.5 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Waiting</span>
              <span className="text-muted-foreground">({waiting.length})</span>
            </TabsTrigger>
            <TabsTrigger value="checkedout" className="flex-1 gap-1.5 whitespace-nowrap">
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Checked Out</span>
              <span className="sm:hidden">Out</span>
              <span className="text-muted-foreground">({checkedOut.length})</span>
            </TabsTrigger>
            <TabsTrigger value="applications" className="flex-1 gap-1.5 whitespace-nowrap">
              <ClipboardList className="w-3.5 h-3.5 shrink-0" />
              <span>Applications</span>
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
              <div className="p-2 space-y-1">
                {filterList(active).map((t) => <TenantRow key={t.id} t={t} showCheckout />)}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="waiting">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {filterList(waiting).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Clock className="w-10 h-10 opacity-20" />
                <p className="text-sm">{search ? "No tenants match" : "Waiting list is empty"}</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filterList(waiting).map((t) => <TenantRow key={t.id} t={t} />)}
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
              <div className="p-2 space-y-1">
                {filterList(checkedOut).map((t) => <TenantRow key={t.id} t={t} />)}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="applications">
          <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
            {applications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <ClipboardList className="w-10 h-10 opacity-20" />
                <p className="text-sm">No applications yet</p>
                {hostelSlug && (
                  <p className="text-xs">Share your join form: <span className="text-amber font-mono">/join/{hostelSlug}</span></p>
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
                              </div>
                              {app.notes && <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-1">{app.notes}</p>}
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
                  <Select value={approveForm.package_tier} onValueChange={(v) => setApproveForm({ ...approveForm, package_tier: v })}>
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
                      onValueChange={(v) => setApproveForm({
                        ...approveForm,
                        room_id: v || null,
                        monthly_rent: approveForm.monthly_rent || (rooms.find(r => r.id === v)?.monthly_rent ?? 0),
                      })}
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Tenant" : "Add Tenant"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {/* Status toggle */}
            {!editing && (
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => setForm({ ...form, is_waiting: false })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${!form.is_waiting ? "bg-amber/10 border-amber/30 text-amber" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2"><Label>Full Name *</Label><Input placeholder="Ahmed Khan" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input placeholder="+92 300 0000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>CNIC</Label><Input placeholder="00000-0000000-0" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></div>
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
              <div className="space-y-1.5 sm:col-span-2"><Label>Package Tier</Label>
                <Select value={form.package_tier} onValueChange={(v) => setForm({ ...form, package_tier: v as PackageTier })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PACKAGE_TIER_LABELS) as [PackageTier, string][]).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

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

            {!form.is_waiting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Room</Label>
                  <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v, monthly_rent: form.monthly_rent || (rooms.find(r => r.id === v)?.monthly_rent?.toString() ?? "") })}>
                    <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
                    <SelectContent>
                      {availableRooms.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          Room {r.room_number} · {r.capacity - r.occupied} free · {formatCurrency(r.monthly_rent)}/mo
                        </SelectItem>
                      ))}
                      {editing && editing.room_id && !availableRooms.find(r => r.id === editing.room_id) && (
                        <SelectItem value={editing.room_id}>Current room (keep)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Bed Number</Label><Input placeholder="A1" value={form.bed_number} onChange={(e) => setForm({ ...form, bed_number: e.target.value })} /></div>
                {form.billing_type === "monthly" && <div className="space-y-1.5"><Label>Check-in Date *</Label><Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></div>}
              </div>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name || (!form.is_waiting && !form.check_in)}>
              {saving ? "Saving…" : editing ? "Update" : "Add Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Check Out Tenant</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <p className="text-sm text-muted-foreground">
              Checking out <span className="font-medium text-foreground">{checkingOut?.full_name}</span>.
              This will free their room slot.
            </p>
            <div className="space-y-1.5">
              <Label>Check-out Date</Label>
              <Input type="date" value={checkoutDate} onChange={(e) => setCheckoutDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCheckout} disabled={saving} className="bg-rose-500 hover:bg-rose-600 text-white">
              {saving ? "Processing…" : "Confirm Check Out"}
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
    </div>
  );
}
