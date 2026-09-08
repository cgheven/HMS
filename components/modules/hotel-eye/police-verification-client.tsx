"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FileCheck2, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { HOTEL_EYE_PROVINCES, HOTEL_EYE_DISTRICTS, HOTEL_EYE_CHUNK_MAX } from "@/lib/hotel-eye-vocabulary";
import {
  saveHotelEyeCredentials, startHotelEyeSync, resumeHotelEyeSync, completeHotelEyeLogin, fileHotelEyeChunk,
  type HotelEyeSettings, type PendingGuest,
} from "@/app/actions/hotel-eye";

export function PoliceVerificationClient({
  systemName, settings, guests, missing,
}: {
  systemName: string;
  settings: HotelEyeSettings | null;
  guests: PendingGuest[];
  missing: number;
}) {
  const [cfgOpen, setCfgOpen] = useState(!settings?.configured);
  const [username, setUsername] = useState(settings?.username ?? "");
  const [password, setPassword] = useState("");
  const [portalUrl, setPortalUrl] = useState(settings?.portalUrl ?? "https://hoteleye.punjab.gov.pk");
  const [province, setProvince] = useState(settings?.defaultProvince ?? "");
  const [district, setDistrict] = useState(settings?.defaultDistrict ?? "");
  const [savingCfg, setSavingCfg] = useState(false);

  // A guest can only be filed with a CNIC, province and district present.
  const fileable = guests.filter((g) => g.cnic && g.province && g.district);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(fileable.map((g) => g.id)));

  // Sync modal (the human CAPTCHA step)
  const [syncOpen, setSyncOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [token, setToken] = useState("");
  const [captchaImg, setCaptchaImg] = useState<{ base64: string; mediaType: string } | null>(null);
  const [captchaText, setCaptchaText] = useState("");
  const [syncing, setSyncing] = useState(false);
  // The queue this run is working through, and a running tally, so the whole
  // batch survives across chunks and (if the portal session drops) across a
  // second CAPTCHA. `queue` is what still has to be attempted.
  const [queue, setQueue] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const [tally, setTally] = useState<{ filed: number; failed: { name: string; reason: string }[]; skipped: { name: string; reason: string }[] } | null>(null);
  const [expiredMidRun, setExpiredMidRun] = useState(false);
  const [done, setDone] = useState(false);

  async function saveConfig() {
    setSavingCfg(true);
    const res = await saveHotelEyeCredentials({
      username, password, portalUrl,
      defaultProvince: province || null, defaultDistrict: district || null,
    });
    setSavingCfg(false);
    if (!res.success) { toast({ title: "Not saved", description: res.error, variant: "destructive" }); return; }
    toast({ title: "Credentials saved" });
    setPassword("");
    setCfgOpen(false);
  }

  // Open the sync modal. Try a cached session first — if the last CAPTCHA is
  // still alive on the portal, file straight away with no CAPTCHA at all.
  // Otherwise fall back to asking for one.
  async function beginSync() {
    if (selected.size === 0) { toast({ title: "Select at least one guest to file." }); return; }
    const ids = [...selected];
    setDone(false); setTally({ filed: 0, failed: [], skipped: [] });
    setQueue(ids); setTotal(ids.length); setProgress(0); setExpiredMidRun(false);
    setCaptchaText(""); setStarting(true); setSyncOpen(true);

    const resume = await resumeHotelEyeSync();
    if (resume.ready) {
      setStarting(false);
      await fileQueue(ids); // no CAPTCHA — the server still holds a live session
      return;
    }
    await fetchCaptcha();
    setStarting(false);
  }

  async function fetchCaptcha() {
    const res = await startHotelEyeSync();
    if (res.error || !res.token || !res.captcha) {
      setSyncOpen(false);
      toast({ title: "Could not start", description: res.error, variant: "destructive" });
      return false;
    }
    setToken(res.token); setCaptchaImg(res.captcha); setCaptchaText("");
    return true;
  }

  // Log in with the typed CAPTCHA (the server stores the session), then file.
  async function runSync() {
    setSyncing(true);
    const login = await completeHotelEyeLogin({ token, captchaText });
    if (login.error || !login.success) {
      setSyncing(false);
      toast({ title: "Login failed", description: login.error, variant: "destructive" });
      return; // stay on the CAPTCHA step to retry
    }
    await fileQueue(queue);
  }

  // Walk the queue in chunks against the server-held session, updating progress
  // as each returns. Shared by the CAPTCHA path and the cached-session resume. If
  // the portal drops the session partway, stop and ask for one more CAPTCHA to
  // finish the rest — never re-filing anyone (the server skips synced rows).
  async function fileQueue(ids: string[]) {
    setSyncing(true);
    setExpiredMidRun(false);
    let remaining = [...ids];

    while (remaining.length > 0) {
      const chunk = remaining.slice(0, HOTEL_EYE_CHUNK_MAX);
      const res = await fileHotelEyeChunk({ tenantIds: chunk });
      // Session dropped between resume and this call → fall back to a CAPTCHA.
      if (res.captchaNeeded) {
        setQueue(remaining); setSyncing(false); setExpiredMidRun(true);
        await fetchCaptcha();
        return;
      }
      if (res.error || !res.result) {
        // A whole-chunk failure (network, timeout). Everything already filed is
        // saved; leave the rest queued so the owner can retry from where it stopped.
        setQueue(remaining);
        setSyncing(false);
        toast({ title: "Sync interrupted", description: res.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      const r = res.result;
      setTally((prev) => ({
        filed: (prev?.filed ?? 0) + r.filed,
        failed: [...(prev?.failed ?? []), ...r.failed],
        skipped: [...(prev?.skipped ?? []), ...r.skipped],
      }));

      if (r.sessionExpired) {
        // Resume the untouched tail after a fresh CAPTCHA.
        const tail = r.remaining ?? remaining.slice(chunk.length);
        setQueue(tail);
        setSyncing(false);
        setExpiredMidRun(true);
        await fetchCaptcha();
        return;
      }

      remaining = remaining.slice(chunk.length);
      setQueue(remaining);
      setProgress((p) => p + chunk.length);
    }

    setSyncing(false);
    setDone(true);
  }

  const badge = (status: string) =>
    status === "synced" ? <Badge variant="success">Synced</Badge>
    : status === "failed" ? <Badge variant="destructive">Failed</Badge>
    : <Badge variant="warning">Pending</Badge>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileCheck2 className="w-6 h-6 text-amber" /> {systemName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            File your guests into the government {systemName} portal, straight from their tenant records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCfgOpen(true)}>
            <ShieldCheck className="w-4 h-4" /> {settings?.configured ? "Portal settings" : "Set up portal"}
          </Button>
          <Button onClick={beginSync} disabled={!settings?.configured || selected.size === 0}>
            Sync {selected.size > 0 ? `${selected.size} ` : ""}to {systemName}
          </Button>
        </div>
      </div>

      {!settings?.configured && (
        <Card className="p-4 border-amber/30 bg-amber/[0.06]">
          <p className="text-sm text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber shrink-0" />
            Add this branch&apos;s {systemName} login to begin. Your password is encrypted and never leaves the server.
          </p>
        </Card>
      )}

      {missing > 0 && (
        <Card className="p-4 border-sidebar-border">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{missing}</span> pending guest{missing === 1 ? "" : "s"} can&apos;t be filed yet —
            they&apos;re missing a CNIC, province or district. Add those on the member&apos;s profile and they&apos;ll appear here ready to sync.
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between">
          <p className="text-sm font-medium">Pending guests ({guests.length})</p>
          {fileable.length > 0 && (
            <button
              className="text-xs text-amber hover:underline"
              onClick={() => setSelected((s) => s.size === fileable.length ? new Set() : new Set(fileable.map((g) => g.id)))}
            >
              {selected.size === fileable.length ? "Clear all" : "Select all fileable"}
            </button>
          )}
        </div>
        {guests.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Everyone is filed. New tenants will appear here until they&apos;re synced.
          </p>
        ) : (
          <ul className="divide-y divide-sidebar-border">
            {guests.map((g) => {
              const canFile = !!(g.cnic && g.province && g.district);
              return (
                <li key={g.id} className="px-4 py-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    disabled={!canFile}
                    checked={selected.has(g.id)}
                    onChange={(e) => setSelected((s) => {
                      const n = new Set(s); if (e.target.checked) n.add(g.id); else n.delete(g.id); return n;
                    })}
                    className="h-4 w-4 accent-amber disabled:opacity-30"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.cnic ?? "no CNIC"}{g.room ? ` · Room ${g.room}` : ""}
                      {(!g.province || !g.district) && <span className="text-amber"> · needs province/district</span>}
                    </p>
                  </div>
                  {badge(g.status)}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {settings?.lastSyncedAt && (
        <p className="text-xs text-muted-foreground">
          Last synced {new Date(settings.lastSyncedAt).toLocaleString()}.
        </p>
      )}

      {/* ── Credential setup ─────────────────────────────────────────── */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{systemName} portal login</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Portal URL</Label>
              <Input value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="https://hoteleye.punjab.gov.pk" />
              <p className="text-[11px] text-muted-foreground">Your province&apos;s official Smart Eye address (a .gov.pk site).</p>
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
                placeholder={settings?.configured ? "Leave blank to keep the saved password" : ""} />
              <p className="text-[11px] text-muted-foreground">Encrypted at rest. Used only to log in to the portal on your behalf.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Default province</Label>
                <SearchableSelect
                  value={province}
                  onValueChange={(v) => { setProvince(v); setDistrict(""); }}
                  options={[...HOTEL_EYE_PROVINCES]}
                  placeholder="None"
                  searchPlaceholder="Search province…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Default district</Label>
                <SearchableSelect
                  value={district}
                  onValueChange={setDistrict}
                  options={[...(HOTEL_EYE_DISTRICTS[province] ?? [])]}
                  placeholder={province ? "None" : "Pick a province first"}
                  searchPlaceholder="Search district…"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Defaults fill in for any guest whose own province/district is blank.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCfgOpen(false)}>Cancel</Button>
            <Button onClick={saveConfig} disabled={savingCfg}>{savingCfg ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── The human-CAPTCHA sync ───────────────────────────────────── */}
      <Dialog open={syncOpen} onOpenChange={(o) => { if (!syncing) setSyncOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Sync to {systemName}</DialogTitle></DialogHeader>

          {starting ? (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-amber" />
              <p className="text-sm text-muted-foreground">Reaching the portal…</p>
            </div>
          ) : syncing ? (
            // Live progress while a run walks the queue in chunks.
            <div className="py-8 space-y-4">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-amber" />
                <p className="text-sm text-foreground">Filing {Math.min(progress + 1, total)} of {total}…</p>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-amber transition-all" style={{ width: `${total ? (progress / total) * 100 : 0}%` }} />
              </div>
              <p className="text-[11px] text-center text-muted-foreground">
                Filed {tally?.filed ?? 0} so far · keep this window open.
              </p>
            </div>
          ) : done ? (
            <div className="py-2 space-y-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold text-emerald-400">{tally?.filed ?? 0}</span> filed
                {(tally?.failed.length ?? 0) > 0 && <> · <span className="text-rose-400">{tally!.failed.length} failed</span></>}
                {(tally?.skipped.length ?? 0) > 0 && <> · <span className="text-amber">{tally!.skipped.length} skipped</span></>}
              </p>
              {((tally?.failed.length ?? 0) + (tally?.skipped.length ?? 0)) > 0 && (
                <ul className="text-xs text-muted-foreground space-y-1 max-h-48 overflow-y-auto">
                  {tally!.failed.map((f, i) => <li key={`f-${i}`}><span className="text-rose-400">{f.name}</span> — {f.reason}</li>)}
                  {tally!.skipped.map((sk, i) => <li key={`s-${i}`}><span className="text-amber">{sk.name}</span> — {sk.reason}</li>)}
                </ul>
              )}
              <DialogFooter>
                <Button onClick={() => { setSyncOpen(false); location.reload(); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="py-1 space-y-3">
              {expiredMidRun ? (
                <p className="text-sm text-amber">
                  The portal ended the session partway. {tally?.filed ?? 0} filed so far — solve one more CAPTCHA to
                  finish the remaining {queue.length}.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The portal requires a person to read the CAPTCHA at login. Type it below, and PulseHub files
                  the {queue.length} selected guest{queue.length === 1 ? "" : "s"} on the session it opens
                  {total > HOTEL_EYE_CHUNK_MAX ? `, ${HOTEL_EYE_CHUNK_MAX} at a time` : ""}.
                </p>
              )}
              {captchaImg && (
                <div className="flex justify-center rounded-lg border border-sidebar-border bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:${captchaImg.mediaType};base64,${captchaImg.base64}`} alt="CAPTCHA" className="h-16" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>CAPTCHA</Label>
                <Input value={captchaText} onChange={(e) => setCaptchaText(e.target.value)} autoFocus autoComplete="off"
                  onKeyDown={(e) => { if (e.key === "Enter" && captchaText.trim()) runSync(); }} />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSyncOpen(false)}>Cancel</Button>
                <Button onClick={runSync} disabled={!captchaText.trim()}>File {queue.length}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
