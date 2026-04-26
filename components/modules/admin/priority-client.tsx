"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Flame, Gem, Target, Star, Ban, Phone,
  ChevronDown, ChevronUp, CheckCircle2, Clock, Eye, MapPin,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import type { Prospect, ProspectStatus } from "@/types";

type WaveKey = 1 | 2 | 3 | 4;
type WaveFilter = "all" | WaveKey | "avoid";

const WAVE_CONFIG: Record<WaveKey, {
  label: string; icon: React.ElementType;
  bg: string; text: string; border: string;
  statBorder: string; statIconBg: string; statIconColor: string;
}> = {
  1: { label: "Lighthouse",     icon: Flame,  bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/40",   statBorder: "border-l-amber-500",   statIconBg: "bg-amber-500/20",   statIconColor: "text-amber-400"   },
  2: { label: "Multi-Property", icon: Gem,    bg: "bg-purple-500/15",  text: "text-purple-400",  border: "border-purple-500/40",  statBorder: "border-l-purple-500",  statIconBg: "bg-purple-500/20",  statIconColor: "text-purple-400"  },
  3: { label: "Cluster",        icon: Target, bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/40",    statBorder: "border-l-blue-500",    statIconBg: "bg-blue-500/20",    statIconColor: "text-blue-400"    },
  4: { label: "Premium",        icon: Star,   bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40", statBorder: "border-l-emerald-500", statIconBg: "bg-emerald-500/20", statIconColor: "text-emerald-400" },
};

const AVOID_CFG = { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/40" };

const STATUS_CFG: Record<ProspectStatus, { label: string; icon: React.ElementType; bg: string; text: string; border: string }> = {
  pending:   { label: "Pending",   icon: Clock,        bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/40"   },
  visited:   { label: "Visited",   icon: Eye,          bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/40"    },
  onboarded: { label: "Onboarded", icon: CheckCircle2, bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40" },
};

function WaveBadge({ p }: { p: Prospect }) {
  if (p.is_avoid) {
    return (
      <span title={p.avoid_reason ?? "Avoid"} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${AVOID_CFG.bg} ${AVOID_CFG.text} ${AVOID_CFG.border}`}>
        <Ban className="w-3 h-3" /> Skip
      </span>
    );
  }
  if (!p.wave || !(p.wave in WAVE_CONFIG)) {
    return <span className="text-muted-foreground/40 text-xs">—</span>;
  }
  const cfg = WAVE_CONFIG[p.wave as WaveKey];
  const Icon = cfg.icon;
  return (
    <span title={p.priority_reason ?? cfg.label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

interface Props {
  prospects: Prospect[];
  loading: boolean;
  onRefresh: () => void;
}

export default function PriorityClient({ prospects, loading, onRefresh }: Props) {
  const [waveFilter, setWaveFilter]   = useState<WaveFilter>("all");
  const [top5Open, setTop5Open]       = useState(true);
  const [isPending, startTransition]  = useTransition();

  function cycleStatus(p: Prospect) {
    const next: Record<ProspectStatus, ProspectStatus> = {
      pending: "visited", visited: "onboarded", onboarded: "pending",
    };
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("hms_prospects")
        .update({ status: next[p.status], updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (error) toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
      else onRefresh();
    });
  }

  const sorted = useMemo(() =>
    [...prospects].sort((a, b) => {
      const wa = a.wave ?? 999, wb = b.wave ?? 999;
      if (wa !== wb) return wa - wb;
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return a.name.localeCompare(b.name);
    }),
    [prospects]
  );

  const top5 = useMemo(() =>
    sorted.filter(p => p.status === "pending" && !p.is_avoid && p.wave != null).slice(0, 5),
    [sorted]
  );

  const filtered = useMemo(() => {
    if (waveFilter === "all")   return sorted;
    if (waveFilter === "avoid") return sorted.filter(p => p.is_avoid);
    return sorted.filter(p => p.wave === waveFilter && !p.is_avoid);
  }, [sorted, waveFilter]);

  const stats = useMemo(() => ({
    wave1: prospects.filter(p => p.wave === 1 && p.status === "pending" && !p.is_avoid).length,
    wave2: prospects.filter(p => p.wave === 2 && !p.is_avoid).length,
    wave3: prospects.filter(p => p.wave === 3 && !p.is_avoid).length,
    avoid: prospects.filter(p => p.is_avoid).length,
  }), [prospects]);

  const FILTER_CHIPS: { key: WaveFilter; label: string; activeClass: string }[] = [
    { key: "all",   label: "All",        activeClass: "bg-muted text-foreground border-border" },
    { key: 1,       label: "Wave 1 🔥",  activeClass: `${WAVE_CONFIG[1].bg} ${WAVE_CONFIG[1].text} ${WAVE_CONFIG[1].border}` },
    { key: 2,       label: "Wave 2 💎",  activeClass: `${WAVE_CONFIG[2].bg} ${WAVE_CONFIG[2].text} ${WAVE_CONFIG[2].border}` },
    { key: 3,       label: "Wave 3 🎯",  activeClass: `${WAVE_CONFIG[3].bg} ${WAVE_CONFIG[3].text} ${WAVE_CONFIG[3].border}` },
    { key: 4,       label: "Wave 4 ⭐",  activeClass: `${WAVE_CONFIG[4].bg} ${WAVE_CONFIG[4].text} ${WAVE_CONFIG[4].border}` },
    { key: "avoid", label: "Avoid ⛔",   activeClass: `${AVOID_CFG.bg} ${AVOID_CFG.text} ${AVOID_CFG.border}` },
  ];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          { label: "Wave 1 Pending", value: stats.wave1, wave: 1 as WaveKey, desc: "Call today" },
          { label: "Wave 2 Pipeline", value: stats.wave2, wave: 2 as WaveKey, desc: "Multi-property" },
          { label: "Wave 3 Clusters", value: stats.wave3, wave: 3 as WaveKey, desc: "Visit in trips" },
          { label: "Avoid List",      value: stats.avoid, wave: null,         desc: "Do not approach" },
        ] as const).map(({ label, value, wave, desc }) => {
          const cfg = wave ? WAVE_CONFIG[wave] : null;
          const Icon = cfg ? cfg.icon : Ban;
          return (
            <Card key={label} className={`border-l-4 ${cfg ? cfg.statBorder : "border-l-red-500"}`}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`p-2.5 rounded-xl shrink-0 ${cfg ? cfg.statIconBg : "bg-red-500/20"}`}>
                  <Icon className={`w-5 h-5 ${cfg ? cfg.statIconColor : "text-red-400"}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{label}</p>
                  <p className="text-3xl font-bold tracking-tight">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{desc}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Today's Top 5 */}
      <Card>
        <button
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors rounded-t-xl"
          onClick={() => setTop5Open(o => !o)}
        >
          <div className="flex items-center gap-2.5">
            <Flame className="w-4 h-4 text-amber-400" />
            <span className="font-semibold text-sm">Today's Top 5 — Call Before Lunch</span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{top5.length}</span>
          </div>
          {top5Open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {top5Open && (
          <div className="px-5 pb-5 pt-1 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 border-t border-border/50">
            {top5.length === 0 ? (
              <p className="text-sm text-muted-foreground col-span-full py-6 text-center">
                All prioritized hostels contacted — great work! 🎉
              </p>
            ) : top5.map((p, i) => {
              const waveCfg = p.wave && p.wave in WAVE_CONFIG ? WAVE_CONFIG[p.wave as WaveKey] : null;
              const WIcon = waveCfg?.icon;
              return (
                <div key={p.id} className="flex flex-col gap-2.5 p-4 rounded-xl border bg-muted/20 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-muted-foreground tabular-nums">#{i + 1}</span>
                    {waveCfg && WIcon && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${waveCfg.bg} ${waveCfg.text} ${waveCfg.border}`}>
                        <WIcon className="w-3 h-3" /> {waveCfg.label}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-sm leading-tight">{p.name}</p>
                  {p.location && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="w-3 h-3 shrink-0" /> {p.location}
                    </span>
                  )}
                  {p.phone ? (
                    <a
                      href={`tel:${p.phone}`}
                      className="flex items-center gap-2 text-sm font-mono text-blue-400 hover:text-blue-300 transition-colors py-1"
                    >
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      {p.phone}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No phone — visit in-person</span>
                  )}
                  <p className="text-[11px] text-muted-foreground/70 leading-tight mt-auto pt-2.5 border-t border-border/50">
                    Call & pitch free 60-day pilot
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Filter Chips + count */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">Filter:</span>
        {FILTER_CHIPS.map(({ key, label, activeClass }) => (
          <button
            key={String(key)}
            onClick={() => setWaveFilter(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              waveFilter === key
                ? activeClass
                : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} / {prospects.length}
        </span>
      </div>

      {/* Priority Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No hostels match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-10">#</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hostel</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Location</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Priority</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Reason</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((p, idx) => {
                  const sCfg = STATUS_CFG[p.status];
                  const SIcon = sCfg.icon;
                  const isAvoid = p.is_avoid;
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-muted/25 transition-colors ${isAvoid ? "opacity-60" : ""}`}
                    >
                      <td className="px-3 py-2.5 text-muted-foreground/50 text-xs tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className={`font-semibold text-sm leading-tight ${isAvoid ? "line-through decoration-red-400/60" : ""}`}>
                          {p.name}
                        </p>
                        {/* Mobile: wave badge inline below name */}
                        <div className="sm:hidden mt-1">
                          <WaveBadge p={p} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {p.phone ? (
                          <a
                            href={`tel:${p.phone}`}
                            className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors whitespace-nowrap font-mono"
                          >
                            {p.phone}
                          </a>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        {p.location ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                            <MapPin className="w-3 h-3 shrink-0" /> {p.location}
                          </span>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="hidden sm:block">
                          <WaveBadge p={p} />
                        </div>
                        {p.priority_score > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{p.priority_score}/100</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 hidden lg:table-cell max-w-[260px]">
                        {isAvoid ? (
                          <span className="text-xs text-red-400/80 line-clamp-2">{p.avoid_reason}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground line-clamp-2">{p.priority_reason || "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => cycleStatus(p)}
                          disabled={isPending}
                          title="Click to advance status"
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all hover:scale-105 active:scale-95 ${sCfg.bg} ${sCfg.text} ${sCfg.border}`}
                        >
                          <SIcon className="w-3 h-3" /> {sCfg.label}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
