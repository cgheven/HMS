"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Megaphone, Search, Send, CheckCheck, Check, Clock, Ban, AlertTriangle,
  BellOff, Bell, RefreshCw, Eye, FlaskConical, Flag, User, X, SlidersHorizontal,
  History, MapPin, ImagePlus, Trash2, Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/hooks/use-toast";
import {
  listCampaignAudience, sendLeadCampaign, setLeadMarketingOptOut, sendCampaignTest,
  setLeadNotAClient, uploadCampaignHeaderImage, removeCampaignHeaderImage, addCampaignLead,
} from "@/app/actions/lead-campaigns";
import {
  canonicalCity, OTHER_CITY, type CampaignTemplate, type HeaderImageSource,
} from "@/lib/lead-campaigns";
import { LEAD_STATUS_CONFIG } from "@/lib/lead-status";
import { formatDateTime, cn } from "@/lib/utils";
import { whatsappErrorShort } from "@/lib/whatsapp-errors";
import type {
  CampaignAudienceRow, CampaignHistoryRow, LeadAudienceBlock,
} from "@/types";

/**
 * Why a lead is out. Every one of these is re-checked server-side before
 * dispatch — these labels only explain the refusal, they never cause it.
 *
 * `short` is what the summary card shows, so the exclusion breakdown reads as a
 * sentence at a glance instead of a legend to decode.
 */
const BLOCK_CONFIG: Record<LeadAudienceBlock, { label: string; short: string; hint: string; cls: string }> = {
  existing_client: {
    label: "Already a client", short: "already onboarded",
    hint: "Looks like a hostel already paying for Pulse — the evidence is shown on the row",
    cls: "bg-violet-500/10 text-violet-300 border-violet-500/25",
  },
  rejected: {
    label: "Rejected", short: "rejected",
    hint: "Marked rejected in the sales pipeline — never included in a campaign",
    cls: "bg-white/5 text-muted-foreground border-white/10",
  },
  no_phone: {
    label: "No valid phone", short: "no number",
    hint: "The number is unusable — fix it on the lead",
    cls: "bg-amber/10 text-amber border-amber/20",
  },
  bad_number: {
    label: "Not on WhatsApp", short: "wrong number",
    hint: "Meta returned 131026 for this number on a previous send — it is not a WhatsApp account",
    cls: "bg-amber/10 text-amber border-amber/20",
  },
  opted_out: {
    label: "Do not contact", short: "opted out",
    hint: "Suppressed by hand — asked not to receive marketing",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  },
  already_sent: {
    label: "Already sent", short: "already sent",
    hint: "This campaign has already gone to them",
    cls: "bg-white/5 text-muted-foreground border-white/10",
  },
  recently_messaged: {
    label: "Messaged today", short: "messaged today",
    hint: "This number had a marketing message in the last 24 hours — sending again is what gets a number reported",
    cls: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  },
  duplicate_number: {
    label: "Duplicate number", short: "duplicate",
    hint: "Another lead on this list has the same number — only the original is messaged, so nobody gets it twice",
    cls: "bg-white/5 text-muted-foreground border-white/10",
  },
  no_name: {
    label: "No usable name", short: "no name",
    hint: "Would send “Assalam o Alaikum xx,” — fix the name first",
    cls: "bg-amber/10 text-amber border-amber/20",
  },
};

/** Breakdown order — the three the campaign is deliberately excluding come
 *  first, because those are the ones worth checking. */
const BLOCK_ORDER: LeadAudienceBlock[] = [
  "existing_client", "rejected", "recently_messaged", "duplicate_number",
  "bad_number", "no_phone", "opted_out", "no_name", "already_sent",
];

const DELIVERY_CONFIG: Record<string, { label: string; icon: typeof Check; cls: string }> = {
  read:        { label: "Read",          icon: CheckCheck,    cls: "text-emerald-400" },
  delivered:   { label: "Delivered",     icon: CheckCheck,    cls: "text-blue-400" },
  sent:        { label: "Sent",          icon: Check,         cls: "text-muted-foreground" },
  queued:      { label: "Queued",        icon: Clock,         cls: "text-muted-foreground" },
  undelivered: { label: "Not delivered", icon: Ban,           cls: "text-amber" },
  failed:      { label: "Failed",        icon: AlertTriangle, cls: "text-rose-400" },
};

type ViewFilter = "eligible" | "blocked" | "sent" | "all";
/** The preview shares the tab bar with the audience views. It used to be a
 *  330px column pinned beside the table, which cost the workspace a third of
 *  its width on every visit to read a message that does not change. */
type Tab = ViewFilter | "preview";

const VIEW_FILTERS: { value: ViewFilter; label: string }[] = [
  { value: "eligible", label: "Ready to send" },
  { value: "blocked", label: "Excluded" },
  { value: "sent", label: "Sent" },
  { value: "all", label: "All" },
];

const ANY = "__any__";
/** assigned_to is nullable, and "nobody owns this lead" is a real thing to
 *  target — a separate sentinel so it isn't confused with "no filter". */
const UNASSIGNED = "__unassigned__";

const EMPTY_LEAD = { business_name: "", owner_name: "", phone: "", city: "" };

interface Props {
  initialTemplate: string | null;
  templates: CampaignTemplate[];
  initialRows: CampaignAudienceRow[];
  history: CampaignHistoryRow[];
  loadError: string | null;
}

export function MarketingClient({ initialTemplate, templates, initialRows, history, loadError }: Props) {
  const [templateName, setTemplateName] = useState<string | null>(initialTemplate);
  const [rows, setRows] = useState<CampaignAudienceRow[]>(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [cities, setCities] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<string>(ANY);
  const [assignee, setAssignee] = useState<string>(ANY);
  const [tab, setTab] = useState<Tab>("eligible");
  /** Set by clicking a reason in the Excluded card — "show me those 12". */
  const [blockFilter, setBlockFilter] = useState<LeadAudienceBlock | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  /** Which slice of the audience the table is showing. The preview tab is not
   *  one, so it falls back to the view a click on it came from. */
  const view: ViewFilter = tab === "preview" ? "eligible" : tab;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Flipped by the <img> ref/onError. Surfaces a missing header image here
  // rather than letting every send fail at Meta — a media-header template with
  // an unreachable image is rejected outright, not sent without a picture.
  const [imageOk, setImageOk] = useState(true);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  // What the header image became after an upload or a removal, per template.
  // The server owns the real answer — it re-resolves on every send — this only
  // spares the admin a page reload to see the picture they just chose.
  const [headerOverride, setHeaderOverride] = useState<
    Record<string, { url: string | null; source: HeaderImageSource | null }>
  >({});
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_LEAD);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  const template = useMemo(
    () => templates.find((t) => t.name === templateName) ?? null,
    [templates, templateName]
  );

  /** Whether this template has a {{1}} to fill. v4 does not — it sends the same
   *  words to everyone — so a Greeting column would be showing a value that is
   *  never sent, and every explanation built on it would be fiction. */
  const usesGreeting = template?.bodyParamCount === 1;

  const override = template ? headerOverride[template.name] : undefined;
  const headerUrl = override ? override.url : template?.headerImageUrl ?? null;
  const headerSource = override ? override.source : template?.headerImageSource ?? null;

  async function reload(name = templateName) {
    if (!name) return;
    setRefreshing(true);
    const res = await listCampaignAudience(name);
    setRefreshing(false);
    if (res.error) {
      toast({ title: "Could not load leads", description: res.error, variant: "destructive" });
      return;
    }
    setRows(res.rows ?? []);
  }

  function switchTemplate(name: string) {
    setTemplateName(name);
    // Selections are per-campaign — carrying them across would let a click
    // meant for one blast land on another.
    setSelected(new Set());
    setImageOk(true);
    startTransition(() => { void reload(name); });
  }

  async function handleTestSend() {
    if (!template) return;
    setTesting(true);
    const res = await sendCampaignTest(template.name, testPhone, "Musab");
    setTesting(false);
    if (res.error) {
      toast({ title: "Test failed", description: res.error, variant: "destructive" });
      return;
    }
    // "Accepted", not "sent": a 200 from Meta only means it was queued. Delivery
    // and read status arrive later by webhook, and a message can still die at
    // that stage — which is exactly how the broken header image went unnoticed.
    toast({
      title: "Accepted by Meta",
      description: `Queued to ${testPhone}. Check the phone — delivery is confirmed by webhook, not by this response.`,
    });
  }

  /**
   * Swapping the artwork used to mean committing a PNG and deploying, which is
   * why v4 sat on this page unsendable: Meta had approved it, but the image it
   * points at did not exist yet at a public URL. Now the file goes to storage
   * and the same URL is live immediately — including from a dev server, since
   * Meta fetches the link itself.
   */
  async function handleHeaderUpload(file: File) {
    if (!template) return;
    setUploadingHeader(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadCampaignHeaderImage(template.name, fd);
    setUploadingHeader(false);
    if (headerInputRef.current) headerInputRef.current.value = "";

    if (res.error) {
      toast({ title: "Upload failed", description: res.error, variant: "destructive" });
      return;
    }
    setHeaderOverride((p) => ({ ...p, [template.name]: { url: res.url!, source: res.source! } }));
    setImageOk(true);
    toast({
      title: "Header image live",
      description: "Meta fetches it from this URL on every send — nothing to deploy.",
    });
  }

  async function handleHeaderRemove() {
    if (!template) return;
    setUploadingHeader(true);
    const res = await removeCampaignHeaderImage(template.name);
    setUploadingHeader(false);
    if (res.error) {
      toast({ title: "Could not remove", description: res.error, variant: "destructive" });
      return;
    }
    // Not necessarily nothing: a template with artwork in the app bundle falls
    // back to it, and showing a missing-image warning for one that still sends
    // fine would be worse than the removal itself.
    setHeaderOverride((p) => ({
      ...p,
      [template.name]: { url: res.url ?? null, source: res.source ?? null },
    }));
    setImageOk(true);
    toast({ title: "Uploaded image removed" });
  }

  async function handleAddLead() {
    setAdding(true);
    const res = await addCampaignLead(addForm);
    setAdding(false);
    if (res.error) {
      toast({ title: "Could not add", description: res.error, variant: "destructive" });
      return;
    }
    setAddOpen(false);
    setAddForm(EMPTY_LEAD);
    toast({
      title: `${addForm.business_name} added`,
      description: "It is in the CRM and in this campaign list.",
    });
    // Reloaded rather than patched in: whether the new lead is actually sendable
    // is the server's call — it may match an existing client on the way in.
    void reload();
  }

  const stats = useMemo(() => {
    const ready = rows.filter((r) => !r.blocked);
    const sent = rows.filter((r) => r.delivery !== null);
    return {
      total: rows.length,
      ready: ready.length,
      excluded: rows.length - ready.length,
      sent: sent.length,
      delivered: sent.filter((r) => r.delivery === "delivered" || r.delivery === "read").length,
      read: sent.filter((r) => r.delivery === "read").length,
      // Undelivered and failed are one number to an admin — the message did not
      // arrive. Why they differ is in the breakdown, not in the headline.
      failed: sent.filter((r) => r.delivery === "undelivered" || r.delivery === "failed").length,
    };
  }, [rows]);

  /** Every reason a lead is out, biggest first within a fixed order. This is
   *  the answer to "who is NOT getting this and why", which is the question the
   *  page exists to make obvious. */
  const exclusionBreakdown = useMemo(() => {
    const counts = new Map<LeadAudienceBlock, number>();
    for (const r of rows) {
      if (!r.blocked) continue;
      counts.set(r.blocked, (counts.get(r.blocked) ?? 0) + 1);
    }
    return BLOCK_ORDER.filter((b) => counts.has(b)).map((b) => [b, counts.get(b)!] as const);
  }, [rows]);

  /** Why sends failed, most common first. A bare "102 failed" is not
   *  actionable; "102 · bad template" is the difference between a bug to fix
   *  and a Meta experiment to wait out. */
  const failureBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.delivery !== "undelivered" && r.delivery !== "failed") continue;
      const label = whatsappErrorShort(r.error_code);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  /** The rows the current tab is about, before any targeting is applied. City
   *  counts come from here rather than from every lead: a chip reading
   *  "Lahore 50" that opens 31 rows because 19 are excluded is a chip that
   *  lies, and this is the number the admin is about to act on. */
  const viewRows = useMemo(() => {
    if (view === "eligible") return rows.filter((r) => !r.blocked);
    if (view === "blocked") return rows.filter((r) => !!r.blocked);
    if (view === "sent") return rows.filter((r) => r.delivery !== null || r.blocked === "already_sent");
    return rows;
  }, [rows, view]);

  // Counted, because "Islamabad 9" tells you whether a city is worth a blast
  // and a bare list does not. Biggest first for the same reason.
  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of viewRows) {
      const c = canonicalCity(r.city);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) =>
      a[0] === OTHER_CITY ? 1 : b[0] === OTHER_CITY ? -1 : b[1] - a[1]
    );
  }, [viewRows]);

  function toggleCity(c: string) {
    setCities((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  function showExclusion(block: LeadAudienceBlock) {
    setTab("blocked");
    setBlockFilter((prev) => (prev === block ? null : block));
  }

  // Derived from the rows rather than fetched — this only ever needs to offer
  // reps and stages that actually have leads behind them.
  const stages = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);
  const assignees = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.assigned_to && r.assigned_to_name) map.set(r.assigned_to, r.assigned_to_name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  /**
   * Whether a target has been picked yet.
   *
   * Nothing lists until it has. Opening on 96 rows answers a question nobody
   * asked — the first decision in a campaign is always WHERE, and a wall of
   * every hostel in the country buries it. An exclusion chip counts as a
   * target too, so "show me those 15 rejected" still works in one click.
   */
  const targeted = cities.size > 0 || search.trim() !== "" || blockFilter !== null;

  const allCitiesPicked = cityOptions.length > 0 && cities.size === cityOptions.length;

  function toggleAllCities() {
    setCities(allCitiesPicked ? new Set() : new Set(cityOptions.map(([c]) => c)));
  }

  const filtersActive =
    cities.size > 0 || stage !== ANY || assignee !== ANY || search.trim() !== "" || blockFilter !== null;

  function clearFilters() {
    setCities(new Set());
    setStage(ANY);
    setAssignee(ANY);
    setSearch("");
    setBlockFilter(null);
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (view === "eligible") list = list.filter((r) => !r.blocked);
    else if (view === "sent") list = list.filter((r) => r.delivery !== null || r.blocked === "already_sent");
    else if (view === "blocked") list = list.filter((r) => !!r.blocked);

    if (blockFilter) list = list.filter((r) => r.blocked === blockFilter);

    // Empty set means "everywhere", not "nowhere" — an empty multi-select that
    // filtered everything out would look like a page with no leads.
    if (cities.size > 0) list = list.filter((r) => cities.has(canonicalCity(r.city)));
    if (stage !== ANY) list = list.filter((r) => r.status === stage);
    if (assignee === UNASSIGNED) list = list.filter((r) => !r.assigned_to);
    else if (assignee !== ANY) list = list.filter((r) => r.assigned_to === assignee);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.business_name.toLowerCase().includes(q) ||
          r.owner_name.toLowerCase().includes(q) ||
          r.phone.toLowerCase().includes(q) ||
          (r.city ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, view, blockFilter, cities, stage, assignee, search]);

  /** What "Select all" takes: everything sendable that the current filters are
   *  showing. There is no second, quieter tier any more — a lead the page calls
   *  ready is a lead this button will select. */
  const selectableIds = useMemo(
    () => (targeted ? filtered.filter((r) => !r.blocked).map((r) => r.lead_id) : []),
    [filtered, targeted]
  );

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.lead_id) && !r.blocked),
    [rows, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!template) return;
    setConfirmOpen(false);
    setSending(true);
    const res = await sendLeadCampaign(template.name, [...selected]);
    setSending(false);

    if (res.error) {
      toast({ title: "Send failed", description: res.error, variant: "destructive" });
      return;
    }
    const s = res.data!;
    toast({
      title: `Sent to ${s.sent} lead${s.sent === 1 ? "" : "s"}`,
      description: [
        s.skipped > 0 ? `${s.skipped} skipped` : null,
        s.failed > 0 ? `${s.failed} failed` : null,
        s.errors[0] ? `First error: ${s.errors[0].error}` : null,
      ].filter(Boolean).join(" · ") || "All selected leads were messaged.",
      variant: s.failed > 0 ? "destructive" : undefined,
    });
    setSelected(new Set());
    void reload();
  }

  async function toggleOptOut(row: CampaignAudienceRow) {
    const next = !row.marketing_opt_out;
    setRows((prev) =>
      prev.map((r) => (r.lead_id === row.lead_id ? { ...r, marketing_opt_out: next } : r))
    );
    const res = await setLeadMarketingOptOut(row.lead_id, next);
    if (res.error) {
      setRows((prev) =>
        prev.map((r) => (r.lead_id === row.lead_id ? { ...r, marketing_opt_out: !next } : r))
      );
      toast({ title: "Could not update", description: res.error, variant: "destructive" });
      return;
    }
    void reload();
  }

  async function toggleNotAClient(row: CampaignAudienceRow) {
    const next = !row.not_a_client;
    const res = await setLeadNotAClient(row.lead_id, next);
    if (res.error) {
      toast({ title: "Could not update", description: res.error, variant: "destructive" });
      return;
    }
    // Reloaded rather than patched: whether clearing the match actually makes
    // this lead sendable depends on every other block too, and the server is
    // the only thing that knows.
    void reload();
  }

  const readRate = stats.sent > 0 ? Math.round((stats.read / stats.sent) * 100) : 0;

  // SuperAdminShell renders {children} with no frame of its own — unlike
  // DashboardShell, which supplies the container. Every super-admin page
  // therefore pads itself, and without this the cards sit flush against
  // the sidebar.
  const shell = "p-4 sm:p-6 space-y-5";

  if (!template) {
    return (
      <div className={shell}>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-amber" />
          Marketing
        </h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <AlertTriangle className="w-10 h-10 text-amber opacity-60" />
            <p className="font-medium">No approved marketing templates</p>
            <p className="text-sm text-muted-foreground max-w-md">
              {loadError
                ?? "Approve a template in WhatsApp Manager with category Marketing and it will appear here automatically — nothing to deploy."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-amber" />
            Marketing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a campaign, choose who gets it, send.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={template.name} onValueChange={switchTemplate}>
            <SelectTrigger className="h-9 w-[240px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.name} value={t.name} disabled={!!t.unsupported}>
                  <span className="flex flex-col items-start">
                    <span>{t.name}</span>
                    {t.unsupported && (
                      <span className="text-[11px] text-muted-foreground">{t.unsupported}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" />
            Add hostel
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => void reload()} disabled={refreshing}>
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Three questions, three cards: who is getting this, who is not and why,
          and did the last one work. The strip used to carry seven numbers, two
          of which were competing counts of "ready", which is how a page ends up
          being read by nobody. */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card
          className={cn(
            "cursor-pointer transition-colors",
            tab === "eligible" && !blockFilter ? "border-amber/40" : "hover:border-white/20"
          )}
          onClick={() => { setTab("eligible"); setBlockFilter(null); }}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ready to send</p>
            <p className="text-3xl font-semibold text-amber mt-0.5">{stats.ready}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              of {stats.total} hostel{stats.total === 1 ? "" : "s"} on the list
            </p>
          </CardContent>
        </Card>

        <Card className={cn("transition-colors", tab === "blocked" ? "border-white/20" : "")}>
          <CardContent className="p-4">
            <button
              className="text-left"
              onClick={() => { setTab("blocked"); setBlockFilter(null); }}
            >
              <p className="text-xs text-muted-foreground">Excluded</p>
              <p className="text-3xl font-semibold mt-0.5">{stats.excluded}</p>
            </button>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {exclusionBreakdown.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Nobody is being held back.</p>
              ) : (
                exclusionBreakdown.map(([block, n]) => (
                  <button
                    key={block}
                    onClick={() => showExclusion(block)}
                    title={BLOCK_CONFIG[block].hint}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-100",
                      BLOCK_CONFIG[block].cls,
                      blockFilter && blockFilter !== block ? "opacity-40" : ""
                    )}
                  >
                    {n} {BLOCK_CONFIG[block].short}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">This campaign so far</p>
            {stats.sent === 0 ? (
              <>
                <p className="text-3xl font-semibold text-muted-foreground/40 mt-0.5">—</p>
                <p className="text-[11px] text-muted-foreground mt-1">Not sent yet.</p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-3 mt-0.5 flex-wrap">
                  <span className="text-3xl font-semibold">{stats.sent}</span>
                  <span className="text-sm text-blue-400">{stats.delivered} delivered</span>
                  <span className="text-sm text-emerald-400">{stats.read} read</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {readRate}% of sends were opened
                  {stats.failed > 0 && (
                    <span className="text-rose-400"> · {stats.failed} never arrived</span>
                  )}
                </p>
                {failureBreakdown.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {failureBreakdown.map(([label, n]) => (
                      <span
                        key={label}
                        className="rounded border border-rose-500/20 bg-rose-500/5 text-rose-300 px-1.5 py-0.5 text-[10px]"
                      >
                        {n} · {label}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tab bar first, so the controls under it belong to the tab you picked.
          The preview lives here now rather than in a permanent side column. */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-fit overflow-x-auto">
          {VIEW_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setTab(value); setBlockFilter(null); }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                tab === value ? "bg-amber/10 text-amber" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
          <span className="w-px bg-sidebar-border mx-1 my-1" />
          <button
            onClick={() => setTab("preview")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5",
              tab === "preview" ? "bg-amber/10 text-amber" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Eye className="w-3.5 h-3.5" />
            Message preview
          </button>
        </div>

        {tab !== "preview" && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-52">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search hostel, owner, number..."
                className="h-9 pl-9 text-sm"
              />
            </div>
            <Button
              variant={showFilters ? "secondary" : "ghost"}
              size="sm"
              className="h-9 gap-1.5 shrink-0"
              onClick={() => setShowFilters((v) => !v)}
              title="Stage and sales rep"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">More</span>
            </Button>
          </div>
        )}
      </div>

      {tab === "preview" && (
        <Card className="max-w-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground shrink-0" />
              What the hostel receives
            </CardTitle>
            <CardDescription className="text-xs mt-1 break-words">
              <code className="text-amber">{template.name}</code> · read live from Meta, so this is
              the approved wording rather than what was submitted.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-[11px] text-muted-foreground">
              {usesGreeting ? (
                <>
                  <code className="text-amber">{"{{1}}"}</code> becomes each hostel&rsquo;s greeting —
                  shown per row in the list.
                </>
              ) : (
                "No variables — every hostel receives exactly this text, with no name in it."
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 items-start">
              {/* Shaped like the real bubble — an admin comparing this against a
                  phone should not have to translate between two layouts. */}
              <div className="rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.03] overflow-hidden">
                {template.headerFormat === "IMAGE" && (
                  headerUrl && imageOk ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      // Keyed on the URL so a replacement actually repaints:
                      // same <img> element with a new src keeps the decoded
                      // frame around long enough to look like nothing happened.
                      key={headerUrl}
                      src={headerUrl}
                      alt="Campaign header"
                      className="w-full aspect-[1.91/1] object-cover"
                      // onError alone is not enough: the request usually fails
                      // before React attaches the handler, so a broken image just
                      // renders as the browser's alt-text box and the warning
                      // never appears. The ref catches that already-failed case.
                      ref={(el) => {
                        if (el && el.complete && el.naturalWidth === 0) setImageOk(false);
                      }}
                      onError={() => setImageOk(false)}
                    />
                  ) : (
                    <div className="aspect-[1.91/1] flex flex-col items-center justify-center gap-1.5 bg-rose-500/5 border-b border-rose-500/20 px-3 text-center">
                      <AlertTriangle className="w-5 h-5 text-rose-400" />
                      <p className="text-xs text-rose-400 font-medium">No header image yet</p>
                      <p className="text-[10px] text-muted-foreground">
                        This template cannot send until one is uploaded.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs mt-0.5"
                        onClick={() => headerInputRef.current?.click()}
                        disabled={uploadingHeader}
                      >
                        <ImagePlus className="w-3.5 h-3.5 mr-1.5" />
                        {uploadingHeader ? "Uploading..." : "Upload image"}
                      </Button>
                    </div>
                  )
                )}
                <div className="p-3">
                  {template.headerText && (
                    <p className="font-semibold text-[13px] mb-1.5">{template.headerText}</p>
                  )}
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed">
                    {template.body}
                  </pre>
                  {template.footer && (
                    <p className="text-[11px] text-muted-foreground mt-2">{template.footer}</p>
                  )}
                </div>
                {template.buttons.length > 0 && (
                  <div className="border-t border-white/10">
                    {template.buttons.map((b) => (
                      <span
                        key={`${b.type}-${b.label}`}
                        className="block text-center text-[13px] text-sky-400 py-2 border-b border-white/5 last:border-0"
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Header artwork is managed here rather than in the repo. The
                  file lands in a public bucket, so a new template is sendable —
                  and testable from a dev machine — the moment Meta approves it,
                  with no commit and no deploy in between. */}
              {template.headerFormat === "IMAGE" && (
                <div className="rounded-lg border border-sidebar-border bg-white/[0.02] p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium flex items-center gap-1.5">
                      <ImagePlus className="w-3.5 h-3.5 text-amber shrink-0" />
                      Header image
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => headerInputRef.current?.click()}
                        disabled={uploadingHeader}
                      >
                        {uploadingHeader ? "Uploading..." : headerUrl && imageOk ? "Replace" : "Upload"}
                      </Button>
                      {headerSource === "uploaded" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-400"
                          onClick={() => void handleHeaderRemove()}
                          disabled={uploadingHeader}
                          title="Remove the uploaded image"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {headerSource === "uploaded"
                      ? "Uploaded here. Replacing it takes effect on the next send — no deploy."
                      : headerUrl && imageOk
                        ? "Shipped inside the app. Upload one to override it without a deploy."
                        : "PNG, JPEG or WebP, up to 5 MB. 1.91:1 renders best in WhatsApp."}
                  </p>
                  <input
                    ref={headerInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleHeaderUpload(file);
                    }}
                  />
                </div>
              )}

              {/* A dry run before 50 real prospects. Writes nothing to the
                  ledger, so it stays repeatable and never burns a lead's
                  one-shot at this campaign. */}
              <div className="rounded-lg border border-sidebar-border bg-white/[0.02] p-2.5 space-y-2">
                <p className="text-[11px] font-medium flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 text-amber" />
                  Send a test first
                </p>
                <div className="flex gap-2">
                  <Input
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="03xx xxxxxxx"
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => void handleTestSend()}
                    disabled={testing || testPhone.trim().length < 10}
                  >
                    {testing ? "Sending..." : "Test"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab !== "preview" && (
        <div className="space-y-3 min-w-0">
          {/* Chips rather than a dropdown: there are six cities, targeting is
              usually two of them at once ("Lahore and Islamabad"), and a
              single-select made that two separate blasts. Counts are on the
              chip because the decision is "is this city worth a campaign?". */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <button
              onClick={toggleAllCities}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                allCitiesPicked
                  ? "bg-amber/10 text-amber border-amber/25"
                  : "border-sidebar-border text-muted-foreground hover:text-foreground"
              )}
            >
              Everywhere
            </button>
            {cityOptions.map(([c, n]) => (
              <button
                key={c}
                onClick={() => toggleCity(c)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                  cities.has(c)
                    ? "bg-amber/10 text-amber border-amber/25"
                    : "border-sidebar-border text-muted-foreground hover:text-foreground"
                )}
              >
                {c} <span className="opacity-50">{n}</span>
              </button>
            ))}
          </div>

          {/* Behind a toggle, because a city plus a search box answers almost
              every targeting question and two more permanently-open dropdowns
              were most of what made this page feel like a form. */}
          {showFilters && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger className="h-9 w-[165px] text-sm">
                  <Flag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any stage</SelectItem>
                  {stages.map((s) => (
                    <SelectItem key={s} value={s}>{LEAD_STATUS_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="h-9 w-[175px] text-sm">
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Anyone assigned</SelectItem>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {assignees.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className={cn(
            "flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between rounded-xl border border-sidebar-border bg-white/[0.02] px-3 py-2",
            !targeted && "opacity-40 pointer-events-none"
          )}>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(new Set(selectableIds))}
                disabled={selectableIds.length === 0}
              >
                Select all {selectableIds.length}
              </Button>
              {selected.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              )}
              {filtersActive && (
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5" />
                  Reset filters
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                Showing {targeted ? filtered.length : 0} of {viewRows.length}
              </span>
            </div>
            <Button
              className="gap-2 shrink-0"
              onClick={() => setConfirmOpen(true)}
              disabled={sending || selectedRows.length === 0}
            >
              <Send className="w-4 h-4" />
              {sending ? "Sending..." : `Send to ${selectedRows.length}`}
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {!targeted ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <MapPin className="w-9 h-9 mb-3 text-muted-foreground/30" />
                  <p className="font-medium">Choose where you are sending</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Pick a city above — or search for one hostel by name, owner or number.
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap justify-center mt-4">
                    {cityOptions.slice(0, 4).map(([c, n]) => (
                      <button
                        key={c}
                        onClick={() => toggleCity(c)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium border border-sidebar-border text-muted-foreground hover:text-amber hover:border-amber/25 transition-colors"
                      >
                        {c} <span className="opacity-50">{n}</span>
                      </button>
                    ))}
                    <button
                      onClick={toggleAllCities}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium border border-sidebar-border text-muted-foreground hover:text-amber hover:border-amber/25 transition-colors"
                    >
                      Everywhere <span className="opacity-50">{viewRows.length}</span>
                    </button>
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center px-4">
                  <Megaphone className="w-10 h-10 mb-3 opacity-30" />
                  <p className="font-medium">Nothing here</p>
                  <p className="text-xs mt-1">
                    {filtersActive ? "Try a different city, or reset the filters." : "Add a hostel to start building this list."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="w-10 px-4 py-3" />
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Hostel</th>
                        {usesGreeting && (
                          <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Greeting</th>
                        )}
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                        <th
                          className="text-right text-xs font-medium text-muted-foreground px-4 py-3"
                          title="A permanent suppression list. A lead marked here is never included in any campaign, now or in future."
                        >
                          Do not contact
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((row) => {
                        const block = row.blocked ? BLOCK_CONFIG[row.blocked] : null;
                        const d = row.delivery ? DELIVERY_CONFIG[row.delivery] : null;
                        const stageCfg = LEAD_STATUS_CONFIG[row.status];
                        return (
                          <tr key={row.lead_id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selected.has(row.lead_id)}
                                disabled={!!row.blocked}
                                onChange={() => toggle(row.lead_id)}
                                className="w-4 h-4 accent-amber cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="font-medium text-sm truncate max-w-[220px]">{row.business_name}</p>
                                <span className={cn("hidden sm:inline-flex shrink-0 rounded border text-[10px] font-medium px-1.5 py-0.5", stageCfg.cls)}>
                                  {stageCfg.label}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {row.owner_name} · {row.phone}
                                {row.city ? ` · ${row.city}` : ""}
                              </p>
                            </td>
                            {usesGreeting && (
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {row.greeting ? (
                                <div className="space-y-0.5">
                                  <span className="text-sm">Assalam o Alaikum <strong>{row.greeting}</strong>,</span>
                                  {row.greeting_from_business && (
                                    <p
                                      className="text-[10px] text-amber"
                                      title="No real owner name on this lead — the business name is being used instead"
                                    >
                                      business name, not a person
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-amber">— no usable name —</span>
                              )}
                            </td>
                            )}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {block && (
                                  <span
                                    title={block.hint}
                                    className={cn("inline-flex rounded border text-xs font-medium px-1.5 py-0.5", block.cls)}
                                  >
                                    {block.label}
                                  </span>
                                )}
                                {d && (
                                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium", d.cls)}>
                                    <d.icon className="w-3.5 h-3.5" />
                                    {d.label}
                                  </span>
                                )}
                                {!block && !d && (
                                  <span className="text-xs text-emerald-400">Ready</span>
                                )}
                              </div>
                              {row.block_detail && (
                                <p className="text-[10px] text-muted-foreground mt-1 max-w-[260px]">
                                  {row.block_detail}
                                </p>
                              )}
                              {/* The evidence, in words. A fuzzy match is only
                                  useful if the admin can see WHY and overrule it
                                  without leaving the page. */}
                              {row.client_match && (
                                <div className="mt-1 flex items-start gap-1.5">
                                  <p className="text-[10px] text-muted-foreground max-w-[220px]">
                                    {row.client_match}
                                    {row.not_a_client && <span className="text-emerald-400"> · cleared</span>}
                                  </p>
                                  <button
                                    onClick={() => void toggleNotAClient(row)}
                                    className="text-[10px] font-medium text-amber hover:underline shrink-0 whitespace-nowrap"
                                    title={
                                      row.not_a_client
                                        ? "Restore the block — treat this lead as an existing client again"
                                        : "Confirm this is not one of our clients and allow campaigns to reach it"
                                    }
                                  >
                                    {row.not_a_client ? "undo" : "not a client"}
                                  </button>
                                </div>
                              )}
                              {row.sent_at && (
                                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                  {formatDateTime(row.sent_at)}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-7 text-xs gap-1",
                                  row.marketing_opt_out
                                    ? "text-rose-400"
                                    : "text-muted-foreground/40 hover:text-rose-400"
                                )}
                                onClick={() => void toggleOptOut(row)}
                                title={
                                  row.marketing_opt_out
                                    ? "Currently suppressed — click to allow campaigns again"
                                    : "Suppress: never include this lead in any campaign"
                                }
                              >
                                {row.marketing_opt_out ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                                <span className="hidden sm:inline">
                                  {row.marketing_opt_out ? "Suppressed" : "Suppress"}
                                </span>
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cross-campaign, because the cards above only ever describe the template
          currently selected. Comparing v2 against v4 is the only way to know
          whether a rewrite actually did anything. */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              Campaign history
            </CardTitle>
            <CardDescription className="text-xs">
              Every blast ever sent from this page. Test sends are excluded — they never touch the ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Campaign</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Sent</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Delivered</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Read</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Failed</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden md:table-cell">Last sent</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((h) => {
                    const pct = (n: number) => (h.recipients > 0 ? Math.round((n / h.recipients) * 100) : 0);
                    return (
                      <tr key={h.campaign_key} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <code className={cn("text-xs", h.campaign_key === template.name && "text-amber")}>
                            {h.campaign_key}
                          </code>
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-medium">{h.recipients}</td>
                        <td className="px-4 py-2.5 text-right text-sm text-blue-400">
                          {h.delivered}
                          <span className="text-[10px] text-muted-foreground ml-1">{pct(h.delivered)}%</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm text-emerald-400">
                          {h.read}
                          <span className="text-[10px] text-muted-foreground ml-1">{pct(h.read)}%</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm hidden sm:table-cell">
                          <span className={cn(h.failed + h.undelivered > 0 ? "text-rose-400" : "text-muted-foreground/50")}>
                            {h.failed + h.undelivered}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                          {h.last_sent_at ? formatDateTime(h.last_sent_at) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a hostel</DialogTitle>
            <DialogDescription>
              Creates a real lead in the CRM and adds it to this campaign list. The
              same exclusions apply — if the number matches a client, it stays out.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label>Hostel name *</Label>
              <Input
                autoFocus
                placeholder="Al Madina Boys Hostel"
                value={addForm.business_name}
                onChange={(e) => setAddForm({ ...addForm, business_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp number *</Label>
              <Input
                placeholder="0321 4272165"
                value={addForm.phone}
                onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Owner name</Label>
                <Input
                  placeholder="Optional"
                  value={addForm.owner_name}
                  onChange={(e) => setAddForm({ ...addForm, owner_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input
                  placeholder="Lahore"
                  value={addForm.city}
                  onChange={(e) => setAddForm({ ...addForm, city: e.target.value })}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Without an owner name the greeting falls back to the hostel name —
              &ldquo;Assalam o Alaikum Al Madina Boys Hostel,&rdquo;.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void handleAddLead()}
              disabled={adding || addForm.business_name.trim().length < 2 || addForm.phone.trim().length < 10}
            >
              {adding ? "Adding..." : "Add to list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title={`Send to ${selectedRows.length} hostel${selectedRows.length === 1 ? "" : "s"}?`}
        description={
          `This sends "${template.name}" on WhatsApp immediately and cannot be undone. ` +
          "Each hostel can only receive this campaign once."
        }
        confirmLabel="Send now"
        onConfirm={() => void handleSend()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
