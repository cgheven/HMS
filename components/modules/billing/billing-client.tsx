"use client";

import { Wallet, CheckCircle2, Clock, Download } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { ClientBilling, PlatformInvoice } from "@/types";

interface Props {
  billing: ClientBilling | null;
  invoices: PlatformInvoice[];
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

export function BillingClient({ billing, invoices }: Props) {
  const outstanding = invoices.filter((i) => i.status === "unpaid").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground">Your Pulse subscription and invoice history</p>
      </div>

      {!billing || billing.custom_price == null ? (
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
                {formatCurrency(billing.custom_price)}
                <span className="text-sm font-normal text-muted-foreground"> / {billing.billing_cycle === "monthly" ? "month" : "year"}</span>
              </p>
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
              // Discount % is unit-agnostic (always compared annualized internally), but the
              // displayed amounts stay in whichever cycle the client actually opted into —
              // a monthly client shouldn't see their bill re-framed as an annual number.
              const cycleUnit = inv.billing_cycle === "monthly" ? "mo" : "yr";
              const perBranchAmount = Number(inv.amount) / inv.branch_count;
              const actualAnnual = inv.billing_cycle === "annual" ? Number(inv.amount) : Number(inv.amount) * 12;
              const discount = Math.max(0, Number(inv.standard_annual_price) - actualAnnual);
              const discountPct = Number(inv.standard_annual_price) > 0 ? (discount / Number(inv.standard_annual_price)) * 100 : 0;
              const showBreakdown = inv.branch_count > 1 || discount > 0;
              return (
                <div key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{inv.period_label}</p>
                    <p className="text-xs text-muted-foreground">Due {formatDate(inv.due_date)}</p>
                    {showBreakdown && (
                      <p className="text-xs text-muted-foreground">
                        {inv.branch_count > 1 && <>{formatCurrency(perBranchAmount)}/{cycleUnit} per branch</>}
                        {discount > 0 && (
                          <span className="text-emerald-400">
                            {inv.branch_count > 1 ? " · " : ""}{discountPct.toFixed(0)}% discount applied
                          </span>
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
