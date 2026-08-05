"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SalesTarget } from "@/types";

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

// Compact single-row strip, not full cards — a rep's call/visit targets matter
// but shouldn't out-weigh the leads table they sit above.
export function SalesStatsStrip({
  today, week, target,
}: {
  today: { calls: number; visits: number };
  week: { calls: number; visits: number };
  target: SalesTarget | null;
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
