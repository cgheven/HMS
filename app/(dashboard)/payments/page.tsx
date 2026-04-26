import { getPaymentsData } from "@/lib/data";
import { PaymentsClient } from "@/components/modules/payments/payments-client";

export default async function PaymentsPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const data = await getPaymentsData(defaultMonth);
  return <PaymentsClient {...data} initialMonth={defaultMonth} />;
}
