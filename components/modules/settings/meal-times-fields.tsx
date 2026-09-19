"use client";

import type { MealTimes } from "@/types";

// Meal times are stored and rendered verbatim as a display string ("7:00 AM"):
// welcome email, WhatsApp welcome and the admission PDF all print `${from} - ${to}`.
// This picker keeps that exact format so existing data stays valid — it just
// replaces the free-text inputs with hour / minute / AM–PM dropdowns so owners
// can't type an ambiguous time.

const MEALS = [
  { key: "breakfast" as const, label: "Breakfast" },
  { key: "lunch" as const, label: "Lunch" },
  { key: "dinner" as const, label: "Dinner" },
];
type MealKey = (typeof MEALS)[number]["key"];

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
const MERIDIEMS = ["AM", "PM"];

type Parts = { h: string; m: string; ap: string };

function parseTime(value?: string): Parts {
  const str = (value ?? "").trim();
  if (!str) return { h: "", m: "00", ap: "AM" };
  const m = str.match(/(\d{1,2})\s*[:.]?\s*(\d{1,2})?\s*(am|pm)?/i);
  if (!m) return { h: "", m: "00", ap: "AM" };
  let hour = parseInt(m[1], 10);
  let min = m[2] ? String(parseInt(m[2], 10)).padStart(2, "0") : "00";
  let ap = (m[3] || "").toUpperCase();
  if (ap) {
    if (hour === 0) hour = 12;
    if (hour > 12) hour -= 12;
  } else {
    // 24-hour legacy value with no AM/PM.
    ap = hour >= 12 ? "PM" : "AM";
    if (hour === 0) hour = 12;
    else if (hour > 12) hour -= 12;
  }
  if (Number.isNaN(hour) || hour < 1 || hour > 12) return { h: "", m: "00", ap: "AM" };
  return { h: String(hour), m: min, ap };
}

function build(parts: Parts): string {
  return parts.h ? `${parts.h}:${parts.m} ${parts.ap}` : "";
}

const selectCls =
  "h-9 rounded-md border border-white/10 bg-white/5 px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40";

function TimeGroup({ value, onChange }: { value?: string; onChange: (next: string) => void }) {
  const parts = parseTime(value);
  // Keep a legacy minute (e.g. "07") selectable even if it isn't a 5-min step.
  const minuteOptions = MINUTES.includes(parts.m) ? MINUTES : [parts.m, ...MINUTES];
  const set = (patch: Partial<Parts>) => onChange(build({ ...parts, ...patch }));

  return (
    <div className="flex items-center gap-1">
      <select aria-label="Hour" className={selectCls} value={parts.h} onChange={(e) => set({ h: e.target.value })}>
        <option value="">--</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-muted-foreground">:</span>
      <select aria-label="Minute" className={selectCls} value={parts.m} disabled={!parts.h} onChange={(e) => set({ m: e.target.value })}>
        {minuteOptions.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select aria-label="AM or PM" className={selectCls} value={parts.ap} disabled={!parts.h} onChange={(e) => set({ ap: e.target.value })}>
        {MERIDIEMS.map((ap) => (
          <option key={ap} value={ap}>{ap}</option>
        ))}
      </select>
    </div>
  );
}

export function MealTimesFields({
  value,
  onChange,
}: {
  value: MealTimes;
  onChange: (meal: MealKey, side: "from" | "to", next: string) => void;
}) {
  return (
    <div className="space-y-3">
      {MEALS.map(({ key, label }) => (
        <div key={key} className="space-y-1.5">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className="flex flex-wrap items-center gap-2">
            <TimeGroup value={value[key]?.from} onChange={(next) => onChange(key, "from", next)} />
            <span className="text-xs text-muted-foreground">to</span>
            <TimeGroup value={value[key]?.to} onChange={(next) => onChange(key, "to", next)} />
          </div>
        </div>
      ))}
    </div>
  );
}
