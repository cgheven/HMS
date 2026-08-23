"use client";

import { useState } from "react";
import { Plus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Quick Add chip tray — collapsible on a phone, always open from sm up.
 *
 * Shared by Expenses and Kitchen because both had the same problem and the same
 * markup. Kitchen was the worse case: 18 chips wrapping to eight rows, sitting
 * between the filters and the actual entries, so a phone showed two full screens
 * of shortcuts before a single record. The chips are only useful while ADDING,
 * and most visits to either page are to review.
 *
 * The collapse is CSS at the breakpoint, and state drives only the mobile case:
 * `sm:flex` beats the collapsed `hidden`, so the tray is open on desktop
 * whatever `open` says, and the toggle hides itself there. That matters beyond
 * tidiness — reading a media query during render would make the server and the
 * client disagree on first paint, and this way there is nothing for hydration
 * to reconcile.
 */
export function QuickAddTray({
  count,
  hint,
  icon: Icon = Plus,
  iconClassName = "text-muted-foreground",
  children,
}: {
  /** How many shortcuts are hidden, shown on the collapsed mobile toggle. */
  count: number;
  /** Desktop-only aside beside the title; the toggle takes its place on mobile. */
  hint?: string;
  /** Bills marks its tray with an amber Zap rather than the default Plus. */
  icon?: LucideIcon;
  iconClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left sm:cursor-default"
        aria-expanded={open}
      >
        <Icon className={cn("w-3.5 h-3.5 shrink-0", iconClassName)} />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Add</p>
        {hint && <span className="hidden sm:inline text-xs text-muted-foreground/50">{hint}</span>}
        <span className="sm:hidden ml-auto text-xs font-medium text-amber">
          {open ? "Hide" : `Show ${count}`}
        </span>
      </button>
      <div className={cn("flex-wrap gap-2 sm:flex", open ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}
