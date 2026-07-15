import { getOwnerBilling } from "@/lib/data";
import { BillingClient } from "@/components/modules/billing/billing-client";

export default async function BillingPage() {
  const { billing, invoices } = await getOwnerBilling();
  return <BillingClient billing={billing} invoices={invoices} />;
}
