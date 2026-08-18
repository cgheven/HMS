"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle, Ban, Check, ChevronLeft, ChevronRight, Copy, Link2, Megaphone, Pause, RefreshCw,
  RotateCcw, Search, Sparkles, Undo2, Users, X, MessageCircle, Percent,
} from "lucide-react";
import {
  ensureCodesForAllActiveTenants, ensureReferralCode, getReferralOverview, grantReferralRewardManually, rejectReferral,
  setReferralCampaign, startReferralCampaign,
  revokeReferralReward, rotateReferralCode, stopAllReferralRewards, undoRejectReferral,
  updateReferralPercentages,
} from "@/app/actions/referrals";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatPhoneDisplay, normalizePhoneDigits } from "@/lib/phone";
import { REFERRAL_PENDING_TTL_DAYS, REFERRAL_STATUS_CONFIG, referralLinkFor } from "@/lib/referrals";
import { cn, formatDate, formatMonthLong } from "@/lib/utils";
import type {
  ReferralOverview, ReferralRewardRole, ReferralRewardRow, ReferralRewardStatus, ReferralRow,
  ReferralStatus, ReferrerRow,
} from "@/types";

type StatusFilter = "all" | ReferralStatus;

/**
 * Why a referral link did not go out, in words an owner can act on.
 *
 * Keyed on the reason strings sendReferralInvite returns. Anything unmapped
 * falls back to a message that says to contact support rather than inventing a
 * cause — the previous copy asserted three specific reasons unconditionally,
 * and stated them confidently while the real fault was a rejected template.
 */
const REASON_COPY: Record<string, string> = {
  send_failed:
    "WhatsApp rejected the messages. Nobody was charged and nobody was marked as sent — please contact support before trying again.",
  no_phone: "no mobile number on file.",
  not_resident: "they are on the waiting list or have checked out.",
  already_sent: "they already have their link.",
  campaign_not_active: "the campaign is not running.",
  whatsapp_off: "WhatsApp is not enabled for this branch.",
  referrals_off: "referrals are not enabled for this branch.",
  no_offer: "both discount percentages are set to 0.",
  no_code: "no active referral link.",
  token_failed: "their private status link could not be created.",
  unknown: "please contact support.",
};

const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "joined", "rejected"];

/** 'void' is filtered out server-side — a cancelled reward is not a line item. */
type RewardFilter = "all" | Exclude<ReferralRewardStatus, "void">;

const REWARD_FILTERS: RewardFilter[] = ["all", "scheduled", "held", "applied", "expired"];

const REWARD_STATUS_CONFIG: Record<ReferralRewardStatus, { label: string; cls: string }> = {
  scheduled: { label: "Queued",  cls: "bg-amber/10 text-amber border-amber/25" },
  held:      { label: "Held",    cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  applied:   { label: "Applied", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  expired:   { label: "Expired", cls: "bg-white/5 text-muted-foreground border-white/10" },
  void:      { label: "Cancelled", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

/** "Welcome" rather than "Referred": the owner reads this as which side of the
 *  deal the money is paying, not as a database role. */
const REWARD_ROLE_LABEL: Record<ReferralRewardRole, string> = {
  referred: "Welcome",
  referrer: "Referrer",
};

/** Matches the server's own rendering ("Applied Rs 1,500 · Aug"), which lands on
 *  the same screen — formatCurrency's "PKR 1,500" beside it reads as two systems. */
function rs(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-PK")}`;
}

function StatusBadge({ status }: { status: ReferralStatus }) {
  const cfg = REFERRAL_STATUS_CONFIG[status];
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function RewardBadge({ status }: { status: ReferralRewardStatus }) {
  const cfg = REWARD_STATUS_CONFIG[status];
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function RoleBadge({ role }: { role: ReferralRewardRole }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 border-white/10 bg-white/5 text-muted-foreground">
      {REWARD_ROLE_LABEL[role]}
    </span>
  );
}

function EmptyBlock({ line1, line2 }: { line1: string; line2?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground rounded-2xl border border-sidebar-border bg-card">
      <Megaphone className="w-10 h-10 opacity-20" />
      <p className="text-sm">{line1}</p>
      {line2 && <p className="text-xs text-center max-w-sm">{line2}</p>}
    </div>
  );
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      // `link` is empty until the origin effect has run — copying then would
      // put a relative path on the clipboard.
      disabled={!link}
      // Icon only: four controls plus the money have to fit one phone row, and
      // the label is the first thing that can go without losing an action.
      className="gap-1.5 h-7 text-[11px] px-2 shrink-0"
      title={copied ? "Copied" : "Copy this tenant's referral link"}
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}


/**
 * Hands a tenant their own link over the OWNER's WhatsApp, not the platform's
 * business number — a plain wa.me link, so no Meta template, no per-message
 * cost, and it works on the branches that do not have WhatsApp enabled.
 *
 * The tenant then forwards this same message into their groups, which is the
 * only step of the loop we cannot build a button for.
 */
function ShareOnWhatsAppButton({
  tenantName, phone, link, hostelName, referrerPercent, referredPercent,
}: {
  tenantName: string;
  phone: string | null;
  link: string;
  hostelName: string | null;
  referrerPercent: number;
  /** 0 is the referrer-only campaign — the message must then not promise the
   *  friend anything, or the tenant repeats an offer nobody will honour. */
  referredPercent: number;
}) {
  // normalizePhoneDigits, not a second inline implementation: the old chain hid
  // the button for a bare 10-digit number and built an invalid wa.me link for a
  // "0092…" one.
  const digits = normalizePhoneDigits(phone);
  const usable = !!digits && !!link;

  // First name only — the message is a note between two people who know each
  // other, and a full legal name reads like a letter from a bank.
  const first = (tenantName ?? "").trim().split(/\s+/)[0] || "";
  // Both halves are spelled out when both are configured: the tenant is the one
  // repeating this offer to strangers, so anything left implicit here becomes an
  // argument at the front desk later.
  const bothSides = referrerPercent > 0 && referredPercent > 0;

  // All three states are spelled out. There is deliberately no catch-all: the
  // old fallback fired exactly when the referrer's share was 0 and promised
  // "you get a discount" while silently dropping the friend's real offer that
  // the public page was displaying at that moment.
  const rewardLines = bothSides
    ? [
        "When they join and pay their first month:",
        "",
        `\u2705 You get ${referrerPercent}% off your rent`,
        `\u2705 They get ${referredPercent}% off their first month`,
      ]
    : referrerPercent > 0
      ? [`When they join and pay their first month, you get ${referrerPercent}% off your rent.`]
      : referredPercent > 0
        ? [`When they join and pay their first month, they get ${referredPercent}% off their first month.`]
        : [];

  const text = [
    `Assalam o Alaikum ${first},`,
    "",
    // Announce the programme before handing over the link. A tenant who
    // receives a bare URL has no idea a referral scheme exists, and a link with
    // no context reads like something to ignore.
    hostelName
      ? `Good news \u2014 we have launched a referral programme at ${hostelName}.`
      : "Good news \u2014 we have launched a referral programme.",
    "",
    "You now have your own referral link:",
    link,
    "",
    // Points at the LINK, not this message. Forwarding the message itself would
    // tell a stranger in a group "you get 10% off your rent" — a promise that
    // only holds for the tenant, while the credit still goes to the tenant no
    // matter who passes it on.
    "Just share the link above in your WhatsApp groups or with friends \u2014 that is all it takes.",
    ...rewardLines,
    "",
    // Names the CONSEQUENCE, not just the rule. "Visit within 14 days" reads as
    // advice; the referrer needs to know the discount itself dies, or the
    // deadline creates no urgency and only produces unexplained refusals later.
    `\u23F3 The discount is valid for ${REFERRAL_PENDING_TTL_DAYS} days only.`,
    `They must visit and complete admission within ${REFERRAL_PENDING_TTL_DAYS} days of submitting the form, otherwise the discount no longer applies.`,
    "",
    hostelName ? `— ${hostelName}` : "",
  ].join("\n");

  if (!usable) return null;
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="gap-1.5 h-7 text-[11px] px-2"
      title={`Send ${first || "this tenant"} their link on WhatsApp`}
    >
      <a
        href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle className="w-3.5 h-3.5" />
      </a>
    </Button>
  );
}


/** The referred figure is what the PUBLIC page promises a stranger, which is why
 *  it is labelled as such here — the owner is editing a live public offer. */
function PercentageSettings({
  referrerPercent, referredPercent, openRewardCount, openRewardValue,
}: {
  referrerPercent: number;
  referredPercent: number;
  openRewardCount: number;
  openRewardValue: number;
}) {
  const [referrer, setReferrer] = useState(String(referrerPercent));
  const [referred, setReferred] = useState(String(referredPercent));
  const [saving, setSaving] = useState(false);
  const [confirmLower, setConfirmLower] = useState(false);

  const clean = (v: string) => Math.max(0, Math.min(100, Math.trunc(Number(v) || 0)));
  const dirty = clean(referrer) !== referrerPercent || clean(referred) !== referredPercent;
  const lowering = clean(referrer) < referrerPercent || clean(referred) < referredPercent;

  // Decided here rather than from what updateReferralPercentages hands back: the
  // action writes the new percentages BEFORE it returns those counts, so its
  // answer can explain a save but can never gate one.
  function requestSave() {
    if (lowering && openRewardCount > 0) setConfirmLower(true);
    else void save();
  }

  async function save() {
    setConfirmLower(false);
    setSaving(true);
    const res = await updateReferralPercentages(clean(referrer), clean(referred));
    setSaving(false);
    if (res.error) {
      toast({ title: "Could not save", description: res.error, variant: "destructive" });
      return;
    }
    // Reload rather than rely on revalidation, matching handleEnsureAll above.
    // These two numbers are re-read by the WhatsApp draft and by the public
    // page, and a tenant repeating a stale percentage to strangers is a promise
    // nobody agreed to honour.
    window.location.reload();
  }

  return (
    <div className="rounded-xl border border-sidebar-border bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Percent className="w-4 h-4 text-amber" />
        <h3 className="text-sm font-medium">Discounts</h3>
      </div>
      {/* Two 20ch number fields and a Save button stacked into a full-height
          column on a phone, with Save rendered as a full-width primary bar —
          for editing a percentage that is almost never touched. They are small
          enough to sit in one row at any width; only the explanation wraps. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tenant who refers</label>
          <div className="flex items-center gap-1.5">
            <Input value={referrer} onChange={(e) => setReferrer(e.target.value)}
              inputMode="numeric" className="h-9 w-16 sm:w-20 text-sm" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Person who joins</label>
          <div className="flex items-center gap-1.5">
            <Input value={referred} onChange={(e) => setReferred(e.target.value)}
              inputMode="numeric" className="h-9 w-16 sm:w-20 text-sm" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <Button size="sm" className="h-9 ml-auto sm:ml-0" onClick={requestSave} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <p className="w-full sm:w-auto text-[11px] text-muted-foreground sm:ml-2 sm:pb-2">
          {clean(referred) > 0
            ? `The referral page offers visitors ${clean(referred)}% off their first month.`
            : "Set to 0 — the referral page makes no offer to visitors."}
        </p>
      </div>

      <ConfirmDialog
        open={confirmLower}
        title="Lower the discount?"
        description={`${openRewardCount} reward${openRewardCount === 1 ? " is" : "s are"} already queued at the old rate (${rs(openRewardValue)}) and will not change — a reward keeps the percentage it was granted at. New referrals from now on get the new rate.`}
        confirmLabel="Save new rate"
        onConfirm={() => void save()}
        onCancel={() => setConfirmLower(false)}
      />
    </div>
  );
}

/**
 * The liability, rendered whatever the entitlement says. Switching referrals off
 * does not void what is already sitting on bills — the reconciler gets to those
 * branch by branch — so an owner who has turned the feature off must still be
 * able to see, and stop, the money that is still going out.
 */
function OpenRewardsCard({
  enabled, count, value, valueKnown, busy, onStopAll,
}: {
  enabled: boolean;
  count: number;
  value: number;
  /** False once rewards have been cancelled in this session: the rupee figure is
   *  a server-side estimate off each tenant's rent, which a row does not carry. */
  valueKnown: boolean;
  busy: boolean;
  onStopAll: () => void;
}) {
  const alarming = !enabled && count > 0;
  return (
    <div
      className={
        "rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 " +
        (alarming ? "border-amber/30 bg-amber/[0.04]" : "border-sidebar-border bg-card")
      }
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertTriangle
          className={`w-4 h-4 mt-0.5 shrink-0 ${count > 0 ? "text-amber" : "text-muted-foreground/40"}`}
        />
        <div className="min-w-0">
          <p className="text-sm text-foreground">
            {count === 0
              ? enabled
                ? "No rewards are queued right now."
                : "Referrals are switched off — no rewards are queued."
              : `${enabled ? "" : "Referrals are switched off — "}${count} reward${count === 1 ? " is" : "s are"} still queued${valueKnown ? ` (${rs(value)})` : ""}.`}
          </p>
          {count > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              These come off tenants&apos; bills as they fall due, across every branch you own.
            </p>
          )}
        </div>
      </div>

      {count > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-rose-400 shrink-0 self-start sm:self-auto"
          disabled={busy}
          onClick={onStopAll}
        >
          <Ban className="w-3.5 h-3.5" /> Stop all rewards
        </Button>
      )}
    </div>
  );
}

function RewardsPanel({
  rewards, totalRewards, busyId, onRevoke,
}: {
  rewards: ReferralRewardRow[];
  /** Pre-search total, so "nothing matches" is not reported as "nothing exists". */
  totalRewards: number;
  busyId: string | null;
  onRevoke: (reward: ReferralRewardRow) => void;
}) {
  const [filter, setFilter] = useState<RewardFilter>("all");

  const counts = useMemo(
    () => ({
      all: rewards.length,
      scheduled: rewards.filter((r) => r.status === "scheduled").length,
      held: rewards.filter((r) => r.status === "held").length,
      applied: rewards.filter((r) => r.status === "applied").length,
      expired: rewards.filter((r) => r.status === "expired").length,
    }),
    [rewards]
  );

  const visible = useMemo(
    () => (filter === "all" ? rewards : rewards.filter((r) => r.status === filter)),
    [rewards, filter]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {REWARD_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors " +
              (filter === f
                ? "border-amber/40 bg-amber/[0.08] text-amber"
                : "border-sidebar-border text-muted-foreground hover:text-foreground")
            }
          >
            {f === "all" ? "All" : REWARD_STATUS_CONFIG[f].label} ({counts[f]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyBlock
          line1={totalRewards === 0 ? "No discounts have been earned yet" : "Nothing matches this filter."}
          line2={
            totalRewards === 0
              ? "Every discount this programme owes — to the tenant who referred and to the person who joined — is listed here, from the moment it is earned until it comes off a bill."
              : undefined
          }
        />
      ) : (
        /* A LEDGER, NOT A STACK OF CARDS — the same shape as Submissions, so the
         * two tabs are read the same way: down a column of money, not across a
         * paragraph per record. One bordered container with hairline rows rather
         * than N bordered cards, or the columns stop lining up. */
        <div className="rounded-xl border border-sidebar-border overflow-hidden">
          {/* EVERY track is a fixed width or an fr — deliberately no `auto`. The
               header and the rows are two separate grids, and an `auto` track
               sizes to its own content, so the header's short words and a row's
               badges resolve differently and every label drifts a column away
               from its data. */}
          <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_6.5rem_7rem_7rem_6.5rem] gap-3 px-4 py-2 bg-white/[0.02] border-b border-sidebar-border text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Beneficiary</span>
            <span>For</span>
            <span>Month</span>
            {/* pl-4 on Status, not a wider gap: the gap is uniform across the
                whole grid, and widening it to fix one seam loosens five others.
                A right-aligned figure ending flush against a left-aligned chip
                is the one place that needs the extra air. */}
            <span className="text-right">Amount</span>
            <span className="pl-4">Status</span>
            <span className="text-right">Actions</span>
          </div>

          {visible.map((r) => {
            /* Built once and rendered into both layouts. A second copy of the
               button is how the phone and the desktop quietly drift into
               offering different actions. */
            const cancellable = r.status === "scheduled" || r.status === "held";
            const actions = cancellable ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 text-[11px] px-2 text-muted-foreground hover:text-rose-400"
                disabled={busyId === r.id}
                onClick={() => onRevoke(r)}
                title="Cancel this discount — the bill is re-priced immediately"
              >
                {busyId === r.id ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <X className="w-3 h-3" />
                )}
                Cancel
              </Button>
            ) : null;

            // Money only exists once a reward has been applied — every other
            // status carries a percentage and no rupees.
            const givenAmount = r.status === "applied" ? r.appliedAmount : null;

            return (
              <div
                key={r.id}
                className="md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_6.5rem_7rem_7rem_6.5rem] md:items-center md:gap-x-3 md:px-4 md:py-3 border-b border-sidebar-border/60 last:border-b-0 hover:bg-white/[0.02] transition-colors"
              >
                {/* ── PHONE ────────────────────────────────────────────────────
                    Not the table stacked — a different layout for a different
                    shape of screen. Who it pays reads down the left, the figure
                    and its state sit bottom-left with the action opposite, the
                    way a bank statement does. */}
                <div className="md:hidden px-4 py-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.tenantName ?? "Former tenant"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.role === "referrer" ? "for referring " : "referred by "}
                        {r.counterpartyName ?? "a former tenant"}
                      </p>
                      {/* Branch, always: a link shared at one branch is legitimately
                          answered by an admission at another, so a reward the owner
                          does not recognise is otherwise unexplainable. */}
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                        {r.hostelName ?? "another branch"}
                        {r.forMonth ? ` · ${formatMonthLong(r.forMonth)}` : ""}
                      </p>
                    </div>
                    <RoleBadge role={r.role} />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {givenAmount !== null ? rs(givenAmount) : `${r.percent}%`}
                      </span>
                      <RewardBadge status={r.status} />
                    </div>
                    {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
                  </div>
                </div>

                {/* ── DESKTOP CELLS ───────────────────────────────────────────
                    display:none on a phone, so they take no grid slot. */}
                <div className="hidden md:block min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {r.tenantName ?? "Former tenant"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.hostelName ?? "another branch"}
                  </p>
                </div>

                <div className="hidden md:block min-w-0">
                  <p className="text-xs text-foreground truncate">
                    {r.counterpartyName ?? "a former tenant"}
                  </p>
                  <div className="mt-1">
                    <RoleBadge role={r.role} />
                  </div>
                </div>

                <div className="hidden md:block min-w-0">
                  {r.forMonth ? (
                    <p className="text-xs text-foreground truncate">{formatMonthLong(r.forMonth)}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/40">—</p>
                  )}
                </div>

                <div className="hidden md:block text-right min-w-0">
                  {givenAmount !== null ? (
                    <p className="text-xs text-foreground tabular-nums">{rs(givenAmount)}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/40">—</p>
                  )}
                  {/* The rate stays beside the rupees: until a reward is applied
                      the percentage is the only figure that exists for it. */}
                  <p className="text-[11px] text-muted-foreground/70 tabular-nums">{r.percent}% off</p>
                </div>

                <div className="hidden md:flex min-w-0 pl-4">
                  <RewardBadge status={r.status} />
                </div>

                <div className="hidden md:flex items-center gap-1.5 justify-end min-w-0">
                  {actions ?? <span className="text-xs text-muted-foreground/40">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ReferralsClient({ overview }: { overview: ReferralOverview }) {
  // The whole payload is state, not just the lists: every tile, total and label
  // on this page is scoped to one month, so a month change has to swap all of
  // them together or the page shows two months at once.
  const [ov, setOv] = useState<ReferralOverview>(overview);
  const { referrerPercent, referredPercent, hostelName } = ov;
  const [referrers, setReferrers] = useState<ReferrerRow[]>(overview.referrers);
  const [referrals, setReferrals] = useState<ReferralRow[]>(overview.referrals);
  const [rewards, setRewards] = useState<ReferralRewardRow[]>(overview.rewards);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  /** Whose referrals the Submissions tab is narrowed to — a tenantId, set by
   *  "View referrals" on a link card. Deliberately independent of `search`:
   *  clearing one must never silently clear the other. */
  const [referrerFilter, setReferrerFilter] = useState<string | null>(null);
  const [tab, setTab] = useState("submissions");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ReferralRewardRow | null>(null);
  const [confirmStopAll, setConfirmStopAll] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Which pending row has its "attribute by hand" picker open. A phone match is
  // only ever a suggestion, and the person may well have been admitted on a
  // different number from the one their friend gave.

  // The link has to carry the real host the owner is looking at (a branded
  // subdomain, a preview deployment or localhost), and only the browser knows
  // which one that is. No server round-trip involved.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [monthLoading, setMonthLoading] = useState(false);

  /** The current month at PKT, so stepping forward stops at a month that can
   *  actually have data rather than walking into an empty 2027. */
  const thisMonth = useMemo(() => {
    const now = new Date();
    const pkt = new Date(now.getTime() + (now.getTimezoneOffset() + 300) * 60000);
    return `${pkt.getFullYear()}-${String(pkt.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  async function loadMonth(next: string) {
    if (next > thisMonth) return;
    setMonthLoading(true);
    const res = await getReferralOverview(next);
    if (res.data) {
      setOv(res.data);
      setReferrers(res.data.referrers);
      setReferrals(res.data.referrals);
      setRewards(res.data.rewards);
      // A referrer picked in another month may have nothing here, which would
      // read as "the page broke" rather than "that person referred nobody in
      // June". Status resets for the same reason.
      setReferrerFilter(null);
      setStatus("all");
    } else {
      toast({ title: "Failed to load", description: res.error, variant: "destructive" });
    }
    setMonthLoading(false);
  }

  function stepMonth(dir: -1 | 1) {
    const [y, m] = ov.month.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    void loadMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const atCurrentMonth = ov.month >= thisMonth;

  /** "August" — for the places that need to NAME the month in a sentence. The
   *  cards deliberately do not: the stepper sits directly above them, so
   *  repeating it four times is noise, not clarity. */
  const monthShort = useMemo(() => formatMonthLong(ov.month).split(" ")[0], [ov.month]);

  const header = (
    <div>
      <h1 className="text-3xl font-serif font-normal tracking-tight">Marketing</h1>
      <p className="text-muted-foreground text-sm mt-1">
        Referral links your tenants can share, and who came in through them
      </p>
    </div>
  );

  /* self-start, not a stretched flex child: the mobile header is flex-col, so
     without it this sizes to the full 340px of the screen and pushes the two
     chevrons to opposite edges — a thumb cannot reach both, and a control that
     wide reads as a banner rather than something you press.
     Aligned to the RIGHT edge on a phone (self-end) so it sits under the
     thumb rather than across the screen from it, and back to self-start from
     sm up, where the header is a row and the cross axis is vertical.
     Tap targets are 40px on a phone and tighten from sm up, where a mouse is
     doing the pointing. */
  const monthStepper = (
    <div className="flex items-center self-end sm:self-start shrink-0 w-fit rounded-lg border border-sidebar-border bg-sidebar-accent/30">
      <button
        onClick={() => stepMonth(-1)}
        disabled={monthLoading}
        className="px-3 py-2.5 sm:px-2 sm:py-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        aria-label="Previous month"
      >
        <ChevronLeft className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
      </button>
      <span className="text-xs font-medium px-1 min-w-[6.5rem] text-center inline-flex items-center justify-center gap-1.5 tabular-nums">
        {monthLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
        {formatMonthLong(ov.month)}
      </span>
      <button
        onClick={() => stepMonth(1)}
        disabled={monthLoading || atCurrentMonth}
        className="px-3 py-2.5 sm:px-2 sm:py-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        aria-label="Next month"
      >
        <ChevronRight className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
      </button>
    </div>
  );

  const missingCodes = referrers.filter((r) => !r.code).length;
  const pending = referrals.filter((r) => r.status === "pending").length;

  // The bottom line the owner is being sold on: what the referred tenants paid,
  // less what the branch gave away in discounts, less Pulse's commission. Amber
  // when negative — a month where those two costs outran the revenue is worth
  // looking at, not celebrating.
  // discountGivenThisMonthBranch, NOT discountGivenThisMonth: revenue and
  // commission are both branch-scoped, and subtracting the owner-WIDE discount
  // total from them double-counts across a multi-branch owner's two Marketing
  // pages — enough to render a profitable branch as an amber loss.
  // Collected revenue minus the commission on tenants who actually paid.
  //
  // The owner's discounts are NOT subtracted here. hms_payments.amount is stored
  // NET of the referral discount, so amount_paid — which is what revenueInMonth
  // sums — is already post-discount; taking discountGivenThisMonthBranch off
  // again charged the owner for the same rupees twice.
  //
  // Confirmed commission, not total: the fee accrues at conversion while revenue
  // is cash, so netting the full fee against collected revenue showed a tenant
  // who joined this morning as a loss.
  const earningAfterDiscounts =
    ov.revenueInMonth - ov.pulseCommissionConfirmedInMonth;

  const openRewardCount = rewards.filter(
    (r) => r.status === "scheduled" || r.status === "held"
  ).length;
  // The rupee total is the server's own estimate (rent × percent), and a row does
  // not carry the rent — so once anything has been cancelled here it can only be
  // stated again after a reload.
  const openValueKnown = rewards.length === overview.rewards.length;

  const referrerScoped = useMemo(
    () =>
      referrerFilter ? referrals.filter((r) => r.referrerTenantId === referrerFilter) : referrals,
    [referrals, referrerFilter]
  );

  // Scoped to the referrer filter, not to the search box: a filter chip the owner
  // can see should agree with the tab counts beside it, whereas typing in a
  // shared search box that also drives two other tabs should not renumber these.
  const counts = useMemo(
    () => ({
      all: referrerScoped.length,
      pending: referrerScoped.filter((r) => r.status === "pending").length,
      joined: referrerScoped.filter((r) => r.status === "joined").length,
      rejected: referrerScoped.filter((r) => r.status === "rejected").length,
      expired: referrerScoped.filter((r) => r.status === "expired").length,
    }),
    [referrerScoped]
  );

  /** Who has actually brought people in, best first. A separate derivation from
   *  `referrers` on purpose: the cards answer "what happened lately", this
   *  answers "who is worth talking to", and one list cannot be sorted both ways.
   *  Anyone who has never been used is left out — they are not a choice, they
   *  are noise in a list the owner is scanning for their best advocates. */
  const rankedReferrers = useMemo(
    () =>
      referrers
        .filter((r) => r.totalReferred > 0)
        .slice()
        .sort((a, b) =>
          b.totalReferred - a.totalReferred ||
          b.joined - a.joined ||
          a.tenantName.localeCompare(b.tenantName)
        ),
    [referrers]
  );

  const referrerFilterName = useMemo(() => {
    if (!referrerFilter) return null;
    return (
      referrers.find((r) => r.tenantId === referrerFilter)?.tenantName ??
      referrals.find((r) => r.referrerTenantId === referrerFilter)?.referrerName ??
      "this tenant"
    );
  }, [referrerFilter, referrers, referrals]);

  /** Status is reset because the jump comes from a card that counted every
   *  submission — landing on "Rejected" from a previous glance would show an
   *  empty list and read as "this tenant referred nobody". */
  function viewReferralsOf(tenantId: string) {
    setReferrerFilter(tenantId);
    setStatus("all");
    setTab("submissions");
  }

  const q = search.trim().toLowerCase();
  // "0300 12" and "0300-12" have to find "03001234567" — the number was typed
  // by a stranger on a public form, so its shape is whatever they felt like.
  const qDigits = q.replace(/\D/g, "");

  const filteredReferrals = useMemo(
    () =>
      referrerScoped.filter((r) => {
        if (status !== "all" && r.status !== status) return false;
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && r.phone.replace(/\D/g, "").includes(qDigits)) ||
          (r.referrerName ?? "").toLowerCase().includes(q)
        );
      }),
    [referrerScoped, status, q, qDigits]
  );

  const filteredReferrers = useMemo(
    () =>
      referrers.filter((r) => {
        if (!q) return true;
        return (
          r.tenantName.toLowerCase().includes(q) ||
          (r.code ?? "").toLowerCase().includes(q) ||
          (r.roomNumber ?? "").toLowerCase().includes(q)
        );
      }),
    [referrers, q]
  );

  const filteredRewards = useMemo(
    () =>
      rewards.filter((r) => {
        if (!q) return true;
        return (
          (r.tenantName ?? "").toLowerCase().includes(q) ||
          (r.counterpartyName ?? "").toLowerCase().includes(q) ||
          (r.hostelName ?? "").toLowerCase().includes(q)
        );
      }),
    [rewards, q]
  );

  function applyCode(tenantId: string, code: string) {
    setReferrers((prev) => prev.map((r) => (r.tenantId === tenantId ? { ...r, code } : r)));
  }

  function handleEnsureCode(tenantId: string) {
    setBusyId(tenantId);
    startTransition(async () => {
      const res = await ensureReferralCode(tenantId);
      if (res.error) toast({ title: "Failed", description: res.error, variant: "destructive" });
      else if (res.code) applyCode(tenantId, res.code);
      setBusyId(null);
    });
  }

  function handleRotate(tenantId: string) {
    setBusyId(tenantId);
    startTransition(async () => {
      const res = await rotateReferralCode(tenantId);
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      } else if (res.code) {
        applyCode(tenantId, res.code);
        toast({ title: "New link created", description: "The old link no longer works." });
      }
      setBusyId(null);
    });
  }

  function handleEnsureAll() {
    setBusyId("all");
    startTransition(async () => {
      const res = await ensureCodesForAllActiveTenants();
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
        setBusyId(null);
        return;
      }
      // Codes are minted server-side, so the only honest way to show them is to
      // re-render the page that read them.
      window.location.reload();
    });
  }

  // Pausing is instant and reversible, so it gets no confirm step — unlike Start,
  // which spends money per message and does.
  function handlePause() {
    setBusyId("campaign");
    startTransition(async () => {
      const res = await setReferralCampaign("paused");
      setBusyId(null);
      if (res.error) {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
        return;
      }
      toast({ title: "Campaign paused", description: "No new tenant will be messaged. Referrals already submitted still pay out." });
      window.location.reload();
    });
  }

  function handleReject(referralId: string) {
    setBusyId(referralId);
    startTransition(async () => {
      const res = await rejectReferral(referralId);
      if (res.error) toast({ title: "Failed", description: res.error, variant: "destructive" });
      else {
        setReferrals((prev) =>
          prev.map((r) =>
            r.id === referralId
              ? { ...r, status: "rejected" as ReferralStatus, rejectedAt: new Date().toISOString() }
              : r
          )
        );
      }
      setBusyId(null);
    });
  }

  function handleUndoReject(referral: ReferralRow) {
    setBusyId(referral.id);
    startTransition(async () => {
      const res = await undoRejectReferral(referral.id);
      if (res.error) toast({ title: "Failed", description: res.error, variant: "destructive" });
      else {
        // The action reports what the DB actually restored to.
        const restored: ReferralStatus = res.status ?? "pending";
        setReferrals((prev) =>
          prev.map((r) =>
            r.id === referral.id
              ? { ...r, status: restored, rejectedAt: null, rejectedByName: null }
              : r
          )
        );
      }
      setBusyId(null);
    });
  }

  /** The count these actions report only exists server-side, and the rows they
   *  create or void are spread across bills this page does not hold — so the
   *  owner is told the number first, then the page is re-read. */
  function toastThenReload(title: string, description: string) {
    toast({ title, description });
    window.setTimeout(() => window.location.reload(), 1400);
  }

  function handleRevoke(reward: ReferralRewardRow) {
    setRevokeTarget(null);
    setBusyId(reward.id);
    startTransition(async () => {
      const res = await revokeReferralReward(reward.id, "Cancelled by owner from Marketing");
      if (res.error) {
        toast({ title: "Could not cancel", description: res.error, variant: "destructive" });
      } else {
        // A voided reward is never listed — the overview query excludes it — so
        // dropping the row is what the next server read would produce anyway.
        setRewards((prev) => prev.filter((r) => r.id !== reward.id));
        toast({
          title: "Discount cancelled",
          description: `${reward.tenantName ?? "That tenant"}'s ${reward.percent}% will not come off ${
            reward.forMonth ? formatMonthLong(reward.forMonth) : "any bill"
          }.`,
        });
      }
      setBusyId(null);
    });
  }

  function handleStopAll() {
    setConfirmStopAll(false);
    setBusyId("stop-all");
    startTransition(async () => {
      const res = await stopAllReferralRewards();
      if (res.error) {
        toast({ title: "Could not stop rewards", description: res.error, variant: "destructive" });
        setBusyId(null);
        return;
      }
      toastThenReload(
        `${res.voided ?? 0} reward${res.voided === 1 ? "" : "s"} stopped`,
        "Nothing further will come off any bill. Bills already collected are untouched."
      );
    });
  }

  /** Asks for the referrer side, but hms_grant_referral_rewards re-evaluates BOTH
   *  sides on every call and is idempotent per (referral, role) — so this grants
   *  whatever actually qualifies, which is why one button is enough. */
  function handleGrant(referral: ReferralRow) {
    setBusyId(referral.id);
    startTransition(async () => {
      const res = await grantReferralRewardManually(referral.id, "referrer");
      if (res.error) {
        toast({ title: "Could not grant", description: res.error, variant: "destructive" });
        setBusyId(null);
        return;
      }
      toastThenReload(
        `${res.granted ?? 0} reward${res.granted === 1 ? "" : "s"} granted`,
        `From ${referral.name}'s referral. It lands on the next open bill.`
      );
    });
  }

  const liabilityCard = (
    <OpenRewardsCard
      enabled={ov.enabled}
      count={openRewardCount}
      value={ov.openRewardValue}
      valueKnown={openValueKnown}
      busy={isPending}
      onStopAll={() => setConfirmStopAll(true)}
    />
  );

  const dialogs = (
    <>
      <ConfirmDialog
        open={!!revokeTarget}
        title="Cancel this discount?"
        description={
          revokeTarget
            ? `${revokeTarget.percent}% off for ${revokeTarget.tenantName ?? "this tenant"}${
                revokeTarget.forMonth ? ` on ${formatMonthLong(revokeTarget.forMonth)}` : ""
              }. The bill is re-priced straight away and this cannot be undone.`
            : ""
        }
        confirmLabel="Cancel discount"
        onConfirm={() => revokeTarget && handleRevoke(revokeTarget)}
        onCancel={() => setRevokeTarget(null)}
      />
      {/* Named count, because this spends real money — Meta bills per message —
          and because 56 WhatsApps is not something to discover after clicking. */}
      <ConfirmDialog
        open={confirmStart}
        onCancel={() => setConfirmStart(false)}
        title={
          ov.campaign === "paused"
            ? "Resume the campaign?"
            : ov.campaign === "active"
              ? `Send ${ov.unsentCount} pending link${ov.unsentCount === 1 ? "" : "s"}?`
              : "Start the referral campaign?"
        }
        description={
          ov.campaign === "paused"
            ? "New tenants will start receiving their referral link again."
            : ov.campaign === "active"
              ? // Named separately from the first-run copy: "start the campaign"
                // is the wrong sentence for a campaign already running, and an
                // owner reaching this dialog has usually just had a blast fail.
                `${ov.unsentCount} tenant${ov.unsentCount === 1 ? " has" : "s have"} a referral link but ${ov.unsentCount === 1 ? "has" : "have"} never been sent it. This messages only them — anyone already sent their link is skipped.`
              : `${ov.unsentCount} tenant${ov.unsentCount === 1 ? "" : "s"} will receive their own referral link by WhatsApp, and every tenant admitted from now on will get one automatically. Nobody is ever messaged twice for the same link.`
        }
        confirmLabel={
          ov.campaign === "paused"
            ? "Resume"
            : ov.campaign === "active"
              ? "Send now"
              : "Start and send"
        }
        onConfirm={() =>
          startTransition(async () => {
            const res =
              ov.campaign === "paused"
                ? await setReferralCampaign("active")
                : await startReferralCampaign();
            if ("error" in res && res.error) {
              toast({ title: "Failed", description: res.error, variant: "destructive" });
              return;
            }
            if ("sent" in res) {
              const sent = res.sent ?? 0;
              const skipped = res.skipped ?? 0;
              // A blast where NOTHING sent is a fault, not a result, and must
              // not be reported in the same calm voice as a partial one. The
              // old copy guessed at the reason and guessed wrong, which is how
              // a template error read as "already sent" to a client.
              const failedOutright = sent === 0 && skipped > 0;
              toast({
                variant: failedOutright ? "destructive" : undefined,
                title: failedOutright
                  ? `Could not send — 0 of ${res.queued ?? skipped} went out`
                  : `${sent} link${sent === 1 ? "" : "s"} sent`,
                description: failedOutright
                  ? REASON_COPY[res.reason ?? "unknown"] ?? REASON_COPY.unknown
                  : skipped > 0
                    ? `${skipped} skipped — ${REASON_COPY[res.reason ?? "unknown"] ?? REASON_COPY.unknown}`
                    : undefined,
              });
            }
            setConfirmStart(false);
            setTimeout(() => window.location.reload(), 1200);
          })
        }
      />

      <ConfirmDialog
        open={confirmStopAll}
        title="Stop every queued reward?"
        description={`${openRewardCount} reward${openRewardCount === 1 ? "" : "s"} still owed${
          openValueKnown ? ` (${rs(ov.openRewardValue)})` : ""
        } will be cancelled across every branch you own, permanently. Discounts already collected are not touched.`}
        confirmLabel="Stop all rewards"
        onConfirm={handleStopAll}
        onCancel={() => setConfirmStopAll(false)}
      />
    </>
  );

  // After every hook, never before — an early return above them would make the
  // hook order depend on the entitlement.
  if (!ov.enabled) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        {/* The liability and the percentage inputs both outlive the switch: open
            rewards keep landing on bills until the reconciler clears them, and
            setting a percentage to 0 is the only way to stop future grants. */}
        {liabilityCard}
        <PercentageSettings
          referrerPercent={referrerPercent}
          referredPercent={referredPercent}
          openRewardCount={openRewardCount}
          openRewardValue={ov.openRewardValue}
        />
        {rewards.length > 0 && (
          <RewardsPanel
            rewards={rewards}
            totalRewards={rewards.length}
            busyId={busyId}
            onRevoke={setRevokeTarget}
          />
        )}
        <EmptyBlock
          line1="Referrals aren't enabled for this branch yet"
          line2="Tenant referral links are granted per branch. Contact support to have this turned on, and every active tenant gets their own shareable link."
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        {header}
        {monthStepper}
      </div>

      {/* No liability bar here. Everything it said is already on this page —
          the tiles carry the money and the Rewards tab carries the queue — so on
          an enabled branch it was a third copy of the same fact. It survives on
          the DISABLED branch below, where the tiles and tabs do not render and it
          is the only thing reporting that rewards are still landing on bills.
          "Stop all rewards" moves to the Rewards tab so it stays reachable. */}

      {/* Four tiles, all scoped to the picked month, reading left to right as
          ONE equation rather than four unrelated facts: paying tenants won,
          what they paid, what that cost, what is left. The count is PAYING
          tenants only — somebody who moved in and never settled a bill took a
          discount and returned nothing, and counting them would flatter the
          very figure this card set exists to make honest. Two per row on a
          phone, four on a laptop; four divides both, so no tile is orphaned on
          a half row. Money sits a size below the count because "Rs 1,240,000"
          in text-2xl truncates in a half-width tile on a phone. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          // Reads left to right as ONE equation: how many paying tenants
          // referrals won, what they paid, what Pulse charged, what is left.
          // The owner's own discounts are inside the final figure rather than
          // on a card of their own — they are already itemised per referral in
          // the list below, and a fifth card would break the equation.
          {
            label: "Tenants joined",
            value: `${ov.joinedPaidInMonth}`,
            color: "text-emerald-400",
            size: "text-2xl",
            note: ov.joinedUnpaidInMonth > 0 ? `${ov.joinedUnpaidInMonth} not paid yet` : null,
          },
          {
            label: "Revenue collected",
            value: rs(ov.revenueInMonth),
            color: "text-emerald-400",
            size: "text-base sm:text-lg lg:text-xl",
            note: null,
          },
          {
            label: "Pulse commission",
            value: rs(ov.pulseCommissionConfirmedInMonth),
            color: "text-amber",
            size: "text-base sm:text-lg lg:text-xl",
            note:
              ov.pulseCommissionPendingInMonth > 0
                ? `${rs(ov.pulseCommissionPendingInMonth)} pending`
                : null,
          },
          {
            // Collected revenue minus confirmed commission — both sides on the
            // same cash basis, so this can never go negative on the strength of
            // a tenant who simply has not paid yet.
            label: "Net earning",
            value: `${earningAfterDiscounts < 0 ? "−" : ""}${rs(Math.abs(earningAfterDiscounts))}`,
            color: earningAfterDiscounts < 0 ? "text-amber" : "text-emerald-400",
            size: "text-base sm:text-lg lg:text-xl",
            note: null,
          },
        ].map(({ label, value, color, size, note }) => (
          <div
            key={label}
            className="rounded-2xl border border-sidebar-border bg-card p-4 text-center"
          >
            <p className={`${size} font-bold ${color} truncate`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
            {/* Reserved whether or not it is filled, so a tile that gains a note
                does not grow taller than the three beside it. */}
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 h-4 truncate">
              {note ?? ""}
            </p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, number, tenant or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Controlled: "View referrals" on a link card has to move the owner to
          the Submissions tab, not just set a filter they cannot see. */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Full-width thirds on a phone rather than a scrolling strip. Three
              triggers do not fit at 390px, and a strip the owner has to swipe —
              with the first tab sitting under a fade — reads as a broken page
              rather than a scrollable one. Laid out to fit, it needs no fade. */}
          <TabsList noFade className="w-full grid grid-cols-3 sm:w-auto sm:inline-flex">
            <TabsTrigger value="submissions" className="justify-center px-2 sm:px-3 text-[11px] sm:text-xs">
              <span className="truncate">Submissions ({referrals.length})</span>
            </TabsTrigger>
            <TabsTrigger value="rewards" className="justify-center px-2 sm:px-3 text-[11px] sm:text-xs">
              <span className="truncate">Rewards ({rewards.length})</span>
            </TabsTrigger>
            <TabsTrigger value="links" className="justify-center px-2 sm:px-3 text-[11px] sm:text-xs">
              <span className="truncate">
                <span className="sm:hidden">Links</span>
                <span className="hidden sm:inline">Tenant links</span> ({referrers.length})
              </span>
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 shrink-0">
            {/* The campaign switch. Off is the only state that spends money on
                click, so it is the only one styled as a primary action; live and
                paused are status first, control second. */}
            {ov.campaign === "active" ? (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {/* Shown on every width. On a phone this used to be hidden, which
                    left a bare "Pause" button with nothing saying the campaign
                    was running — the one fact that makes the button make sense. */}
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="relative flex w-2 h-2">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
                  </span>
                  Campaign live
                </span>
                {/* The escape hatch from a campaign that started but did not
                    send.
                    
                    Start only ever ran on the off -> active transition, and
                    nothing in the app can set 'off' again — so a branch whose
                    blast failed had its flag flipped to active with nobody
                    messaged and no button left that could reach them. It
                    happened to a live client: 52 codes minted, 52 sends
                    rejected by Meta, campaign showing as running, and the only
                    control on screen was Pause.
                    
                    Reuses startReferralCampaign unchanged, which is already
                    idempotent — it re-sets a flag that is already active, mints
                    only missing codes, and sends only where link_sent_at is
                    null. So this can be pressed twice with no duplicate
                    message. Deliberately not shown while paused: paused means
                    stop outbound, and a send button there would contradict it. */}
                {ov.unsentCount > 0 && (
                  <Button
                    onClick={() => setConfirmStart(true)}
                    disabled={isPending || !ov.whatsappEnabled}
                    size="sm"
                    className="gap-2 ml-auto sm:ml-0 bg-amber text-background border-amber hover:bg-amber/90 font-semibold"
                  >
                    <Megaphone className="w-4 h-4" />
                    Send {ov.unsentCount} pending
                  </Button>
                )}
                <Button
                  onClick={handlePause}
                  disabled={isPending}
                  size="sm"
                  variant="outline"
                  className={cn("gap-2", ov.unsentCount > 0 ? "" : "ml-auto sm:ml-0")}
                >
                  <Pause className="w-4 h-4" />
                  Pause
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => setConfirmStart(true)}
                disabled={isPending || !ov.whatsappEnabled}
                title={
                  ov.whatsappEnabled
                    ? undefined
                    : "WhatsApp is not enabled for this branch — contact support to turn it on."
                }
                size="sm"
                className="gap-2 w-full sm:w-auto justify-center bg-amber text-background border-amber hover:bg-amber/90 font-semibold"
              >
                <Megaphone className="w-4 h-4" />
                {ov.campaign === "paused" ? "Resume campaign" : "Start campaign"}
              </Button>
            )}
            {missingCodes > 0 && (
              /* Outline on a phone, solid amber from sm up. Minting missing links
                 is maintenance, and as a full-bleed amber block it was the loudest
                 thing on the screen — louder than the money the page is about.
                 Now that Start sits beside it, it stays outline at every width —
                 two solid amber buttons side by side have no primary. */
              <Button
                onClick={handleEnsureAll}
                disabled={isPending}
                size="sm"
                variant="outline"
                className="gap-2 shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                Create {missingCodes} missing link{missingCodes === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="submissions" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={
                  "text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors " +
                  (status === s
                    ? "border-amber/40 bg-amber/[0.08] text-amber"
                    : "border-sidebar-border text-muted-foreground hover:text-foreground")
                }
              >
                {s === "all" ? "All" : REFERRAL_STATUS_CONFIG[s].label} ({counts[s]})
              </button>
            ))}

            {/* Ordered by who has brought the most, so the list doubles as a
                leaderboard — the owner reads their best advocates off the top
                without opening it. Hidden entirely until someone has actually
                referred somebody, when it would be an empty control. */}
            {rankedReferrers.length > 0 && (
              <Select
                value={referrerFilter ?? "all"}
                onValueChange={(v) => setReferrerFilter(v === "all" ? null : v)}
              >
                <SelectTrigger className="h-[30px] text-xs flex-1 min-w-[11rem] sm:flex-none sm:w-56">
                  <SelectValue placeholder="Any referrer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All referrers</SelectItem>
                  {rankedReferrers.map((r) => (
                    <SelectItem key={r.tenantId} value={r.tenantId}>
                      {r.tenantName} — {r.totalReferred} referred, {r.joined} joined
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Showing referrals submitted in {formatMonthLong(ov.month)}.
          </p>

          {/* Always rendered while the filter is on, including over an empty
              list — the owner must never be left wondering where the other rows
              went, so the thing hiding them is also the thing that clears it. */}
          {referrerFilter && (
            <button
              onClick={() => setReferrerFilter(null)}
              className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber/40 bg-amber/[0.08] text-amber"
              title="Show every submission again"
            >
              <span className="truncate">Referred by {referrerFilterName}</span>
              <X className="w-3.5 h-3.5 shrink-0" />
            </button>
          )}

          {filteredReferrals.length === 0 ? (
            <EmptyBlock
              // Names the month rather than reusing the generic empty state: a
              // quiet June is not the same fact as "this has never been used",
              // and the generic copy reads as the latter.
              line1={
                referrals.length === 0
                  ? `No referrals were submitted in ${monthShort}`
                  : "Nothing matches this filter."
              }
              line2={
                referrals.length === 0
                  ? "Step back a month, or share a tenant's link to start getting them."
                  : undefined
              }
            />
          ) : (
            /* A LEDGER, NOT A STACK OF CARDS.
             *
             * This list exists to be COMPARED down, not read across: which
             * referrals converted, what each cost, what each returned. The old
             * shape restated its own labels on every row — "Referred by X",
             * "Applied Rs 1,500", "Paid Rs 18,500 so far" — which is the same
             * three words repeated once per record and a reader who has to
             * re-parse every line to find one figure. Column headers say each
             * label once and the eye runs straight down.
             *
             * One bordered container with hairline rows rather than N bordered
             * cards: a border around every row plus internal columns is two
             * grids fighting, and the money stops lining up.
             */
            <div className="rounded-xl border border-sidebar-border overflow-hidden">
              {/* Desktop only — on a phone the labels move inline, below. */}
              {/* EVERY track is a fixed width or an fr — deliberately no `auto`.
                   The header and the rows are two separate grids, and an `auto`
                   track sizes to its own content: the header's short words and a
                   row's badges and buttons resolve to different widths, so the
                   labels drift a whole column away from the data they name. */}
              <div className="hidden md:grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_6.5rem_11rem_8rem_10.5rem] gap-3 px-4 py-2 bg-white/[0.02] border-b border-sidebar-border text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Person</span>
                <span>Referred by</span>
                <span>Referral</span>
                <span className="text-right">Reward</span>
                <span className="pl-4">Status</span>
                <span className="text-right">Actions</span>
              </div>

              {filteredReferrals.map((r) => {
                /* Built once and rendered in both layouts. A second copy of the
                   button logic is how the phone and the desktop quietly drift
                   into offering different actions. */
                const actions = (
                  <>
                    {r.status === "joined" &&
                      (r.rewardState === null || r.rewardState === "None") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 h-7 text-[11px] px-2"
                          disabled={busyId === r.id}
                          onClick={() => handleGrant(r)}
                          title="Grant the discount this referral did not produce"
                        >
                          {busyId === r.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          Grant
                        </Button>
                      )}
                    {r.status === "rejected" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-7 text-[11px] px-2"
                        disabled={busyId === r.id}
                        onClick={() => handleUndoReject(r)}
                      >
                        <Undo2 className="w-3 h-3" /> Undo
                      </Button>
                    ) : (
                      /* The wording changes with the status: on a pending
                         submission this dismisses a claim, but once the person
                         has moved in "Reject" reads as rejecting the tenant,
                         which is alarming and not what it does — it cancels the
                         money still queued. */
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-7 text-[11px] px-2 text-muted-foreground hover:text-rose-400"
                        disabled={busyId === r.id}
                        onClick={() => handleReject(r.id)}
                        title={
                          r.status === "joined"
                            ? "Cancels any referral reward still queued. Discounts already collected are not clawed back."
                            : "Dismiss this referral claim."
                        }
                      >
                        <X className="w-3 h-3" />
                        {r.status === "joined" ? "Cancel reward" : "Reject"}
                      </Button>
                    )}
                  </>
                );

                const rewardChip =
                  r.rewardState && r.rewardState !== "None" ? (
                    <span
                      className={cn(
                        "inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
                        r.rewardState === "Applied" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                        r.rewardState === "Queued" && "bg-sky-500/10 text-sky-400 border-sky-500/20",
                        r.rewardState === "Held" && "bg-amber/10 text-amber border-amber/25",
                        r.rewardState === "Expired" && "bg-white/5 text-muted-foreground border-white/10"
                      )}
                      title={
                        r.rewardState === "Applied"
                          ? "Taken off a bill — money actually given"
                          : r.rewardState === "Queued"
                            ? "Placed on an upcoming bill, not collected yet"
                            : r.rewardState === "Held"
                              ? "Earned, waiting for the referred tenant's first payment"
                              : "Ran out before it could be used"
                      }
                    >
                      {r.rewardState}
                    </span>
                  ) : null;

                return (
                  <div
                    key={r.id}
                    className="md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_6.5rem_11rem_8rem_10.5rem] md:items-center md:gap-x-3 md:px-4 md:py-3 border-b border-sidebar-border/60 last:border-b-0 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* ── PHONE ────────────────────────────────────────────────
                        Not the table stacked — a different layout for a different
                        shape of screen. Identity reads down the left, money sits
                        on the right, the way a bank statement does, so the eye
                        finds the figure without reading the line. Three lines
                        instead of eight, and no repeated "Reward:" / "Paid:"
                        labels, which on a phone are most of the width. */}
                    <div className="md:hidden px-4 py-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            via {r.referrerName ?? "a former tenant"}
                            {r.referrerRoom ? ` · Rm ${r.referrerRoom}` : ""}
                          </p>
                          <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                            {formatPhoneDisplay(r.phone)} · {formatDate(r.createdAt)}
                          </p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>

                      {(r.rewardAmount || rewardChip || r.status !== "expired") && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {r.rewardAmount !== null && r.rewardAmount > 0 && (
                              <span className="text-sm font-semibold text-foreground tabular-nums">
                                {rs(r.rewardAmount)}
                              </span>
                            )}
                            {rewardChip}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
                        </div>
                      )}

                      {r.status === "rejected" && r.rejectedAt && (
                        <p className="text-[11px] text-muted-foreground/70">
                          rejected {formatDate(r.rejectedAt)}
                          {r.rejectedByName ? ` by ${r.rejectedByName}` : ""}
                        </p>
                      )}
                    </div>

                    {/* ── DESKTOP CELLS ───────────────────────────────────────
                        display:none on a phone, so they take no grid slot. */}
                    <div className="hidden md:block min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {formatPhoneDisplay(r.phone)} · {formatDate(r.createdAt)}
                      </p>
                    </div>

                    <div className="hidden md:block min-w-0">
                      <p className="text-xs text-foreground truncate">
                        {r.referrerName ?? "a former tenant"}
                      </p>
                      {r.referrerRoom && (
                        <p className="text-xs text-muted-foreground truncate">Rm {r.referrerRoom}</p>
                      )}
                      {r.status === "rejected" && r.rejectedAt && (
                        <p className="text-xs text-muted-foreground/80 truncate">
                          rejected {formatDate(r.rejectedAt)}
                          {r.rejectedByName ? ` by ${r.rejectedByName}` : ""}
                        </p>
                      )}
                    </div>

                    <div className="hidden md:flex">
                      <StatusBadge status={r.status} />
                    </div>

                    <div className="hidden md:block text-right min-w-0">
                      {r.rewardAmount !== null && r.rewardAmount > 0 ? (
                        <p className="text-xs text-foreground tabular-nums">{rs(r.rewardAmount)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground/40">—</p>
                      )}
                    </div>

                    <div className="hidden md:block min-w-0 pl-4">
                      {rewardChip ?? <span className="text-xs text-muted-foreground/40">—</span>}
                    </div>

                    <div className="hidden md:flex items-center gap-1.5 justify-end min-w-0">
                      {actions}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {ov.duplicateClaims.length > 0 && (
            <div className="rounded-xl border border-sidebar-border bg-card/30 p-4 space-y-2">
              <p className="text-xs font-medium text-foreground">
                Already referred by someone else ({ov.duplicateClaims.length})
              </p>
              <p className="text-xs text-muted-foreground">
                These numbers were sent again after another tenant had already submitted them. Only
                the first submission counts.
              </p>
              <div className="space-y-1 pt-1">
                {ov.duplicateClaims.map((d) => (
                  <p key={d.id} className="text-xs text-muted-foreground">
                    <span className="text-foreground">{d.name}</span> ·{" "}
                    {formatPhoneDisplay(d.phone)} · sent by {d.referrerName ?? "a former tenant"} on{" "}
                    {formatDate(d.createdAt)}
                  </p>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="rewards" className="space-y-4">
          {openRewardCount > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground min-w-0">
                {openRewardCount} reward{openRewardCount === 1 ? "" : "s"} still queued
                {openValueKnown ? ` (${rs(ov.openRewardValue)})` : ""} — these come off
                tenants&apos; bills as they fall due, across every branch you own.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-rose-400 shrink-0"
                disabled={isPending}
                onClick={() => setConfirmStopAll(true)}
              >
                <Ban className="w-3.5 h-3.5" /> Stop all rewards
              </Button>
            </div>
          )}
          <RewardsPanel
            rewards={filteredRewards}
            totalRewards={rewards.length}
            busyId={busyId}
            onRevoke={setRevokeTarget}
          />
        </TabsContent>

        <TabsContent value="links" className="space-y-4">
          <PercentageSettings
            referrerPercent={referrerPercent}
            referredPercent={referredPercent}
            openRewardCount={openRewardCount}
            openRewardValue={ov.openRewardValue}
          />
          {filteredReferrers.length === 0 ? (
            <EmptyBlock
              line1={referrers.length === 0 ? "No active tenants yet" : "Nothing matches this search."}
              line2={
                referrers.length === 0
                  ? "Every active tenant gets their own link the moment they check in."
                  : undefined
              }
            />
          ) : (
            /* A LEDGER, NOT A STACK OF CARDS. This list is scanned down for one
             * thing — which advocate is worth cultivating — and that is a
             * comparison of two money columns, which a stack of cards cannot
             * make. One bordered container with hairline rows, so the figures
             * line up instead of each row drawing its own grid. */
            <div className="rounded-xl border border-sidebar-border overflow-hidden">
              {/* Every track is a fixed width or an fr — never `auto`, or the
                   header and the rows (two separate grids) size their tracks to
                   different content and the labels drift off their data. */}
              <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_7rem_8rem_8rem_11rem] gap-3 px-4 py-2 bg-white/[0.02] border-b border-sidebar-border text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Tenant</span>
                <span>Referrals</span>
                <span className="text-right">Earned</span>
                <span className="text-right">Revenue</span>
                <span className="text-right">Actions</span>
              </div>

              {filteredReferrers.map((r) => {
                const link = r.code && origin ? referralLinkFor(origin, r.code) : "";

                /* Built once and rendered into both layouts, so the phone and
                   the desktop cannot drift into offering different actions. */
                /* TWO controls, not four.
                 *
                 * Every row carried Copy, WhatsApp, Rotate and View referrals —
                 * four bordered buttons per row, forty on a screen of ten
                 * tenants, and the two that matter drowned in the two that
                 * rarely do. What an owner does here is hand a link to a tenant,
                 * so Copy and WhatsApp stay.
                 *
                 * Rotate moved out: it invalidates a link people may already be
                 * holding, it is used once in a blue moon, and a destructive
                 * action sitting one pixel from Copy is a misclick waiting to
                 * happen. It now lives on the tenant's own row — see the Rm line.
                 *
                 * "View referrals" moved onto the joined count itself, which is
                 * the thing you actually want to click when you want to see them. */
                const actions = r.code ? (
                  <>
                    <CopyLinkButton link={link} />
                    <ShareOnWhatsAppButton
                      tenantName={r.tenantName}
                      phone={r.phone}
                      link={link}
                      hostelName={hostelName}
                      referrerPercent={referrerPercent}
                      referredPercent={referredPercent}
                    />
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-[11px] px-2"
                    disabled={busyId === r.tenantId}
                    onClick={() => handleEnsureCode(r.tenantId)}
                  >
                    {busyId === r.tenantId ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Link2 className="w-3 h-3" />
                    )}
                    Create link
                  </Button>
                );

                // referred and joined stay adjacent and unseparated by anything
                // else: the ratio between them is the number the owner is
                // actually reading, not either figure alone.
                // Joined only. "3 referred · 2 joined · 1 waiting" was three
                // figures where the owner reads one — who actually moved in.
                // The breakdown is still one click away in Submissions, and the
                // full ratio is on the referrer dropdown there.
                const counts =
                  r.totalReferred === 0 ? null : (
                    <span className="text-emerald-400">
                      {r.joined} joined
                    </span>
                  );

                // The half of the funnel that used to be invisible.
                //
                // A tenant with shares and opens but no submissions is the most
                // actionable row on this page: the link IS circulating and the
                // offer is not landing, which is a problem the owner can fix.
                // Without this the same row is indistinguishable from a tenant
                // who never touched their link, and the only available reading
                // was "this tenant is not helping" — which may be the opposite
                // of the truth.
                //
                // No column of its own: the grid has five fixed tracks and a
                // sixth would need the header rewritten to match, which is
                // exactly how the header drifted off its data last time.
                // All-time by nature, so it carries its own explanation rather
                // than being silently read as the selected month's.
                const reach =
                  r.linkOpens > 0 || r.linkShares > 0 ? (
                    <span
                      className="text-muted-foreground/70"
                      title="All time, not just the selected month. Shares are counted when the link is pasted into a chat and the messenger fetches its preview."
                    >
                      {r.linkOpens} open{r.linkOpens === 1 ? "" : "s"}
                      {r.linkShares > 0 && ` · ${r.linkShares} share${r.linkShares === 1 ? "" : "s"}`}
                    </span>
                  ) : null;

                return (
                  <div
                    key={r.tenantId}
                    className="md:grid md:grid-cols-[minmax(0,1.6fr)_7rem_8rem_8rem_11rem] md:items-center md:gap-x-3 md:px-4 md:py-3 border-b border-sidebar-border/60 last:border-b-0 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* ── PHONE ────────────────────────────────────────────────
                        Not the table stacked. Identity and what the link has done
                        read down the left; the money the tenant has actually been
                        given sits bottom-left in bold with the buttons opposite. */}
                    <div className="md:hidden px-4 py-3.5 space-y-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.tenantName}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.roomNumber ? `Room ${r.roomNumber} · ` : ""}
                          {counts ?? "No referrals yet"}
                        </p>
                        {reach && (
                          <p className="text-[11px] truncate mt-0.5">{reach}</p>
                        )}
                        {!r.code && (
                          <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                            No link yet
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-semibold text-foreground tabular-nums">
                              {r.discountEarned > 0 ? rs(r.discountEarned) : "—"}
                            </span>
                            <span className="text-[11px] text-muted-foreground">earned</span>
                          </div>
                          {/* Muted, and never a badge: what is already off their
                              bill and what is merely promised must not read as
                              the same kind of number. */}
                          {r.discountPending > 0 && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {rs(r.discountPending)} coming
                            </p>
                          )}
                          {/* Kept apart from Earned rather than stacked with it:
                              both are realised money, but one is what this person
                              cost and one is what they returned, and matching
                              styles would read as one running total. */}
                          {r.revenueFromReferred > 0 && (
                            <p className="text-[11px] text-emerald-400 truncate">
                              {rs(r.revenueFromReferred)} revenue
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
                      </div>
                    </div>

                    {/* ── DESKTOP CELLS ───────────────────────────────────────
                        display:none on a phone, so they take no grid slot. */}
                    <div className="hidden md:block min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.tenantName}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-2">
                        {r.roomNumber ? `Room ${r.roomNumber}` : <span className="text-muted-foreground/40">—</span>}
                        {r.code && (
                          <button
                            onClick={() => handleRotate(r.tenantId)}
                            disabled={busyId === r.tenantId}
                            className="text-muted-foreground/50 hover:text-amber transition-colors disabled:opacity-40"
                            title="Replace this link with a new one — the old link stops working"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </p>
                    </div>

                    <div className="hidden md:block min-w-0 text-xs text-muted-foreground">
                      {r.totalReferred > 0 ? (
                        <button
                          onClick={() => viewReferralsOf(r.tenantId)}
                          className="hover:underline underline-offset-2"
                          title={`Show every submission that came through ${r.tenantName}'s link`}
                        >
                          {counts}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/40">None yet</span>
                      )}
                      {reach && <p className="text-[11px] truncate mt-0.5">{reach}</p>}
                    </div>

                    <div className="hidden md:block text-right min-w-0">
                      {r.discountEarned > 0 ? (
                        <p className="text-xs text-foreground tabular-nums">{rs(r.discountEarned)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground/40">—</p>
                      )}
                      {r.discountPending > 0 && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {rs(r.discountPending)} coming
                        </p>
                      )}
                    </div>

                    <div className="hidden md:block text-right min-w-0">
                      {r.revenueFromReferred > 0 ? (
                        <p className="text-xs text-emerald-400 tabular-nums">
                          {rs(r.revenueFromReferred)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground/40">—</p>
                      )}
                    </div>

                    <div className="hidden md:flex items-center gap-1.5 justify-end min-w-0">
                      {actions}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {dialogs}
    </div>
  );
}
