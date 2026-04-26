import { getBills } from "@/lib/data";
import { BillsClient } from "@/components/modules/bills/bills-client";

export default async function BillsPage() {
  const { hostelId, bills } = await getBills();
  return <BillsClient hostelId={hostelId} initialBills={bills} />;
}
