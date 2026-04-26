"use client";

import { useEffect, useState, useTransition, useMemo, useRef } from "react";
import {
  Building2, Plus, MapPin, RefreshCw,
  Edit2, Trash2, Search, LogOut,
  CheckCircle2, Clock, Eye, Map, ChevronDown, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import type { Prospect, ProspectStatus } from "@/types";
import PriorityClient from "./priority-client";

type DialogMode = "add" | "edit" | "delete" | null;

const STATUS_CONFIG: Record<ProspectStatus, { label: string; color: string; bg: string; border: string; icon: typeof Clock }> = {
  pending:   { label: "Pending",   color: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/40",   icon: Clock },
  visited:   { label: "Visited",   color: "text-blue-400",    bg: "bg-blue-500/15",    border: "border-blue-500/40",    icon: Eye },
  onboarded: { label: "Onboarded", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", icon: CheckCircle2 },
};


const LOCATIONS = ["Clifton", "DHA", "Defence View", "Saddar", "Tariq Road", "Gulistan-e-Johar", "Gulshan-e-Iqbal"];

const emptyForm = {
  name: "",
  owner_name: "",
  phone: "",
  area: "",
  address: "",
  maps_url: "",
  location: "",
  status: "pending" as ProspectStatus,
  notes: "",
};

export default function ProspectsClient() {
  const [prospects, setProspects]   = useState<Prospect[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatusFilter]     = useState<"all" | ProspectStatus>("all");
  const [areaFilter, setAreaFilter]         = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [openDropdown, setOpenDropdown]     = useState<"area" | "status" | "location" | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selected, setSelected]     = useState<Prospect | null>(null);
  const [form, setForm]             = useState(emptyForm);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab]   = useState<"pipeline" | "priority">("pipeline");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hms_prospects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load prospects", description: error.message, variant: "destructive" });
    } else {
      setProspects((data ?? []) as Prospect[]);
    }
    setLoading(false);
  }

  function openAdd() {
    setForm(emptyForm);
    setDialogMode("add");
  }

  function openEdit(p: Prospect) {
    setSelected(p);
    setForm({
      name:       p.name,
      owner_name: p.owner_name ?? "",
      phone:      p.phone ?? "",
      area:       p.area ?? "",
      address:    p.address ?? "",
      maps_url:   p.maps_url ?? "",
      location:   p.location ?? "",
      status:     p.status,
      notes:      p.notes ?? "",
    });
    setDialogMode("edit");
  }

  function openDelete(p: Prospect) {
    setSelected(p);
    setDialogMode("delete");
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Hostel name required", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const payload = {
        name:       form.name.trim(),
        owner_name: form.owner_name.trim() || null,
        phone:      form.phone.trim() || null,
        area:       form.area.trim() || null,
        address:    form.address.trim() || null,
        maps_url:   form.maps_url.trim() || null,
        location:   form.location.trim() || null,
        status:     form.status,
        notes:      form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (dialogMode === "add") {
        const { error } = await supabase.from("hms_prospects").insert(payload);
        if (error) {
          toast({ title: "Failed to add", description: error.message, variant: "destructive" });
          return;
        }
        toast({ title: "Hostel added to pipeline" });
      } else if (dialogMode === "edit" && selected) {
        const { error } = await supabase.from("hms_prospects").update(payload).eq("id", selected.id);
        if (error) {
          toast({ title: "Failed to update", description: error.message, variant: "destructive" });
          return;
        }
        toast({ title: "Updated successfully" });
      }

      setDialogMode(null);
      load();
    });
  }

  function handleDelete() {
    if (!selected) return;
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.from("hms_prospects").delete().eq("id", selected.id);
      if (error) {
        toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Removed from pipeline" });
      setDialogMode(null);
      load();
    });
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const uniqueAreas = useMemo(() =>
    Array.from(new Set(prospects.map((p) => p.area?.trim()).filter(Boolean) as string[])).sort(),
  [prospects]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return prospects.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.owner_name ?? "").toLowerCase().includes(q) ||
        (p.area ?? "").toLowerCase().includes(q) ||
        (p.location ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").includes(q);
      const matchStatus   = statusFilter   === "all" || p.status === statusFilter;
      const matchArea     = areaFilter     === "all" || (p.area?.trim() ?? "") === areaFilter;
      const matchLocation = locationFilter === "all" || (p.location?.trim() ?? "") === locationFilter;
      return matchSearch && matchStatus && matchArea && matchLocation;
    });
  }, [prospects, search, statusFilter, areaFilter, locationFilter]);

  const stats = useMemo(() => ({
    total:     prospects.length,
    pending:   prospects.filter((p) => p.status === "pending").length,
    visited:   prospects.filter((p) => p.status === "visited").length,
    onboarded: prospects.filter((p) => p.status === "onboarded").length,
  }), [prospects]);

  function cycleStatus(p: Prospect) {
    const next: Record<ProspectStatus, ProspectStatus> = {
      pending: "visited",
      visited: "onboarded",
      onboarded: "pending",
    };
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("hms_prospects")
        .update({ status: next[p.status], updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (error) {
        toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
      } else {
        load();
      }
    });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-sidebar text-white">
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white/10">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Admin Panel</h1>
                <p className="text-white/60 text-xs">Hostel Pipeline</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:text-white hover:bg-white/10 gap-2"
                onClick={load}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                size="sm"
                className="bg-white text-sidebar hover:bg-white/90 gap-2"
                onClick={openAdd}
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Hostel</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white/80 hover:text-white hover:bg-red-500/20 gap-2"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="border-b bg-background">
        <div className="container mx-auto px-4 sm:px-6 flex gap-1 pt-1">
          {([
            { key: "pipeline" as const, label: "Pipeline" },
            { key: "priority" as const, label: "Outreach Priority" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "priority" && (
        <PriorityClient prospects={prospects} loading={loading} onRefresh={load} />
      )}

      {activeTab === "pipeline" && <div className="container mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Hostels", value: stats.total,     icon: Building2,    iconBg: "bg-blue-500/20",    iconColor: "text-blue-400",    border: "border-l-blue-500" },
            { label: "Pending",       value: stats.pending,   icon: Clock,        iconBg: "bg-amber-500/20",   iconColor: "text-amber-400",   border: "border-l-amber-500" },
            { label: "Visited",       value: stats.visited,   icon: Eye,          iconBg: "bg-indigo-500/20",  iconColor: "text-indigo-400",  border: "border-l-indigo-500" },
            { label: "Onboarded",     value: stats.onboarded, icon: CheckCircle2, iconBg: "bg-emerald-500/20", iconColor: "text-emerald-400", border: "border-l-emerald-500" },
          ].map(({ label, value, icon: Icon, iconBg, iconColor, border }) => (
            <Card key={label} className={`border-l-4 ${border}`}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`p-2.5 rounded-xl ${iconBg} shrink-0`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground font-medium">{label}</p>
                  <p className="text-3xl font-bold tracking-tight">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, owner, area, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          {(statusFilter !== "all" || areaFilter !== "all" || locationFilter !== "all") && (
            <button
              onClick={() => { setStatusFilter("all"); setAreaFilter("all"); setLocationFilter("all"); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-colors"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
          <p className="text-xs text-muted-foreground shrink-0 tabular-nums ml-auto">
            {filtered.length} / {prospects.length}
          </p>
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Building2 className="w-10 h-10 mb-3 opacity-30" />
              <p className="font-medium">No hostels found</p>
              <p className="text-sm mt-1">
                {search || statusFilter !== "all" || areaFilter !== "all" || locationFilter !== "all" ? "Try adjusting your filters" : "Add a hostel to start tracking"}
              </p>
              {!search && statusFilter === "all" && areaFilter === "all" && locationFilter === "all" && (
                <Button size="sm" className="mt-4 gap-2" onClick={openAdd}>
                  <Plus className="w-4 h-4" /> Add First Hostel
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" ref={dropdownRef as React.RefObject<HTMLTableElement>}>
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-10">#</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hostel</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Owner</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</th>
                    {/* Area filter column */}
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <div className="relative">
                        <button
                          onClick={() => setOpenDropdown(openDropdown === "area" ? null : "area")}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted ${areaFilter !== "all" ? "text-violet-400" : ""}`}
                        >
                          Area
                          <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === "area" ? "rotate-180" : ""}`} />
                          {areaFilter !== "all" && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 ml-0.5" />}
                        </button>
                        {openDropdown === "area" && (
                          <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                            <button
                              onClick={() => { setAreaFilter("all"); setOpenDropdown(null); }}
                              className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${areaFilter === "all" ? "text-foreground font-semibold" : "text-muted-foreground"}`}
                            >
                              All Areas
                            </button>
                            <div className="border-t border-border/50" />
                            {uniqueAreas.map((area) => (
                              <button
                                key={area}
                                onClick={() => { setAreaFilter(area); setOpenDropdown(null); }}
                                className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-2 ${areaFilter === area ? "text-violet-400 font-semibold" : "text-muted-foreground"}`}
                              >
                                {area}
                                {areaFilter === area && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </th>
                    {/* Location filter column */}
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <div className="relative">
                        <button
                          onClick={() => setOpenDropdown(openDropdown === "location" ? null : "location")}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted ${locationFilter !== "all" ? "text-emerald-400" : ""}`}
                        >
                          Location
                          <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === "location" ? "rotate-180" : ""}`} />
                          {locationFilter !== "all" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />}
                        </button>
                        {openDropdown === "location" && (
                          <div className="absolute top-full left-0 mt-1 z-50 min-w-[170px] rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                            <button
                              onClick={() => { setLocationFilter("all"); setOpenDropdown(null); }}
                              className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${locationFilter === "all" ? "text-foreground font-semibold" : "text-muted-foreground"}`}
                            >
                              All Locations
                            </button>
                            <div className="border-t border-border/50" />
                            {LOCATIONS.map((loc) => (
                              <button
                                key={loc}
                                onClick={() => { setLocationFilter(loc); setOpenDropdown(null); }}
                                className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-2 ${locationFilter === loc ? "text-emerald-400 font-semibold" : "text-muted-foreground"}`}
                              >
                                {loc}
                                {locationFilter === loc && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Address</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-14">Map</th>
                    {/* Status filter column */}
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <div className="relative">
                        <button
                          onClick={() => setOpenDropdown(openDropdown === "status" ? null : "status")}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted ${statusFilter !== "all" ? STATUS_CONFIG[statusFilter].color : ""}`}
                        >
                          Status
                          <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === "status" ? "rotate-180" : ""}`} />
                          {statusFilter !== "all" && <span className={`w-1.5 h-1.5 rounded-full ml-0.5 ${statusFilter === "pending" ? "bg-amber-400" : statusFilter === "visited" ? "bg-blue-400" : "bg-emerald-400"}`} />}
                        </button>
                        {openDropdown === "status" && (
                          <div className="absolute top-full left-0 mt-1 z-50 min-w-[150px] rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                            <button
                              onClick={() => { setStatusFilter("all"); setOpenDropdown(null); }}
                              className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${statusFilter === "all" ? "text-foreground font-semibold" : "text-muted-foreground"}`}
                            >
                              All Statuses
                            </button>
                            <div className="border-t border-border/50" />
                            {(["pending", "visited", "onboarded"] as ProspectStatus[]).map((s) => {
                              const cfg = STATUS_CONFIG[s];
                              const Icon = cfg.icon;
                              return (
                                <button
                                  key={s}
                                  onClick={() => { setStatusFilter(s); setOpenDropdown(null); }}
                                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2 ${statusFilter === s ? `${cfg.color} font-semibold` : "text-muted-foreground"}`}
                                >
                                  <Icon className="w-3 h-3" />
                                  {cfg.label}
                                  {statusFilter === s && <span className={`w-1.5 h-1.5 rounded-full ml-auto shrink-0 ${s === "pending" ? "bg-amber-400" : s === "visited" ? "bg-blue-400" : "bg-emerald-400"}`} />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </th>
                    <th className="w-1 px-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((p, idx) => {
                    const cfg = STATUS_CONFIG[p.status];
                    const Icon = cfg.icon;
                    const initial = p.name.charAt(0).toUpperCase();
                    const avatarColors = [
                      "bg-violet-500/20 text-violet-400",
                      "bg-cyan-500/20 text-cyan-400",
                      "bg-rose-500/20 text-rose-400",
                      "bg-orange-500/20 text-orange-400",
                      "bg-teal-500/20 text-teal-400",
                    ];
                    const avatarColor = avatarColors[idx % avatarColors.length];
                    return (
                      <tr key={p.id} className="hover:bg-muted/25 transition-colors group">
                        <td className="px-3 py-2.5 text-muted-foreground/50 text-xs tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor}`}>
                              {initial}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground leading-tight truncate max-w-[220px]">{p.name}</p>
                              {p.notes && (
                                <p className="text-[11px] text-muted-foreground truncate max-w-[220px] mt-0.5">{p.notes}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-muted-foreground">
                          {p.owner_name || <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
                          {p.phone || <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {p.area ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20 whitespace-nowrap">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {p.area}
                            </span>
                          ) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {p.location ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                              {p.location}
                            </span>
                          ) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[260px] truncate">
                          {p.address || <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {p.maps_url ? (
                            <a
                              href={p.maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
                              title="View on Google Maps"
                            >
                              <Map className="w-3.5 h-3.5" />
                            </a>
                          ) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => cycleStatus(p)}
                            disabled={isPending}
                            title="Click to advance status"
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all hover:scale-105 active:scale-95 ${cfg.bg} ${cfg.color} ${cfg.border}`}
                          >
                            <Icon className="w-3 h-3" />
                            {cfg.label}
                          </button>
                        </td>
                        <td className="px-1 py-2.5 w-1">
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={() => openEdit(p)}
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => openDelete(p)}
                              title="Delete"
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
          </Card>
        )}
      </div>}

      {/* ── Add / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogMode === "add" || dialogMode === "edit"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === "add" ? <><Plus className="w-4 h-4" /> Add Hostel</> : <><Edit2 className="w-4 h-4" /> Edit Hostel</>}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "add" ? "Add a new hostel to the pipeline." : "Update hostel details or status."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Hostel Name *</Label>
                <Input
                  placeholder="Al-Noor Hostel"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Owner Name</Label>
                <Input
                  placeholder="Muhammad Ali"
                  value={form.owner_name}
                  onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  placeholder="0300-1234567"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <select
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select location...</option>
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Area</Label>
              <Input
                placeholder="Clifton Block 5, DHA Phase 2..."
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                placeholder="Street / Block / Sector"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Google Maps URL</Label>
              <Input
                placeholder="https://maps.google.com/..."
                value={form.maps_url}
                onChange={(e) => setForm({ ...form, maps_url: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <div className="flex gap-2">
                {(["pending", "visited", "onboarded"] as ProspectStatus[]).map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={s}
                      onClick={() => setForm({ ...form, status: s })}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        form.status === s
                          ? cfg.bg
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                placeholder="Any details about this hostel..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending || !form.name.trim()}>
              {isPending ? "Saving..." : dialogMode === "add" ? "Add to Pipeline" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={dialogMode === "delete"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-4 h-4" /> Remove from Pipeline
            </DialogTitle>
            <DialogDescription>
              Remove <strong>{selected?.name}</strong> from the pipeline? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Removing..." : "Yes, Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
