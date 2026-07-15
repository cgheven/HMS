"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { isToday, startOfDay, addDays, subDays } from "date-fns";
import {
  Inbox, RefreshCw, Search, Eye, CheckCircle2, Plus, PhoneCall, MapPin,
  Presentation, StickyNote, ArrowRightLeft, MessageCircle, Mail, Send, User,
  Calendar, AlertCircle, Trash2, Flag, MailCheck,
} from "lucide-react";
import { listLeadsForAdmin, createLead, assignLead, updateLeadStage, setLeadFollowUpDate, setLeadPriority, deleteLead, sendFollowUpDigestEmail, logLeadActivity, listLeadActivities } from "@/app/actions/leads";
import { createHostelForClient } from "@/app/actions/super-admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { LEAD_SOURCES, LEAD_SOURCE_OTHER } from "@/lib/lead-sources";
import { LEAD_STATUS_CONFIG as STATUS_CONFIG, LEAD_STATUS_ORDER as STATUS_ORDER, followUpUrgency, parseDateOnly } from "@/lib/lead-status";
import { LEAD_PRIORITY_CONFIG as PRIORITY_CONFIG, LEAD_PRIORITY_ORDER as PRIORITY_ORDER } from "@/lib/lead-priority";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/utils";
import type { PlatformLead, LeadStatus, LeadPriority, LeadActivity, LeadActivityType, SalesRep } from "@/types";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { value: "all" | LeadStatus; label: string }[] = [
  { value: "all", label: "All" },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_CONFIG[s].label })),
];

const ACTIVITY_TYPE_CONFIG: Record<LeadActivityType, { label: string; icon: typeof PhoneCall }> = {
  call:          { label: "Call",          icon: PhoneCall },
  visit:         { label: "Visit",         icon: MapPin },
  demo:          { label: "Demo",          icon: Presentation },
  note:          { label: "Note",          icon: StickyNote },
  status_change: { label: "Status Change", icon: ArrowRightLeft },
  whatsapp:      { label: "WhatsApp",      icon: MessageCircle },
  email:         { label: "Email",         icon: Mail },
};

const ACTIVITY_TYPES: LeadActivityType[] = [
  "call", "visit", "demo", "note", "status_change", "whatsapp", "email",
];

type DateFilter = "all" | "today" | "week" | "month" | "custom";

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

// Filters on next_follow_up_date, independent of the "Added" date filter above —
// this is what decides which leads "Send Follow-up Email" mails out.
type FollowUpFilter = "all" | "overdue" | "today" | "week";

const FOLLOWUP_FILTERS: { value: FollowUpFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due Today" },
  { value: "week", label: "Due This Week" },
];

// Segregates the leads table by who's actually responsible for it — distinct
// from the per-row "Assigned" select, this is a table-level filter. "mine" =
// leads the admin personally added and hasn't handed off to a rep; "unclaimed"
// = nobody's claimed it yet (e.g. public onboarding-form submissions); a rep id
// = that rep's assigned leads.
// "all"/"mine"/"unclaimed" are reserved sentinels; any other value is a sales rep id.
type OwnerFilter = string;
const OWNER_ALL = "all";
const OWNER_MINE = "mine";
const OWNER_UNCLAIMED = "unclaimed";

const emptyConvertForm = {
  hostelName: "",
  city: "",
  address: "",
};

const emptyAddLeadForm = {
  business_name: "",
  owner_name: "",
  phone: "",
  email: "",
  city: "",
  branch_count: "1",
  source: "",
  sourceCustom: "",
  notes: "",
  assigned_to: "",
};

interface Props {
  initialLeads: PlatformLead[];
  salesReps: SalesRep[];
  adminUserId: string;
}

export function SuperAdminLeadsClient({ initialLeads, salesReps, adminUserId }: Props) {
  const [leads, setLeads] = useState<PlatformLead[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>(OWNER_ALL);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [sendingDigest, setSendingDigest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Convert dialog state
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertLeadId, setConvertLeadId] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState(emptyConvertForm);

  // Add Lead dialog state
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState(emptyAddLeadForm);
  const [addLeadSubmitting, setAddLeadSubmitting] = useState(false);

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; lead: PlatformLead | null }>({ open: false, lead: null });
  const [deleting, setDeleting] = useState(false);

  // Detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  // Log activity form state
  const [logType, setLogType] = useState<LeadActivityType>("call");
  const [logOutcome, setLogOutcome] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logSubmitting, setLogSubmitting] = useState(false);

  const selectedLead = useMemo(() => leads.find((l) => l.id === convertLeadId) ?? null, [leads, convertLeadId]);
  const detailLead = useMemo(() => leads.find((l) => l.id === detailLeadId) ?? null, [leads, detailLeadId]);
  // The server rejects assigning to a deactivated rep — never offer one as a NEW pick.
  const assignableReps = useMemo(() => salesReps.filter((r) => r.is_active), [salesReps]);
  // For a lead already assigned to a since-deactivated rep, still show that rep in the
  // list (labeled inactive) — otherwise the picker silently renders as "Unassigned" even
  // though the DB still has a real assignee, misleading the admin.
  function assignOptionsFor(lead: PlatformLead): SalesRep[] {
    if (lead.assigned_to && !assignableReps.some((r) => r.id === lead.assigned_to)) {
      const current = salesReps.find((r) => r.id === lead.assigned_to);
      if (current) return [...assignableReps, current];
    }
    return assignableReps;
  }

  useEffect(() => {
    if (!detailOpen || !detailLeadId) return;
    setActivitiesLoading(true);
    listLeadActivities(detailLeadId).then((res) => {
      if ("activities" in res) {
        setActivities(res.activities);
      } else {
        toast({ title: "Failed to load activity timeline", description: res.error, variant: "destructive" });
        setActivities([]);
      }
      setActivitiesLoading(false);
    });
  }, [detailOpen, detailLeadId]);

  async function refresh() {
    setLoading(true);
    const res = await listLeadsForAdmin();
    if ("error" in res) {
      toast({ title: "Error refreshing leads", description: res.error, variant: "destructive" });
    } else {
      setLeads(res.leads ?? []);
    }
    setLoading(false);
  }

  function handleAssign(lead: PlatformLead, repId: string | null) {
    const prevAssignedTo = lead.assigned_to;
    const prevSalesRep = lead.sales_rep;
    const rep = repId ? salesReps.find((r) => r.id === repId) ?? null : null;

    setLeads((prev) =>
      prev.map((l) =>
        l.id === lead.id
          ? { ...l, assigned_to: repId, sales_rep: rep ? { id: rep.id, name: rep.name } : null }
          : l
      )
    );

    startTransition(async () => {
      const res = await assignLead(lead.id, repId);
      if (res.error) {
        toast({ title: "Failed to assign lead", description: res.error, variant: "destructive" });
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id ? { ...l, assigned_to: prevAssignedTo, sales_rep: prevSalesRep } : l
          )
        );
      } else {
        toast({ title: repId ? "Lead assigned" : "Lead unassigned" });
      }
    });
  }

  function handleStageChange(lead: PlatformLead, status: LeadStatus) {
    const prevStatus = lead.status;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l)));

    startTransition(async () => {
      const res = await updateLeadStage(lead.id, status);
      if (res.error) {
        toast({ title: "Failed to update stage", description: res.error, variant: "destructive" });
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: prevStatus } : l)));
      } else {
        toast({ title: "Stage updated" });
      }
    });
  }

  function handleFollowUpChange(lead: PlatformLead, date: string | null) {
    const prevDate = lead.next_follow_up_date;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, next_follow_up_date: date } : l)));

    startTransition(async () => {
      const res = await setLeadFollowUpDate(lead.id, date);
      if (res.error) {
        toast({ title: "Failed to set follow-up date", description: res.error, variant: "destructive" });
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, next_follow_up_date: prevDate } : l)));
      } else {
        toast({ title: "Follow-up date updated" });
      }
    });
  }

  function handlePriorityChange(lead: PlatformLead, priority: LeadPriority) {
    const prevPriority = lead.priority;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, priority } : l)));

    startTransition(async () => {
      const res = await setLeadPriority(lead.id, priority);
      if (res.error) {
        toast({ title: "Failed to update priority", description: res.error, variant: "destructive" });
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, priority: prevPriority } : l)));
      } else {
        toast({ title: "Priority updated" });
      }
    });
  }

  async function handleDeleteLead() {
    if (!deleteConfirm.lead) return;
    setDeleting(true);
    const res = await deleteLead(deleteConfirm.lead.id);
    setDeleting(false);
    if (res.error) {
      toast({ title: "Failed to delete lead", description: res.error, variant: "destructive" });
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== deleteConfirm.lead!.id));
    setDeleteConfirm({ open: false, lead: null });
    if (detailLeadId === deleteConfirm.lead.id) setDetailOpen(false);
    toast({ title: "Lead deleted" });
  }

  function openDetailDialog(lead: PlatformLead) {
    setDetailLeadId(lead.id);
    setActivities([]);
    setLogType("call");
    setLogOutcome("");
    setLogNotes("");
    setDetailOpen(true);
  }

  function openConvertDialog(lead: PlatformLead) {
    setDetailOpen(false);
    setConvertLeadId(lead.id);
    setConvertForm({
      hostelName: lead.business_name,
      city: lead.city ?? "",
      address: "",
    });
    setConvertOpen(true);
  }

  function handleConvert() {
    if (!selectedLead) return;
    startTransition(async () => {
      const res = await createHostelForClient({
        ownerEmail: selectedLead.email ?? "",
        ownerName: selectedLead.owner_name,
        ownerPhone: selectedLead.phone,
        hostelName: convertForm.hostelName,
        city: convertForm.city,
        address: convertForm.address,
        leadId: selectedLead.id,
      });
      if (res.error) {
        toast({ title: "Conversion failed", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Lead converted", description: "Owner account and hostel created successfully." });
        setConvertOpen(false);
        setConvertLeadId(null);
        refresh();
      }
    });
  }

  function handleAddLead() {
    if (!addLeadForm.business_name.trim() || !addLeadForm.owner_name.trim() || !addLeadForm.phone.trim()) {
      toast({ title: "Missing required fields", description: "Business name, owner name, and phone are required.", variant: "destructive" });
      return;
    }
    setAddLeadSubmitting(true);
    const source = addLeadForm.source === LEAD_SOURCE_OTHER
      ? addLeadForm.sourceCustom.trim() || undefined
      : addLeadForm.source || undefined;
    startTransition(async () => {
      const res = await createLead({
        business_name: addLeadForm.business_name,
        owner_name: addLeadForm.owner_name,
        phone: addLeadForm.phone,
        email: addLeadForm.email || undefined,
        city: addLeadForm.city || undefined,
        branch_count: Number(addLeadForm.branch_count) || 1,
        source,
        notes: addLeadForm.notes || undefined,
        assigned_to: addLeadForm.assigned_to || null,
      });
      setAddLeadSubmitting(false);
      if ("error" in res) {
        toast({ title: "Failed to add lead", description: res.error, variant: "destructive" });
        return;
      }
      setLeads((prev) => [res.lead, ...prev]);
      setAddLeadOpen(false);
      setAddLeadForm(emptyAddLeadForm);
      toast({ title: "Lead added" });
    });
  }

  function handleLogActivity() {
    if (!detailLeadId) return;
    setLogSubmitting(true);
    startTransition(async () => {
      const res = await logLeadActivity(detailLeadId, {
        type: logType,
        outcome: logOutcome.trim() || undefined,
        notes: logNotes.trim() || undefined,
      });
      setLogSubmitting(false);
      if (res.error) {
        toast({ title: "Failed to log activity", description: res.error, variant: "destructive" });
        return;
      }
      const now = new Date().toISOString();
      const optimisticEntry: LeadActivity = {
        id: `temp-${Date.now()}`,
        lead_id: detailLeadId,
        sales_rep_id: null,
        actor_id: null,
        type: logType,
        outcome: logOutcome.trim() || null,
        notes: logNotes.trim() || null,
        occurred_at: now,
        created_at: now,
        sales_rep: null,
      };
      setActivities((prev) => [optimisticEntry, ...prev]);
      setLogOutcome("");
      setLogNotes("");
      toast({ title: "Activity logged" });
    });
  }

  const filtered = useMemo(() => {
    let list = leads;
    if (statusFilter !== "all") list = list.filter((l) => l.status === statusFilter);
    if (ownerFilter === OWNER_MINE) {
      list = list.filter((l) => !l.assigned_to && l.created_by === adminUserId);
    } else if (ownerFilter === OWNER_UNCLAIMED) {
      list = list.filter((l) => !l.assigned_to && l.created_by !== adminUserId);
    } else if (ownerFilter !== OWNER_ALL) {
      list = list.filter((l) => l.assigned_to === ownerFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.business_name.toLowerCase().includes(q) ||
          l.owner_name.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          (l.email ?? "").toLowerCase().includes(q) ||
          (l.city ?? "").toLowerCase().includes(q)
      );
    }
    if (dateFilter === "today") {
      list = list.filter((l) => isToday(new Date(l.created_at)));
    } else if (dateFilter === "week") {
      const cutoff = subDays(startOfDay(new Date()), 6);
      list = list.filter((l) => new Date(l.created_at) >= cutoff);
    } else if (dateFilter === "month") {
      const cutoff = subDays(startOfDay(new Date()), 29);
      list = list.filter((l) => new Date(l.created_at) >= cutoff);
    } else if (dateFilter === "custom") {
      // Parse as local calendar boundaries, not UTC — new Date("YYYY-MM-DD") parses
      // as UTC midnight, which shifts the effective boundary by a day west of UTC.
      if (customFrom) {
        const from = new Date(`${customFrom}T00:00:00`);
        list = list.filter((l) => new Date(l.created_at) >= from);
      }
      if (customTo) {
        const to = new Date(`${customTo}T23:59:59.999`);
        list = list.filter((l) => new Date(l.created_at) <= to);
      }
    }
    if (followUpFilter === "overdue") {
      list = list.filter((l) => followUpUrgency(l.next_follow_up_date) === "overdue");
    } else if (followUpFilter === "today") {
      list = list.filter((l) => followUpUrgency(l.next_follow_up_date) === "today");
    } else if (followUpFilter === "week") {
      const now = startOfDay(new Date());
      const weekOut = addDays(now, 7);
      list = list.filter((l) => {
        if (!l.next_follow_up_date) return false;
        const d = startOfDay(parseDateOnly(l.next_follow_up_date));
        return d >= now && d <= weekOut;
      });
    }
    return list;
  }, [leads, search, statusFilter, ownerFilter, adminUserId, dateFilter, customFrom, customTo, followUpFilter]);

  // The set "Send Follow-up Email" mails out. With no follow-up chip selected,
  // default to what's actually due (overdue + today) rather than every lead that
  // merely has a follow-up date set somewhere in the future — otherwise a stray
  // click sends a digest full of leads due next month, mislabeled as urgent.
  const followUpCandidates = useMemo(() => {
    if (followUpFilter !== "all") return filtered.filter((l) => !!l.next_follow_up_date);
    return filtered.filter((l) => {
      const urgency = followUpUrgency(l.next_follow_up_date);
      return urgency === "overdue" || urgency === "today";
    });
  }, [filtered, followUpFilter]);

  async function handleSendDigest() {
    if (followUpCandidates.length === 0) return;
    setSendingDigest(true);
    const res = await sendFollowUpDigestEmail(followUpCandidates.map((l) => l.id));
    setSendingDigest(false);
    if (res.error) {
      toast({ title: "Failed to send email", description: res.error, variant: "destructive" });
    } else {
      toast({
        title: "Follow-up email sent",
        description: `${res.sent} lead${res.sent !== 1 ? "s" : ""} across ${res.recipients} inbox${res.recipients !== 1 ? "es" : ""} (reps CC you).`,
      });
    }
  }

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: leads.length };
    for (const l of leads) {
      map[l.status] = (map[l.status] ?? 0) + 1;
    }
    return map;
  }, [leads]);

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="border-b border-sidebar-border px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
              <Inbox className="w-4 h-4 text-amber" />
            </div>
            <div>
              <h1 className="text-base font-bold">Client Leads</h1>
              <p className="text-xs text-muted-foreground">Onboarding pipeline for new hostel owners</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => setAddLeadOpen(true)}>
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Lead</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-5">
        {/* Status filter tabs */}
        <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-fit overflow-x-auto">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                statusFilter === value
                  ? "bg-amber/10 text-amber"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                statusFilter === value ? "bg-amber/20 text-amber" : "bg-muted text-muted-foreground"
              )}>
                {counts[value] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Owner segregation */}
        <div className="flex items-center gap-2">
          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OWNER_ALL}>All Leads</SelectItem>
              <SelectItem value={OWNER_MINE}>My Leads</SelectItem>
              <SelectItem value={OWNER_UNCLAIMED}>Unclaimed</SelectItem>
              {salesReps.map((rep) => (
                <SelectItem key={rep.id} value={rep.id}>
                  {rep.name}{!rep.is_active ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search + date range */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by business, owner, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">Added:</span>
            <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-fit overflow-x-auto">
              {DATE_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDateFilter(value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                    dateFilter === value
                      ? "bg-amber/10 text-amber"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {dateFilter === "custom" && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 w-36 text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-36 text-xs"
              />
            </div>
          )}
        </div>

        {/* Follow-up filter + digest email */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">Follow-up:</span>
            <div className="flex gap-1 p-1 bg-white/[0.03] border border-sidebar-border rounded-xl w-fit overflow-x-auto">
              {FOLLOWUP_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFollowUpFilter(value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                    followUpFilter === value
                      ? "bg-amber/10 text-amber"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={handleSendDigest}
            disabled={sendingDigest || followUpCandidates.length === 0}
          >
            <MailCheck className="w-4 h-4" />
            {sendingDigest
              ? "Sending..."
              : `Send Follow-up Email${followUpCandidates.length > 0 ? ` (${followUpCandidates.length})` : ""}`}
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Leads ({filtered.length})</CardTitle>
            <CardDescription>
              Assign leads to sales reps, track pipeline stage, and convert to create the owner account and hostel.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Inbox className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No leads found</p>
                <p className="text-sm mt-1">
                  {search || statusFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Leads will appear here when businesses submit the onboarding form"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Business</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Contact</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">City / Branches</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Priority</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Assigned</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Follow-up</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Date</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((lead) => {
                      const badge = STATUS_CONFIG[lead.status];
                      const canConvert = lead.status !== "converted" && lead.status !== "rejected" && !!lead.email;
                      return (
                        <tr key={lead.id} className="hover:bg-muted/20 transition-colors group">
                          <td className="px-4 py-3">
                            <p className="font-medium text-sm truncate max-w-[160px]">{lead.business_name}</p>
                            <p className="text-xs text-muted-foreground">{lead.owner_name}</p>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <p className="text-sm">{lead.phone}</p>
                            {lead.email && (
                              <p className="text-xs text-muted-foreground truncate max-w-[160px]">{lead.email}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <p className="text-sm">{lead.city ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{lead.branch_count} branch{lead.branch_count !== 1 ? "es" : ""}</p>
                            {lead.quoted_annual_price != null && (
                              <p className="text-xs text-emerald-400 font-medium">{formatCurrency(lead.quoted_annual_price)}/yr</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={lead.status}
                              onChange={(e) => handleStageChange(lead, e.target.value as LeadStatus)}
                              disabled={isPending}
                              className={cn(
                                "rounded border text-xs font-medium whitespace-nowrap px-1.5 py-1 outline-none focus:ring-1 focus:ring-amber/40 bg-transparent cursor-pointer",
                                badge.cls
                              )}
                            >
                              {STATUS_ORDER.map((s) => (
                                <option key={s} value={s} className="bg-background text-foreground">
                                  {STATUS_CONFIG[s].label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <select
                              value={lead.priority}
                              onChange={(e) => handlePriorityChange(lead, e.target.value as LeadPriority)}
                              disabled={isPending}
                              className={cn(
                                "rounded border text-xs font-medium whitespace-nowrap px-1.5 py-1 outline-none focus:ring-1 focus:ring-amber/40 bg-transparent cursor-pointer",
                                PRIORITY_CONFIG[lead.priority].cls
                              )}
                            >
                              {PRIORITY_ORDER.map((p) => (
                                <option key={p} value={p} className="bg-background text-foreground">
                                  {PRIORITY_CONFIG[p].label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <select
                              value={lead.assigned_to ?? ""}
                              onChange={(e) => handleAssign(lead, e.target.value || null)}
                              disabled={isPending}
                              className={cn(
                                "text-xs rounded-md border border-sidebar-border bg-white/[0.03] px-1.5 py-1 max-w-[130px] outline-none focus:ring-1 focus:ring-amber/40",
                                lead.assigned_to ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              <option value="">Unassigned</option>
                              {assignOptionsFor(lead).map((rep) => (
                                <option key={rep.id} value={rep.id}>{rep.name}{!rep.is_active ? " (inactive)" : ""}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell whitespace-nowrap">
                            {(() => {
                              const urgency = followUpUrgency(lead.next_follow_up_date);
                              if (!lead.next_follow_up_date) return <span className="text-xs text-muted-foreground">—</span>;
                              return (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 text-xs font-medium",
                                    urgency === "overdue" && "text-rose-400",
                                    urgency === "today" && "text-amber",
                                    urgency === "future" && "text-muted-foreground"
                                  )}
                                >
                                  {urgency === "overdue" ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
                                  {formatDate(lead.next_follow_up_date)}
                                  {urgency === "today" && " (today)"}
                                  {urgency === "overdue" && " (overdue)"}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                            {formatDate(lead.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => openDetailDialog(lead)}
                              >
                                <Eye className="w-3 h-3" />
                                <span className="hidden sm:inline">View</span>
                              </Button>
                              {canConvert && (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => openConvertDialog(lead)}
                                >
                                  <Plus className="w-3 h-3" />
                                  <span className="hidden sm:inline">Convert</span>
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-400"
                                onClick={() => setDeleteConfirm({ open: true, lead })}
                                title="Delete Lead"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
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

      {/* Add Lead Dialog */}
      <Dialog open={addLeadOpen} onOpenChange={(o) => { setAddLeadOpen(o); if (!o) setAddLeadForm(emptyAddLeadForm); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto scrollbar-thin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-amber" /> Add Lead
            </DialogTitle>
            <DialogDescription>Manually log a lead sourced from a cold call, referral, or walk-in.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Business Name *</Label>
                <Input
                  value={addLeadForm.business_name}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, business_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Owner Name *</Label>
                <Input
                  value={addLeadForm.owner_name}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, owner_name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input
                  placeholder="03XXXXXXXXX"
                  value={addLeadForm.phone}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={addLeadForm.email}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input
                  placeholder="Lahore"
                  value={addLeadForm.city}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, city: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Branches</Label>
                <Input
                  type="number"
                  min={1}
                  value={addLeadForm.branch_count}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, branch_count: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select
                  value={addLeadForm.source || "__none"}
                  onValueChange={(v) => setAddLeadForm({ ...addLeadForm, source: v === "__none" ? "" : v })}
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
              <div className="space-y-1.5">
                <Label>Assign To</Label>
                <Select
                  value={addLeadForm.assigned_to || "__unassigned"}
                  onValueChange={(v) => setAddLeadForm({ ...addLeadForm, assigned_to: v === "__unassigned" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned">Unassigned</SelectItem>
                    {assignableReps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {addLeadForm.source === LEAD_SOURCE_OTHER && (
              <div className="space-y-1.5">
                <Label>Custom Source</Label>
                <Input
                  placeholder="e.g. Trade show, WhatsApp group..."
                  value={addLeadForm.sourceCustom}
                  onChange={(e) => setAddLeadForm({ ...addLeadForm, sourceCustom: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Any context worth recording..."
                value={addLeadForm.notes}
                onChange={(e) => setAddLeadForm({ ...addLeadForm, notes: e.target.value })}
                className="min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLeadOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddLead}
              disabled={addLeadSubmitting || !addLeadForm.business_name.trim() || !addLeadForm.owner_name.trim() || !addLeadForm.phone.trim()}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              {addLeadSubmitting ? "Adding..." : "Add Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(o) => !o && setDetailOpen(false)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin">
          {detailLead && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {detailLead.business_name}
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium",
                    STATUS_CONFIG[detailLead.status].cls
                  )}>
                    {STATUS_CONFIG[detailLead.status].label}
                  </span>
                  <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium",
                    PRIORITY_CONFIG[detailLead.priority].cls
                  )}>
                    <Flag className="w-3 h-3" />
                    {PRIORITY_CONFIG[detailLead.priority].label}
                  </span>
                </DialogTitle>
                <DialogDescription>Lead details, pipeline stage, and activity history.</DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                {/* Contact info */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Owner</p>
                    <p className="font-medium">{detailLead.owner_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium">{detailLead.phone}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium">{detailLead.email ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">City</p>
                    <p className="font-medium">{detailLead.city ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Branches</p>
                    <p className="font-medium">{detailLead.branch_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Hostel Type</p>
                    <p className="font-medium capitalize">{detailLead.hostel_type ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Quoted Annual Price</p>
                    <p className="font-medium text-emerald-400">
                      {detailLead.quoted_annual_price != null ? `${formatCurrency(detailLead.quoted_annual_price)}/yr` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Source</p>
                    <p className="font-medium">{detailLead.source ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p className="font-medium">{formatDate(detailLead.created_at)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Next Follow-up</p>
                    <Input
                      type="date"
                      value={detailLead.next_follow_up_date ?? ""}
                      onChange={(e) => handleFollowUpChange(detailLead, e.target.value || null)}
                      className="h-8 text-xs"
                    />
                  </div>
                  {detailLead.notes && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Notes</p>
                      <p className="font-medium whitespace-pre-wrap">{detailLead.notes}</p>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Stage + Priority + Assign */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Pipeline Stage</Label>
                    <Select
                      value={detailLead.status}
                      onValueChange={(v) => handleStageChange(detailLead, v as LeadStatus)}
                      disabled={isPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Priority</Label>
                    <Select
                      value={detailLead.priority}
                      onValueChange={(v) => handlePriorityChange(detailLead, v as LeadPriority)}
                      disabled={isPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_ORDER.map((p) => (
                          <SelectItem key={p} value={p}>{PRIORITY_CONFIG[p].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label>Assigned Rep</Label>
                    <Select
                      value={detailLead.assigned_to ?? "__unassigned"}
                      onValueChange={(v) => handleAssign(detailLead, v === "__unassigned" ? null : v)}
                      disabled={isPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unassigned">Unassigned</SelectItem>
                        {assignOptionsFor(detailLead).map((rep) => (
                          <SelectItem key={rep.id} value={rep.id}>{rep.name}{!rep.is_active ? " (inactive)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {/* Activity timeline */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Activity Timeline</h3>
                  {activitiesLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : activities.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-3">No activity logged yet.</p>
                  ) : (
                    <div className="space-y-2.5 max-h-64 overflow-y-auto scrollbar-thin pr-1">
                      {activities.map((activity) => {
                        const config = ACTIVITY_TYPE_CONFIG[activity.type];
                        const Icon = config.icon;
                        return (
                          <div key={activity.id} className="flex gap-3 rounded-lg border border-sidebar-border bg-white/[0.02] p-3">
                            <div className="p-1.5 rounded-md bg-amber/10 border border-amber/20 h-fit">
                              <Icon className="w-3.5 h-3.5 text-amber" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-xs font-semibold">{config.label}</span>
                                {activity.outcome && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                                    {activity.outcome}
                                  </span>
                                )}
                              </div>
                              {activity.notes && (
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{activity.notes}</p>
                              )}
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                                <User className="w-2.5 h-2.5" />
                                <span>{activity.sales_rep?.name ?? (activity.sales_rep_id ? "Deleted rep" : "Admin")}</span>
                                <span>·</span>
                                <span>{formatDateTime(activity.occurred_at)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Log activity form */}
                <div className="space-y-2.5 rounded-lg border border-sidebar-border bg-white/[0.02] p-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Log Activity</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={logType} onValueChange={(v) => setLogType(v as LeadActivityType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{ACTIVITY_TYPE_CONFIG[t].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Outcome (optional)"
                      value={logOutcome}
                      onChange={(e) => setLogOutcome(e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder="Notes (optional)"
                    value={logNotes}
                    onChange={(e) => setLogNotes(e.target.value)}
                    className="min-h-[60px]"
                  />
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={handleLogActivity}
                    disabled={logSubmitting}
                  >
                    <Send className="w-3.5 h-3.5" />
                    {logSubmitting ? "Logging..." : "Log Activity"}
                  </Button>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="ghost"
                  className="text-rose-400 hover:text-rose-400 hover:bg-rose-500/10 gap-2"
                  onClick={() => setDeleteConfirm({ open: true, lead: detailLead })}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Lead
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
                  {detailLead.status !== "converted" && detailLead.status !== "rejected" && !!detailLead.email && (
                    <Button onClick={() => openConvertDialog(detailLead)} className="gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Convert Lead
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert Lead Dialog */}
      <Dialog open={convertOpen} onOpenChange={(o) => !o && setConvertOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Convert Lead
            </DialogTitle>
            <DialogDescription>
              Creates an owner account for <strong>{selectedLead?.owner_name}</strong> ({selectedLead?.email}) and the hostel below. They can log in immediately.
            </DialogDescription>
          </DialogHeader>
          {!selectedLead?.email && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
              This lead has no email address. Add an email before converting.
            </div>
          )}
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Hostel Name *</Label>
              <Input
                value={convertForm.hostelName}
                onChange={(e) => setConvertForm({ ...convertForm, hostelName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input
                placeholder="Lahore"
                value={convertForm.city}
                onChange={(e) => setConvertForm({ ...convertForm, city: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                placeholder="Street, area, city"
                value={convertForm.address}
                onChange={(e) => setConvertForm({ ...convertForm, address: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConvert}
              disabled={isPending || !selectedLead?.email || !convertForm.hostelName}
              className="gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isPending ? "Converting..." : "Convert & Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Lead"
        description={`Delete ${deleteConfirm.lead?.business_name ?? "this lead"}? This also removes its activity history and cannot be undone.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        onConfirm={handleDeleteLead}
        onCancel={() => setDeleteConfirm({ open: false, lead: null })}
      />
    </div>
  );
}
