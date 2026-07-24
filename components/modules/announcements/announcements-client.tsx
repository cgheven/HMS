"use client";
import { useState } from "react";
import { Plus, Megaphone, Pin, PinOff, Trash2, MessageCircle, Loader2, CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { sendAnnouncementToWhatsAppAction, type AnnouncementSendSummary } from "@/app/actions/announcements";
import type { Announcement, PartnerTier } from "@/types";

interface Props {
  hostelId: string | null;
  announcements: Announcement[];
  partnerTier?: PartnerTier | null;
  whatsappEnabled?: boolean;
}

const emptyForm = { title: "", content: "", is_pinned: false };

export function AnnouncementsClient({ hostelId, announcements: initial, partnerTier = null, whatsappEnabled = false }: Props) {
  const canStandardTier = !partnerTier || partnerTier !== "read_only";
  const [announcements, setAnnouncements] = useState<Announcement[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState<Announcement | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<AnnouncementSendSummary | null>(null);

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
    const { data, error } = await supabase.from("hms_announcements").update({ is_pinned: !a.is_pinned }).eq("id", a.id).select("id");
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) { toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" }); return; }
    await reload();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase.from("hms_announcements").delete().eq("id", id).select("id");
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    if (!data || data.length === 0) { toast({ title: "Not permitted", description: "Your access level does not allow this change.", variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    await reload();
  }

  async function confirmSendToWhatsApp() {
    if (!confirmSend) return;
    setSendingId(confirmSend.id);
    const res = await sendAnnouncementToWhatsAppAction(confirmSend.id);
    if (res.error) {
      toast({ title: "Error", description: res.error, variant: "destructive" });
    } else if (res.data) {
      setSendResult(res.data);
      await reload();
    }
    setSendingId(null);
    setConfirmSend(null);
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
        {canStandardTier && (
          <Button onClick={() => { setForm(emptyForm); setDialogOpen(true); }} className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold w-full sm:w-auto">
            <Plus className="w-4 h-4" /> New Announcement
          </Button>
        )}
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
                  {a.whatsapp_sent_at && (
                    <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Sent to {a.whatsapp_sent_count} on WhatsApp · {formatDate(a.whatsapp_sent_at)}
                    </p>
                  )}
                </div>
                {canStandardTier && (
                  <div className="flex gap-1 shrink-0">
                    {whatsappEnabled && !a.whatsapp_sent_at && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/10" title="Send to WhatsApp" onClick={() => setConfirmSend(a)} disabled={sendingId === a.id}>
                        {sendingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-amber hover:bg-amber/10" onClick={() => togglePin(a)}>
                      <PinOff className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(a.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
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
                  {a.whatsapp_sent_at && (
                    <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Sent to {a.whatsapp_sent_count} on WhatsApp · {formatDate(a.whatsapp_sent_at)}
                    </p>
                  )}
                </div>
                {canStandardTier && (
                  <div className="flex gap-1 shrink-0">
                    {whatsappEnabled && !a.whatsapp_sent_at && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/10" title="Send to WhatsApp" onClick={() => setConfirmSend(a)} disabled={sendingId === a.id}>
                        {sendingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber hover:bg-amber/10" onClick={() => togglePin(a)}>
                      <Pin className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(a.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete announcement?"
        description="This announcement will be permanently removed."
        onConfirm={() => { handleDelete(deleteId!); setDeleteId(null); }}
        onCancel={() => setDeleteId(null)}
      />

      {/* Send to WhatsApp — Confirm */}
      <Dialog open={!!confirmSend} onOpenChange={(o) => !sendingId && !o && setConfirmSend(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">
                <MessageCircle className="w-4 h-4" />
              </span>
              Send to WhatsApp
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Send <span className="text-foreground font-medium">&quot;{confirmSend?.title}&quot;</span> to every active resident&apos;s WhatsApp?
            </p>
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Tenants on the waiting list, checked out, or with no phone on file are skipped automatically. This can only be sent once per announcement.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSend(null)} disabled={!!sendingId}>
              Cancel
            </Button>
            <Button
              onClick={confirmSendToWhatsApp}
              disabled={!!sendingId}
              className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {sendingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              {sendingId ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to WhatsApp — Result */}
      <Dialog open={!!sendResult} onOpenChange={(o) => !o && setSendResult(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className={(sendResult?.sent ?? 0) > 0 ? "text-emerald-400" : ""}>
              {(sendResult?.sent ?? 0) > 0 ? "Announcement Sent" : "No Messages Sent"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">{sendResult?.sent ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">
                tenant{sendResult?.sent === 1 ? "" : "s"} reached on WhatsApp
              </p>
            </div>
            <div className="space-y-1.5 text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Skipped — waiting list, checked out, or no phone on file</span>
                <span className="text-foreground font-medium shrink-0 ml-3">{sendResult?.skipped ?? 0}</span>
              </div>
              {(sendResult?.failed ?? 0) > 0 && (
                <div className="flex items-center justify-between text-rose-400 pt-1.5 border-t border-white/10">
                  <span>Rejected by WhatsApp</span>
                  <span className="font-medium shrink-0 ml-3">{sendResult?.failed}</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/70 text-center">
              This confirms the message was accepted by WhatsApp — not that the tenant has read it.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setSendResult(null)} className="w-full">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
