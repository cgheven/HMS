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

  // Fetch payment + tenant + hostel + AC rate in parallel
  const [
    { data: payment, error: pErr },
    { data: hostel, error: hErr },
    { data: pkgConfig },
  ] = await Promise.all([
    supabase
      .from("hms_payments")
      .select(
        // F-008: cnic excluded — sensitive PII must not appear in public receipts
        "id, for_month, amount, late_fee, food_charge, ac_charge, ac_units_consumed, payment_method, payment_date, receipt_number, payment_package_tier, tenant:hms_tenants(full_name, phone, security_deposit, check_in, check_out)"
      )
      .eq("id", link.payment_id)
      .single(),
    supabase
      .from("hms_hostels")
      .select("name, address, phone")
      .eq("id", link.hostel_id)
      .single(),
    supabase
      .from("hms_package_configs")
      .select("ac_per_unit_rate")
      .eq("hostel_id", link.hostel_id)
      .maybeSingle(),
  ]);

  if (pErr || !payment || hErr || !hostel) {
    return new NextResponse("Receipt data unavailable.", { status: 404 });
  }

  // Self-heal: generate + persist receipt_number on first view if it was never set.
  if (!payment.receipt_number) {
    const tenantRaw = Array.isArray(payment.tenant) ? payment.tenant[0] : payment.tenant;
    const tenantName = (tenantRaw as { full_name?: string })?.full_name ?? "";
    const initials = tenantName.split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
    const rand = Math.floor(Math.random() * 900 + 100);
    const generated = `HMS-${payment.for_month.replace("-", "")}-${initials}-${rand}`;
    await supabase.from("hms_payments").update({ receipt_number: generated }).eq("id", payment.id);
    payment.receipt_number = generated;
  }

  const tenant = Array.isArray(payment.tenant) ? payment.tenant[0] : payment.tenant;
  const tenantTyped = tenant as { full_name?: string; phone?: string | null; security_deposit?: number | null; check_in?: string | null; check_out?: string | null } | null;

  const checkInMonth = tenantTyped?.check_in?.slice(0, 7);
  const checkOutMonth = tenantTyped?.check_out?.slice(0, 7);
  // Show security deposit on move-in month (tenant pays it) AND checkout month (to be refunded).
  const isFirstMonth = checkInMonth === payment.for_month;
  const isCheckout = !!checkOutMonth && checkOutMonth === payment.for_month;
  const securityDeposit = (isFirstMonth || isCheckout) ? Number(tenantTyped?.security_deposit ?? 0) : 0;

  const pdfBytes = generateReceiptPDF(
    {
      receipt_number: payment.receipt_number,
      for_month: payment.for_month,
      amount: Number(payment.amount),
      late_fee: Number(payment.late_fee ?? 0),
      food_charge: Number(payment.food_charge ?? 0),
      ac_charge: Number(payment.ac_charge ?? 0),
      ac_units_consumed: payment.ac_units_consumed ? Number(payment.ac_units_consumed) : null,
      ac_per_unit_rate: pkgConfig?.ac_per_unit_rate ? Number(pkgConfig.ac_per_unit_rate) : undefined,
      security_deposit: securityDeposit,
      is_checkout: isCheckout,
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
