import { getBills, getAuthContext } from "@/lib/data";
import { BillsClient } from "@/components/modules/bills/bills-client";

export default async function BillsPage() {
  const [{ hostelId, bills }, ctx] = await Promise.all([getBills(), getAuthContext()]);
  return <BillsClient key={hostelId ?? ''} hostelId={hostelId} initialBills={bills} partnerTier={ctx?.partnerTier} />;
}
