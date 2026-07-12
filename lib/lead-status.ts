import { isPast, isToday, startOfDay } from "date-fns";
import type { LeadStatus } from "@/types";

// Shared between the SuperAdmin leads table and the Sales portal dashboard so
// the two views never drift (they previously had demo_done/onboarding swapped).
export const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; cls: string }> = {
  new:             { label: "New",            cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  contacted:       { label: "Contacted",      cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  follow_up:       { label: "Follow-up",      cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  demo_scheduled:  { label: "Demo Scheduled", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  demo_done:       { label: "Demo Done",      cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  onboarding:      { label: "Onboarding",     cls: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  converted:       { label: "Converted",      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected:        { label: "Rejected",       cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "new", "contacted", "follow_up", "demo_scheduled", "demo_done", "onboarding", "converted", "rejected",
];

export function followUpUrgency(dateStr: string | null): "overdue" | "today" | "future" | null {
  if (!dateStr) return null;
  const d = startOfDay(new Date(dateStr));
  if (isToday(d)) return "today";
  if (isPast(d)) return "overdue";
  return "future";
}
