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
const emptyRoom = { room_number: "", floor: "", type: "general" as SpaceType, capacity: "1", monthly_rent: "", status: "available" as RoomStatus, has_ac: false, has_cooler: false };

interface Props { hostelId: string | null; initialRooms: Room[]; }

interface PhotoSlot { file: File | null; preview: string | null; }

export function SpacesClient({ hostelId, initialRooms }: Props) {
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [filtered, setFiltered] = useState<Room[]>(initialRooms);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState(emptyRoom);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [photo1, setPhoto1] = useState<PhotoSlot>({ file: null, preview: null });
  const [photo2, setPhoto2] = useState<PhotoSlot>({ file: null, preview: null });
  const file1Ref = useRef<HTMLInputElement>(null);
  const file2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(rooms.filter((r) => r.room_number.toLowerCase().includes(q) || r.type.includes(q) || r.status.includes(q)));
  }, [search, rooms]);

  async function reload() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_rooms").select("*").eq("hostel_id", hostelId).order("room_number");
    setRooms((data as Room[]) ?? []);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyRoom);
    setPhoto1({ file: null, preview: null });
    setPhoto2({ file: null, preview: null });
    setDialogOpen(true);
  }

  function openEdit(room: Room) {
    setEditing(room);
    setForm({ room_number: room.room_number, floor: room.floor?.toString() ?? "", type: room.type, capacity: room.capacity.toString(), monthly_rent: room.monthly_rent.toString(), status: room.status, has_ac: room.has_ac ?? false, has_cooler: room.has_cooler ?? false });
    setPhoto1({ file: null, preview: room.photo_path ?? null });
    setPhoto2({ file: null, preview: room.photo_path_2 ?? null });
    setDialogOpen(true);
  }

  function handlePhotoChange(slot: 1 | 2, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Room photo must be under 5 MB.", variant: "destructive" });
      return;
    }
    const preview = URL.createObjectURL(file);
    if (slot === 1) setPhoto1({ file, preview });
    else setPhoto2({ file, preview });
  }

  function clearPhoto(slot: 1 | 2) {
    if (slot === 1) {
      setPhoto1({ file: null, preview: editing?.photo_path ?? null });
      if (file1Ref.current) file1Ref.current.value = "";
    } else {
      setPhoto2({ file: null, preview: editing?.photo_path_2 ?? null });
      if (file2Ref.current) file2Ref.current.value = "";
    }
  }

  async function uploadPhoto(supabase: ReturnType<typeof createClient>, roomId: string, slot: 1 | 2, photo: PhotoSlot) {
    if (!photo.file || !hostelId) return;
    const ext = photo.file.type === "image/png" ? "png" : photo.file.type === "image/webp" ? "webp" : "jpg";
    const suffix = slot === 2 ? "_2" : "";
    const path = `${hostelId}/${roomId}${suffix}.${ext}`;
    const { error } = await supabase.storage.from("room-photos").upload(path, photo.file, { upsert: true, contentType: photo.file.type });
    if (error) return;
    const { data: { publicUrl } } = supabase.storage.from("room-photos").getPublicUrl(path);
    const field = slot === 2 ? "photo_path_2" : "photo_path";
    await supabase.from("hms_rooms").update({ [field]: publicUrl }).eq("id", roomId);
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
      monthly_rent: parseFloat(form.monthly_rent) || 0,
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

    await Promise.all([
      uploadPhoto(supabase, roomId, 1, photo1),
      uploadPhoto(supabase, roomId, 2, photo2),
    ]);

    toast({ title: editing ? "Room updated" : "Room added" });
    setDialogOpen(false);
    reload();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_rooms").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Room deleted" }); reload(); }
  }

  const stats = { total: rooms.length, available: rooms.filter((r) => r.status === "available").length, occupied: rooms.filter((r) => r.status === "occupied").length, maintenance: rooms.filter((r) => r.status === "maintenance").length };

  function PhotoUploader({ slot, photo, fileRef }: { slot: 1 | 2; photo: PhotoSlot; fileRef: React.RefObject<HTMLInputElement | null> }) {
    return (
      <div className="flex-1 space-y-1.5">
        <Label className="text-xs">Photo {slot}</Label>
        {photo.preview ? (
          <div className="relative rounded-xl overflow-hidden border border-sidebar-border h-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.preview} alt={`Photo ${slot}`} className="w-full h-full object-cover" />
            <div className="absolute top-1.5 right-1.5 flex gap-1">
              <button type="button" onClick={() => fileRef.current?.click()} className="p-1 rounded bg-black/60 hover:bg-black/80 text-white transition-colors" title="Replace">
                <ImagePlus className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => clearPhoto(slot)} className="p-1 rounded bg-black/60 hover:bg-black/80 text-white transition-colors" title="Remove">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 w-full h-28 rounded-xl border-2 border-dashed border-sidebar-border hover:border-amber/30 hover:bg-amber/5 transition-colors text-muted-foreground hover:text-amber"
          >
            <ImagePlus className="w-5 h-5" />
            <span className="text-[11px] font-medium">Upload</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handlePhotoChange(slot, e)} className="hidden" />
      </div>
    );
  }

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

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search rooms..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground"><BedDouble className="w-10 h-10 mb-3 opacity-30" /><p className="font-medium">{search ? "No rooms match" : "No rooms yet"}</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((room) => (
            <Card key={room.id} className="hover:shadow-md transition-shadow overflow-hidden">
              {(room.photo_path || room.photo_path_2) && (
                <div className="flex h-32 overflow-hidden">
                  {room.photo_path && (
                    <div className={`relative overflow-hidden ${room.photo_path_2 ? "w-1/2 border-r border-sidebar-border" : "w-full"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={room.photo_path} alt={`Room ${room.room_number}`} className="w-full h-full object-cover" />
                    </div>
                  )}
                  {room.photo_path_2 && (
                    <div className={`relative overflow-hidden ${room.photo_path ? "w-1/2" : "w-full"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={room.photo_path_2} alt={`Room ${room.room_number} (2)`} className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              )}
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
          ))}
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
            {/* Photos — side by side */}
            <div>
              <Label className="mb-2 block">Room Photos (up to 2)</Label>
              <div className="flex gap-3">
                <PhotoUploader slot={1} photo={photo1} fileRef={file1Ref} />
                <PhotoUploader slot={2} photo={photo2} fileRef={file2Ref} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">JPG, PNG or WebP · max 5 MB each · shown on public listing</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Room Number *</Label><Input placeholder="101" value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Floor</Label><Input type="number" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Type</Label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as SpaceType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="student">Student</SelectItem><SelectItem value="professional">Professional</SelectItem><SelectItem value="general">General</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as RoomStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="available">Available</SelectItem><SelectItem value="occupied">Occupied</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Capacity</Label><Input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Monthly Rent (PKR)</Label><Input type="number" value={form.monthly_rent} onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} /></div>
            </div>
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
