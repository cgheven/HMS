"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Search, X, AlertTriangle, CheckCheck, Clock, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { formatDateTime, cn } from "@/lib/utils";
import type { WhatsAppLogRow, WhatsAppLogStats } from "@/app/actions/whatsapp-monitor";

const ALL = "all";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  read:        { label: "Read",        cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  delivered:   { label: "Delivered",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  sent:        { label: "Sent",        cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  queued:      { label: "Queued",      cls: "bg-white/5 text-muted-foreground border-white/10" },
  undelivered: { label: "Not delivered", cls: "bg-amber/10 text-amber border-amber/20" },
  failed:      { label: "Failed",      cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

/** Meta error codes worth translating — the raw text is not self-explanatory. */
const ERROR_HINTS: Record<number, string> = {
  131026: "Number is not on WhatsApp",
  131047: "Outside the 24-hour window — needs an approved template",
  132001: "Template name or language does not match",
  132000: "Wrong number of template parameters",
  100: "Invalid parameter sent to Meta",
  131049: "Blocked by Meta to protect user experience",
  131048: "Spam rate limit hit for this number",
};

interface Props {
  rows: WhatsAppLogRow[];
  stats: WhatsAppLogStats;
}

export function WhatsAppMonitorClient({ rows, stats }: Props) {
  const [search, setSearch] = useState("");
  const [hostel, setHostel] = useState(ALL);
  const [type, setType] = useState(ALL);
  // Problems first: this page exists to find what broke, not to admire what worked.
  const [status, setStatus] = useState("problems");

  const hostels = useMemo(
    () => [...new Set(rows.map((r) => r.hostel_name).filter(Boolean) as string[])].sort(),
    [rows]
  );
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.message_type))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (hostel !== ALL) list = list.filter((r) => r.hostel_name === hostel);
    if (type !== ALL) list = list.filter((r) => r.message_type === type);
    if (status === "problems") list = list.filter((r) => r.status === "failed" || r.status === "undelivered");
    else if (status !== ALL) list = list.filter((r) => r.status === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          (r.tenant_name ?? "").toLowerCase().includes(q) ||
          r.phone.includes(q) ||
          (r.hostel_name ?? "").toLowerCase().includes(q) ||
          (r.template ?? "").toLowerCase().includes(q) ||
          (r.error ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, search, hostel, type, status]);

  const active = search.trim() !== "" || hostel !== ALL || type !== ALL || status !== "problems";

  const tiles = [
    { label: "Delivered", value: stats.delivered, Icon: CheckCheck, cls: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { label: "Awaiting confirmation", value: stats.pending, Icon: Clock, cls: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
    { label: "Not delivered", value: stats.undelivered, Icon: Ban, cls: "text-amber", bg: "bg-amber/10 border-amber/20" },
    { label: "Failed to send", value: stats.failed, Icon: AlertTriangle, cls: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-sidebar-border px-4 sm:px-6 h-14 flex items-center">
        <div className="flex items-center gap-3 max-w-7xl mx-auto w-full">
          <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
            <MessageCircle className="w-4 h-4 text-amber" />
          </div>
          <div>
            <h1 className="text-base font-bold">WhatsApp</h1>
            <p className="text-xs text-muted-foreground">Every message sent in the last 30 days</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map(({ label, value, Icon, cls, bg }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("p-2 rounded-lg border shrink-0", bg)}>
                  <Icon className={cn("w-4 h-4", cls)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tenant, phone, hostel, error..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-2 flex-1">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-xs lg:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="problems">Problems only</SelectItem>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="undelivered">Not delivered</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={hostel} onValueChange={setHostel}>
              <SelectTrigger className="h-9 text-xs lg:w-52"><SelectValue placeholder="Hostel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All hostels</SelectItem>
                {hostels.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9 text-xs lg:w-44"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {active && (
              <button
                onClick={() => { setSearch(""); setHostel(ALL); setType(ALL); setStatus("problems"); }}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-sidebar-border text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Reset
              </button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b">
              <p className="text-sm font-semibold">
                {filtered.length}
                <span className="text-muted-foreground font-normal"> of {rows.length} messages</span>
              </p>
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <CheckCheck className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">
                  {status === "problems" ? "No failed or undelivered messages" : "No messages match"}
                </p>
                <p className="text-sm mt-1">
                  {status === "problems" ? "Everything sent in this period reached its recipient" : "Try widening the filters"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Recipient</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Hostel</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Type</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Status</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden lg:table-cell">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((r) => {
                      const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.queued;
                      const hint = r.error_code ? ERROR_HINTS[r.error_code] : undefined;
                      return (
                        <tr key={r.id} className="align-top hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium truncate max-w-[170px]">{r.tenant_name ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{r.phone}</p>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <p className="text-xs truncate max-w-[170px]">{r.hostel_name ?? "—"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs">{r.message_type}</p>
                            {r.template && (
                              <p className="text-[10px] text-muted-foreground/60 truncate max-w-[150px]">{r.template}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap", cfg.cls)}>
                              {cfg.label}
                            </span>
                            {r.error && (
                              <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px]">
                                {hint ?? r.error}
                                {hint && r.error_code ? <span className="text-muted-foreground/50"> ({r.error_code})</span> : null}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(r.created_at)}
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
    </div>
  );
}
