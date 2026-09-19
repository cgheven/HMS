"use client";

import { useState } from "react";
import { Clapperboard, Loader2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { removeSampleData } from "@/app/actions/demo-data";

// Shown across the dashboard whenever the ACTIVE branch is the sample-data demo,
// so it's never mistaken for real data and is one click to remove.
export function DemoBanner() {
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    const res = await removeSampleData();
    if (res.success) {
      // Full navigation so the re-pointed active-branch cookie is committed before
      // the dashboard re-renders (same reason branch switching uses window.location).
      window.location.href = "/dashboard";
    } else {
      toast({ title: res.error ?? "Could not remove sample data", variant: "destructive" });
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber/30 bg-amber/10 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 min-w-0">
        <Clapperboard className="h-4 w-4 shrink-0 text-amber" />
        <span>
          <span className="font-semibold">You&apos;re viewing sample data.</span>{" "}
          <span className="text-muted-foreground">Explore freely — nothing here is real, and it&apos;s not billed.</span>
        </span>
      </div>
      <button
        onClick={remove}
        disabled={removing}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-amber/30 px-3 py-1.5 text-xs font-medium text-amber transition-colors hover:bg-amber/10 disabled:opacity-50 sm:self-auto"
      >
        {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        {removing ? "Removing…" : "Remove sample data"}
      </button>
    </div>
  );
}
