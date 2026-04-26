"use client";
import { useState } from "react";
import { Plus, Megaphone, Pin, PinOff, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import type { Announcement } from "@/types";

interface Props {
  hostelId: string | null;
  announcements: Announcement[];
}

const emptyForm = { title: "", content: "", is_pinned: false };

export function AnnouncementsClient({ hostelId, announcements: initial }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!hostelId) return;
    const supabase = createClient();
    const { data } = await supabase.from("hms_announcements")
      .select("*").eq("hostel_id", hostelId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });
    setAnnouncements((data ?? []) as Announcement[]);
  }

  async function handleSave() {
    if (!hostelId || !form.title || !form.content) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("hms_announcements").insert({
      hostel_id: hostelId,
      title: form.title,
      content: form.content,
      is_pinned: form.is_pinned,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Announcement posted" }); setDialogOpen(false); setForm(emptyForm); await reload(); }
    setSaving(false);
  }

  async function togglePin(a: Announcement) {
    const supabase = createClient();
    const { error } = await supabase.from("hms_announcements").update({ is_pinned: !a.is_pinned }).eq("id", a.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await reload();
  }

  async function handleDelete(a: Announcement) {
    if (!confirm("Delete this announcement?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_announcements").delete().eq("id", a.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    await reload();
  }

  const pinned = announcements.filter((a) => a.is_pinned);
  const rest = announcements.filter((a) => !a.is_pinned);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight">Announcements</h1>
          <p className="text-muted-foreground text-sm mt-1">Hostel notices & updates</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setDialogOpen(true); }} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
          <Plus className="w-4 h-4" /> New Announcement
        </Button>
      </div>

      {announcements.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
          <Megaphone className="w-10 h-10 opacity-20" />
          <p className="text-sm">No announcements yet</p>
          <p className="text-xs">Post an announcement for your residents</p>
        </div>
      )}

      {/* Pinned */}
      {pinned.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest flex items-center gap-2">
            <Pin className="w-3 h-3" /> Pinned
          </p>
          {pinned.map((a) => (
            <div key={a.id} className="rounded-2xl border border-amber/20 bg-amber/5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Pin className="w-3.5 h-3.5 text-amber shrink-0" />
                    <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{a.content}</p>
                  <p className="text-xs text-muted-foreground/60 mt-2">{formatDate(a.created_at)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-amber hover:bg-amber/10" onClick={() => togglePin(a)}>
                    <PinOff className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(a)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All others */}
      {rest.length > 0 && (
        <div className="space-y-3">
          {pinned.length > 0 && <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest">Recent</p>}
          {rest.map((a) => (
            <div key={a.id} className="rounded-2xl border border-sidebar-border bg-card p-5 hover:border-white/10 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{a.content}</p>
                  <p className="text-xs text-muted-foreground/60 mt-2">{formatDate(a.created_at)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber hover:bg-amber/10" onClick={() => togglePin(a)}>
                    <Pin className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(a)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Announcement</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5"><Label>Title *</Label><Input placeholder="e.g. Water supply off Friday" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Content *</Label><Textarea placeholder="Write the announcement…" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} /></div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-5 rounded-full border transition-colors relative ${form.is_pinned ? "bg-amber border-amber/50" : "bg-white/10 border-white/20"}`}
                onClick={() => setForm({ ...form, is_pinned: !form.is_pinned })}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.is_pinned ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-muted-foreground">Pin to top</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title || !form.content}>
              {saving ? "Posting…" : "Post Announcement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
