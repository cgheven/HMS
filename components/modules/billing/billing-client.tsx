"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Wallet, CheckCircle2, Clock, Download, CreditCard, Loader2, Check, Building2 } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { clientDiscountPct } from "@/lib/pricing";
import {
  SELF_SERVE_TIERS,
  TIER_LABEL,
  TIER_PROPERTIES_LABEL,
  priceFor,
  type PricingTier,
  type TierBillingCycle,
} from "@/lib/tier-pricing";
import type { Plan } from "@/lib/entitlements";
import { createPlanCheckoutAction, reconcileCheckoutAction } from "@/app/actions/paddle";
import type { ClientBilling, PlatformInvoice } from "@/types";

const SUPPORT_EMAIL = "hello@yourpulse.io";

const TIER_ORDER: PricingTier[] = ["basic", "standard", "business", "enterprise"];

type PaddlePayment = {
  transaction_id: string;
  amount: number | null;
  currency_code: string | null;
  status: string | null;
  invoice_number: string | null;
  billed_at: string | null;
};

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "USD" }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
  }
}

interface Props {
  billing: ClientBilling | null;
  invoices: PlatformInvoice[];
  branchCount: number;
  /** The account holder (auth user) — the subscription is tagged with this so
   *  the webhook can link it back. */
  ownerId: string;
  ownerEmail: string;
  /** Paddle config read on the server. Empty token = feature off (picker hidden). */
  paddle: {
    environment: "sandbox" | "production";
    clientToken: string;
    prices: { basicMonthly: string; standardMonthly: string; basicAnnual: string; standardAnnual: string };
    checkoutUrl: string;
  };
  /** The owner's billing/legal country (ISO alpha-2). Drives the local tier price. */
  country: string | null;
  /** The tier the owner's billable-property count puts them on (server-computed). */
  tier: PricingTier;
  /** Self-serve trial expiry (ISO). Non-null only for trial accounts. */
  trialEndsAt: string | null;
  /** The owner's Paddle subscription (mirror), or null if not set up yet. */
  subscription: {
    status: string;
    quantity: number | null;
    unit_amount: number | null;
    currency_code: string | null;
    current_period_end: string | null;
    last_paid_at: string | null;
  } | null;
  /** Paddle card-payment receipts, newest first. */
  paddlePayments: PaddlePayment[];
  /** The owner's account plan (features). NULL if unset. */
  plan: Plan | null;
  /** A grandfathered per-branch USD rate. When set, this owner pays their
   *  negotiated rate on their fixed plan — no plan picker. */
  customUnitAmountUsd: number | null;
  /** True when the owner just came back from a completed Paddle checkout. */
  checkoutSuccess: boolean;
  /** Whether the manual/bank billing rail applies (PK). When false the owner is
   *  Paddle-only (card): the manual plan card + bank invoice framing are hidden. */
  manualBankBilling: boolean;
}

type SelfServeTier = (typeof SELF_SERVE_TIERS)[number];
type Cycle = TierBillingCycle;

function statusBadge(status: PlatformInvoice["status"]) {
  if (status === "paid") return { label: "Paid", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 };
  if (status === "cancelled") return { label: "Cancelled", cls: "text-muted-foreground bg-muted/30 border-sidebar-border", icon: Clock };
  return { label: "Unpaid", cls: "text-amber bg-amber/10 border-amber/20", icon: Clock };
}

export function BillingClient({ billing, invoices, branchCount, ownerId, ownerEmail, paddle, subscription, paddlePayments, plan, customUnitAmountUsd, checkoutSuccess, manualBankBilling, country, tier, trialEndsAt }: Props) {
  const outstanding = invoices.filter((i) => i.status === "unpaid").reduce((s, i) => s + Number(i.amount), 0);
  const qty = Math.max(1, branchCount);

  const subActive = !!subscription && ["active", "trialing"].includes(subscription.status);

  // After a completed checkout Paddle redirects back here. The webhook that flips
  // the subscription to active lands a beat later, so if we're not active yet,
  // reload ONCE after a short delay to pick it up. sessionStorage guards against
  // a reload loop (this is post-checkout only, not an every-mount sync).
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!checkoutSuccess || subActive || refreshedRef.current) return;
    refreshedRef.current = true;
    let cancelled = false;
    (async () => {
      let txn = "";
      try { txn = sessionStorage.getItem("pulse_last_txn") ?? ""; } catch {}
      // Activate the subscription by reading it straight from Paddle — the inbound
      // webhook is delayed under load and cannot reach a localhost/tunnel-less app.
      // Poll a few times in case the payment is still settling into a subscription.
      for (let i = 0; i < 5 && !cancelled; i++) {
        const res = await reconcileCheckoutAction({ transactionId: txn });
        if (res.active) {
          try { sessionStorage.removeItem("pulse_last_txn"); } catch {}
          window.location.reload();
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => { cancelled = true; };
  }, [checkoutSuccess, subActive]);

  // Once the subscription is live, tidy up: drop the stashed transaction id and
  // strip ?checkout=success from the URL so a manual reload doesn't keep showing
  // the "Payment received" banner.
  useEffect(() => {
    if (!subActive) return;
    try { sessionStorage.removeItem("pulse_last_txn"); } catch {}
    if (checkoutSuccess && typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [subActive, checkoutSuccess]);
  // What the owner actually pays each cycle. The subscription mirror only stores
  // the LIST unit price (the per-country override lands on the real charge), so
  // the last payment is the accurate figure and currency to show.
  const lastPayment = paddlePayments[0] ?? null;
  const subAmountLabel =
    lastPayment?.amount != null
      ? formatMoney(lastPayment.amount, lastPayment.currency_code)
      : subscription?.unit_amount != null
        ? formatMoney(Number(subscription.unit_amount) * (subscription.quantity ?? 1), subscription.currency_code)
        : null;
  // The RECURRING amount shown on the active card = the tier's price (the mirror's
  // unit_amount is now the resolved tier price). Grandfathered custom-rate owners
  // keep the last-actual-charge figure (their mirror stores a list price, not their
  // negotiated rate).
  const recurringLabel = customUnitAmountUsd
    ? subAmountLabel
    : subscription?.unit_amount != null
      ? formatMoney(Number(subscription.unit_amount), subscription.currency_code)
      : subAmountLabel;

  // Card billing is "on" when a Paddle client token is configured. Prices are
  // now resolved server-side (per-country tier pricing), so there is no
  // client-side Paddle.PricePreview and no PADDLE_PRICE_ID preview ids.
  const paddleEnabled = !!paddle.clientToken;
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [choosing, setChoosing] = useState<PricingTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [contactUs, setContactUs] = useState(false);

  const choose = useCallback(async (clicked: PricingTier) => {
    if (choosing) return;
    setCheckoutError(null);
    setContactUs(false);
    setChoosing(clicked);
    try {
      // The tier is authoritative server-side (computed from the owner's billable
      // property count) — the button only carries the billing cycle.
      const res = await createPlanCheckoutAction({ cycle });
      if (res.contactUs) {
        // Enterprise: no self-serve price — surface the contact-us path instead.
        setContactUs(true);
        setChoosing(null);
        return;
      }
      if (res.error || !res.transactionId) {
        setCheckoutError(res.error ?? "Could not start checkout. Please try again.");
        setChoosing(null);
        return;
      }
      // Redirect to the checkout page on an APPROVED domain (prod: yourpulse.io).
      // That page opens Paddle for this transaction, so THIS app domain never
      // launches Paddle.js checkout and doesn't need domain approval. `return`
      // tells it where to send the buyer after a successful payment. The line
      // items + quantity are already locked server-side on the transaction.
      // Stash the transaction id so, on return, we can reconcile the subscription
      // straight from Paddle instead of waiting on the (possibly unreachable) webhook.
      try { sessionStorage.setItem("pulse_last_txn", res.transactionId); } catch {}
      const base = paddle.checkoutUrl || "/checkout";
      const sep = base.includes("?") ? "&" : "?";
      window.location.href =
        `${base}${sep}_ptxn=${encodeURIComponent(res.transactionId)}` +
        `&return=${encodeURIComponent(window.location.origin)}`;
    } catch {
      setCheckoutError("Could not start checkout. Please try again.");
      setChoosing(null);
    }
  }, [choosing, cycle, paddle.checkoutUrl]);

  const cycleTotal = billing?.monthly_rate != null
    ? billing.monthly_rate * (billing.billing_cycle === "annual" ? 12 : 1) * branchCount
    : null;
  // Legacy per-branch discount reference only applies to the original basic/standard
  // packages; higher tiers have no per-branch list rate to compare against.
  const legacyDiscountPlan = plan === "standard" ? "standard" : plan === "basic" ? "basic" : null;
  const currentDiscountPct = billing?.monthly_rate != null ? clientDiscountPct(billing.monthly_rate, legacyDiscountPlan) : 0;

  // Grandfathered client: a fixed negotiated USD rate on their existing plan —
  // no plan choice, just their rate. Annual mirrors the pay-10-get-12 (× 10).
  // A grandfathered custom-rate owner on the CARD rail keeps their "pay by card"
  // option. Manual/bank-billed owners (PK) never do — even with a custom rate — or
  // they'd see a "Pay by card" button that createPlanCheckoutAction rejects with
  // "billed by invoice". Gating on !manualBankBilling keeps that dead-end button
  // away from grandfathered manual (PK) clients.
  const isLegacy = paddleEnabled && !manualBankBilling && customUnitAmountUsd != null && customUnitAmountUsd > 0;
  const legacyPlanLabel = plan === "standard" ? "standard" : "basic";
  const legacyPerBranch = (customUnitAmountUsd ?? 0) * (cycle === "annual" ? 10 : 1);
  const legacyTotal = legacyPerBranch * qty;

  // Trial pay-after messaging: non-PK owner, no active subscription, and a
  // future trial-end date. The freeze itself is enforced by the daily cron.
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const showTrialBanner =
    !subActive && !manualBankBilling && trialEnd != null && !Number.isNaN(trialEnd.getTime()) && trialEnd.getTime() > Date.now();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground">Your Pulse subscription and invoice history</p>
      </div>

      {checkoutSuccess && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">Payment received.</span>{" "}
            {subActive ? "Your subscription is active." : "Activating your subscription — this can take a few seconds."}
          </p>
        </div>
      )}

      {showTrialBanner && trialEnd && (
        <div className="rounded-xl border border-amber/20 bg-amber/10 px-4 py-3 flex items-center gap-3">
          <Clock className="w-4 h-4 text-amber shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">Add a card to keep your account active</span> — trial ends {formatDate(trialEnd.toISOString())}.
          </p>
        </div>
      )}

      {/* Legacy manual plan card — the manual/bank rail (PK only). Hidden for
          Paddle-only (non-PK) owners, who never have a manual plan or bank dues.
          Shown only when there is no active Paddle subscription, so nothing about
          the existing manual-billing view changes for PK clients. */}
      {manualBankBilling && !subActive && (
        !billing || billing.monthly_rate == null || cycleTotal == null ? null : (
          <div className="rounded-2xl border border-sidebar-border bg-card p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber/10 border border-amber/20 shrink-0"><Wallet className="w-4 h-4 text-amber" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Current Plan</p>
                <p className="text-lg font-bold">
                  {formatCurrency(cycleTotal)}
                  <span className="text-sm font-normal text-muted-foreground"> / {billing.billing_cycle === "monthly" ? "month" : "year"}</span>
                  {currentDiscountPct > 0 && <span className="ml-2 text-xs font-semibold text-emerald-400">{currentDiscountPct.toFixed(0)}% off</span>}
                </p>
                {branchCount > 1 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatCurrency(billing.monthly_rate! * (billing.billing_cycle === "annual" ? 12 : 1))}/{billing.billing_cycle === "monthly" ? "mo" : "yr"} per branch × {branchCount} branches
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-sidebar-border/60 pt-4 sm:justify-end sm:gap-8 sm:border-t-0 sm:pt-0">
              {billing.next_invoice_date && (
                <div className="sm:text-right"><p className="text-xs text-muted-foreground">Next Billing Date</p><p className="text-sm font-semibold">{formatDate(billing.next_invoice_date)}</p></div>
              )}
              {outstanding > 0 && (
                <div className="sm:text-right"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-lg font-bold text-amber">{formatCurrency(outstanding)}</p></div>
              )}
            </div>
          </div>
        )
      )}

      {subActive ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
            <div>
              <p className="text-sm font-semibold">Automatic card payment active{subscription!.status === "trialing" ? " (trial)" : ""}</p>
              <p className="text-xs text-muted-foreground">
                {recurringLabel && <>{recurringLabel} · </>}
                {plan && <>{TIER_LABEL[plan]} · </>}
                {qty} propert{qty > 1 ? "ies" : "y"} · Renews {subscription!.current_period_end ? formatDate(subscription!.current_period_end) : "—"}
              </p>
            </div>
          </div>
          {subscription!.last_paid_at && (
            <div className="sm:text-right"><p className="text-xs text-muted-foreground">Last payment</p><p className="text-sm font-semibold">{formatDate(subscription!.last_paid_at)}</p></div>
          )}
        </div>
      ) : isLegacy ? (
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Pay by card</p>
              <p className="text-xs text-muted-foreground">Your negotiated rate — renews automatically, no manual transfers.</p>
            </div>
            <div className="inline-flex rounded-lg border border-sidebar-border p-0.5 text-xs">
              <button onClick={() => setCycle("monthly")} className={cn("px-3 py-1.5 rounded-md font-medium", cycle === "monthly" ? "bg-white/10 text-foreground" : "text-muted-foreground")}>Monthly</button>
              <button onClick={() => setCycle("annual")} className={cn("px-3 py-1.5 rounded-md font-medium", cycle === "annual" ? "bg-white/10 text-foreground" : "text-muted-foreground")}>Annual <span className="text-emerald-400">· 2 months free</span></button>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold capitalize">{legacyPlanLabel} <span className="ml-1 text-[10px] font-semibold text-amber uppercase tracking-wide align-middle">Your rate</span></p>
              <p className="mt-1 text-2xl font-bold">
                {formatMoney(legacyTotal, "USD")}
                <span className="text-xs font-normal text-muted-foreground"> / {cycle === "monthly" ? "month" : "year"}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">{formatMoney(legacyPerBranch, "USD")}/{cycle === "monthly" ? "mo" : "yr"} per branch · {qty} {qty > 1 ? "branches" : "branch"}</p>
            </div>
            <button
              onClick={() => choose(tier)}
              disabled={!!choosing}
              className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium px-4 py-2 transition-colors disabled:opacity-50 bg-emerald-600 hover:bg-emerald-600/90 text-white"
            >
              {choosing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {choosing ? "Opening…" : "Pay by card"}
            </button>
          </div>
          {checkoutError && <p className="text-xs text-rose-400">{checkoutError}</p>}
        </div>
      ) : manualBankBilling ? null : paddleEnabled ? (
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Choose a plan</p>
              <p className="text-xs text-muted-foreground">
                Flat price per tier — add properties within a tier at no extra cost. Your properties: {qty}.
              </p>
            </div>
            {/* Monthly / Annual toggle */}
            <div className="inline-flex rounded-lg border border-sidebar-border p-0.5 text-xs">
              <button onClick={() => setCycle("monthly")} className={cn("px-3 py-1.5 rounded-md font-medium", cycle === "monthly" ? "bg-white/10 text-foreground" : "text-muted-foreground")}>Monthly</button>
              <button onClick={() => setCycle("annual")} className={cn("px-3 py-1.5 rounded-md font-medium", cycle === "annual" ? "bg-white/10 text-foreground" : "text-muted-foreground")}>Annual <span className="text-emerald-400">· 2 months free</span></button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SELF_SERVE_TIERS.map((t) => {
              const price = priceFor(country, t, cycle);
              const isCurrent = t === tier;
              return (
                <div key={t} className={cn("rounded-xl border p-5 flex flex-col gap-4", isCurrent ? "border-emerald-500/40 bg-emerald-500/5" : "border-sidebar-border bg-background/40")}>
                  <div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-bold">{TIER_LABEL[t]}</p>
                      <div className="flex items-center gap-1.5">
                        {t === "standard" && <span className="text-[10px] font-semibold text-amber uppercase tracking-wide">Most Popular</span>}
                        {isCurrent && <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Your tier</span>}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{TIER_PROPERTIES_LABEL[t]}</p>
                    <p className="mt-2 text-2xl font-bold">
                      {formatMoney(price.amount, price.currency)}
                      <span className="text-xs font-normal text-muted-foreground"> / {cycle === "monthly" ? "month" : "year"}</span>
                    </p>
                    {cycle === "annual" && <p className="text-[11px] text-emerald-400">2 months free</p>}
                  </div>
                  <div className="flex-1">
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Full PulseHub access</p>
                  </div>
                  {/* Only the owner's CURRENT tier (their property count) can be
                      checked out — the charge is server-computed from that count,
                      so a button on any other card would open checkout at a price
                      that doesn't match the card the owner clicked. Other tiers are
                      shown for reference only. */}
                  {isCurrent ? (
                    <button
                      onClick={() => choose(t)}
                      disabled={!!choosing}
                      className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium px-4 py-2 transition-colors disabled:opacity-50 bg-emerald-600 hover:bg-emerald-600/90 text-white"
                    >
                      {choosing === t ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                      {choosing === t ? "Opening…" : "Subscribe"}
                    </button>
                  ) : (
                    <p className="text-[11px] text-muted-foreground text-center py-2">
                      {TIER_ORDER.indexOf(t) < TIER_ORDER.indexOf(tier) ? "Below your property count" : "Add properties to reach this tier"}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Enterprise — custom quote, no self-serve checkout. */}
            <div className={cn("rounded-xl border p-5 flex flex-col gap-4", tier === "enterprise" ? "border-emerald-500/40 bg-emerald-500/5" : "border-sidebar-border bg-background/40")}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{TIER_LABEL.enterprise}</p>
                  {tier === "enterprise" && <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Your tier</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">{TIER_PROPERTIES_LABEL.enterprise}</p>
                <p className="mt-2 text-2xl font-bold">Custom<span className="text-xs font-normal text-muted-foreground"> pricing</span></p>
              </div>
              <div className="flex-1">
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Full PulseHub access + dedicated support</p>
              </div>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Pulse Enterprise enquiry")}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium px-4 py-2 transition-colors border border-sidebar-border hover:bg-white/5"
              >
                <Building2 className="w-4 h-4" /> Contact us
              </a>
            </div>
          </div>
          <div className="rounded-xl border border-sidebar-border bg-background/40 p-5">
            <p className="text-sm font-semibold mb-1.5">Everything included</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Residents • Rooms &amp; Beds • Rent &amp; Payments • Deposits • Electricity Units • Expenses • Complaints • Announcements • Staff &amp; Permissions • Reports • Admission Forms • Website • Feedback • Multi-Property Management
            </p>
          </div>
          {contactUs && (
            <p className="text-xs text-muted-foreground">
              With {qty} properties you&apos;re on our Enterprise tier — <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Pulse Enterprise enquiry")}`} className="text-emerald-400 hover:underline">contact us</a> for a custom quote.
            </p>
          )}
          {checkoutError && <p className="text-xs text-rose-400">{checkoutError}</p>}
        </div>
      ) : (
        // Paddle-only (non-PK) owner but card billing isn't configured yet — never
        // leave them at a dead end with no manual rail to fall back to.
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 text-sm text-muted-foreground">
          Card billing for your region is being set up. Please contact support to activate your subscription.
        </div>
      )}

      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-sidebar-border">
          <p className="text-sm font-semibold">Invoice History</p>
        </div>
        {invoices.length === 0 && paddlePayments.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No invoices yet.</div>
        ) : (
          <div className="divide-y divide-sidebar-border/60">
            {paddlePayments.map((p) => (
              <div key={p.transaction_id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Card payment{p.invoice_number ? ` · ${p.invoice_number}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{p.billed_at ? formatDate(p.billed_at) : "—"}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-sm font-semibold">{formatMoney(p.amount, p.currency_code)}</span>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" /> Paid
                    </span>
                    <a href={`/billing/invoice/${p.transaction_id}`} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors" title="Download invoice PDF">
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
            {invoices.map((inv) => {
              const badge = statusBadge(inv.status);
              const Icon = badge.icon;
              const cycleUnit = inv.billing_cycle === "monthly" ? "mo" : "yr";
              const perBranchAmount = Number(inv.monthly_rate) * (inv.billing_cycle === "annual" ? 12 : 1);
              const showBreakdown = inv.branch_count > 1 || inv.discount_pct > 0 || (inv.is_first_invoice && inv.onboarding_fee_charged > 0);
              return (
                <div key={inv.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{inv.period_label}</p>
                    <p className="text-xs text-muted-foreground">Due {formatDate(inv.due_date)}</p>
                    {showBreakdown && (
                      <p className="text-xs text-muted-foreground">
                        {inv.branch_count > 1 && <>{formatCurrency(perBranchAmount)}/{cycleUnit} per branch</>}
                        {inv.discount_pct > 0 && <span className="text-emerald-400">{inv.branch_count > 1 ? " · " : ""}{Number(inv.discount_pct).toFixed(0)}% discount applied</span>}
                        {inv.is_first_invoice && inv.onboarding_fee_charged > 0 && <span>{(inv.branch_count > 1 || inv.discount_pct > 0) ? " · " : ""}includes one-time onboarding fee</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-sm font-semibold">{formatCurrency(inv.amount)}</span>
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium border", badge.cls)}>
                        <Icon className="w-3 h-3" /> {badge.label}
                      </span>
                      <a href={`/invoice/${inv.share_token}`} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors" title="Download PDF">
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
