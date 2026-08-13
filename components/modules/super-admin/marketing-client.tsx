"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Megaphone, Search, Send, CheckCheck, Check, Clock, Ban, AlertTriangle,
  BellOff, Bell, RefreshCw, Eye, Building2, FlaskConical, Flag, User, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/hooks/use-toast";
import {
  listCampaignAudience, sendLeadCampaign, setLeadMarketingOptOut, sendCampaignTest,
} from "@/app/actions/lead-campaigns";
import type { CampaignTemplate } from "@/lib/lead-campaigns";
import { LEAD_STATUS_CONFIG } from "@/lib/lead-status";
import { formatDateTime, cn } from "@/lib/utils";
import type { CampaignAudienceRow, LeadAudienceBlock, LeadAudienceWarning } from "@/types";

// Why a lead cannot be messaged. Every one of these is re-checked server-side
// before dispatch — these labels only explain the refusal, they don't cause it.
const BLOCK_CONFIG: Record<LeadAudienceBlock, { label: string; hint: string; cls: string }> = {
  opted_out:    { label: "Opted out",     hint: "Asked not to receive marketing", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  already_sent: { label: "Already sent",  hint: "This campaign has already gone to them", cls: "bg-white/5 text-muted-foreground border-white/10" },
  no_phone:     { label: "No valid phone", hint: "Number is unusable — fix it on the lead", cls: "bg-amber/10 text-amber border-amber/20" },
  no_name:      { label: "No usable name", hint: "Would send “Assalam o Alaikum xx,” — fix the name first", cls: "bg-amber/10 text-amber border-amber/20" },
};

const WARNING_CONFIG: Record<LeadAudienceWarning, { label: string; hint: string }> = {
  converted:       { label: "Client", hint: "Already onboarded — converted through this CRM" },
  existing_client: { label: "Client?", hint: "Phone matches an existing account" },
  rejected:        { label: "Rejected", hint: "Marked rejected in the pipeline" },
};

const DELIVERY_CONFIG: Record<string, { label: string; icon: typeof Check; cls: string }> = {
  read:        { label: "Read",          icon: CheckCheck,    cls: "text-emerald-400" },
  delivered:   { label: "Delivered",     icon: CheckCheck,    cls: "text-blue-400" },
  sent:        { label: "Sent",          icon: Check,         cls: "text-muted-foreground" },
  queued:      { label: "Queued",        icon: Clock,         cls: "text-muted-foreground" },
  undelivered: { label: "Not delivered", icon: Ban,           cls: "text-amber" },
  failed:      { label: "Failed",        icon: AlertTriangle, cls: "text-rose-400" },
};

type ViewFilter = "all" | "eligible" | "sent" | "blocked";

const VIEW_FILTERS: { value: ViewFilter; label: string }[] = [
  { value: "eligible", label: "Ready to send" },
  { value: "sent", label: "Already sent" },
  { value: "blocked", label: "Excluded" },
  { value: "all", label: "All" },
];

const ANY = "__any__";
/** assigned_to is nullable, and "nobody owns this lead" is a real thing to
 *  target — a separate sentinel so it isn't confused with "no filter". */
const UNASSIGNED = "__unassigned__";

interface Props {
  initialTemplate: string | null;
  templates: CampaignTemplate[];
  initialRows: CampaignAudienceRow[];
  loadError: string | null;
}

export function MarketingClient({ initialTemplate, templates, initialRows, loadError }: Props) {
  const [templateName, setTemplateName] = useState<string | null>(initialTemplate);
  const [rows, setRows] = useState<CampaignAudienceRow[]>(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [city, setCity] = useState(ANY);
  const [stage, setStage] = useState<string>(ANY);
  const [assignee, setAssignee] = useState<string>(ANY);
  const [view, setView] = useState<ViewFilter>("eligible");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  // Flipped by the <img> ref/onError. Surfaces a missing header image here
  // rather than letting every send fail at Meta — a media-header template with
  // an unreachable image is rejected outright, not sent without a picture.
  const [imageOk, setImageOk] = useState(true);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [, startTransition] = useTransition();

  const template = useMemo(
    () => templates.find((t) => t.name === templateName) ?? null,
    [templates, templateName]
  );

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

  const stats = useMemo(() => {
    const eligible = rows.filter((r) => !r.blocked);
    const sent = rows.filter((r) => r.delivery !== null);
    return {
      total: rows.length,
      eligible: eligible.length,
      // What "Select all clean" would actually take. Reported separately
      // because eligible-but-flagged leads inflate the headline number and
      // then don't get selected, which reads as a bug.
      clean: eligible.filter((r) => r.warnings.length === 0).length,
      sent: sent.length,
      delivered: sent.filter((r) => r.delivery === "delivered" || r.delivery === "read").length,
      read: sent.filter((r) => r.delivery === "read").length,
      excluded: rows.filter((r) => r.blocked).length,
    };
  }, [rows]);

  const cities = useMemo(
    () => [...new Set(rows.map((r) => r.city).filter((c): c is string => !!c && c.trim() !== ""))].sort(),
    [rows]
  );

  // Derived from the rows rather than fetched — this only ever needs to offer
  // reps and stages that actually have leads behind them.
  const stages = useMemo(
    () => [...new Set(rows.map((r) => r.status))].sort(),
    [rows]
  );
  const assignees = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.assigned_to && r.assigned_to_name) map.set(r.assigned_to, r.assigned_to_name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtersActive = city !== ANY || stage !== ANY || assignee !== ANY || search.trim() !== "";

  function clearFilters() {
    setCity(ANY);
    setStage(ANY);
    setAssignee(ANY);
    setSearch("");
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (view === "eligible") list = list.filter((r) => !r.blocked);
    else if (view === "sent") list = list.filter((r) => r.delivery !== null || r.blocked === "already_sent");
    else if (view === "blocked") list = list.filter((r) => !!r.blocked);

    if (city !== ANY) list = list.filter((r) => r.city === city);
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
  }, [rows, view, city, stage, assignee, search]);

  // Clean = eligible AND carrying no warning. This is what "Select all" takes,
  // so a client or a rejected lead is never swept in by a single click.
  const cleanIds = useMemo(
    () => filtered.filter((r) => !r.blocked && r.warnings.length === 0).map((r) => r.lead_id),
    [filtered]
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-amber" />
            Marketing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Send an approved WhatsApp campaign to CRM leads and track who read it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={template.name} onValueChange={switchTemplate}>
            <SelectTrigger className="h-9 w-[260px] text-sm"><SelectValue /></SelectTrigger>
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
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void reload()} disabled={refreshing}>
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Read rate is the point of this strip. Delivered only proves the phone
          exists; read is the only number that says the message landed. Kept to
          one compact row so the table clears the fold. */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { label: "Leads", value: stats.total, cls: "text-foreground", note: null as string | null },
          {
            label: "Clean & ready",
            value: stats.clean,
            cls: "text-amber",
            note: stats.eligible > stats.clean ? `+${stats.eligible - stats.clean} flagged` : null,
          },
          { label: "Sent", value: stats.sent, cls: "text-foreground", note: null },
          { label: "Delivered", value: stats.delivered, cls: "text-blue-400", note: null },
          { label: "Read", value: stats.read, cls: "text-emerald-400", note: stats.sent > 0 ? `${readRate}% of sent` : null },
          { label: "Excluded", value: stats.excluded, cls: "text-muted-foreground", note: null },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground truncate">{s.label}</p>
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className={cn("text-xl font-semibold", s.cls)}>{s.value}</span>
                {s.note && <span className="text-[11px] text-muted-foreground">{s.note}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Preview is reference material, not the workspace — it gets a phone-width
          column and sticks while the table scrolls, instead of a full-width card
          that pushed every control below the fold. */}
      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        <Card className="xl:sticky xl:top-4">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Eye className="w-4 h-4 text-muted-foreground shrink-0" />
                  Message preview
                </CardTitle>
                <CardDescription className="text-xs mt-1 break-words">
                  <code className="text-amber">{template.name}</code> · {template.language} · read live from Meta
                </CardDescription>
              </div>
              <button
                onClick={() => setPreviewOpen((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
              >
                {previewOpen ? "Hide" : "Show"}
              </button>
            </div>
          </CardHeader>
          {previewOpen && (
            <CardContent className="pt-0 space-y-3">
              {/* Shaped like the real bubble — an admin comparing this against a
                  phone should not have to translate between two layouts. */}
              <div className="rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.03] overflow-hidden max-h-[55vh] overflow-y-auto">
                {template.headerFormat === "IMAGE" && template.headerImageUrl && (
                  imageOk ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={template.headerImageUrl}
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
                    <div className="aspect-[1.91/1] flex flex-col items-center justify-center gap-1 bg-rose-500/5 border-b border-rose-500/20 px-3 text-center">
                      <AlertTriangle className="w-5 h-5 text-rose-400" />
                      <p className="text-xs text-rose-400 font-medium">Header image missing</p>
                      <p className="text-[10px] text-muted-foreground break-all">{template.headerImageUrl}</p>
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

              {template.bodyParamCount === 1 ? (
                <p className="text-[11px] text-muted-foreground">
                  <code className="text-amber">{"{{1}}"}</code> becomes the greeting shown per row.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No variables — every lead receives identical text.
                </p>
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
            </CardContent>
          )}
        </Card>

        <div className="space-y-3 min-w-0">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-fit overflow-x-auto">
              {VIEW_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                    view === value ? "bg-amber/10 text-amber" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, city..."
                className="h-9 pl-9 text-sm"
              />
            </div>
          </div>

          {/* Targeting axes, separate from the view tabs above: those pick which
              SLICE of the campaign you're looking at, these pick WHO. */}
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

            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="h-9 w-[155px] text-sm">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any city</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
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

            {filtersActive && (
              <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" onClick={clearFilters}>
                <X className="w-3.5 h-3.5" />
                Clear filters
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">
              {filtered.length} of {rows.length}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between rounded-xl border border-sidebar-border bg-white/[0.02] px-3 py-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(new Set(cleanIds))}
                disabled={cleanIds.length === 0}
              >
                Select all clean ({cleanIds.length})
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Clear
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Clients and rejected leads are never swept in — tick those individually.
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
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Megaphone className="w-10 h-10 mb-3 opacity-30" />
                  <p className="font-medium">No leads in this view</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="w-10 px-4 py-3" />
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Lead</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Greeting</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Stage</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Owner</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Sent</th>
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
                        const stage = LEAD_STATUS_CONFIG[row.status];
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
                              <p className="font-medium text-sm truncate max-w-[200px]">{row.business_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {row.owner_name} · {row.phone}
                                {row.city ? ` · ${row.city}` : ""}
                              </p>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
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
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className={cn("inline-flex rounded border text-xs font-medium px-1.5 py-0.5", stage.cls)}>
                                {stage.label}
                              </span>
                            </td>
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
                                {row.warnings.map((w) => (
                                  <span
                                    key={w}
                                    title={WARNING_CONFIG[w].hint}
                                    className="inline-flex items-center gap-1 rounded border border-amber/20 bg-amber/10 text-amber text-xs font-medium px-1.5 py-0.5"
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    {WARNING_CONFIG[w].label}
                                  </span>
                                ))}
                                {!block && !d && row.warnings.length === 0 && (
                                  <span className="text-xs text-muted-foreground">Ready</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell whitespace-nowrap">
                              {row.assigned_to_name ? (
                                <span className="text-muted-foreground">{row.assigned_to_name}</span>
                              ) : (
                                <span className="text-muted-foreground/50">Unassigned</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                              {row.sent_at ? formatDateTime(row.sent_at) : "—"}
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
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Send to ${selectedRows.length} lead${selectedRows.length === 1 ? "" : "s"}?`}
        description={
          `This sends "${template.name}" on WhatsApp immediately and cannot be undone. ` +
          (selectedRows.some((r) => r.warnings.length > 0)
            ? `${selectedRows.filter((r) => r.warnings.length > 0).length} of them are flagged as an existing client or rejected. `
            : "") +
          "Each lead can only receive this campaign once."
        }
        confirmLabel="Send now"
        onConfirm={() => void handleSend()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
