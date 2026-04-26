"use client";
import { useState, useMemo } from "react";
import { Plus, MessageSquareWarning, CheckCircle2, Clock, Wrench, AlertTriangle, Edit2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDate, capitalize } from "@/lib/utils";
import type { Complaint, ComplaintCategory, ComplaintPriority, ComplaintStatus, Tenant, Room } from "@/types";

type TenantRow = Pick<Tenant, "id" | "full_name">;
type RoomRow = Pick<Room, "id" | "room_number">;

interface Props {
  hostelId: string | null;
  complaints: Complaint[];
  tenants: TenantRow[];
  rooms: RoomRow[];
}

const categoryIcons: Record<ComplaintCategory, string> = {
  plumbing: "🚿", electricity: "⚡", cleanliness: "🧹",
  security: "🔒", furniture: "🪑", other: "📋",
};

const priorityColors: Record<ComplaintPriority, string> = {
  low: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  medium: "text-amber bg-amber/10 border-amber/20",
  high: "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

const statusConfig: Record<ComplaintStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  open: { label: "Open", color: "text-rose-400", icon: AlertTriangle },
  in_progress: { label: "In Progress", color: "text-amber", icon: Clock },
  resolved: { label: "Resolved", color: "text-emerald-400", icon: CheckCircle2 },
};

const emptyForm = {
  title: "", description: "", category: "other" as ComplaintCategory,
  priority: "medium" as ComplaintPriority, tenant_id: "", room_id: "",
};

export function ComplaintsClient({ hostelId, complaints: initial, tenants, rooms }: Props) {
  const [complaints, setComplaints] = useState<Complaint[]>(initial);
  const [tab, setTab] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolveDialog, setResolveDialog] = useState<Complaint | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_complaints")
      .select("*, tenant:hms_tenants(full_name), room:hms_rooms(room_number)")
      .eq("hostel_id", hostelId).order("created_at", { ascending: false });
    setComplaints((data ?? []) as Complaint[]);
  }

  async function handleSave() {
    if (!hostelId || !form.title) return;
    setSaving(true);
    const supabase = createClient();
    const payload = {
      hostel_id: hostelId,
      title: form.title,
      description: form.description || null,
      category: form.category,
      priority: form.priority,
      tenant_id: form.tenant_id || null,
      room_id: form.room_id || null,
      status: "open" as ComplaintStatus,
    };
    const { error } = await supabase.from("hms_complaints").insert(payload);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Complaint logged" }); setDialogOpen(false); setForm(emptyForm); await reload(); }
    setSaving(false);
  }

  async function updateStatus(c: Complaint, status: ComplaintStatus) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_complaints").update({ status }).eq("id", c.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await reload();
  }

  async function handleResolve() {
    if (!resolveDialog) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_complaints").update({
      status: "resolved",
      resolution_notes: resolutionNotes || null,
      resolved_at: new Date().toISOString(),
    }).eq("id", resolveDialog.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Complaint resolved" }); setResolveDialog(null); setResolutionNotes(""); await reload(); }
    setSaving(false);
  }

  async function handleDelete(c: Complaint) {
    if (!confirm("Delete this complaint?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_complaints").delete().eq("id", c.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    await reload();
  }

  const filtered = useMemo(() => {
    if (tab === "all") return complaints;
    return complaints.filter((c) => c.status === tab.replace("_", "_"));
  }, [complaints, tab]);

  const stats = useMemo(() => ({
    open: complaints.filter((c) => c.status === "open").length,
    in_progress: complaints.filter((c) => c.status === "in_progress").length,
    resolved: complaints.filter((c) => c.status === "resolved").length,
  }), [complaints]);

  function ComplaintCard({ c }: { c: Complaint }) {
    const cfg = statusConfig[c.status];
    const StatusIcon = cfg.icon;
    return (
      <div className="rounded-xl border border-sidebar-border bg-card/50 p-4 hover:border-white/10 transition-colors">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0 mt-0.5">{categoryIcons[c.category]}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-foreground">{c.title}</p>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium ${priorityColors[c.priority]}`}>
                {capitalize(c.priority)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {c.tenant?.full_name && <span className="text-xs text-muted-foreground">{c.tenant.full_name}</span>}
              {c.room?.room_number && <span className="text-xs text-muted-foreground">Room {c.room.room_number}</span>}
              <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
            </div>
            {c.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>}
            {c.resolution_notes && <p className="text-xs text-emerald-400 mt-1">✓ {c.resolution_notes}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{cfg.label}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-sidebar-border">
          {c.status === "open" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-amber hover:bg-amber/10 border border-amber/20" onClick={() => updateStatus(c, "in_progress")}>
              Start Progress
            </Button>
          )}
          {c.status !== "resolved" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20" onClick={() => { setResolveDialog(c); setResolutionNotes(""); }}>
              <CheckCircle2 className="w-3 h-3 mr-1" /> Resolve
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(c)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Complaints</h1>
          <p className="text-muted-foreground text-sm mt-1">Maintenance requests & issues</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setDialogOpen(true); }} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Log Complaint
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Open", value: stats.open, color: "text-rose-400", bg: "bg-rose-500/10 border border-rose-500/20" },
          { label: "In Progress", value: stats.in_progress, color: "text-amber", bg: "bg-amber/10 border border-amber/20" },
          { label: "Resolved", value: stats.resolved, color: "text-emerald-400", bg: "bg-emerald-500/10 border border-emerald-500/20" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All ({complaints.length})</TabsTrigger>
          <TabsTrigger value="open"><AlertTriangle className="w-3 h-3" /> Open ({stats.open})</TabsTrigger>
          <TabsTrigger value="in_progress"><Clock className="w-3 h-3" /> In Progress ({stats.in_progress})</TabsTrigger>
          <TabsTrigger value="resolved"><CheckCircle2 className="w-3 h-3" /> Resolved ({stats.resolved})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
              <MessageSquareWarning className="w-10 h-10 opacity-20" />
              <p className="text-sm">No complaints in this category</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((c) => <ComplaintCard key={c.id} c={c} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Complaint Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Log Complaint</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5"><Label>Title *</Label><Input placeholder="e.g. Leaking pipe in bathroom" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as ComplaintCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(categoryIcons) as ComplaintCategory[]).map((c) => (
                      <SelectItem key={c} value={c}>{categoryIcons[c]} {capitalize(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as ComplaintPriority })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Tenant</Label>
                <Select value={form.tenant_id} onValueChange={(v) => setForm({ ...form, tenant_id: v === "_none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
                    {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Room</Label>
                <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v === "_none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
                    {rooms.map((r) => <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea placeholder="Describe the issue…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title}>{saving ? "Saving…" : "Log Complaint"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveDialog} onOpenChange={(o) => !o && setResolveDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Resolve Complaint</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">Resolving: <span className="text-foreground font-medium">{resolveDialog?.title}</span></p>
            <div className="space-y-1.5">
              <Label>Resolution Notes</Label>
              <Textarea placeholder="What was done to fix this?" value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialog(null)}>Cancel</Button>
            <Button onClick={handleResolve} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving ? "Saving…" : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
