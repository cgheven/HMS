"use client";
import { useState, useMemo } from "react";
import {
  Plus, Users, BedDouble, Search, Edit2, Trash2,
  LogOut, Clock, UserCheck, Phone, Mail, CreditCard,
} from "lucide-react";
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
import type { Tenant, Room, SpaceType } from "@/types";

interface Props {
  hostelId: string | null;
  active: Tenant[];
  waiting: Tenant[];
  checkedOut: Tenant[];
  rooms: Room[];
}

const emptyForm = {
  full_name: "", phone: "", email: "", cnic: "",
  type: "general" as SpaceType,
  room_id: "", bed_number: "",
  check_in: formatDateInput(new Date()),
  monthly_rent: "", security_deposit: "0",
  emergency_contact: "", emergency_phone: "", notes: "",
  is_waiting: false,
};

export function TenantsClient({ hostelId, active: initialActive, waiting: initialWaiting, checkedOut: initialCheckedOut, rooms: initialRooms }: Props) {
  const [active, setActive] = useState(initialActive);
  const [waiting, setWaiting] = useState(initialWaiting);
  const [checkedOut, setCheckedOut] = useState(initialCheckedOut);
  const [rooms, setRooms] = useState(initialRooms);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [checkingOut, setCheckingOut] = useState<Tenant | null>(null);
  const [checkoutDate, setCheckoutDate] = useState(formatDateInput(new Date()));
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

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
      room_id: t.room_id ?? "",
      bed_number: t.bed_number ?? "",
      check_in: t.check_in,
      monthly_rent: t.monthly_rent.toString(),
      security_deposit: t.security_deposit?.toString() ?? "0",
      emergency_contact: t.emergency_contact ?? "",
      emergency_phone: t.emergency_phone ?? "",
      notes: t.notes ?? "",
      is_waiting: t.is_waiting,
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
      room_id: form.is_waiting || !form.room_id ? null : form.room_id,
      bed_number: form.bed_number || null,
      check_in: form.is_waiting ? formatDateInput(new Date()) : form.check_in,
      monthly_rent: parseFloat(form.monthly_rent) || 0,
      security_deposit: parseFloat(form.security_deposit) || 0,
      emergency_contact: form.emergency_contact || null,
      emergency_phone: form.emergency_phone || null,
      notes: form.notes || null,
      is_waiting: form.is_waiting,
      is_active: !form.is_waiting,
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
    if (!confirm(`Delete ${t.full_name}? This cannot be undone.`)) return;
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
    return (
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber/10 border border-amber/20 text-amber text-sm font-semibold shrink-0">
          {t.full_name[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{t.full_name}</p>
            <Badge variant="secondary" className="text-xs capitalize">{t.type}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {room && <span className="text-xs text-muted-foreground">Room {room.room_number}{t.bed_number ? ` · Bed ${t.bed_number}` : ""}</span>}
            {t.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{t.phone}</span>}
            {t.check_in && <span className="text-xs text-muted-foreground">In: {formatDate(t.check_in)}</span>}
            {t.check_out && <span className="text-xs text-muted-foreground">Out: {formatDate(t.check_out)}</span>}
          </div>
        </div>
        <div className="text-right shrink-0 hidden sm:block">
          <p className="text-sm font-semibold text-foreground">{formatCurrency(t.monthly_rent)}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
          {t.security_deposit > 0 && <p className="text-xs text-muted-foreground">Dep: {formatCurrency(t.security_deposit)}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showCheckout && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20"
              onClick={() => { setCheckingOut(t); setCheckoutDate(formatDateInput(new Date())); setCheckoutDialogOpen(true); }}>
              <LogOut className="w-3 h-3" /> Check Out
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}><Edit2 className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
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
        <Button onClick={openAdd} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Add Tenant
        </Button>
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
        <TabsList>
          <TabsTrigger value="active"><UserCheck className="w-3.5 h-3.5" /> Active ({active.length})</TabsTrigger>
          <TabsTrigger value="waiting"><Clock className="w-3.5 h-3.5" /> Waiting ({waiting.length})</TabsTrigger>
          <TabsTrigger value="checkedout"><Users className="w-3.5 h-3.5" /> Checked Out ({checkedOut.length})</TabsTrigger>
        </TabsList>

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
      </Tabs>

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
            </div>

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
                <div className="space-y-1.5"><Label>Check-in Date *</Label><Input type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Monthly Rent (PKR){!form.is_waiting && " *"}</Label><Input type="number" placeholder="0" value={form.monthly_rent} onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Security Deposit (PKR)</Label><Input type="number" placeholder="0" value={form.security_deposit} onChange={(e) => setForm({ ...form, security_deposit: e.target.value })} /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Emergency Contact</Label><Input placeholder="Name" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Emergency Phone</Label><Input placeholder="+92 300 0000000" value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} /></div>
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
    </div>
  );
}
