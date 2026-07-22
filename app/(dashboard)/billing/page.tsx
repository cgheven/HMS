import { redirect } from "next/navigation";
import { getOwnerBilling, getAuthContext } from "@/lib/data";
import { BillingClient } from "@/components/modules/billing/billing-client";

export default async function BillingPage() {
  // Account-level: the account holder's SaaS subscription with Pulse, spanning
  // every branch. getOwnerBilling keys off owner_id, so a partner would render
  // an empty page rather than leak anything — but redirect explicitly instead
  // of showing a blank Billing screen that looks broken.
  const ctx = await getAuthContext();
  if (ctx?.profile?.role === "partner") redirect("/dashboard");

  const { billing, invoices, branchCount } = await getOwnerBilling();
  return <BillingClient billing={billing} invoices={invoices} branchCount={branchCount} />;
}
