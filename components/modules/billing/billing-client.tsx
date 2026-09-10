"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { Wallet, CheckCircle2, Clock, Download, CreditCard, Loader2, Check } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { clientDiscountPct } from "@/lib/pricing";
import { createPlanCheckoutAction } from "@/app/actions/paddle";
import type { ClientBilling, PlatformInvoice } from "@/types";

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
  };
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
  /** True when the owner just came back from a completed Paddle checkout. */
  checkoutSuccess: boolean;
}

type PlanKey = "basic" | "standard";
type Cycle = "monthly" | "annual";

const PLAN_FEATURES: Record<PlanKey, string[]> = {
  basic: ["Core HMS", "Reports & billing", "RedFlag", "Multi-branch", "Hotel Eye", "WhatsApp automation (Pakistan)"],
  standard: ["Everything in Basic", "Branded subdomain", "Email reminders", "Referral engine"],
};

function statusBadge(status: PlatformInvoice["status"]) {
  if (status === "paid") return { label: "Paid", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 };
  if (status === "cancelled") return { label: "Cancelled", cls: "text-muted-foreground bg-muted/30 border-sidebar-border", icon: Clock };
  return { label: "Unpaid", cls: "text-amber bg-amber/10 border-amber/20", icon: Clock };
}

export function BillingClient({ billing, invoices, branchCount, ownerId, ownerEmail, paddle, subscription, paddlePayments, checkoutSuccess }: Props) {
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
    let seen = 0;
    try { seen = Number(sessionStorage.getItem("pulse_checkout_refresh") ?? "0"); } catch {}
    if (seen >= 3) return;
    refreshedRef.current = true;
    const t = setTimeout(() => {
      try { sessionStorage.setItem("pulse_checkout_refresh", String(seen + 1)); } catch {}
      window.location.reload();
    }, 4000);
    return () => clearTimeout(t);
  }, [checkoutSuccess, subActive]);

  // Clear the guard once the subscription is live so a future checkout starts fresh.
  useEffect(() => {
    if (subActive) { try { sessionStorage.removeItem("pulse_checkout_refresh"); } catch {} }
  }, [subActive]);
  const subMonthly = subscription && subscription.unit_amount != null
    ? Number(subscription.unit_amount) * (subscription.quantity ?? 1)
    : null;

  const paddleEnabled = !!paddle.clientToken && !!paddle.prices.basicMonthly && !!paddle.prices.standardMonthly;
  const [paddleInst, setPaddleInst] = useState<Paddle | undefined>(undefined);
  const [cycle, setCycle] = useState<Cycle>("monthly");
  // priceId -> localized formatted total for `qty` branches (from Paddle.PricePreview)
  const [previewTotals, setPreviewTotals] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(true);
  const [choosing, setChoosing] = useState<PlanKey | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!paddleEnabled) { setPreviewLoading(false); return; }
    let cancelled = false;
    initializePaddle({ environment: paddle.environment, token: paddle.clientToken })
      .then((p) => { if (!cancelled && p) setPaddleInst(p); })
      .catch(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [paddleEnabled, paddle.environment, paddle.clientToken]);

  // Localized price preview for all four prices at the owner's real branch count.
  useEffect(() => {
    if (!paddleInst || subActive) return;
    const ids = Object.values(paddle.prices).filter(Boolean);
    if (ids.length === 0) { setPreviewLoading(false); return; }
    let cancelled = false;
    paddleInst.PricePreview({ items: ids.map((priceId) => ({ priceId, quantity: qty })) })
      .then((res) => {
        if (cancelled) return;
        const m: Record<string, string> = {};
        for (const li of res.data.details.lineItems) m[li.price.id] = li.formattedTotals.total;
        setPreviewTotals(m);
        setPreviewLoading(false);
      })
      .catch(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [paddleInst, subActive, qty, paddle.prices]);

  const choose = useCallback(async (plan: PlanKey) => {
    if (!paddleInst || choosing) return;
    setCheckoutError(null);
    setChoosing(plan);
    try {
      const res = await createPlanCheckoutAction({ plan, cycle });
      if (res.error || !res.transactionId) {
        setCheckoutError(res.error ?? "Could not start checkout. Please try again.");
        return;
      }
      // Transaction-based checkout: line items (and quantity) are locked server-side.
      // successUrl brings the owner back to /billing after payment so the page
      // refreshes into the active-subscription state and shows the new receipt.
      paddleInst.Checkout.open({
        transactionId: res.transactionId,
        settings: {
          displayMode: "overlay",
          theme: "dark",
          allowLogout: false,
          successUrl: `${window.location.origin}/billing?checkout=success`,
        },
      });
    } finally {
      setChoosing(null);
    }
  }, [paddleInst, choosing, cycle]);

  const priceIdFor = (plan: PlanKey): string =>
    plan === "basic"
      ? (cycle === "monthly" ? paddle.prices.basicMonthly : paddle.prices.basicAnnual)
      : (cycle === "monthly" ? paddle.prices.standardMonthly : paddle.prices.standardAnnual);

  const cycleTotal = billing?.monthly_rate != null
    ? billing.monthly_rate * (billing.billing_cycle === "annual" ? 12 : 1) * branchCount
    : null;
  const currentDiscountPct = billing?.monthly_rate != null ? clientDiscountPct(billing.monthly_rate) : 0;

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

      {/* Legacy manual plan card — shown only when there is no active Paddle
          subscription, so nothing about the existing manual-billing view changes
          for clients who aren't on card payment yet. */}
      {!subActive && (
        !billing || billing.monthly_rate == null || cycleTotal == null ? null : (
          <div className="rounded-2xl border border-sidebar-border bg-card p-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber/10 border border-amber/20"><Wallet className="w-4 h-4 text-amber" /></div>
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
            <div className="flex items-center gap-4">
              {billing.next_invoice_date && (
                <div className="text-right"><p className="text-xs text-muted-foreground">Next Billing Date</p><p className="text-sm font-semibold">{formatDate(billing.next_invoice_date)}</p></div>
              )}
              {outstanding > 0 && (
                <div className="text-right"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-lg font-bold text-amber">{formatCurrency(outstanding)}</p></div>
              )}
            </div>
          </div>
        )
      )}

      {subActive ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
            <div>
              <p className="text-sm font-semibold">Automatic card payment active{subscription!.status === "trialing" ? " (trial)" : ""}</p>
              <p className="text-xs text-muted-foreground">
                {subMonthly != null && <>{formatCurrency(subMonthly)}{subscription!.quantity ? ` · ${subscription!.quantity} branch${subscription!.quantity > 1 ? "es" : ""}` : ""} · </>}
                Renews {subscription!.current_period_end ? formatDate(subscription!.current_period_end) : "—"}
              </p>
            </div>
          </div>
          {subscription!.last_paid_at && (
            <div className="text-right"><p className="text-xs text-muted-foreground">Last payment</p><p className="text-sm font-semibold">{formatDate(subscription!.last_paid_at)}</p></div>
          )}
        </div>
      ) : paddleEnabled ? (
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Choose a plan</p>
              <p className="text-xs text-muted-foreground">Pay automatically by card — renews each cycle, no manual transfers. Priced per branch ({qty} {qty > 1 ? "branches" : "branch"}).</p>
            </div>
            {/* Monthly / Annual toggle */}
            <div className="inline-flex rounded-lg border border-sidebar-border p-0.5 text-xs">
              <button onClick={() => setCycle("monthly")} className={cn("px-3 py-1.5 rounded-md font-medium", cycle === "monthly" ? "bg-white/10 text-foreground" : "text-muted-foreground")}>Monthly</button>
              <button onClick={() => setCycle("annual")} className={cn("px-3 py-1.5 rounded-md font-medium", cycle === "annual" ? "bg-white/10 text-foreground" : "text-muted-foreground")}>Annual <span className="text-emerald-400">· 2 months free</span></button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {(["basic", "standard"] as PlanKey[]).map((plan) => {
              const pid = priceIdFor(plan);
              const total = previewTotals[pid];
              const isStd = plan === "standard";
              return (
                <div key={plan} className={cn("rounded-xl border p-5 flex flex-col gap-4", isStd ? "border-emerald-500/30 bg-emerald-500/5" : "border-sidebar-border bg-background/40")}>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold capitalize">{plan}</p>
                      {isStd && <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Most features</span>}
                    </div>
                    <p className="mt-1 text-2xl font-bold">
                      {previewLoading ? <span className="inline-block h-7 w-24 animate-pulse rounded bg-white/5 align-middle" /> : (total ?? "—")}
                      <span className="text-xs font-normal text-muted-foreground"> / {cycle === "monthly" ? "month" : "year"}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">for {qty} {qty > 1 ? "branches" : "branch"} · billed by card</p>
                  </div>
                  <ul className="space-y-1.5 flex-1">
                    {PLAN_FEATURES[plan].map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> {f}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => choose(plan)}
                    disabled={!paddleInst || !!choosing}
                    className={cn("inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium px-4 py-2 transition-colors disabled:opacity-50",
                      isStd ? "bg-emerald-600 hover:bg-emerald-600/90 text-white" : "border border-sidebar-border hover:bg-white/5")}
                  >
                    {choosing === plan ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {choosing === plan ? "Opening…" : `Choose ${plan}`}
                  </button>
                </div>
              );
            })}
          </div>
          {checkoutError && <p className="text-xs text-rose-400">{checkoutError}</p>}
        </div>
      ) : null}

      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-sidebar-border">
          <p className="text-sm font-semibold">Invoice History</p>
        </div>
        {invoices.length === 0 && paddlePayments.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No invoices yet.</div>
        ) : (
          <div className="divide-y divide-sidebar-border/60">
            {paddlePayments.map((p) => (
              <div key={p.transaction_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">Card payment{p.invoice_number ? ` · ${p.invoice_number}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{p.billed_at ? formatDate(p.billed_at) : "—"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{formatMoney(p.amount, p.currency_code)}</span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" /> Paid
                  </span>
                  <a href={`/billing/invoice/${p.transaction_id}`} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors" title="Download invoice PDF">
                    <Download className="w-3.5 h-3.5" />
                  </a>
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
                <div key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
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
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{formatCurrency(inv.amount)}</span>
                    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium border", badge.cls)}>
                      <Icon className="w-3 h-3" /> {badge.label}
                    </span>
                    <a href={`/invoice/${inv.share_token}`} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors" title="Download PDF">
                      <Download className="w-3.5 h-3.5" />
                    </a>
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
