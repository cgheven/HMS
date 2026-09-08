"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FileCheck2, ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  saveHotelEyeCredentials, startHotelEyeSync, resumeHotelEyeSync, completeHotelEyeLogin,
  startHotelEyeBackgroundSync, getPendingGuests,
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
  const [savingCfg, setSavingCfg] = useState(false);

  // The list is kept in state so the background sync's progress can be polled
  // in — rows drop off as they turn "synced", failed rows gain a reason.
  const [rows, setRows] = useState<PendingGuest[]>(guests);
  const [missingCount, setMissingCount] = useState(missing);

  // A guest can only be filed with a CNIC, province and district present.
  const fileable = rows.filter((g) => g.cnic && g.province && g.district && g.status !== "queued");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(guests.filter((g) => g.cnic && g.province && g.district).map((g) => g.id)));

  // Sync modal. Two possible steps: the human CAPTCHA, then a fire-and-forget
  // hand-off to the server. The browser never drives the filing loop.
  const [syncOpen, setSyncOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [token, setToken] = useState("");
  const [captchaImg, setCaptchaImg] = useState<{ base64: string; mediaType: string } | null>(null);
  const [captchaText, setCaptchaText] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [handedOff, setHandedOff] = useState(false); // queue is now the server's; safe to close
  const [queuedCount, setQueuedCount] = useState(0);

  const anyQueued = rows.some((g) => g.status === "queued");

  // Gentle poll while anything is mid-flight — refresh the list so the owner
  // watches rows clear without touching the browser. Stops when nothing is
  // queued anymore. Never drives the filing itself.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!anyQueued) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const res = await getPendingGuests();
      if (res.guests) { setRows(res.guests); setMissingCount(res.missing ?? 0); }
    }, 4000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [anyQueued]);

  async function saveConfig() {
    setSavingCfg(true);
    const res = await saveHotelEyeCredentials({
      username, password, portalUrl,
      defaultProvince: null, defaultDistrict: null,
    });
    setSavingCfg(false);
    if (!res.success) { toast({ title: "Not saved", description: res.error, variant: "destructive" }); return; }
    toast({ title: "Credentials saved" });
    setPassword("");
    setCfgOpen(false);
  }

  // Open the sync modal. Try a cached session first — if the last CAPTCHA is
  // still alive on the portal, hand off straight away with no CAPTCHA at all.
  // Otherwise fall back to asking for one.
  async function beginSync() {
    if (selected.size === 0) { toast({ title: "Select at least one guest to file." }); return; }
    setHandedOff(false); setCaptchaText(""); setStarting(true); setSyncOpen(true);

    const resume = await resumeHotelEyeSync();
    if (resume.ready) {
      await handOff(); // no CAPTCHA — the server still holds a live session
      setStarting(false);
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

  // Log in with the typed CAPTCHA (the server stores the session), then hand the
  // queue to the server.
  async function runLogin() {
    setLoggingIn(true);
    const login = await completeHotelEyeLogin({ token, captchaText });
    if (login.error || !login.success) {
      setLoggingIn(false);
      toast({ title: "Login failed", description: login.error, variant: "destructive" });
      return; // stay on the CAPTCHA step to retry
    }
    await handOff();
    setLoggingIn(false);
  }

  // Fire-and-forget: give the selection to the server and return immediately.
  // The server files it in the background (Next `after`), so the page never
  // loops over the list and the browser can close mid-run.
  async function handOff() {
    const ids = [...selected];
    const res = await startHotelEyeBackgroundSync({ tenantIds: ids });
    if (res.captchaNeeded) { await fetchCaptcha(); return; } // session lapsed between resume and hand-off
    if (res.error) { toast({ title: "Could not start", description: res.error, variant: "destructive" }); setSyncOpen(false); return; }
    // Reflect "Syncing…" locally at once, then let the poll take over.
    setRows((prev) => prev.map((g) => selected.has(g.id) ? { ...g, status: "queued" } : g));
    setQueuedCount(res.queued ?? ids.length);
    setSelected(new Set());
    setHandedOff(true);
  }

  const badge = (g: PendingGuest) =>
    g.status === "synced" ? <Badge variant="success">Synced</Badge>
    : g.status === "queued" ? <Badge variant="warning" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Syncing…</Badge>
    : g.status === "failed" ? <Badge variant="destructive">Failed</Badge>
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

      {anyQueued && (
        <Card className="p-4 border-amber/30 bg-amber/[0.06]">
          <p className="text-sm text-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-amber shrink-0 animate-spin" />
            Syncing in the background — this list updates on its own as each guest is filed. You can leave this page.
          </p>
        </Card>
      )}

      {missingCount > 0 && (
        <Card className="p-4 border-sidebar-border">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{missingCount}</span> pending guest{missingCount === 1 ? "" : "s"} can&apos;t be filed yet —
            they&apos;re missing a CNIC, province or district. Add those on the member&apos;s profile and they&apos;ll appear here ready to sync.
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between">
          <p className="text-sm font-medium">Pending guests ({rows.length})</p>
          {fileable.length > 0 && (
            <button
              className="text-xs text-amber hover:underline"
              onClick={() => setSelected((s) => s.size === fileable.length ? new Set() : new Set(fileable.map((g) => g.id)))}
            >
              {selected.size === fileable.length ? "Clear all" : "Select all fileable"}
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Everyone is filed. New tenants will appear here until they&apos;re synced.
          </p>
        ) : (
          <ul className="divide-y divide-sidebar-border">
            {rows.map((g) => {
              const canFile = !!(g.cnic && g.province && g.district) && g.status !== "queued";
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
                      {g.status === "failed" && g.lastError && <span className="text-rose-400"> · {g.lastError}</span>}
                    </p>
                  </div>
                  {badge(g)}
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCfgOpen(false)}>Cancel</Button>
            <Button onClick={saveConfig} disabled={savingCfg}>{savingCfg ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── The human-CAPTCHA sync ───────────────────────────────────── */}
      <Dialog open={syncOpen} onOpenChange={(o) => { if (!loggingIn && !starting) setSyncOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Sync to {systemName}</DialogTitle></DialogHeader>

          {starting ? (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-amber" />
              <p className="text-sm text-muted-foreground">Reaching the portal…</p>
            </div>
          ) : handedOff ? (
            // The queue is the server's now. This window is free to close.
            <div className="py-6 space-y-4 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm text-foreground font-medium">
                  Syncing {queuedCount} guest{queuedCount === 1 ? "" : "s"} in the background.
                </p>
                <p className="text-[12px] text-muted-foreground">
                  It keeps running on the server even if you close this window. The list updates on its own —
                  anyone already on the portal is skipped automatically, so no duplicates are filed.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => setSyncOpen(false)}>Close</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="py-1 space-y-3">
              <p className="text-sm text-muted-foreground">
                The portal requires a person to read the CAPTCHA at login. Type it below, and PulseHub files
                the {selected.size} selected guest{selected.size === 1 ? "" : "s"} in the background on the session it opens.
              </p>
              {captchaImg && (
                <div className="flex justify-center rounded-lg border border-sidebar-border bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:${captchaImg.mediaType};base64,${captchaImg.base64}`} alt="CAPTCHA" className="h-16" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>CAPTCHA</Label>
                <Input value={captchaText} onChange={(e) => setCaptchaText(e.target.value)} autoFocus autoComplete="off"
                  disabled={loggingIn}
                  onKeyDown={(e) => { if (e.key === "Enter" && captchaText.trim() && !loggingIn) runLogin(); }} />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSyncOpen(false)} disabled={loggingIn}>Cancel</Button>
                <Button onClick={runLogin} disabled={!captchaText.trim() || loggingIn}>
                  {loggingIn ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : `Sync ${selected.size}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
