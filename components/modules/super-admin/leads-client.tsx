"use client";

import { useState, useTransition, useMemo } from "react";
import {
  Inbox, RefreshCw, Search, PhoneCall, X, CheckCircle2, Plus,
} from "lucide-react";
import {
  listLeads,
  updateLeadStatus,
  createHostelForClient,
} from "@/app/actions/super-admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import type { PlatformLead, LeadStatus } from "@/types";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<LeadStatus, { label: string; cls: string }> = {
  new:       { label: "New",       cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  contacted: { label: "Contacted", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  converted: { label: "Converted", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected:  { label: "Rejected",  cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

const STATUS_FILTERS: { value: "all" | LeadStatus; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "new",       label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "converted", label: "Converted" },
  { value: "rejected",  label: "Rejected" },
];

const emptyConvertForm = {
  hostelName: "",
  city: "",
  address: "",
};

interface Props {
  initialLeads: PlatformLead[];
}

export function SuperAdminLeadsClient({ initialLeads }: Props) {
  const [leads, setLeads] = useState<PlatformLead[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Convert dialog state
  const [convertOpen, setConvertOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<PlatformLead | null>(null);
  const [convertForm, setConvertForm] = useState(emptyConvertForm);

  async function refresh() {
    setLoading(true);
    const res = await listLeads();
    if (res.error) {
      toast({ title: "Error refreshing leads", description: res.error, variant: "destructive" });
    } else {
      setLeads(res.leads ?? []);
    }
    setLoading(false);
  }

  function handleMarkContacted(lead: PlatformLead) {
    startTransition(async () => {
      const res = await updateLeadStatus(lead.id, "contacted");
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Marked as contacted" });
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: "contacted" } : l)));
      }
    });
  }

  function handleMarkRejected(lead: PlatformLead) {
    startTransition(async () => {
      const res = await updateLeadStatus(lead.id, "rejected");
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Marked as rejected" });
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: "rejected" } : l)));
      }
    });
  }

  function openConvertDialog(lead: PlatformLead) {
    setSelectedLead(lead);
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
        setSelectedLead(null);
        refresh();
      }
    });
  }

  const filtered = useMemo(() => {
    let list = leads;
    if (statusFilter !== "all") list = list.filter((l) => l.status === statusFilter);
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
    return list;
  }, [leads, search, statusFilter]);

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
          <Button variant="ghost" size="sm" className="gap-2" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
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

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by business, owner, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Leads ({filtered.length})</CardTitle>
            <CardDescription>
              Mark leads as contacted or rejected. Convert to create the owner account and hostel.
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
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium",
                                badge.cls
                              )}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                            {formatDate(lead.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {lead.status === "new" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => handleMarkContacted(lead)}
                                  disabled={isPending}
                                >
                                  <PhoneCall className="w-3 h-3" />
                                  <span className="hidden sm:inline">Contacted</span>
                                </Button>
                              )}
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
                              {lead.status !== "rejected" && lead.status !== "converted" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 text-rose-400 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => handleMarkRejected(lead)}
                                  disabled={isPending}
                                >
                                  <X className="w-3 h-3" />
                                  <span className="hidden sm:inline">Reject</span>
                                </Button>
                              )}
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
    </div>
  );
}
