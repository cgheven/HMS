import { redirect } from "next/navigation";
import { getOwnerBilling, getAuthContext } from "@/lib/data";
import { getPaddleClientConfig } from "@/lib/paddle";
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
  if (ctx?.profile?.role === "partner") redirect("/dashboard");

  const { checkout } = await searchParams;
  const { billing, invoices, branchCount, subscription, paddlePayments } = await getOwnerBilling();
  return (
    <BillingClient
      billing={billing}
      invoices={invoices}
      branchCount={branchCount}
      subscription={subscription}
      paddlePayments={paddlePayments}
      checkoutSuccess={checkout === "success"}
      ownerId={ctx?.user?.id ?? ""}
      ownerEmail={ctx?.user?.email ?? ""}
      paddle={getPaddleClientConfig()}
    />
  );
}
