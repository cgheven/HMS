"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Check, Copy, Link2, Megaphone, RefreshCw, RotateCcw, Search, Sparkles,
  Undo2, X, MessageCircle, Percent,
} from "lucide-react";
import {
  ensureCodesForAllActiveTenants, ensureReferralCode, rejectReferral,
  rotateReferralCode, undoRejectReferral, updateReferralPercentages,
} from "@/app/actions/referrals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatPhoneDisplay, normalizePhoneDigits } from "@/lib/phone";
import { REFERRAL_PENDING_TTL_DAYS, REFERRAL_STATUS_CONFIG, referralLinkFor } from "@/lib/referrals";
import { formatDate } from "@/lib/utils";
import type { ReferralOverview, ReferralRow, ReferralStatus, ReferrerRow } from "@/types";

type StatusFilter = "all" | ReferralStatus;

const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "joined", "rejected"];

function StatusBadge({ status }: { status: ReferralStatus }) {
  const cfg = REFERRAL_STATUS_CONFIG[status];
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${cfg.cls}`}>
      {cfg.label}
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
  referrerPercent, referredPercent,
}: { referrerPercent: number; referredPercent: number }) {
  const [referrer, setReferrer] = useState(String(referrerPercent));
  const [referred, setReferred] = useState(String(referredPercent));
  const [saving, setSaving] = useState(false);

  const clean = (v: string) => Math.max(0, Math.min(100, Math.trunc(Number(v) || 0)));
  const dirty = clean(referrer) !== referrerPercent || clean(referred) !== referredPercent;

  async function save() {
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
        <Button size="sm" className="h-9" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <p className="text-[11px] text-muted-foreground sm:ml-2 sm:pb-2">
          {clean(referred) > 0
            ? `The referral page offers visitors ${clean(referred)}% off their first month.`
            : "Set to 0 — the referral page makes no offer to visitors."}
        </p>
      </div>
    </div>
  );
}

export function ReferralsClient({ overview }: { overview: ReferralOverview }) {
  const { referrerPercent, referredPercent, hostelName } = overview;
  const [referrers, setReferrers] = useState<ReferrerRow[]>(overview.referrers);
  const [referrals, setReferrals] = useState<ReferralRow[]>(overview.referrals);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const counts = useMemo(
    () => ({
      all: referrals.length,
      pending,
      joined,
      rejected: referrals.filter((r) => r.status === "rejected").length,
      expired: referrals.filter((r) => r.status === "expired").length,
    }),
    [referrals, pending, joined]
  );

  const q = search.trim().toLowerCase();
  // "0300 12" and "0300-12" have to find "03001234567" — the number was typed
  // by a stranger on a public form, so its shape is whatever they felt like.
  const qDigits = q.replace(/\D/g, "");

  const filteredReferrals = useMemo(
    () =>
      referrals.filter((r) => {
        if (status !== "all" && r.status !== status) return false;
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && r.phone.replace(/\D/g, "").includes(qDigits)) ||
          (r.referrerName ?? "").toLowerCase().includes(q)
        );
      }),
    [referrals, status, q, qDigits]
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

  // After every hook, never before — an early return above them would make the
  // hook order depend on the entitlement.
  if (!overview.enabled) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <EmptyBlock
          line1="Referrals aren't enabled for this branch yet"
          line2="Tenant referral links are granted per branch. Contact support to have this turned on, and every active tenant gets their own shareable link."
        />
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Active tenants", value: `${referrers.length}`, color: "text-foreground" },
          { label: "Links created", value: `${referrers.length - missingCodes}`, color: "text-foreground" },
          { label: "Waiting to be called", value: `${pending}`, color: "text-amber" },
          { label: "Joined", value: `${joined}`, color: "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-2xl border border-sidebar-border bg-card p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
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

      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">Submissions ({referrals.length})</TabsTrigger>
          <TabsTrigger value="links">Tenant links ({referrers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="space-y-4">
          <div className="flex flex-wrap gap-2">
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
          </div>

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
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
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
                          {/* Joining is automatic on a phone match. The only
                              judgement left is the exception: someone the owner
                              knows was walking in anyway. */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-rose-400"
                            disabled={busyId === r.id}
                            onClick={() => handleReject(r.id)}
                          >
                            <X className="w-3.5 h-3.5" /> Reject
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

        <TabsContent value="links" className="space-y-4">
          <PercentageSettings
            referrerPercent={referrerPercent}
            referredPercent={referredPercent}
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
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[
                          r.roomNumber ? `Room ${r.roomNumber}` : null,
                          `${r.pending} pending`,
                          `${r.joined} joined`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
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
    </div>
  );
}
