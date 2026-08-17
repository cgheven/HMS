"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Gift } from "lucide-react";
import { lookupReferralForAdmission } from "@/app/actions/referrals";
import { computeReferralDiscount } from "@/lib/payment-calc";
import { normalizePhoneDigits } from "@/lib/phone";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type Lookup = Awaited<ReturnType<typeof lookupReferralForAdmission>>;

/** `null` = nothing worth saying yet (no usable number, or the first answer for
 *  this number hasn't landed). "error" is the only state the action itself can
 *  never report: it swallows its own failures and answers like a miss, so a
 *  thrown value here means the round trip never completed. */
type State = Lookup | "error" | null;

// A Pakistani mobile is 11 digits, so the last keystroke lands with the number
// already complete — the wait is dead time at the desk, not typing headroom.
// 180ms is long enough to swallow a fast paste-then-edit and short enough that
// the banner reads as a response to finishing the field.
const DEBOUNCE_MS = 180;

function Box({
  tone,
  children,
}: {
  tone: "emerald" | "amber" | "muted";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3 flex items-start gap-2",
        tone === "emerald" && "bg-emerald-500/10 border-emerald-500/20",
        tone === "amber" && "bg-amber/10 border-amber/25",
        tone === "muted" && "bg-white/5 border-white/10"
      )}
    >
      <Gift
        className={cn(
          "w-3.5 h-3.5 shrink-0 mt-0.5",
          tone === "emerald" ? "text-emerald-400" : tone === "amber" ? "text-amber" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0 flex-1 space-y-1 text-xs break-words">{children}</div>
    </div>
  );
}

/**
 * Read-only preview of the referral the typed phone number belongs to. It never
 * gates the form, never writes a form value and never blocks Save — attribution
 * happens server-side off the saved tenant row, so anything shown here is
 * decoration on a path that must always be able to admit somebody.
 */
export function ReferralAdmissionBanner({
  phone,
  /** Monthly rent or daily rate as currently typed — the raw input string is fine. */
  rent,
  className,
  onReferralFound,
}: {
  phone: string;
  rent: number | string;
  className?: string;
  /** Fired once per matched referral with the name the person was submitted
   *  under, so the form can prefill it instead of making the operator retype a
   *  name the system already holds. */
  onReferralFound?: (referredName: string) => void;
}) {
  const [state, setState] = useState<State>(null);
  const digits = normalizePhoneDigits(phone);

  useEffect(() => {
    if (!digits) {
      setState(null);
      return;
    }
    // Whatever is on screen was the answer for a different number.
    setState(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await lookupReferralForAdmission(digits);
        if (cancelled) return;
        setState(res);
        if (res.found && res.referredName) onReferralFound?.(res.referredName);
      } catch {
        if (!cancelled) setState("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [digits, onReferralFound]);

  if (state === null) return null;

  if (state === "error") {
    return (
      <div className={className}>
        <Box tone="muted">
          <p className="text-muted-foreground">Referral check unavailable.</p>
        </Box>
      </div>
    );
  }

  if (!state.found) {
    // A plain miss is the common case and says nothing worth a box.
    if (state.reason === "expired") {
      return (
        <div className={className}>
          <Box tone="amber">
            <p className="text-amber">
              This number was referred, but that referral has expired — no discount will apply.
            </p>
          </Box>
        </div>
      );
    }
    if (state.reason === "already_referred") {
      return (
        <div className={className}>
          <Box tone="muted">
            <p className="text-muted-foreground">
              This number has been referred before. No new discount applies.
            </p>
          </Box>
        </div>
      );
    }
    return null;
  }

  // Cross-branch privacy: the action withholds the name and the room whenever
  // the referrer sits at a branch this user has no access to, so an absent name
  // on a found referral is the signal to say nothing more about who they are.
  const anonymous = !state.referrerName;
  const who = `${state.referrerName}${state.referrerRoom ? ` (Rm ${state.referrerRoom})` : ""}`;

  const dates = (
    <p className="text-muted-foreground">
      {state.submittedAt ? `Submitted ${formatDate(state.submittedAt)}` : "Submitted earlier"}
      {state.expiresOn ? `, valid to ${formatDate(state.expiresOn)}.` : "."}
    </p>
  );

  const percent = state.referredPercent;
  if (percent < 1) {
    return (
      <div className={className}>
        <Box tone="muted">
          <p className="text-foreground/80">
            {anonymous ? "Referred by a resident at another branch." : `Referred by ${who}.`}
          </p>
          {dates}
          <p className="text-muted-foreground">
            Referral rewards aren&apos;t switched on for this branch — set your percentages in Marketing.
          </p>
        </Box>
      </div>
    );
  }

  // The rupee figure can only be computed here: the rent is typed further down
  // this same dialog, so the server had nothing to apply the percentage to.
  const rentValue = typeof rent === "number" ? rent : parseFloat(rent);
  const rentNum = Number.isFinite(rentValue) && rentValue > 0 ? rentValue : 0;
  const estimate = rentNum > 0 ? computeReferralDiscount(rentNum, percent) : 0;

  return (
    <div className={className}>
      <Box tone="emerald">
        <p className="font-semibold text-emerald-400">
          {anonymous ? "Referred by a resident at another branch." : `Referral — ${who} sent this person.`}
        </p>
        {dates}
        <p className="text-foreground/80">
          Enter the full rent below. A {percent}% welcome discount{" "}
          {rentNum > 0 ? (
            <span className="text-emerald-400 font-medium">(≈ {formatCurrency(estimate)})</span>
          ) : (
            <span className="text-emerald-400 font-medium">({percent}% of the rent you enter below)</span>
          )}{" "}
          is applied automatically on their first bill. Nothing else to do.
        </p>
      </Box>
    </div>
  );
}
