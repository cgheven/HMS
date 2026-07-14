"use client";

import { useState, useCallback, useEffect } from "react";
import { Home, Banknote, LogOut, AlertCircle, Clock, ChevronDown, FileText, Loader2, ArrowLeftRight, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getTenantTimeline, createInvoiceLink, type TimelineEvent } from "@/app/actions/tenants";
import { toast } from "@/hooks/use-toast";
import type { Tenant, Room, PackageTier, TenantDocument } from "@/types";
import { DocumentManager } from "./document-manager";

const PACKAGE_TIER_LABELS: Record<PackageTier, string> = {
  space_only: "Space Only",
  space_food: "Space + 2 Meals",
  space_3meals: "Space + 3 Meals",
  space_food_ac: "Space + Meals + AC",
  space_meals_cooler: "Space + Meals + Cooler",
};

const PACKAGE_TIER_SHORT: Record<PackageTier, string> = {
  space_only: "Space",
  space_food: "Food",
  space_3meals: "3 Meals",
  space_food_ac: "AC",
  space_meals_cooler: "Cooler",
};

const DEFAULT_SHOW = 12;

interface Props {
  tenant: Tenant;
  room: Room | null;
  open: boolean;
  onClose: () => void;
}

export function EventIcon({ type }: { type: TimelineEvent["type"] }) {
  switch (type) {
    case "joined":
      return <Home className="w-4 h-4 text-emerald-400" />;
    case "payment":
      return <Banknote className="w-4 h-4 text-emerald-400" />;
    case "check_out":
      return <LogOut className="w-4 h-4 text-rose-400" />;
    case "package_changed":
      return <AlertCircle className="w-4 h-4 text-blue-400" />;
    case "room_changed":
      return <ArrowLeftRight className="w-4 h-4 text-blue-400" />;
    case "deposit_collected":
      return <Wallet className="w-4 h-4 text-emerald-400" />;
    case "deposit_returned":
      return <Wallet className="w-4 h-4 text-blue-400" />;
    case "deposit_forfeited":
      return <Wallet className="w-4 h-4 text-rose-400" />;
    case "pending":
      return <Clock className="w-4 h-4 text-amber/70" />;
    case "status_change":
    default:
      return <Clock className="w-4 h-4 text-amber" />;
  }
}

export function eventDotColor(type: TimelineEvent["type"]): string {
  switch (type) {
    case "joined":        return "bg-emerald-500 border-emerald-400";
    case "payment":       return "bg-emerald-600 border-emerald-400";
    case "check_out":     return "bg-rose-500 border-rose-400";
    case "package_changed": return "bg-blue-500 border-blue-400";
    case "room_changed":  return "bg-blue-500 border-blue-400";
    case "deposit_collected": return "bg-emerald-600 border-emerald-400";
    case "deposit_returned":  return "bg-blue-500 border-blue-400";
    case "deposit_forfeited": return "bg-rose-500 border-rose-400";
    case "pending":       return "bg-amber/30 border-amber/50";
    case "status_change":
    default:              return "bg-amber border-amber/60";
  }
}

export function TenantTimeline({ tenant, room, open, onClose }: Props) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null);
  const [localDocs, setLocalDocs] = useState<TenantDocument[]>(tenant.documents ?? []);

  // Sync documents when a different tenant is selected without unmounting
  useEffect(() => {
    setLocalDocs(tenant.documents ?? []);
    setLoaded(false);
    setEvents(null);
    setShowAll(false);
  }, [tenant.id]);

  const load = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    const result = await getTenantTimeline(tenant.id);
    if (result.error) {
      toast({ title: "Failed to load history", description: result.error, variant: "destructive" });
    } else {
      setEvents(result.events ?? []);
    }
    setLoaded(true);
    setLoading(false);
  }, [tenant.id, loaded]);

  function handleOpenChange(o: boolean) {
    if (o && !loaded) load();
    if (!o) onClose();
  }

  async function openReceipt(paymentId: string) {
    setGeneratingReceipt(paymentId);
    const result = await createInvoiceLink(paymentId);
    setGeneratingReceipt(null);
    if (result.error) {
      toast({ title: "Failed to open receipt", description: result.error, variant: "destructive" });
      return;
    }
    window.open(`/r/${result.token}`, "_blank", "noopener,noreferrer");
  }

  const totalPaid = (events ?? [])
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + (e.amount ?? 0), 0);

  const displayed = events
    ? showAll
      ? events
      : events.slice(0, DEFAULT_SHOW)
    : [];

  const initials = tenant.full_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>Tenant History</DialogTitle>
        </DialogHeader>

        {/* Header: photo + identity */}
        <div className="flex items-center gap-4 py-2">
          <div className="w-16 h-16 rounded-full shrink-0 overflow-hidden border-2 border-amber/30 bg-amber/10 flex items-center justify-center">
            {tenant.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.photo_url} alt={tenant.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-amber">{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-semibold text-foreground">{tenant.full_name}</p>
              <Badge variant="secondary" className="text-xs capitalize">
                {PACKAGE_TIER_LABELS[tenant.package_tier ?? "space_only"]}
              </Badge>
            </div>
            {tenant.phone && <p className="text-xs text-muted-foreground mt-0.5">{tenant.phone}</p>}
            {room && (
              <p className="text-xs text-muted-foreground">
                Room {room.room_number}{tenant.bed_number ? ` · Bed ${tenant.bed_number}` : ""}
              </p>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-sidebar-border bg-card/50 p-3">
          {[
            { label: "Check-in", value: tenant.check_in ? formatDate(tenant.check_in) : "—" },
            { label: "Total Paid", value: formatCurrency(totalPaid) },
            {
              label: "Package",
              value: PACKAGE_TIER_SHORT[tenant.package_tier ?? "space_only"] ?? "—",
            },
            {
              label: "Room",
              value: room ? `Room ${room.room_number}` : "—",
            },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Verification Documents (with upload) */}
        <div className="mt-4">
          <DocumentManager
            tenantId={tenant.id}
            tenantName={tenant.full_name}
            documents={localDocs}
            onChange={setLocalDocs}
          />
        </div>

        {/* Timeline */}
        <div className="mt-4 border-t border-sidebar-border pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Timeline</p>

          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              Loading history…
            </div>
          )}

          {!loading && events !== null && events.length === 0 && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              No history events yet.
            </div>
          )}

          {!loading && displayed.length > 0 && (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/10" />

              <div className="space-y-4 pl-8">
                {displayed.map((event) => (
                  <div key={event.id} className="relative">
                    {/* Dot */}
                    <div
                      className={`absolute -left-[21px] top-0.5 w-3 h-3 rounded-full border-2 flex items-center justify-center ${eventDotColor(event.type)}`}
                    >
                      <span className="sr-only">{event.type}</span>
                    </div>

                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <EventIcon type={event.type} />
                          <p className="text-sm font-medium text-foreground leading-snug">
                            {event.label}
                          </p>
                        </div>
                        {event.sub && (
                          <p className="text-xs text-muted-foreground mt-0.5">{event.sub}</p>
                        )}
                        {/* Breakdown for payment events — matches the receipt's itemization,
                            so it's clear the total is rent + food/AC, never the deposit. */}
                        {event.type === "payment" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Rent: {formatCurrency(event.rentCharge ?? 0)}
                            {(event.foodCharge ?? 0) > 0 && <> · Food: {formatCurrency(event.foodCharge!)}</>}
                            {(event.acCharge ?? 0) > 0 && (
                              <> · AC: {event.acUnitsConsumed != null ? `${event.acUnitsConsumed} units → ` : ""}{formatCurrency(event.acCharge!)}</>
                            )}
                            {(event.lateFee ?? 0) > 0 && <> · Late Fee: {formatCurrency(event.lateFee!)}</>}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <p className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(event.date)}
                        </p>
                        {event.type === "payment" && event.paymentId && (
                          <button
                            type="button"
                            title="View Receipt"
                            disabled={generatingReceipt === event.paymentId}
                            onClick={() => openReceipt(event.paymentId!)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                          >
                            {generatingReceipt === event.paymentId
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <FileText className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Show more button */}
          {events && events.length > DEFAULT_SHOW && !showAll && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 w-full gap-1.5 text-xs text-muted-foreground"
              onClick={() => setShowAll(true)}
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Show {events.length - DEFAULT_SHOW} older event{events.length - DEFAULT_SHOW !== 1 ? "s" : ""}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
