import type { LeadPriority } from "@/types";

export const LEAD_PRIORITY_CONFIG: Record<LeadPriority, { label: string; cls: string }> = {
  high:   { label: "High",   cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  medium: { label: "Medium", cls: "bg-amber/10 text-amber border-amber/20" },
  low:    { label: "Low",    cls: "bg-white/5 text-muted-foreground border-sidebar-border" },
};

export const LEAD_PRIORITY_ORDER: LeadPriority[] = ["high", "medium", "low"];
