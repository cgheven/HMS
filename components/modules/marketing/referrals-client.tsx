"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle, Ban, Check, Copy, Link2, Megaphone, RefreshCw, RotateCcw, Search, Sparkles,
  Undo2, Users, X, MessageCircle, Percent,
} from "lucide-react";
import {
  ensureCodesForAllActiveTenants, ensureReferralCode, grantReferralRewardManually, rejectReferral,
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
import { formatDate, formatMonthLong } from "@/lib/utils";
import type {
  ReferralOverview, ReferralRewardRole, ReferralRewardRow, ReferralRewardStatus, ReferralRow,
  ReferralStatus, ReferrerRow,
} from "@/types";

type StatusFilter = "all" | ReferralStatus;

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
      className="gap-1.5 h-8 text-xs shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy link"}
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
      className="gap-1.5 h-8 text-xs"
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
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tenant who refers</label>
          <div className="flex items-center gap-1.5">
            <Input value={referrer} onChange={(e) => setReferrer(e.target.value)}
              inputMode="numeric" className="h-9 w-20 text-sm" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Person who joins</label>
          <div className="flex items-center gap-1.5">
            <Input value={referred} onChange={(e) => setReferred(e.target.value)}
              inputMode="numeric" className="h-9 w-20 text-sm" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <Button size="sm" className="h-9" onClick={requestSave} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <p className="text-[11px] text-muted-foreground sm:ml-2 sm:pb-2">
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
        <div className="grid gap-3">
          {visible.map((r) => {
            const cancellable = r.status === "scheduled" || r.status === "held";
            return (
              <div
                key={r.id}
                className="rounded-xl border border-sidebar-border bg-card/50 p-4 hover:border-white/10 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.tenantName ?? "Former tenant"}
                      </p>
                      <RoleBadge role={r.role} />
                      <RewardBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.percent}% off ·{" "}
                      {r.status === "applied" && r.appliedAmount !== null ? (
                        <span className="text-emerald-400">{rs(r.appliedAmount)} given</span>
                      ) : r.forMonth ? (
                        `lands on ${formatMonthLong(r.forMonth)}`
                      ) : r.status === "held" ? (
                        "not on a bill yet"
                      ) : (
                        "never landed on a bill"
                      )}
                      {r.status === "applied" && r.appliedAmount !== null && r.forMonth
                        ? ` · ${formatMonthLong(r.forMonth)}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {/* Branch, always: a link shared at one branch is legitimately
                          answered by an admission at another, so a reward the owner
                          does not recognise is otherwise unexplainable. */}
                      <span className="text-foreground">{r.hostelName ?? "another branch"}</span>
                      {" · "}
                      {r.role === "referrer" ? "for referring " : "referred by "}
                      <span className="text-foreground">{r.counterpartyName ?? "a former tenant"}</span>
                    </p>
                  </div>

                  {cancellable && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-rose-400"
                        disabled={busyId === r.id}
                        onClick={() => onRevoke(r)}
                        title="Cancel this discount — the bill is re-priced immediately"
                      >
                        {busyId === r.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                        Cancel
                      </Button>
                    </div>
                  )}
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
  const { referrerPercent, referredPercent, hostelName } = overview;
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
  const [isPending, startTransition] = useTransition();
  // Which pending row has its "attribute by hand" picker open. A phone match is
  // only ever a suggestion, and the person may well have been admitted on a
  // different number from the one their friend gave.

  // The link has to carry the real host the owner is looking at (a branded
  // subdomain, a preview deployment or localhost), and only the browser knows
  // which one that is. No server round-trip involved.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const header = (
    <div>
      <h1 className="text-3xl font-serif font-normal tracking-tight">Marketing</h1>
      <p className="text-muted-foreground text-sm mt-1">
        Referral links your tenants can share, and who came in through them
      </p>
    </div>
  );

  const missingCodes = referrers.filter((r) => !r.code).length;
  const joined = referrals.filter((r) => r.status === "joined").length;
  const pending = referrals.filter((r) => r.status === "pending").length;

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
      enabled={overview.enabled}
      count={openRewardCount}
      value={overview.openRewardValue}
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
      <ConfirmDialog
        open={confirmStopAll}
        title="Stop every queued reward?"
        description={`${openRewardCount} reward${openRewardCount === 1 ? "" : "s"} still owed${
          openValueKnown ? ` (${rs(overview.openRewardValue)})` : ""
        } will be cancelled across every branch you own, permanently. Discounts already collected are not touched.`}
        confirmLabel="Stop all rewards"
        onConfirm={handleStopAll}
        onCancel={() => setConfirmStopAll(false)}
      />
    </>
  );

  // After every hook, never before — an early return above them would make the
  // hook order depend on the entitlement.
  if (!overview.enabled) {
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
          openRewardValue={overview.openRewardValue}
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
        {missingCodes > 0 && (
          <Button
            onClick={handleEnsureAll}
            disabled={isPending}
            className="gap-2 bg-amber text-background hover:bg-amber/90 font-semibold shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            Create {missingCodes} missing link{missingCodes === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {liabilityCard}

      {/* Six tiles, so the column counts have to divide six exactly or the last
          tile is orphaned alone on a half-empty row: 2 / 3 / 6. The two money
          tiles are the last pair and carry no col-span, which puts them side by
          side at every breakpoint — this month against all time is a comparison,
          and stacking them full-width would break the pairing. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Active tenants", value: `${referrers.length}`, color: "text-foreground", size: "text-2xl" },
          { label: "Links created", value: `${referrers.length - missingCodes}`, color: "text-foreground", size: "text-2xl" },
          { label: "Waiting to be called", value: `${pending}`, color: "text-amber", size: "text-2xl" },
          { label: "Joined", value: `${joined}`, color: "text-emerald-400", size: "text-2xl" },
          // Immediately after Joined: tenants gained is only readable against
          // what they cost.
          {
            label: "Discounts given (this month)",
            value: rs(overview.discountGivenThisMonth),
            color: "text-amber",
            size: "text-xl",
          },
          {
            label: "Discounts given (all time)",
            value: rs(overview.discountGivenTotal),
            color: "text-amber",
            size: "text-xl",
          },
        ].map(({ label, value, color, size }) => (
          <div
            key={label}
            className="rounded-2xl border border-sidebar-border bg-card p-4 text-center"
          >
            <p className={`${size} font-bold ${color} truncate`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
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
        <TabsList>
          <TabsTrigger value="submissions">Submissions ({referrals.length})</TabsTrigger>
          <TabsTrigger value="rewards">Rewards ({rewards.length})</TabsTrigger>
          <TabsTrigger value="links">Tenant links ({referrers.length})</TabsTrigger>
        </TabsList>

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
              line1={referrals.length === 0 ? "No submissions yet" : "Nothing matches this filter."}
              line2={
                referrals.length === 0
                  ? "When someone opens a tenant's link and leaves their number, they show up here."
                  : undefined
              }
            />
          ) : (
            <div className="grid gap-3">
              {filteredReferrals.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-sidebar-border bg-card/50 p-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatPhoneDisplay(r.phone)} · {formatDate(r.createdAt)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Referred by{" "}
                        <span className="text-foreground">{r.referrerName ?? "a former tenant"}</span>
                        {r.status === "joined" && r.matchedTenantName && (
                          <>
                            {" · joined as "}
                            <span className="text-emerald-400">{r.matchedTenantName}</span>
                            {r.matchedAt ? ` on ${formatDate(r.matchedAt)}` : ""}
                          </>
                        )}
                      </p>
                      {r.status === "rejected" && r.rejectedAt && (
                        <p className="text-xs text-muted-foreground/80 mt-1">
                          Rejected on {formatDate(r.rejectedAt)}
                          {r.rejectedByName ? ` by ${r.rejectedByName}` : ""}
                        </p>
                      )}
                      {r.rewardSummary && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="text-foreground/80">{r.rewardSummary}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* A joined referral that produced no reward row at all —
                          referrer had left, percentage was 0, cap hit. The reward
                          list cannot offer this: the row was never created. */}
                      {r.status === "joined" &&
                        (!r.rewardSummary || r.rewardSummary.startsWith("No reward")) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8 text-xs"
                            disabled={busyId === r.id}
                            onClick={() => handleGrant(r)}
                            title="Grant the discount this referral did not produce"
                          >
                            {busyId === r.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            Grant
                          </Button>
                        )}
                      {r.status === "rejected" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 h-8 text-xs"
                          disabled={busyId === r.id}
                          onClick={() => handleUndoReject(r)}
                        >
                          <Undo2 className="w-3.5 h-3.5" /> Undo
                        </Button>
                      ) : (
                        <>
                          {/* Joining is automatic on a phone match, so the only
                              judgement left is the exception. The WORDING has to
                              change with the status: on a pending submission this
                              dismisses a claim, but once the person has actually
                              moved in "Reject" reads as rejecting the tenant,
                              which is alarming and not what it does — it cancels
                              the money that is still queued. */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-rose-400"
                            disabled={busyId === r.id}
                            onClick={() => handleReject(r.id)}
                            title={
                              r.status === "joined"
                                ? "Cancels any referral reward still queued. Discounts already collected are not clawed back."
                                : "Dismiss this referral claim."
                            }
                          >
                            <X className="w-3.5 h-3.5" />
                            {r.status === "joined" ? "Cancel reward" : "Reject"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}

          {/* The DB enforces "first submission wins" per owner, and the loser
              used to vanish with no trace — which is both how a real referrer's
              submission disappeared and how someone could quietly claim numbers
              they do not know. Shown so the owner can adjudicate. */}
          {overview.duplicateClaims.length > 0 && (
            <div className="rounded-xl border border-sidebar-border bg-card/30 p-4 space-y-2">
              <p className="text-xs font-medium text-foreground">
                Already referred by someone else ({overview.duplicateClaims.length})
              </p>
              <p className="text-xs text-muted-foreground">
                These numbers were sent again after another tenant had already submitted them. Only
                the first submission counts.
              </p>
              <div className="space-y-1 pt-1">
                {overview.duplicateClaims.map((d) => (
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
            openRewardValue={overview.openRewardValue}
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
            <div className="grid gap-3">
              {filteredReferrers.map((r) => (
                <div
                  key={r.tenantId}
                  className="rounded-xl border border-sidebar-border bg-card/50 p-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.tenantName}</p>
                      {/* referred and joined stay adjacent and unseparated by
                          anything else: the ratio between them is the number the
                          owner is actually reading, not either figure alone. */}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.roomNumber ? `Room ${r.roomNumber} · ` : ""}
                        {r.totalReferred === 0 ? (
                          "No referrals yet"
                        ) : (
                          <>
                            <span className="text-foreground">{r.totalReferred} referred</span>
                            {" · "}
                            <span className="text-emerald-400">{r.joined} joined</span>
                            {r.pending > 0 && (
                              <span className="text-amber"> · {r.pending} waiting</span>
                            )}
                          </>
                        )}
                      </p>
                      {r.totalReferred > 0 && (
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span
                            className={
                              "text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 " +
                              (r.discountEarned > 0
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-white/5 text-muted-foreground border-white/10")
                            }
                          >
                            Earned {rs(r.discountEarned)}
                          </span>
                          {/* Plain muted text, never a second badge: what is
                              already off their bill and what is merely promised
                              must not read as the same kind of number. */}
                          {r.discountPending > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {rs(r.discountPending)} coming
                            </span>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-7 px-2 text-[11px]"
                            onClick={() => viewReferralsOf(r.tenantId)}
                            title={`Show every submission that came through ${r.tenantName}'s link`}
                          >
                            <Users className="w-3 h-3" />
                            View referrals
                          </Button>
                        </div>
                      )}
                      {r.code && origin && (
                        <p className="text-xs text-muted-foreground/80 mt-1.5 font-mono truncate">
                          {referralLinkFor(origin, r.code)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {r.code ? (
                        <>
                          <CopyLinkButton link={origin ? referralLinkFor(origin, r.code) : ""} />
                          <ShareOnWhatsAppButton
                            tenantName={r.tenantName}
                            phone={r.phone}
                            link={origin ? referralLinkFor(origin, r.code) : ""}
                            hostelName={hostelName}
                            referrerPercent={referrerPercent}
                            referredPercent={referredPercent}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8 text-xs"
                            disabled={busyId === r.tenantId}
                            onClick={() => handleRotate(r.tenantId)}
                            title="Replace this link with a new one — the old link stops working"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 h-8 text-xs"
                          disabled={busyId === r.tenantId}
                          onClick={() => handleEnsureCode(r.tenantId)}
                        >
                          {busyId === r.tenantId ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Link2 className="w-3.5 h-3.5" />
                          )}
                          Create link
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {dialogs}
    </div>
  );
}
