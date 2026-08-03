"use client";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { REDFLAG_REASON_LABELS } from "@/types";
import type { RedflagListRow, RedflagReason, RedflagStatus } from "@/types";

const STATUS_STYLES: Record<RedflagStatus, string> = {
  reported: "bg-rose-500/10 border-rose-500/25 text-rose-400",
  resolved: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400",
};

const STATUS_LABELS: Record<RedflagStatus, string> = {
  reported: "Reported",
  resolved: "Resolved",
};

/** House tints, reused by the report dialog's picker and the registry filter so
 *  a reason is the same colour everywhere it appears. */
export const REASON_STYLES: Record<RedflagReason, string> = {
  unpaid_rent: "bg-amber/10 border-amber/25 text-amber",
  unpaid_utilities: "bg-cyan-500/10 border-cyan-500/25 text-cyan-400",
  damage: "bg-violet-500/10 border-violet-500/25 text-violet-400",
  theft: "bg-rose-500/10 border-rose-500/25 text-rose-400",
  other: "bg-white/5 border-white/10 text-muted-foreground",
};

export function RedflagReasonPill({ reason }: { reason: RedflagReason }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap",
        REASON_STYLES[reason]
      )}
    >
      {REDFLAG_REASON_LABELS[reason]}
    </span>
  );
}

export function RedflagStatusPill({ status }: { status: RedflagStatus }) {
  return (
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function MineTag() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border border-amber/25 bg-amber/10 text-amber">
      Your report
    </span>
  );
}

/** Months are only ever shown for a rent report — "2 months" next to a broken
 *  geyser or a stolen fan is noise the reader has to decode. */
function monthsLabel(row: RedflagListRow): string {
  if (row.reason !== "unpaid_rent") return "—";
  const months = row.monthsUnpaid;
  if (!months || months <= 0) return "—";
  return `${months} month${months === 1 ? "" : "s"}`;
}

interface Props {
  rows: RedflagListRow[];
  /** Absent for a read-only partner — the whole resolve affordance disappears
   *  rather than being shown and then refused by the server. */
  onResolve?: (row: RedflagListRow) => void;
}

export function RedflagTable({ rows, onResolve }: Props) {
  return (
    <>
      {/* Mobile cards (< md) */}
      <div className="md:hidden space-y-2.5">
        {rows.map((r) => (
          <div
            key={r.id}
            className={cn(
              "rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-2.5",
              r.status === "resolved" && "opacity-60"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">{r.fullName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {r.cnicMasked ?? "CNIC not given"}
                  {r.phoneMasked && <> · {r.phoneMasked}</>}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <RedflagReasonPill reason={r.reason} />
                  {r.reportedBySelf && <MineTag />}
                </div>
              </div>
              <RedflagStatusPill status={r.status} />
            </div>
            <div
              className={cn(
                "grid gap-2 pt-2 border-t border-white/5 text-center",
                r.reason === "unpaid_rent" ? "grid-cols-3" : "grid-cols-2"
              )}
            >
              <div>
                <p className="text-[10px] text-muted-foreground">Amount</p>
                <p className="text-xs font-semibold text-rose-400">{formatCurrency(r.amount)}</p>
              </div>
              {r.reason === "unpaid_rent" && (
                <div>
                  <p className="text-[10px] text-muted-foreground">Unpaid</p>
                  <p className="text-xs font-semibold">{monthsLabel(r)}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] text-muted-foreground">Reported</p>
                <p className="text-xs font-semibold">{formatDate(r.reportedAt)}</p>
              </div>
            </div>
            {r.reportedByHostelName && (
              <div className="pt-2 border-t border-white/5 flex items-baseline justify-between gap-2">
                <span className="text-[10px] text-muted-foreground shrink-0">Reported by</span>
                <span className="text-xs text-right min-w-0">
                  <span className="text-foreground/90 block truncate">{r.reportedByHostelName}</span>
                  {r.reportedByHostelPhone && (
                    <a
                      href={`tel:${r.reportedByHostelPhone.replace(/\s/g, "")}`}
                      className="text-muted-foreground hover:text-amber"
                    >
                      {r.reportedByHostelPhone}
                    </a>
                  )}
                </span>
              </div>
            )}
            {onResolve && r.reportedBySelf && r.status === "reported" && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20"
                onClick={() => onResolve(r)}
              >
                <CheckCircle2 className="w-3 h-3" /> Mark Resolved
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table (≥ md) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* Amount, Reason and Months are centred with symmetric padding.
                Edge alignment made them lean toward whichever column came next
                — a right-aligned amount sits hard against the reason pill — so
                the middle of the row read as crowded while the sides did not. */}
            <tr className="text-xs text-muted-foreground font-medium border-b border-sidebar-border whitespace-nowrap">
              <th className="text-left pb-2 pr-6">Name</th>
              <th className="text-left pb-2 pr-6">CNIC</th>
              <th className="text-left pb-2 pr-6">Phone</th>
              <th className="text-center pb-2 px-5">Amount</th>
              <th className="text-center pb-2 px-5">Reason</th>
              <th className="text-center pb-2 px-5">Months</th>
              <th className="text-left pb-2 pl-5 pr-6">Status</th>
              <th className="text-left pb-2 pr-6">Reported</th>
              <th className="text-left pb-2 pr-6">Reported by</th>
              <th className="text-right pb-2 w-0">&nbsp;</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sidebar-border/50">
            {rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-white/[0.02]", r.status === "resolved" && "opacity-60")}>
                <td className="py-2.5 pr-6">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{r.fullName}</span>
                    {r.reportedBySelf && <MineTag />}
                  </div>
                </td>
                <td className="py-2.5 pr-6 text-muted-foreground whitespace-nowrap">{r.cnicMasked ?? "—"}</td>
                <td className="py-2.5 pr-6 text-muted-foreground whitespace-nowrap">{r.phoneMasked ?? "—"}</td>
                <td className="py-2.5 px-5 text-center text-rose-400 font-semibold whitespace-nowrap">{formatCurrency(r.amount)}</td>
                <td className="py-2.5 px-5 text-center"><RedflagReasonPill reason={r.reason} /></td>
                <td className="py-2.5 px-5 text-center text-muted-foreground whitespace-nowrap">{monthsLabel(r)}</td>
                <td className="py-2.5 pl-5 pr-6"><RedflagStatusPill status={r.status} /></td>
                <td className="py-2.5 pr-6 text-muted-foreground whitespace-nowrap">{formatDate(r.reportedAt)}</td>
                {/* Named, and never masked. The disclaimer holds the reporting
                    hostel responsible for accuracy, so a reader has to be able
                    to see who filed it — and to ring them and ask. */}
                <td className="py-2.5 pr-6 whitespace-nowrap">
                  {r.reportedByHostelName ? (
                    <>
                      <div className="text-foreground/90">{r.reportedByHostelName}</div>
                      {r.reportedByHostelPhone && (
                        <a
                          href={`tel:${r.reportedByHostelPhone.replace(/\s/g, "")}`}
                          className="text-xs text-muted-foreground hover:text-amber"
                        >
                          {r.reportedByHostelPhone}
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2.5 text-right w-0">
                  {onResolve && r.reportedBySelf && r.status === "reported" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20"
                      onClick={() => onResolve(r)}
                    >
                      <CheckCircle2 className="w-3 h-3" /> Mark Resolved
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
