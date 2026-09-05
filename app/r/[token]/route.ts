import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReceiptPDF } from "@/lib/receipt-pdf";
import { countBillableNights } from "@/lib/daily-billing";

const RECEIPT_BUCKET = "receipts";

/** Deterministic, so every link pointing at the same payment shares one stored
 *  object instead of each caching its own copy. Regeneration overwrites in
 *  place (upsert), so the bucket never accumulates stale versions. */
function receiptStoragePath(
  hostelId: string,
  scope: { paymentId: string } | { installmentId: string }
): string {
  return "installmentId" in scope
    ? `${hostelId}/inst_${scope.installmentId}.pdf`
    : `${hostelId}/${scope.paymentId}.pdf`;
}

function pdfResponse(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  stamp: string,
  immutable: boolean
): NextResponse {
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // An installment receipt is a frozen snapshot and can be cached hard. A
      // payment-scoped one tracks the live row, so it revalidates every time —
      // but the ETag turns that into a 304 rather than a re-download.
      "Cache-Control": immutable
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
      ETag: `"${stamp}"`,
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return new NextResponse("Invalid link.", { status: 400 });
  }

  // Use admin client — hms_invoice_links RLS policy allows anon SELECT where
  // expires_at IS NULL (permanent) OR expires_at > now(). Admin client ensures
  // this works even without a session.
  const supabase = createAdminClient();

  // F-012: Filter expiry in SQL so the DB enforces it regardless of which client
  // is used. The JS check below is a redundant safety net, not the primary control.
  const now = new Date().toISOString();
  const { data: link, error: linkErr } = await supabase
    .from("hms_invoice_links")
    .select(
      "id, payment_id, installment_id, hostel_id, expires_at, pdf_path, pdf_stamp, pdf_filename, payment:hms_payments(updated_at)"
    )
    .eq("token", token)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();

  if (linkErr || !link) {
    return new NextResponse("This receipt link has expired or does not exist.", {
      status: 410,
    });
  }

  // Redundant JS guard — belt-and-suspenders in case the SQL filter is ever
  // removed. NULL expires_at means permanent, never treat it as expired.
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return new NextResponse("This receipt link has expired.", { status: 410 });
  }

  // ── Cache fast path ────────────────────────────────────────────────────────
  // An installment link renders an immutable snapshot row, so once built it is
  // valid forever. A payment link tracks the live row, so it is only valid
  // while the payment's updated_at still matches what it was stamped with.
  const linkedPayment = Array.isArray(link.payment) ? link.payment[0] : link.payment;
  const isImmutableScope = !!link.installment_id;
  const currentStamp = isImmutableScope
    ? "immutable"
    : ((linkedPayment as { updated_at?: string } | null)?.updated_at ?? "");

  const cacheIsFresh = !!link.pdf_path && !!currentStamp && link.pdf_stamp === currentStamp;

  if (cacheIsFresh) {
    if (req.headers.get("if-none-match") === `"${currentStamp}"`) {
      return new NextResponse(null, { status: 304 });
    }
    const { data: cached } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .download(link.pdf_path as string);
    if (cached) {
      return pdfResponse(
        Buffer.from(await cached.arrayBuffer()),
        link.pdf_filename ?? "receipt.pdf",
        currentStamp,
        isImmutableScope
      );
    }
    // Object missing (manually purged, or a failed upload persisted a path) —
    // fall through and rebuild rather than 404 a receipt that is still valid.
  }

  // An installment-scoped link resolves the payment_id from the snapshot row —
  // both branches converge on the same payment_id below.
  let installmentSnapshot: {
    amount: number; amount_after: number; total_due: number; late_fee: number;
    payment_method: string | null; payment_date: string | null; receipt_number: string | null;
  } | null = null;
  let paymentId = link.payment_id;

  if (link.installment_id) {
    const { data: installment, error: instErr } = await supabase
      .from("hms_payment_installments")
      .select("payment_id, amount, amount_after, total_due, late_fee, payment_method, payment_date, receipt_number")
      .eq("id", link.installment_id)
      .single();
    if (instErr || !installment) {
      return new NextResponse("Receipt data unavailable.", { status: 404 });
    }
    installmentSnapshot = installment;
    paymentId = installment.payment_id;
  }

  if (!paymentId) {
    return new NextResponse("Receipt data unavailable.", { status: 404 });
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
        "id, for_month, amount, amount_paid, late_fee, food_charge, ac_charge, ac_units_consumed, security_deposit_charge, registration_fee_charge, ac_maintenance_charge, referral_discount, referral_percent, discount_amount, discount_percent, payment_method, payment_date, receipt_number, payment_package_tier, status, is_reservation, billed_days, daily_rate_billed, updated_at, tenant:hms_tenants(full_name, phone, security_deposit, check_in, check_out, is_active, billing_type, daily_rate, joining_meter_reading, food_breakfast, food_lunch, food_dinner)"
      )
      .eq("id", paymentId)
      .single(),
    supabase
      .from("hms_hostels")
      .select("name, address, phone")
      .eq("id", link.hostel_id)
      .single(),
    supabase
      .from("hms_package_configs")
      .select("ac_per_unit_rate, ac_charge_label")
      .eq("hostel_id", link.hostel_id)
      .maybeSingle(),
  ]);

  if (pErr || !payment || hErr || !hostel) {
    return new NextResponse("Receipt data unavailable.", { status: 404 });
  }

  // A plain payment-scoped link (not installment-scoped) still reflects the LIVE
  // row, so it still needs the "has this actually been collected" guard.
  // Installment-scoped links are always historical snapshots of money that was
  // genuinely received, so this guard doesn't apply to them.
  // An uncollected bill is served as an INVOICE rather than refused. It used to
  // 409 here, which was right while only receipts existed: a receipt asserts
  // money was received. An invoice asserts the opposite, and it is the same
  // itemised breakdown the tenant needs when they ask why the figure is what it
  // is. Installment-scoped links are always historical snapshots of money that
  // WAS received, so they are never invoices.
  // Decided on MONEY HELD, not on status. An undone payment leaves the bill at
  // partially_paid with amount_paid = 0 (that collected status is what stops the
  // monthly sync re-pricing a historical bill), and status alone rendered it as
  // a "PARTIAL PAYMENT RECEIPT / Amount Received Rs. 0" — a receipt for nothing,
  // on the permanent link the tenant was already sent.
  const heldAmount = Number((payment as { amount_paid?: number | null }).amount_paid ?? 0);
  const isInvoice =
    !installmentSnapshot &&
    (heldAmount <= 0.009 || (payment.status !== "paid" && payment.status !== "partially_paid"));

  // A waived bill is owed by nobody. Printing "AMOUNT DUE" over it would ask a
  // tenant for money the hostel has already written off.
  if (isInvoice && payment.status === "waived") {
    return new NextResponse("This bill has been waived — nothing is due.", { status: 409 });
  }

  // Tracks the updated_at the cached bytes will correspond to. The self-heal
  // below writes to the payment and therefore moves updated_at, so the stamp
  // must be taken from AFTER that write — stamping the pre-write value would
  // make the very first cache entry stale on arrival.
  let stampSource: string | null = (payment as { updated_at?: string }).updated_at ?? null;

  // Self-heal: generate + persist receipt_number on first view if it was never
  // set. Never for an invoice — stamping a receipt number onto a bill holding no
  // money manufactures evidence of a payment that was not made, and an undo
  // clears receipt_number precisely so it is not carried over.
  if (!installmentSnapshot && !isInvoice && !payment.receipt_number) {
    const tenantRaw = Array.isArray(payment.tenant) ? payment.tenant[0] : payment.tenant;
    const tenantName = (tenantRaw as { full_name?: string })?.full_name ?? "";
    const initials = tenantName.split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2);
    const rand = Math.floor(Math.random() * 900 + 100);
    const generated = `HMS-${payment.for_month.replace("-", "")}-${initials}-${rand}`;
    const { data: healed } = await supabase
      .from("hms_payments")
      .update({ receipt_number: generated })
      .eq("id", payment.id)
      .select("updated_at")
      .single();
    payment.receipt_number = generated;
    stampSource = (healed as { updated_at?: string } | null)?.updated_at ?? stampSource;
  }

  const tenant = Array.isArray(payment.tenant) ? payment.tenant[0] : payment.tenant;
  const tenantTyped = tenant as { full_name?: string; phone?: string | null; security_deposit?: number | null; check_in?: string | null; check_out?: string | null; is_active?: boolean; billing_type?: string | null; daily_rate?: number | null; joining_meter_reading?: number | null; food_breakfast?: boolean; food_lunch?: boolean; food_dinner?: boolean } | null;

  const checkOutMonth = tenantTyped?.check_out?.slice(0, 7);
  // "Has actually left", not "their planned departure falls in this month".
  // A DAILY tenant has check_out set at creation as their intended last day, so
  // matching on the month alone printed a "Security Deposit Refund" line on the
  // very first receipt — next to the deposit being collected, reading as a
  // double charge. Only a tenant who is no longer active has a deposit to
  // refund. Monthly tenants never exposed this because check_out is only ever
  // written when they genuinely check out.
  const isReservation = !!payment.is_reservation;
  // A waiting-list tenant is is_active = false with no check_out, so this is
  // already false for a reservation — pinned explicitly anyway, because a
  // deposit-refund line on a receipt for the deposit being COLLECTED would
  // read as the money going straight back out again.
  const isCheckout =
    !isReservation &&
    tenantTyped?.is_active === false && !!checkOutMonth && checkOutMonth === payment.for_month;
  // Deposit REFUND is shown only at checkout — informational, not part of `amount`.
  // Deposit COLLECTION is driven by payment.security_deposit_charge below (embedded
  // in `amount` for the tenant's first billing month), not guessed from the month here.
  const securityDepositRefund = isCheckout ? Number(tenantTyped?.security_deposit ?? 0) : 0;

  // food_charge/ac_charge/ac_units_consumed/security_deposit_charge come from the
  // live payment row — these reflect the month's fixed bill composition and don't
  // change between installments, so it's safe to use them even for a historical snapshot.
  const pdfBytes = generateReceiptPDF(
    {
      receipt_number: installmentSnapshot?.receipt_number ?? payment.receipt_number,
      for_month: payment.for_month,
      amount: installmentSnapshot ? (installmentSnapshot.total_due - installmentSnapshot.late_fee) : Number(payment.amount),
      amount_paid: installmentSnapshot
        ? installmentSnapshot.amount_after
        : (payment.status === "partially_paid" ? Number(payment.amount_paid ?? 0) : undefined),
      late_fee: installmentSnapshot ? installmentSnapshot.late_fee : Number(payment.late_fee ?? 0),
      food_charge: Number(payment.food_charge ?? 0),
      ac_charge: Number(payment.ac_charge ?? 0),
      ac_units_consumed: payment.ac_units_consumed ? Number(payment.ac_units_consumed) : null,
      ac_per_unit_rate: pkgConfig?.ac_per_unit_rate ? Number(pkgConfig.ac_per_unit_rate) : undefined,
      security_deposit_charge: Number(payment.security_deposit_charge ?? 0),
      registration_fee_charge: Number(payment.registration_fee_charge ?? 0),
      ac_maintenance_charge: Number(payment.ac_maintenance_charge ?? 0),
      referral_discount: Number(payment.referral_discount ?? 0),
      referral_percent: Number(payment.referral_percent ?? 0),
      discount_amount: Number(payment.discount_amount ?? 0),
      discount_percent: Number(payment.discount_percent ?? 0),
      security_deposit: securityDepositRefund,
      is_checkout: isCheckout,
      is_reservation: isReservation,
      // The date the held bed starts — the tenant's intended joining date,
      // which for a reservation is deliberately in a later month than the
      // receipt's own for_month.
      reservation_from: isReservation ? (tenantTyped?.check_in ?? null) : null,
      // Snapshot from the row, with a fallback for rows billed before migration
      // 099 existed so an older daily receipt still reads "N days x Rs R"
      // rather than silently mislabelling itself "Monthly Rent".
      billed_days: payment.billed_days != null
        ? Number(payment.billed_days)
        : (tenantTyped?.billing_type === "daily"
            ? countBillableNights({
                checkIn: (tenantTyped.check_in ?? "").slice(0, 10),
                checkOut: tenantTyped.check_out ? tenantTyped.check_out.slice(0, 10) : null,
                month: payment.for_month,
              })
            : null),
      daily_rate_billed: payment.daily_rate_billed != null
        ? Number(payment.daily_rate_billed)
        : (tenantTyped?.billing_type === "daily" ? Number(tenantTyped.daily_rate ?? 0) : null),
      payment_method: installmentSnapshot?.payment_method ?? payment.payment_method,
      payment_date: installmentSnapshot?.payment_date ?? payment.payment_date,
      payment_package_tier: payment.payment_package_tier,
    },
    {
      full_name: tenantTyped?.full_name ?? "Tenant",
      phone: tenantTyped?.phone,
      // F-008: cnic intentionally omitted from public receipt
      joining_meter_reading: tenantTyped?.joining_meter_reading ?? null,
      food_breakfast: tenantTyped?.food_breakfast ?? false,
      food_lunch: tenantTyped?.food_lunch ?? false,
      food_dinner: tenantTyped?.food_dinner ?? false,
    },
    {
      name: hostel.name,
      acChargeLabel: pkgConfig?.ac_charge_label ?? null,
      address: hostel.address,
      phone: hostel.phone,
    },
    isInvoice ? "invoice" : "receipt"
  );

  const tenantName = (tenant as { full_name?: string })?.full_name?.replace(/\s+/g, "_") ?? "receipt";
  const filename = `${isInvoice ? "invoice" : "receipt"}_${payment.for_month}_${tenantName}.pdf`;
  const body = Buffer.from(pdfBytes);

  // Persist for next time. Best-effort: a storage or bookkeeping failure must
  // never cost the tenant the receipt they are currently waiting on — it just
  // means the next view rebuilds it, exactly as before this cache existed.
  const stamp = isImmutableScope ? "immutable" : stampSource;
  if (stamp) {
    const storagePath = receiptStoragePath(
      link.hostel_id as string,
      link.installment_id
        ? { installmentId: link.installment_id as string }
        : { paymentId: payment.id as string }
    );
    const { error: uploadErr } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .upload(storagePath, body, { contentType: "application/pdf", upsert: true });

    if (!uploadErr) {
      // Stamp every link sharing this scope, not just the one that was opened.
      // Several tokens can point at one payment (each pre-fix Receipt click
      // minted another), and they all resolve to the same stored object.
      const bookkeeping = { pdf_path: storagePath, pdf_stamp: stamp, pdf_filename: filename };
      const q = supabase.from("hms_invoice_links").update(bookkeeping);
      await (link.installment_id
        ? q.eq("installment_id", link.installment_id)
        : q.eq("payment_id", payment.id).is("installment_id", null));
    }
  }

  return pdfResponse(body, filename, stamp ?? "", isImmutableScope);
}
