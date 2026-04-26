"use client";
import { useState, useEffect } from "react";
import { Plus, BedDouble, Users, Wrench, Search, Edit2, Trash2 } from "lucide-react";
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
const emptyRoom = { room_number: "", floor: "", type: "general" as SpaceType, capacity: "1", monthly_rent: "", status: "available" as RoomStatus };

interface Props { hostelId: string | null; initialRooms: Room[]; }

export function SpacesClient({ hostelId, initialRooms }: Props) {
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [filtered, setFiltered] = useState<Room[]>(initialRooms);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState(emptyRoom);
  const [saving, setSaving] = useState(false);

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

  function openAdd() { setEditing(null); setForm(emptyRoom); setDialogOpen(true); }
  function openEdit(room: Room) {
    setEditing(room);
    setForm({ room_number: room.room_number, floor: room.floor?.toString() ?? "", type: room.type, capacity: room.capacity.toString(), monthly_rent: room.monthly_rent.toString(), status: room.status });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!hostelId || !form.room_number) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, room_number: form.room_number, floor: form.floor ? parseInt(form.floor) : null, type: form.type, capacity: parseInt(form.capacity) || 1, monthly_rent: parseFloat(form.monthly_rent) || 0, status: form.status };
    const { error } = editing ? await supabase.from("hms_rooms").update(payload).eq("id", editing.id) : await supabase.from("hms_rooms").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editing ? "Room updated" : "Room added" }); setDialogOpen(false); reload(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this room?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_rooms").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Room deleted" }); reload(); }
  }

  const stats = { total: rooms.length, available: rooms.filter((r) => r.status === "available").length, occupied: rooms.filter((r) => r.status === "occupied").length, maintenance: rooms.filter((r) => r.status === "maintenance").length };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Spaces</h1><p className="text-muted-foreground text-sm mt-1">Manage rooms and occupancy</p></div>
        <Button onClick={openAdd} className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add Room</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Rooms", value: stats.total, icon: BedDouble, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Available", value: stats.available, icon: BedDouble, color: "text-green-600", bg: "bg-green-50" },
          { label: "Occupied", value: stats.occupied, icon: Users, color: "text-orange-600", bg: "bg-orange-50" },
          { label: "Maintenance", value: stats.maintenance, icon: Wrench, color: "text-red-600", bg: "bg-red-50" },
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
            <Card key={room.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2 flex flex-row items-start justify-between">
                <div><CardTitle className="text-lg">Room {room.room_number}</CardTitle>{room.floor != null && <p className="text-xs text-muted-foreground">Floor {room.floor}</p>}</div>
                <Badge variant={statusColors[room.status]}>{capitalize(room.status)}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {[["Type", capitalize(room.type)], ["Capacity", `${room.occupied}/${room.capacity}`], ["Rent/mo", formatCurrency(room.monthly_rent)]].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
                ))}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => openEdit(room)}><Edit2 className="w-3 h-3" /> Edit</Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(room.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Room" : "Add Room"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
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
