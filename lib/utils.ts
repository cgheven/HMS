import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { pktYearMonth } from "@/lib/pkt-time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "PKR") {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

// "2026-07" -> "July 2026". A hostel owner reads a bill month, not an ISO key;
// "2026-07" in a sentence about their money reads as a serial number.
// Built from parts because new Date("2026-07") is parsed as UTC midnight, which
// in Pakistan (UTC+5) is still 30 June locally and renders as the wrong month.
export function formatMonthLong(forMonth: string) {
  const [y, m] = forMonth.split("-").map(Number);
  if (!y || !m) return forMonth;
  return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

// "2026-08-05" -> "5 August 2026". Unabbreviated, for prose telling an owner
// exactly which date to type; formatDate's "5 Aug 2026" is for dense UI.
export function formatDayLong(date: string) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatDateInput(date: Date) {
  // toISOString() converts to UTC first — in any timezone ahead of UTC (e.g.
  // Pakistan, UTC+5), that silently shifts the reported calendar day back by
  // one for hours after local midnight but before UTC catches up. Building
  // the string from the date's own local getters instead means this always
  // reflects the actual wall-clock day wherever it runs (the visitor's own
  // timezone in a browser, the server's in a server action).
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Only ever called server-side (report generation, dashboard queries) — a
// server process can be running in whatever OS timezone its host defaults to
// (Vercel's serverless functions default to UTC; a developer's own machine is
// whatever it's set to), so "this month" is anchored to Pakistan time
// (pktYearMonth) rather than the process's own local getters. Otherwise the
// exact same real-world moment computes a different month depending on which
// server happens to be running the code — which is exactly what caused local
// dev to show August while Vercel still showed July at the same instant.
export function getMonthRange(date = new Date()) {
  const { year, month } = pktYearMonth(date); // month is 1-indexed (7 = July)
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  // Date.UTC's month argument is 0-indexed, so passing the 1-indexed `month`
  // here lands one month ahead; day 0 of that rolls back to the last day of
  // the intended month — pure UTC arithmetic, safe regardless of the running
  // process's own timezone.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
