"use client";
import { useState, useEffect, useRef } from "react";
import { Plus, BedDouble, Users, Wrench, Search, Edit2, Trash2, ImagePlus, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, capitalize } from "@/lib/utils";
import type { Room, RoomStatus, SpaceType } from "@/types";

const statusColors: Record<RoomStatus, "success" | "info" | "warning"> = { available: "success", occupied: "info", maintenance: "warning" };
const emptyRoom = { room_number: "", floor: "", type: "general" as SpaceType, capacity: "1", status: "available" as RoomStatus, has_ac: false, has_cooler: false };

// Fields for each slot — slot 0 = photo_path, slot 1 = photo_path_2, etc.
const PHOTO_FIELDS = ["photo_path", "photo_path_2", "photo_path_3", "photo_path_4", "photo_path_5"] as const;
const PHOTO_SUFFIXES = ["", "_2", "_3", "_4", "_5"] as const;
const MAX_PHOTOS = 5;

interface PhotoSlot {
  file: File | null;
  preview: string | null;
  cleared: boolean; // true means "delete this slot on save"
}

function emptySlot(): PhotoSlot { return { file: null, preview: null, cleared: false }; }

function roomToSlots(room: Room): PhotoSlot[] {
  return PHOTO_FIELDS.map((f) => ({ file: null, preview: room[f] ?? null, cleared: false }));
}

interface Props { hostelId: string | null; initialRooms: Room[]; }

export function SpacesClient({ hostelId, initialRooms }: Props) {
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [filtered, setFiltered] = useState<Room[]>(initialRooms);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RoomStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState(emptyRoom);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [photos, setPhotos] = useState<PhotoSlot[]>(Array.from({ length: MAX_PHOTOS }, emptySlot));
  const fileRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(rooms.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.room_number.toLowerCase().includes(q) || r.type.includes(q);
    }));
  }, [search, statusFilter, rooms]);

  async function reload() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number");
    setRooms((data as Room[]) ?? []);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyRoom);
    setPhotos(Array.from({ length: MAX_PHOTOS }, emptySlot));
    setDialogOpen(true);
  }

  function openEdit(room: Room) {
    setEditing(room);
    setForm({ room_number: room.room_number, floor: room.floor?.toString() ?? "", type: room.type, capacity: room.capacity.toString(), status: room.status, has_ac: room.has_ac ?? false, has_cooler: room.has_cooler ?? false });
    setPhotos(roomToSlots(room));
    setDialogOpen(true);
  }

  function handlePhotoChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Room photo must be under 5 MB.", variant: "destructive" });
      return;
    }
    const preview = URL.createObjectURL(file);
    setPhotos((prev) => {
      const next = [...prev];
      next[index] = { file, preview, cleared: false };
      return next;
    });
    // reset input so same file can be re-selected if needed
    if (fileRefs[index].current) fileRefs[index].current!.value = "";
  }

  function clearPhoto(index: number) {
    // Mark as cleared — handleSave will null the DB field and remove the file from storage
    setPhotos((prev) => {
      const next = [...prev];
      next[index] = { file: null, preview: null, cleared: true };
      return next;
    });
  }

  async function handleSave() {
    if (!hostelId || !form.room_number) return;
    setSaving(true);
    const supabase = createClient();
    const payload = {
      hostel_id: hostelId,
      room_number: form.room_number,
      floor: form.floor ? parseInt(form.floor) : null,
      type: form.type,
      capacity: parseInt(form.capacity) || 1,
      status: form.status,
      has_ac: form.has_ac,
      has_cooler: form.has_cooler,
    };

    let roomId: string;
    if (editing) {
      const { error } = await supabase.from("hms_rooms").update(payload).eq("id", editing.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }
      roomId = editing.id;
    } else {
      const { data: inserted, error } = await supabase.from("hms_rooms").insert(payload).select("id").single();
      if (error || !inserted) { toast({ title: "Error", description: error?.message ?? "Insert failed", variant: "destructive" }); setSaving(false); return; }
      roomId = inserted.id;
    }

    // Process each photo slot: upload new files, clear removed slots
    const dbUpdate: Record<string, string | null> = {};

    await Promise.all(photos.map(async (slot, i) => {
      const field = PHOTO_FIELDS[i];
      const suffix = PHOTO_SUFFIXES[i];

      if (slot.file) {
        // Derive MIME type from file name extension — not file.type which is browser-determined and can be empty/spoofed
        const fname = slot.file.name.toLowerCase();
        const ext = fname.endsWith(".png") ? "png" : fname.endsWith(".webp") ? "webp" : "jpg";
        const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        const path = `${hostelId}/${roomId}${suffix}.${ext}`;
        const { error } = await supabase.storage.from("room-photos").upload(path, slot.file, { upsert: true, contentType });
        if (!error) {
          const { data: { publicUrl } } = supabase.storage.from("room-photos").getPublicUrl(path);
          dbUpdate[field] = publicUrl;
        }
      } else if (slot.cleared) {
        // Remove from storage (best-effort — ignore errors)
        const exts = ["jpg", "jpeg", "png", "webp"];
        for (const ext of exts) {
          await supabase.storage.from("room-photos").remove([`${hostelId}/${roomId}${suffix}.${ext}`]);
        }
        dbUpdate[field] = null;
      }
    }));

    if (Object.keys(dbUpdate).length > 0) {
      await supabase.from("hms_rooms").update(dbUpdate).eq("id", roomId);
    }

    toast({ title: editing ? "Room updated" : "Room added" });
    setDialogOpen(false);
    reload();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    // Fetch photo paths before deleting the row so we can clean up storage
    const { data: room } = await supabase.from("hms_rooms").select("photo_path,photo_path_2,photo_path_3,photo_path_4,photo_path_5").eq("id", id).single();
    const { error } = await supabase.from("hms_rooms").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (room) {
      const urls = [room.photo_path, room.photo_path_2, room.photo_path_3, room.photo_path_4, room.photo_path_5].filter(Boolean) as string[];
      const paths = urls.map((url) => url.split("/room-photos/")[1]).filter(Boolean);
      if (paths.length > 0) await supabase.storage.from("room-photos").remove(paths);
    }
    toast({ title: "Room deleted" });
    reload();
  }

  const stats = { total: rooms.length, available: rooms.filter((r) => r.status === "available").length, occupied: rooms.filter((r) => r.status === "occupied").length, maintenance: rooms.filter((r) => r.status === "maintenance").length };

  // How many filled slots exist (to decide where to show the "add" button)
  const filledCount = photos.filter((s) => s.preview).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-serif font-normal tracking-tight">Spaces</h1><p className="text-muted-foreground text-sm mt-1">Manage rooms and occupancy</p></div>
        <Button onClick={openAdd} className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add Room</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Rooms", value: stats.total, icon: BedDouble, color: "text-blue-400", bg: "bg-blue-500/10 border border-blue-500/20" },
          { label: "Available", value: stats.available, icon: BedDouble, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
          { label: "Occupied", value: stats.occupied, icon: Users, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
          { label: "Maintenance", value: stats.maintenance, icon: Wrench, color: "text-rose-400", bg: "bg-rose-500/10 border border-rose-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}><CardContent className="p-4 flex items-center gap-3"><div className={`p-2 rounded-lg ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search rooms..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["all", "available", "occupied"] as const).map((s) => {
            const counts: Record<string, number> = { all: rooms.length, available: stats.available, occupied: stats.occupied };
            const labels: Record<string, string> = { all: "All", available: "Available", occupied: "Occupied" };
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`h-9 px-3.5 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
                  active
                    ? s === "available"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : s === "occupied"
                      ? "bg-amber/15 text-amber border-amber/30"
                      : "bg-white/10 text-foreground border-sidebar-border"
                    : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-sidebar-border/80"
                }`}
              >
                {labels[s]} <span className="ml-1 opacity-60">{counts[s]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground"><BedDouble className="w-10 h-10 mb-3 opacity-30" /><p className="font-medium">{search || statusFilter !== "all" ? "No rooms match" : "No rooms yet"}</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((room) => {
            const roomPhotos = PHOTO_FIELDS.map((f) => room[f]).filter(Boolean) as string[];
            return (
              <Card key={room.id} className="hover:shadow-md transition-shadow overflow-hidden">
                <div className="relative h-32 overflow-hidden bg-sidebar-accent/40">
                  {roomPhotos.length > 0 ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={roomPhotos[0]} alt={`Room ${room.room_number}`} className="w-full h-full object-cover" />
                      {roomPhotos.length > 1 && (
                        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[11px] text-white/80 font-medium">
                          +{roomPhotos.length - 1} more
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/20">
                      <BedDouble className="w-9 h-9" />
                    </div>
                  )}
                </div>
                <CardHeader className="pb-2 flex flex-row items-start justify-between">
                  <div><CardTitle className="text-lg">Room {room.room_number}</CardTitle>{room.floor != null && <p className="text-xs text-muted-foreground">Floor {room.floor}</p>}</div>
                  <Badge variant={statusColors[room.status]}>{capitalize(room.status)}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[["Type", capitalize(room.type)], ["Capacity", `${room.occupied}/${room.capacity}`], ["Rent/mo", formatCurrency(room.monthly_rent)]].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
                  ))}
                  {(room.has_ac || room.has_cooler) && (
                    <div className="flex gap-1.5 flex-wrap">
                      {room.has_ac && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">AC</span>}
                      {room.has_cooler && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Cooler</span>}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => openEdit(room)}><Edit2 className="w-3 h-3" /> Edit</Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(room.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete room?"
        description="This room and its data will be permanently deleted."
        onConfirm={() => { handleDelete(deleteId!); setDeleteId(null); }}
        onCancel={() => setDeleteId(null)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Room" : "Add Room"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">

            {/* Photos — up to 5 in a grid */}
            <div>
              <Label className="mb-2 block">Room Photos <span className="text-muted-foreground font-normal">({filledCount}/{MAX_PHOTOS})</span></Label>
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
                  const slot = photos[i];
                  const isFirst = i === 0;
                  return (
                    <div key={i} className={isFirst ? "col-span-2 row-span-2" : ""}>
                      {slot.preview ? (
                        <div className={`relative rounded-xl overflow-hidden border border-sidebar-border group ${isFirst ? "h-40" : "h-[74px]"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={slot.preview} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                            <button type="button" onClick={() => fileRefs[i].current?.click()} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-colors" title="Replace">
                              <ImagePlus className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => clearPhoto(i)} className="p-1.5 rounded-lg bg-rose-500/30 hover:bg-rose-500/50 text-white backdrop-blur-sm transition-colors" title="Remove">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileRefs[i].current?.click()}
                          className={`w-full rounded-xl border-2 border-dashed border-sidebar-border hover:border-amber/30 hover:bg-amber/5 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-amber ${isFirst ? "h-40" : "h-[74px]"}`}
                        >
                          <ImagePlus className={isFirst ? "w-5 h-5" : "w-3.5 h-3.5"} />
                          {isFirst && <span className="text-[11px] font-medium">Main Photo</span>}
                        </button>
                      )}
                      <input
                        ref={fileRefs[i]}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => handlePhotoChange(i, e)}
                        className="hidden"
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">Up to 5 photos · JPG, PNG or WebP · max 5 MB each · shown on public listing</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Room Number *</Label><Input placeholder="101" value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Floor</Label><Input type="number" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Type</Label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as SpaceType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="student">Student</SelectItem><SelectItem value="professional">Professional</SelectItem><SelectItem value="general">General</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as RoomStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="available">Available</SelectItem><SelectItem value="occupied">Occupied</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-1.5"><Label>Capacity</Label><Input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Amenities</Label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setForm({ ...form, has_ac: !form.has_ac })} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${form.has_ac ? "bg-blue-500/10 border-blue-500/25 text-blue-400" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                  <span className="w-4 h-4 flex items-center justify-center">{form.has_ac ? "✓" : "○"}</span> AC Available
                </button>
                <button type="button" onClick={() => setForm({ ...form, has_cooler: !form.has_cooler })} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${form.has_cooler ? "bg-cyan-500/10 border-cyan-500/25 text-cyan-400" : "border-sidebar-border text-muted-foreground hover:text-foreground"}`}>
                  <span className="w-4 h-4 flex items-center justify-center">{form.has_cooler ? "✓" : "○"}</span> Cooler Available
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.room_number}>{saving ? "Saving..." : editing ? "Update" : "Add Room"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
