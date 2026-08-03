"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn, formatDate } from "@/lib/utils";
import { listReportableTenantsAction, reportDefaulterAction } from "@/app/actions/redflag";
import { REDFLAG_REASONS, REDFLAG_REASON_LABELS } from "@/types";
import type { RedflagReason } from "@/types";
import { REASON_STYLES } from "./redflag-table";

interface ReportableTenant {
  id: string;
  fullName: string;
  cnic: string | null;
  phone: string | null;
  roomNumber: string | null;
  checkOut: string | null;
  alreadyReported: boolean;
}

/** Reads like a sentence so two people with the same name are still telling
 *  apart at a glance: "Ahmed Khan — Rm 12 (left 3 Aug 2026)". */
function tenantLabel(t: ReportableTenant): string {
  const room = t.roomNumber ? `Rm ${t.roomNumber}` : "no room";
  const when = t.checkOut ? `left ${formatDate(t.checkOut)}` : "still resident";
  return `${t.fullName} — ${room} (${when})`;
}

/** The notes box is the only place the specifics of a non-rent debt can be
 *  written down, so the prompt asks for exactly what that reason needs. */
const NOTES_PLACEHOLDERS: Record<RedflagReason, string> = {
  unpaid_rent: "Anything other owners should know…",
  unpaid_utilities: "Which bills, and for which months?",
  damage: "What was damaged?",
  theft: "What was taken?",
  other: "What happened?",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a report is filed so the page can refetch the list. */
  onReported: () => void;
  /** True when the caller handled a DISCLAIMER_NOT_ACCEPTED error — the dialog
   *  then closes silently instead of raising an error toast the acceptance
   *  gate is already answering. */
  gateOnDisclaimerError: (error: string) => boolean;
}

export function ReportDefaulterDialog({ open, onOpenChange, onReported, gateOnDisclaimerError }: Props) {
  const [tenants, setTenants] = useState<ReportableTenant[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedLabel, setSelectedLabel] = useState("");
  // Rent is the common case, so the form is submittable without touching this.
  const [reason, setReason] = useState<RedflagReason>("unpaid_rent");
  const [amount, setAmount] = useState("");
  const [monthsUnpaid, setMonthsUnpaid] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  // LAZY. Most visits to RedFlag are a lookup, not a report, so the branch
  // roster is only fetched the first time this dialog is opened — never on
  // page load.
  // `loading` must NOT be a dependency, and the in-flight guard must not be
  // state. The previous version had both: setLoading(true) changed a dependency,
  // React ran the cleanup, cleanup set cancelled = true, and the response was
  // then discarded — so setLoading(false) never ran and the picker showed
  // "Loading your members…" forever. The effect cancelled the request it had
  // just started, every time.
  //
  // A ref holds the in-flight flag because it must survive a re-render without
  // causing one. The dialog closing no longer cancels the fetch either: it is a
  // small query, and dropping it just puts the spinner back on the next open.
  const fetchStartedRef = useRef(false);

  useEffect(() => {
    if (!open || fetchStartedRef.current) return;
    fetchStartedRef.current = true;
    setLoading(true);
    setLoadError(null);
    listReportableTenantsAction()
      .then((result) => {
        setLoading(false);
        if (result.error) {
          // Allow a retry: without this the ref keeps the effect from ever
          // firing again, so a transient failure would be permanent.
          fetchStartedRef.current = false;
          if (!gateOnDisclaimerError(result.error)) setLoadError(result.error);
          return;
        }
        setTenants(result.tenants ?? []);
      })
      .catch((err: unknown) => {
        // A thrown request left the spinner up forever too — .then() alone
        // never sees a rejection.
        setLoading(false);
        fetchStartedRef.current = false;
        setLoadError(err instanceof Error ? err.message : "Could not load your members.");
      });
  }, [open, gateOnDisclaimerError]);

  function reset() {
    fetchStartedRef.current = false;
    setSelectedLabel("");
    setReason("unpaid_rent");
    setAmount("");
    setMonthsUnpaid("");
    setNotes("");
    setConfirmed(false);
  }

  /** Months is hidden for every other reason, so the value is dropped as the
   *  field goes — otherwise a number typed for rent would still be sitting in
   *  state, invisible, when a theft report is submitted. */
  function pickReason(next: RedflagReason) {
    setReason(next);
    if (next !== "unpaid_rent") setMonthsUnpaid("");
  }

  // Labels must be unique — SearchableSelect keys and matches on the string
  // itself, so two identical labels would be one unselectable option.
  const { options, byLabel } = useMemo(() => {
    const byLabel = new Map<string, ReportableTenant>();
    const options: string[] = [];
    for (const t of tenants ?? []) {
      const base = tenantLabel(t) + (t.alreadyReported ? " · already reported" : "");
      let label = base;
      let n = 2;
      while (byLabel.has(label)) label = `${base} #${n++}`;
      byLabel.set(label, t);
      options.push(label);
    }
    return { options, byLabel };
  }, [tenants]);

  const selected = selectedLabel ? byLabel.get(selectedLabel) ?? null : null;
  const amountValue = Number(amount);
  const canSubmit =
    !!selected &&
    !selected.alreadyReported &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    confirmed &&
    !saving;

  async function handleSubmit() {
    if (!selected || !canSubmit) return;
    setSaving(true);
    const result = await reportDefaulterAction({
      // Only the id. Name, CNIC and phone are read from that tenant row on the
      // server, so what gets published cannot differ from what is on record.
      tenantId: selected.id,
      amount: amountValue,
      reason,
      monthsUnpaid: reason === "unpaid_rent" ? monthsUnpaid.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
      confirmed,
    });
    setSaving(false);
    if (result.error) {
      if (gateOnDisclaimerError(result.error)) { onOpenChange(false); return; }
      toast({ title: "Could not submit report", description: result.error, variant: "destructive" });
      return;
    }
    // Whether the member was actually told is stated, never implied. Silence
    // would let "no email on record" pass for "they have been notified", which
    // is the opposite of what this notice exists to do.
    toast(
      result.notified === "sent"
        ? {
            title: "Report submitted",
            description: `${selected.fullName} has been emailed and told to contact you to settle it.`,
          }
        : result.notified === "failed"
          ? {
              title: "Report submitted — email not delivered",
              description: `The report is filed, but the notice to ${selected.fullName} could not be sent. Let them know directly.`,
            }
          : {
              title: "Report submitted — member not notified",
              description: `No email address on record for ${selected.fullName}. Add one to their profile if you want them notified automatically.`,
            }
    );
    reset();
    // Dropped so the "already reported" markers are correct the next time the
    // dialog opens, instead of still offering the person just reported.
    setTenants(null);
    onOpenChange(false);
    onReported();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Report a Defaulter</DialogTitle></DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Who is this report about? *</Label>
            {loading ? (
              <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your members…
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-amber/25 bg-amber/10 p-3 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{loadError}</p>
              </div>
            ) : options.length === 0 ? (
              <div className="rounded-xl border border-sidebar-border bg-white/[0.02] p-3">
                <p className="text-xs text-muted-foreground">
                  Nobody can be reported yet. A member needs a CNIC or a phone number on their
                  record — without one, no other hostel could ever match the report to them.
                </p>
              </div>
            ) : (
              <SearchableSelect
                value={selectedLabel}
                onValueChange={setSelectedLabel}
                options={options}
                placeholder="Choose a member"
                searchPlaceholder="Type a name…"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Only your own members can be reported — people who left recently are listed first.
            </p>
          </div>

          {selected && (
            <div className="rounded-xl border border-sidebar-border bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">CNIC</span>
                <span className={cn("font-medium", !selected.cnic && "text-muted-foreground")}>
                  {selected.cnic ?? "Not on file"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Phone</span>
                <span className={cn("font-medium", !selected.phone && "text-muted-foreground")}>
                  {selected.phone ?? "Not on file"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pt-1 border-t border-white/5">
                Taken from this member&apos;s record. Other hostels find the report by these, so
                nothing is typed by hand.
              </p>
            </div>
          )}

          {selected?.alreadyReported && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                You already have an open report for this person. Update the amount by resolving the
                existing report first — a second one would split the amount across two entries.
              </p>
            </div>
          )}

          {/* Five chips rather than a dropdown: all the choices are readable
              without opening anything, and picking one is a single tap. */}
          <div className="space-y-1.5">
            <Label>Why do they owe money? *</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Why do they owe money?">
              {REDFLAG_REASONS.map((key) => {
                const active = reason === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickReason(key)}
                    className={cn(
                      "h-8 px-3 rounded-full text-xs font-medium border transition-all",
                      active
                        ? REASON_STYLES[key]
                        : "border-sidebar-border text-muted-foreground hover:text-foreground hover:border-white/15"
                    )}
                  >
                    {REDFLAG_REASON_LABELS[key]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={cn("grid gap-4", reason === "unpaid_rent" ? "grid-cols-2" : "grid-cols-1")}>
            <div className="space-y-1.5">
              <Label>Amount Owed *</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="25000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {/* Meaningless for a broken door or a stolen fan, so it is not just
                disabled — it is gone, and its value with it. */}
            {reason === "unpaid_rent" && (
              <div className="space-y-1.5">
                <Label>Months Unpaid</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="2"
                  value={monthsUnpaid}
                  onChange={(e) => setMonthsUnpaid(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder={NOTES_PLACEHOLDERS[reason]}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <button
            type="button"
            role="checkbox"
            aria-checked={confirmed}
            onClick={() => setConfirmed((v) => !v)}
            className={cn(
              "flex items-start gap-3 w-full text-left rounded-xl border p-3 transition-colors",
              confirmed
                ? "border-amber/30 bg-amber/10"
                : "border-sidebar-border bg-white/[0.02] hover:border-white/10"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                confirmed ? "bg-amber border-amber text-background" : "border-sidebar-border"
              )}
            >
              {confirmed && <Check className="w-3.5 h-3.5" />}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              I confirm this information is accurate and accept legal responsibility for false
              reporting.
            </span>
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-amber text-background hover:bg-amber/90 font-semibold"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Submit Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
