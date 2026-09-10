"use client";

import { useEffect, useState, useCallback } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { Wallet, CheckCircle2, Clock, Download, CreditCard, Loader2 } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { clientDiscountPct } from "@/lib/pricing";
import type { ClientBilling, PlatformInvoice } from "@/types";

interface Props {
  billing: ClientBilling | null;
  invoices: PlatformInvoice[];
  branchCount: number;
  /** The account holder (auth user) — used to prefill checkout and tag the
   *  subscription so the webhook can link it back. */
  ownerId: string;
  ownerEmail: string;
  /** Paddle config read on the server. Empty tokens = feature off (control hidden). */
  paddle: { environment: "sandbox" | "production"; clientToken: string; priceId: string };
  /** The owner's Paddle subscription (mirror), or null if they haven't set up
   *  automatic card payment yet. */
  subscription: {
    status: string;
    quantity: number | null;
    unit_amount: number | null;
    currency_code: string | null;
    current_period_end: string | null;
    last_paid_at: string | null;
  } | null;
}

function statusBadge(status: PlatformInvoice["status"]) {
  if (status === "paid") {
    return { label: "Paid", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 };
  }
  if (status === "cancelled") {
    return { label: "Cancelled", cls: "text-muted-foreground bg-muted/30 border-sidebar-border", icon: Clock };
  }
  return { label: "Unpaid", cls: "text-amber bg-amber/10 border-amber/20", icon: Clock };
}

export function BillingClient({ billing, invoices, branchCount, ownerId, ownerEmail, paddle, subscription }: Props) {
  const outstanding = invoices.filter((i) => i.status === "unpaid").reduce((s, i) => s + Number(i.amount), 0);

  const subActive = !!subscription && ["active", "trialing"].includes(subscription.status);
  const subMonthly = subscription && subscription.unit_amount != null
    ? Number(subscription.unit_amount) * (subscription.quantity ?? 1)
    : null;

  // Paddle.js checkout for the owner's own Pulse subscription. Initialised once
  // when the token is present; the button stays disabled until it's ready.
  const paddleEnabled = !!paddle.clientToken && !!paddle.priceId;
  const [paddleInst, setPaddleInst] = useState<Paddle | undefined>(undefined);
  const [checkoutOpening, setCheckoutOpening] = useState(false);

  useEffect(() => {
    if (!paddleEnabled) return;
    let cancelled = false;
    initializePaddle({ environment: paddle.environment, token: paddle.clientToken })
      .then((p) => { if (!cancelled && p) setPaddleInst(p); })
      .catch(() => {/* control simply stays disabled */});
    return () => { cancelled = true; };
  }, [paddleEnabled, paddle.environment, paddle.clientToken]);

  const openCheckout = useCallback(() => {
    if (!paddleInst) return;
    setCheckoutOpening(true);
    paddleInst.Checkout.open({
      items: [{ priceId: paddle.priceId, quantity: Math.max(1, branchCount) }],
      // Prefill and tag the transaction so the webhook can match it to this
      // account. custom_data flows through to the subscription + every event.
      ...(ownerEmail ? { customer: { email: ownerEmail } } : {}),
      customData: { owner_id: ownerId },
      settings: { displayMode: "overlay", theme: "dark", allowLogout: false },
    });
    setCheckoutOpening(false);
  }, [paddleInst, paddle.priceId, branchCount, ownerEmail, ownerId]);

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

      {!billing || billing.monthly_rate == null || cycleTotal == null ? (
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 text-sm text-muted-foreground">
          Your plan hasn't been set up yet — reach out to us and we'll get it sorted.
        </div>
      ) : (
        <div className="rounded-2xl border border-sidebar-border bg-card p-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
              <Wallet className="w-4 h-4 text-amber" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Plan</p>
              <p className="text-lg font-bold">
                {formatCurrency(cycleTotal)}
                <span className="text-sm font-normal text-muted-foreground"> / {billing.billing_cycle === "monthly" ? "month" : "year"}</span>
                {currentDiscountPct > 0 && (
                  <span className="ml-2 text-xs font-semibold text-emerald-400">{currentDiscountPct.toFixed(0)}% off</span>
                )}
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
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Next Billing Date</p>
                <p className="text-sm font-semibold">{formatDate(billing.next_invoice_date)}</p>
              </div>
            )}
            {outstanding > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-lg font-bold text-amber">{formatCurrency(outstanding)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {subActive ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                Automatic card payment active{subscription!.status === "trialing" ? " (trial)" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {subMonthly != null && (
                  <>{formatCurrency(subMonthly)}/month{subscription!.quantity ? ` · ${subscription!.quantity} branch${subscription!.quantity > 1 ? "es" : ""}` : ""} · </>
                )}
                Renews {subscription!.current_period_end ? formatDate(subscription!.current_period_end) : "—"}
              </p>
            </div>
          </div>
          {subscription!.last_paid_at && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Last payment</p>
              <p className="text-sm font-semibold">{formatDate(subscription!.last_paid_at)}</p>
            </div>
          )}
        </div>
      ) : paddleEnabled ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CreditCard className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">Pay automatically by card</p>
              <p className="text-xs text-muted-foreground">Set up your Pulse subscription once — it renews each cycle with no manual transfers.</p>
            </div>
          </div>
          <button
            onClick={openCheckout}
            disabled={!paddleInst || checkoutOpening}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-600/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {!paddleInst ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {paddleInst ? "Set up card payment" : "Loading…"}
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-sidebar-border">
          <p className="text-sm font-semibold">Invoice History</p>
        </div>
        {invoices.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No invoices yet.</div>
        ) : (
          <div className="divide-y divide-sidebar-border/60">
            {invoices.map((inv) => {
              const badge = statusBadge(inv.status);
              const Icon = badge.icon;
              // The rate/discount/onboarding snapshot lives on the invoice itself now —
              // no need to recompute against a separate list-price reference. monthly_rate
              // is per branch, per month — not amount/branch_count, which would be skewed
              // by the flat one-time onboarding fee on a client's first invoice.
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
                        {inv.discount_pct > 0 && (
                          <span className="text-emerald-400">
                            {inv.branch_count > 1 ? " · " : ""}{Number(inv.discount_pct).toFixed(0)}% discount applied
                          </span>
                        )}
                        {inv.is_first_invoice && inv.onboarding_fee_charged > 0 && (
                          <span>{(inv.branch_count > 1 || inv.discount_pct > 0) ? " · " : ""}includes one-time onboarding fee</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{formatCurrency(inv.amount)}</span>
                    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium border", badge.cls)}>
                      <Icon className="w-3 h-3" /> {badge.label}
                    </span>
                    <a
                      href={`/invoice/${inv.share_token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-lg border border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                      title="Download PDF"
                    >
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
