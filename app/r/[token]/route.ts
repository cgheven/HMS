import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReceiptPDF } from "@/lib/receipt-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return new NextResponse("Invalid link.", { status: 400 });
  }

  // Use admin client — hms_invoice_links RLS policy allows anon SELECT where
  // expires_at > now(). Admin client ensures this works even without a session.
  const supabase = createAdminClient();

  // F-012: Filter expiry in SQL so the DB enforces it regardless of which client
  // is used. The JS check below is a redundant safety net, not the primary control.
  const now = new Date().toISOString();
  const { data: link, error: linkErr } = await supabase
    .from("hms_invoice_links")
    .select("id, payment_id, hostel_id, expires_at")
    .eq("token", token)
    .gt("expires_at", now)
    .maybeSingle();

  if (linkErr || !link) {
    return new NextResponse("This receipt link has expired or does not exist.", {
      status: 410,
    });
  }

  // Redundant JS guard — belt-and-suspenders in case the SQL filter is ever removed
  if (new Date(link.expires_at) < new Date()) {
    return new NextResponse("This receipt link has expired.", { status: 410 });
  }

  // Fetch payment + tenant + hostel in parallel
  const [
    { data: payment, error: pErr },
    { data: hostel, error: hErr },
  ] = await Promise.all([
    supabase
      .from("hms_payments")
      .select(
        // F-008: cnic excluded — sensitive PII must not appear in public receipts
        "id, for_month, amount, late_fee, food_charge, ac_charge, ac_units_consumed, payment_method, payment_date, receipt_number, payment_package_tier, tenant:hms_tenants(full_name, phone, security_deposit, check_in)"
      )
      .eq("id", link.payment_id)
      .single(),
    supabase
      .from("hms_hostels")
      .select("name, address, phone")
      .eq("id", link.hostel_id)
      .single(),
  ]);

  if (pErr || !payment || hErr || !hostel) {
    return new NextResponse("Receipt data unavailable.", { status: 404 });
  }

  const tenant = Array.isArray(payment.tenant) ? payment.tenant[0] : payment.tenant;
  const tenantTyped = tenant as { full_name?: string; phone?: string | null; security_deposit?: number | null; check_in?: string | null } | null;

  // Include security deposit only on the first month's receipt (move-in month)
  const checkInMonth = tenantTyped?.check_in?.slice(0, 7);
  const securityDeposit = checkInMonth === payment.for_month ? Number(tenantTyped?.security_deposit ?? 0) : 0;

  const pdfBytes = generateReceiptPDF(
    {
      receipt_number: payment.receipt_number,
      for_month: payment.for_month,
      amount: Number(payment.amount),
      late_fee: Number(payment.late_fee ?? 0),
      food_charge: Number(payment.food_charge ?? 0),
      ac_charge: Number(payment.ac_charge ?? 0),
      ac_units_consumed: payment.ac_units_consumed ? Number(payment.ac_units_consumed) : null,
      security_deposit: securityDeposit,
      payment_method: payment.payment_method,
      payment_date: payment.payment_date,
      payment_package_tier: payment.payment_package_tier,
    },
    {
      full_name: tenantTyped?.full_name ?? "Tenant",
      phone: tenantTyped?.phone,
      // F-008: cnic intentionally omitted from public receipt
    },
    {
      name: hostel.name,
      address: hostel.address,
      phone: hostel.phone,
    }
  );

  const tenantName = (tenant as { full_name?: string })?.full_name?.replace(/\s+/g, "_") ?? "receipt";
  const filename = `receipt_${payment.for_month}_${tenantName}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
