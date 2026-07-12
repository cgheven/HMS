"use client";

import { useMemo, useState } from "react";
import {
  Phone, MapPin, Presentation, FileText, RefreshCw, MessageCircle, Mail,
  Calendar, ChevronDown, ChevronUp, Target, Users, Clock, AlertCircle, Loader2, Plus,
  CheckCircle2, Flame,
} from "lucide-react";
import {
  createLead, updateLeadStage, setLeadFollowUpDate, logLeadActivity, listLeadActivities,
  type LogLeadActivityInput,
} from "@/app/actions/leads";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { LEAD_SOURCES, LEAD_SOURCE_OTHER } from "@/lib/lead-sources";
import { LEAD_STATUS_CONFIG as STATUS_CONFIG, LEAD_STATUS_ORDER as STATUS_OPTIONS, followUpUrgency } from "@/lib/lead-status";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { PlatformLead, LeadStatus, LeadActivity, LeadActivityType, SalesTarget } from "@/types";

const emptyAddLeadForm = { business_name: "", owner_name: "", phone: "", city: "", source: "", sourceCustom: "", notes: "" };

interface PerformanceData {
  today: { calls: number; visits: number };
  week: { calls: number; visits: number };
  target: SalesTarget | null;
  leadsAssigned: number;
  leadsConverted: number;
}

interface Props {
  initialLeads: PlatformLead[];
  performance: PerformanceData | null;
}

const TERMINAL_STATUSES: LeadStatus[] = ["converted", "rejected"];

const STAGE_FILTERS: { value: "active" | "all" | LeadStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  ...STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_CONFIG[s].label })),
];

const ACTIVITY_TYPE_CONFIG: Record<LeadActivityType, { label: string; icon: typeof Phone }> = {
  call:          { label: "Call",           icon: Phone },
  visit:         { label: "Visit",          icon: MapPin },
  demo:          { label: "Demo",           icon: Presentation },
  whatsapp:      { label: "WhatsApp",       icon: MessageCircle },
  email:         { label: "Email",          icon: Mail },
  note:          { label: "Note",           icon: FileText },
  status_change: { label: "Status Change",  icon: RefreshCw },
};

const ACTIVITY_TYPE_OPTIONS: LeadActivityType[] = ["call", "visit", "demo", "whatsapp", "email", "note", "status_change"];

function MiniStat({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const met = target > 0 && value >= target;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1">
        <span className="text-base font-bold text-foreground">{value}</span>
        <span className="text-[11px] text-muted-foreground truncate">
          {target > 0 ? `/${target} ${label}` : `${label} · no target`}
        </span>
      </div>
      {target > 0 && (
        <div className="h-1 rounded-full bg-white/5 overflow-hidden mt-1">
          <div
            className={cn("h-full rounded-full transition-all", met ? "bg-emerald-400" : "bg-amber")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Compact single-row strip, not two full cards — targets matter but shouldn't
// out-weigh the Today's Focus section above it.
function StatsStrip({
  today, week, target,
}: {
  today: { calls: number; visits: number }; week: { calls: number; visits: number }; target: SalesTarget | null;
}) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <MiniStat label="calls today" value={today.calls} target={target?.daily_calls_target ?? 0} />
          <MiniStat label="visits today" value={today.visits} target={target?.daily_visits_target ?? 0} />
          <MiniStat label="calls this week" value={week.calls} target={target?.weekly_calls_target ?? 0} />
          <MiniStat label="visits this week" value={week.visits} target={target?.weekly_visits_target ?? 0} />
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityTimeline({ activities, loading }: { activities: LeadActivity[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="py-4 flex items-center justify-center text-muted-foreground text-xs gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading activity...
      </div>
    );
  }
  if (!activities || activities.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">No activity logged yet.</p>;
  }
  return (
    <div className="space-y-2.5 py-2">
      {activities.map((a) => {
        const cfg = ACTIVITY_TYPE_CONFIG[a.type];
        const Icon = cfg.icon;
        return (
          <div key={a.id} className="flex items-start gap-2.5">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white/5 border border-sidebar-border shrink-0 mt-0.5">
              <Icon className="w-3 h-3 text-amber" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-medium text-foreground">{cfg.label}</p>
                {a.outcome && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                    {a.outcome}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground/70">{formatDateTime(a.occurred_at)}</span>
              </div>
              {a.notes && <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface LeadCardProps {
  lead: PlatformLead;
  expanded: boolean;
  activities: LeadActivity[] | undefined;
  loadingActivities: boolean;
  savingStage: boolean;
  onToggleExpand: () => void;
  onStageChange: (status: LeadStatus) => void;
  onLogActivity: () => void;
  onFollowUpChange: (date: string | null) => void;
}

function FollowUpBadge({
  date, onChange,
}: {
  date: string | null; onChange: (date: string | null) => void;
}) {
  const urgency = followUpUrgency(date);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Input
        type="date"
        autoFocus
        defaultValue={date ?? ""}
        onBlur={(e) => {
          setEditing(false);
          onChange(e.target.value || null);
        }}
        className="h-9 w-40 text-xs"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border active:scale-95 transition-transform",
        urgency === "overdue" && "bg-rose-500/10 text-rose-400 border-rose-500/20",
        urgency === "today" && "bg-amber/10 text-amber border-amber/20",
        (urgency === "future" || urgency === null) && "bg-white/5 text-muted-foreground border-sidebar-border"
      )}
    >
      {urgency === "overdue" ? <AlertCircle className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
      {date ? formatDate(date) : "Set follow-up"}
      {urgency === "today" && " (today)"}
      {urgency === "overdue" && " (overdue)"}
    </button>
  );
}

function LeadCard({
  lead, expanded, activities, loadingActivities, savingStage, onToggleExpand, onStageChange, onLogActivity, onFollowUpChange,
}: LeadCardProps) {
  const badge = STATUS_CONFIG[lead.status];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button className="min-w-0 text-left flex-1" onClick={onToggleExpand}>
            <p className="font-semibold text-sm text-foreground truncate">{lead.business_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{lead.owner_name}</p>
          </button>
          <span className={cn("inline-flex items-center shrink-0 px-2 py-0.5 rounded border text-[11px] font-medium", badge.cls)}>
            {badge.label}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <a
            href={`tel:${lead.phone}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber/10 border border-amber/20 text-amber text-sm font-medium active:scale-95 transition-transform"
          >
            <Phone className="w-3.5 h-3.5" />
            {lead.phone}
          </a>
          <FollowUpBadge date={lead.next_follow_up_date} onChange={onFollowUpChange} />
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Select
            value={lead.status}
            onValueChange={(v) => onStageChange(v as LeadStatus)}
            disabled={savingStage}
          >
            <SelectTrigger className="h-9 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STATUS_CONFIG[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0" onClick={onLogActivity}>
            <FileText className="w-3.5 h-3.5" />
            Log
          </Button>
          <button
            onClick={onToggleExpand}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {expanded && (
          <div className="mt-2 pt-2 border-t border-sidebar-border/50">
            <ActivityTimeline activities={activities} loading={loadingActivities} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Dense row for the "Today's Focus" list — deliberately lighter than a full
// LeadCard (no expand/activity-timeline) since this list exists to be scanned
// and acted on fast, not browsed.
function TodayFollowUpRow({
  lead, onFollowUpChange, onLogActivity,
}: {
  lead: PlatformLead; onFollowUpChange: (date: string | null) => void; onLogActivity: () => void;
}) {
  const badge = STATUS_CONFIG[lead.status];
  const urgency = followUpUrgency(lead.next_follow_up_date);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-white/[0.02] p-3">
      {urgency === "overdue" ? (
        <Flame className="w-4 h-4 text-rose-400 shrink-0" />
      ) : (
        <Clock className="w-4 h-4 text-amber shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm text-foreground truncate">{lead.business_name}</p>
          <span className={cn("inline-flex items-center shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium", badge.cls)}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{lead.owner_name}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <a
          href={`tel:${lead.phone}`}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber/10 border border-amber/20 text-amber active:scale-95 transition-transform"
        >
          <Phone className="w-3.5 h-3.5" />
        </a>
        <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" onClick={onLogActivity}>
          <FileText className="w-3.5 h-3.5" />
          Log
        </Button>
        <FollowUpBadge date={lead.next_follow_up_date} onChange={onFollowUpChange} />
      </div>
    </div>
  );
}

export function SalesDashboardClient({ initialLeads, performance }: Props) {
  const [leads, setLeads] = useState<PlatformLead[]>(initialLeads);
  const [stageFilter, setStageFilter] = useState<"active" | "all" | LeadStatus>("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activitiesMap, setActivitiesMap] = useState<Record<string, LeadActivity[]>>({});
  const [loadingActivitiesId, setLoadingActivitiesId] = useState<string | null>(null);
  const [savingStageId, setSavingStageId] = useState<string | null>(null);

  const [activityDialogLead, setActivityDialogLead] = useState<PlatformLead | null>(null);
  const [activityForm, setActivityForm] = useState<{ type: LeadActivityType; outcome: string; notes: string }>({
    type: "call", outcome: "", notes: "",
  });
  const [savingActivity, setSavingActivity] = useState(false);

  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState(emptyAddLeadForm);
  const [savingLead, setSavingLead] = useState(false);

  const filtered = useMemo(() => {
    if (stageFilter === "all") return leads;
    if (stageFilter === "active") return leads.filter((l) => !TERMINAL_STATUSES.includes(l.status));
    return leads.filter((l) => l.status === stageFilter);
  }, [leads, stageFilter]);

  // The thing a rep actually needs to act on today, independent of pipeline
  // stage — a lead sitting in "Demo Scheduled" can still have a follow-up due
  // today, and the stage-filtered list below won't surface that on its own.
  const todaysFollowUps = useMemo(() => {
    return leads
      .filter((l) => !TERMINAL_STATUSES.includes(l.status))
      .filter((l) => {
        const urgency = followUpUrgency(l.next_follow_up_date);
        return urgency === "overdue" || urgency === "today";
      })
      .sort((a, b) => (a.next_follow_up_date ?? "").localeCompare(b.next_follow_up_date ?? ""));
  }, [leads]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {
      all: leads.length,
      active: leads.filter((l) => !TERMINAL_STATUSES.includes(l.status)).length,
    };
    for (const l of leads) map[l.status] = (map[l.status] ?? 0) + 1;
    return map;
  }, [leads]);

  async function handleToggleExpand(lead: PlatformLead) {
    if (expandedId === lead.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(lead.id);
    if (!activitiesMap[lead.id]) {
      setLoadingActivitiesId(lead.id);
      const res = await listLeadActivities(lead.id);
      if ("activities" in res) {
        setActivitiesMap((prev) => ({ ...prev, [lead.id]: res.activities }));
      } else {
        toast({ title: "Failed to load activity", description: res.error, variant: "destructive" });
      }
      setLoadingActivitiesId(null);
    }
  }

  async function handleStageChange(lead: PlatformLead, status: LeadStatus) {
    const prevStatus = lead.status;
    setSavingStageId(lead.id);
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l)));

    const res = await updateLeadStage(lead.id, status);
    if (res.error) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: prevStatus } : l)));
      toast({ title: "Failed to update stage", description: res.error, variant: "destructive" });
    } else {
      toast({ title: "Stage updated", description: `${lead.business_name} → ${STATUS_CONFIG[status].label}` });
    }
    setSavingStageId(null);
  }

  async function handleFollowUpChange(lead: PlatformLead, date: string | null) {
    const prevDate = lead.next_follow_up_date;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, next_follow_up_date: date } : l)));

    const res = await setLeadFollowUpDate(lead.id, date);
    if (res.error) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, next_follow_up_date: prevDate } : l)));
      toast({ title: "Failed to set follow-up date", description: res.error, variant: "destructive" });
    } else {
      toast({ title: "Follow-up date updated" });
    }
  }

  function openActivityDialog(lead: PlatformLead) {
    setActivityDialogLead(lead);
    setActivityForm({ type: "call", outcome: "", notes: "" });
  }

  async function submitActivity() {
    if (!activityDialogLead) return;
    setSavingActivity(true);

    const input: LogLeadActivityInput = {
      type: activityForm.type,
      outcome: activityForm.outcome.trim() || undefined,
      notes: activityForm.notes.trim() || undefined,
    };

    const res = await logLeadActivity(activityDialogLead.id, input);
    if (res.error) {
      toast({ title: "Failed to log activity", description: res.error, variant: "destructive" });
    } else {
      toast({ title: "Activity logged" });
      const optimisticActivity: LeadActivity = {
        id: `optimistic-${Date.now()}`,
        lead_id: activityDialogLead.id,
        sales_rep_id: null,
        actor_id: null,
        type: input.type,
        outcome: input.outcome ?? null,
        notes: input.notes ?? null,
        occurred_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      setActivitiesMap((prev) => ({
        ...prev,
        [activityDialogLead.id]: [optimisticActivity, ...(prev[activityDialogLead.id] ?? [])],
      }));
      setActivityDialogLead(null);
    }
    setSavingActivity(false);
  }

  async function submitAddLead() {
    if (!addLeadForm.business_name.trim() || !addLeadForm.owner_name.trim() || !addLeadForm.phone.trim()) {
      toast({ title: "Missing required fields", description: "Business name, owner name, and phone are required.", variant: "destructive" });
      return;
    }
    setSavingLead(true);
    const source = addLeadForm.source === LEAD_SOURCE_OTHER
      ? addLeadForm.sourceCustom.trim() || undefined
      : addLeadForm.source || undefined;
    const res = await createLead({
      business_name: addLeadForm.business_name,
      owner_name: addLeadForm.owner_name,
      phone: addLeadForm.phone,
      city: addLeadForm.city || undefined,
      source,
      notes: addLeadForm.notes || undefined,
    });
    setSavingLead(false);
    if ("error" in res) {
      toast({ title: "Failed to add lead", description: res.error, variant: "destructive" });
      return;
    }
    setLeads((prev) => [res.lead, ...prev]);
    setAddLeadOpen(false);
    setAddLeadForm(emptyAddLeadForm);
    toast({ title: "Lead added" });
  }

  const target = performance?.target ?? null;
  const overdueCount = todaysFollowUps.filter((l) => followUpUrgency(l.next_follow_up_date) === "overdue").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
          <Target className="w-4 h-4 text-amber" />
        </div>
        <div>
          <h1 className="text-base font-bold">My Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {performance ? `${performance.leadsAssigned} leads · ${performance.leadsConverted} converted` : "Targets and leads"}
            {todaysFollowUps.length > 0 && (
              <span className={overdueCount > 0 ? "text-rose-400" : "text-amber"}>
                {" · "}{todaysFollowUps.length} due today
              </span>
            )}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          {todaysFollowUps.length > 0 ? (
            <Flame className="w-4 h-4 text-rose-400" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          <h2 className="text-sm font-semibold text-foreground">Today's Focus</h2>
        </div>
        {todaysFollowUps.length === 0 ? (
          <div className="rounded-xl border border-sidebar-border bg-white/[0.02] py-6 text-center">
            <p className="text-sm text-muted-foreground">You're all caught up — no follow-ups due today.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {todaysFollowUps.map((lead) => (
              <TodayFollowUpRow
                key={lead.id}
                lead={lead}
                onFollowUpChange={(date) => handleFollowUpChange(lead, date)}
                onLogActivity={() => openActivityDialog(lead)}
              />
            ))}
          </div>
        )}
      </div>

      <StatsStrip
        today={{ calls: performance?.today.calls ?? 0, visits: performance?.today.visits ?? 0 }}
        week={{ calls: performance?.week.calls ?? 0, visits: performance?.week.visits ?? 0 }}
        target={target}
      />

      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">My Leads</h2>
          </div>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setAddLeadOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            New Lead
          </Button>
        </div>

        <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-full overflow-x-auto">
          {STAGE_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStageFilter(value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0",
                stageFilter === value
                  ? "bg-amber/10 text-amber"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                  stageFilter === value ? "bg-amber/20 text-amber" : "bg-muted text-muted-foreground"
                )}
              >
                {counts[value] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-2.5 mt-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Clock className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-sm font-medium">No leads here</p>
              <p className="text-xs mt-1">Try a different filter</p>
            </div>
          ) : (
            filtered.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                expanded={expandedId === lead.id}
                activities={activitiesMap[lead.id]}
                loadingActivities={loadingActivitiesId === lead.id}
                savingStage={savingStageId === lead.id}
                onToggleExpand={() => handleToggleExpand(lead)}
                onStageChange={(status) => handleStageChange(lead, status)}
                onLogActivity={() => openActivityDialog(lead)}
                onFollowUpChange={(date) => handleFollowUpChange(lead, date)}
              />
            ))
          )}
        </div>
      </div>

      <Dialog open={!!activityDialogLead} onOpenChange={(o) => !o && setActivityDialogLead(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
            <DialogDescription>
              {activityDialogLead?.business_name} — {activityDialogLead?.owner_name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={activityForm.type}
                onValueChange={(v) => setActivityForm((f) => ({ ...f, type: v as LeadActivityType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACTIVITY_TYPE_CONFIG[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Outcome (optional)</Label>
              <Input
                placeholder="e.g. Interested, No answer, Reschedule"
                value={activityForm.outcome}
                onChange={(e) => setActivityForm((f) => ({ ...f, outcome: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="What happened?"
                value={activityForm.notes}
                onChange={(e) => setActivityForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivityDialogLead(null)}>
              Cancel
            </Button>
            <Button onClick={submitActivity} disabled={savingActivity} className="gap-2">
              {savingActivity ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {savingActivity ? "Saving..." : "Save Activity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addLeadOpen} onOpenChange={(o) => { setAddLeadOpen(o); if (!o) setAddLeadForm(emptyAddLeadForm); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Lead</DialogTitle>
            <DialogDescription>Found a prospect on a visit or call? Log it here — it'll be assigned to you.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label>Business Name *</Label>
              <Input
                value={addLeadForm.business_name}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, business_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Owner Name *</Label>
              <Input
                value={addLeadForm.owner_name}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, owner_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input
                placeholder="03XXXXXXXXX"
                value={addLeadForm.phone}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input
                placeholder="Lahore"
                value={addLeadForm.city}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select
                value={addLeadForm.source || "__none"}
                onValueChange={(v) => setAddLeadForm((f) => ({ ...f, source: v === "__none" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  <SelectItem value={LEAD_SOURCE_OTHER}>{LEAD_SOURCE_OTHER}...</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addLeadForm.source === LEAD_SOURCE_OTHER && (
              <div className="space-y-1.5">
                <Label>Custom Source</Label>
                <Input
                  placeholder="e.g. Trade show, WhatsApp group..."
                  value={addLeadForm.sourceCustom}
                  onChange={(e) => setAddLeadForm((f) => ({ ...f, sourceCustom: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="What happened?"
                value={addLeadForm.notes}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLeadOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitAddLead}
              disabled={savingLead || !addLeadForm.business_name.trim() || !addLeadForm.owner_name.trim() || !addLeadForm.phone.trim()}
              className="gap-2"
            >
              {savingLead ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {savingLead ? "Adding..." : "Add Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
