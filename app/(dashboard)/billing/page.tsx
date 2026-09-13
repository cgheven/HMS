import { redirect } from "next/navigation";
import { getOwnerBilling, getAuthContext } from "@/lib/data";
import { getPaddleClientConfig } from "@/lib/paddle";
import { reconcileSubscriptionMirror } from "@/lib/tier-sync";
import { BillingClient } from "@/components/modules/billing/billing-client";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  // Account-level: the account holder's SaaS subscription with Pulse, spanning
  // every branch. getOwnerBilling keys off owner_id, so a partner would render
  // an empty page rather than leak anything — but redirect explicitly instead
  // of showing a blank Billing screen that looks broken.
  const ctx = await getAuthContext();
  // Billing is account-level: only the owner (or super_admin) may see it. Managers
  // and partners have no owner billing context — send them back rather than render
  // a blank page. Data access is RLS-scoped to user.id regardless (defense in depth).
  if (ctx?.profile?.role !== "owner" && ctx?.profile?.role !== "super_admin") redirect("/dashboard");

  const { checkout } = await searchParams;
  // Self-heal the subscription mirror from Paddle before reading it, so the page is
  // never stale when the activation/upgrade webhook is delayed or (on localhost)
  // unreachable. Side-effect-safe: refreshes the display only, never charges.
  if (ctx?.user?.id) await reconcileSubscriptionMirror(ctx.user.id);
  const { billing, invoices, branchCount, subscription, paddlePayments, plan, customUnitAmountUsd, manualBankBilling, country, tier, trialEndsAt } = await getOwnerBilling();
  return (
    <BillingClient
      billing={billing}
      invoices={invoices}
      branchCount={branchCount}
      subscription={subscription}
      paddlePayments={paddlePayments}
      plan={plan}
      customUnitAmountUsd={customUnitAmountUsd}
      manualBankBilling={manualBankBilling}
      country={country}
      tier={tier}
      trialEndsAt={trialEndsAt}
      checkoutSuccess={checkout === "success"}
      ownerId={ctx?.user?.id ?? ""}
      ownerEmail={ctx?.user?.email ?? ""}
      paddle={getPaddleClientConfig()}
    />
  );
}
