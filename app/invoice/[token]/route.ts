import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generatePlatformInvoicePDF } from "@/lib/platform-invoice-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return new NextResponse("Invalid link.", { status: 400 });
  }

  const admin = createAdminClient();

  const { data: invoice, error } = await admin
    .from("hms_platform_invoices")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !invoice) {
    return new NextResponse("This invoice link does not exist.", { status: 404 });
  }

  // Branch count and the rate/discount/onboarding snapshot are read from the
  // invoice itself (snapshotted at generation time in lib/invoice-generation.ts)
  // — not recomputed live, so an old invoice stays an accurate historical record
  // even if branches or billing config change later.
  const [{ data: profile }, { data: authUser }] = await Promise.all([
    admin.from("hms_profiles").select("full_name, phone, plan").eq("id", invoice.owner_id).maybeSingle(),
    admin.auth.admin.getUserById(invoice.owner_id),
  ]);

  const pdfBytes = generatePlatformInvoicePDF(
    {
      id: invoice.id,
      period_label: invoice.period_label,
      billing_cycle: invoice.billing_cycle,
      amount: Number(invoice.amount),
      due_date: invoice.due_date,
      status: invoice.status,
      created_at: invoice.created_at,
      paid_at: invoice.paid_at,
      branch_count: invoice.branch_count,
      monthly_rate: Number(invoice.monthly_rate),
      discount_pct: Number(invoice.discount_pct),
      onboarding_fee_charged: Number(invoice.onboarding_fee_charged),
      is_first_invoice: invoice.is_first_invoice,
      // Snapshot on the invoice; fall back to the owner's current plan for
      // pre-snapshot invoices (best available).
      plan: (invoice.plan as "basic" | "standard" | null) ?? (profile?.plan as "basic" | "standard" | null) ?? null,
    },
    {
      owner_name: profile?.full_name ?? "Client",
      owner_email: authUser?.user?.email ?? null,
      owner_phone: profile?.phone ?? null,
    }
  );

  // Content-Disposition is a Latin-1 header, so strip the label to ASCII first —
  // a non-Latin-1 char (em-dash, accented name) would otherwise throw on send.
  const asciiLabel = invoice.period_label.normalize("NFKD").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, "_");
  const filename = `pulse_invoice_${asciiLabel}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
