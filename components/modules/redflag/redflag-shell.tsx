"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { acceptRedflagDisclaimerAction } from "@/app/actions/redflag";

export const REDFLAG_DISCLAIMER =
  "RedFlag information is reported by hostel owners and has not been independently verified by PulseHub. PulseHub accepts no liability for the accuracy of reported information. False reporting is the legal responsibility of the reporting organization.";

interface RedflagGate {
  /** Returns true when the error was the disclaimer gate — the acceptance dialog
   *  has been reopened and the caller must not surface an error of its own. */
  gateOnDisclaimerError: (error: string) => boolean;
  /** Bumped on acceptance so lists that were refused on mount refetch. */
  reloadKey: number;
}

const GateContext = createContext<RedflagGate>({ gateOnDisclaimerError: () => false, reloadKey: 0 });

export function useRedflagGate() {
  return useContext(GateContext);
}

/** Wraps every RedFlag page: the one-time acceptance dialog, the blur that hides
 *  page content until it is accepted, and the footer disclaimer. */
export function RedflagShell({
  children,
  initialAccepted,
  initialUnavailable = false,
}: {
  children: React.ReactNode;
  /** Derived on the server from the first page load. false ONLY when the
   *  registry definitely said the disclaimer is unaccepted. */
  initialAccepted: boolean;
  initialUnavailable?: boolean;
}) {
  // Seeded from the server render rather than probed on mount. The page already
  // asked the registry for the first page, and that answer carries the gate
  // state, so a status round trip after hydration would re-ask a question we
  // arrived holding the answer to — and until it returned, `accepted === null`
  // meant `blocked === false`, flashing the registry unblurred to someone who
  // had never accepted the disclaimer.
  const [accepted, setAccepted] = useState<boolean>(initialAccepted);
  // Distinct from `accepted === false`. If the registry could not be reached —
  // most likely because migration 143 has not been applied yet — we do not know
  // whether the user accepted, and must not trap them behind a gate that cannot
  // be satisfied: accepting would fail too, leaving browser-back as the only exit.
  const [probeFailed] = useState(initialUnavailable);
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const gateOnDisclaimerError = useCallback((error: string) => {
    if (error !== "DISCLAIMER_NOT_ACCEPTED") return false;
    setAccepted(false);
    return true;
  }, []);

  async function handleAccept() {
    setSaving(true);
    const result = await acceptRedflagDisclaimerAction();
    setSaving(false);
    if (result.error) {
      toast({ title: "Could not save", description: result.error, variant: "destructive" });
      return;
    }
    setAccepted(true);
    setReloadKey((k) => k + 1);
  }

  const blocked = accepted === false;

  return (
    <GateContext.Provider value={{ gateOnDisclaimerError, reloadKey }}>
      <div className="space-y-6">
        {probeFailed && (
          <div className="rounded-2xl border border-amber/25 bg-amber/10 px-4 py-3 flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-amber shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm text-foreground">RedFlag is not available right now.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The registry could not be reached, so nothing below is up to date. Adding members
                still works normally — the defaulter check is simply skipped.
              </p>
            </div>
          </div>
        )}
        <div className={cn(blocked && "blur-sm pointer-events-none select-none")} aria-hidden={blocked}>
          {children}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed border-t border-sidebar-border pt-4">
          {REDFLAG_DISCLAIMER}
        </p>
      </div>

      <Dialog open={blocked}>
        <DialogContent
          className="sm:max-w-md [&>button]:hidden"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber/20 bg-amber/10">
                <ShieldAlert className="w-4 h-4 text-amber" />
              </div>
              <DialogTitle>Before you use RedFlag</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-muted-foreground leading-relaxed">
            <p>
              RedFlag lets hostel owners warn each other about members who left without paying.
              Please read this before you use it.
            </p>
            <p className="rounded-xl border border-sidebar-border bg-white/[0.02] p-3 text-foreground/80">
              {REDFLAG_DISCLAIMER}
            </p>
            <p>
              Only report someone you have genuinely dealt with, and mark the report resolved as
              soon as they pay.
            </p>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => router.back()}
              disabled={saving}
              className="text-muted-foreground hover:text-foreground"
            >
              Not now
            </Button>
            <Button
              onClick={handleAccept}
              disabled={saving}
              className="flex-1 bg-amber text-background hover:bg-amber/90 font-semibold"
            >
              {saving ? "Saving…" : "I Understand and Accept"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GateContext.Provider>
  );
}
