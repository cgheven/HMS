import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Redirect the owner to Paddle's hosted invoice PDF for one of THEIR payments.
// Paddle is Merchant of Record, so it issues the tax invoice; the PDF URL is
// short-lived and must be fetched server-side with the API key. We verify the
// transaction belongs to the signed-in owner before handing back the link.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ txnId: string }> }) {
  const { txnId } = await params;
  const ctx = await getAuthContext();
  if (!ctx?.user) return NextResponse.redirect(new URL("/login", _req.url));

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("hms_paddle_transactions")
    .select("transaction_id")
    .eq("transaction_id", txnId)
    .eq("owner_id", ctx.user.id)
    .maybeSingle();
  if (!row) return new NextResponse("Not found", { status: 404 });

  try {
    const pdf = await getPaddleServer().transactions.getInvoicePDF(txnId);
    if (!pdf?.url) return new NextResponse("Invoice not available yet", { status: 404 });
    return NextResponse.redirect(pdf.url);
  } catch {
    return new NextResponse("Invoice not available yet", { status: 404 });
  }
}
