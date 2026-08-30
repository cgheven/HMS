import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOwnerPaymentAlertEmail } from "@/lib/email";
import { formatMonthLong } from "@/lib/utils";

// Deliberately NOT a server action and not under app/actions. A server action is
// a publicly callable RPC endpoint — exposing this one would let anybody with a
// session mail an arbitrary hostel owner by guessing payment ids.

// Mirrors methodLabels in components/modules/payments/payments-client.tsx:112.
// An unrecognised method falls through to the raw value rather than "Other", so
// a method added to the UI without touching this map still reads correctly.
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  sadapay: "SadaPay",
  other: "Other",
};

/** Managers hold synthetic accounts on this domain, which receives no mail. */
const SYNTHETIC_DOMAIN = "@hms-portal.internal";

/**
 * Emails the branch owner that someone else collected money.
 *
 * Fires only for a manager or partner collection: the owner recording their own
 * payment does not need telling what they just did. The caller decides the role
 * from the session, and this function independently re-checks the actor against
 * hms_hostels.owner_id — so a future path that forgets the role check still
 * cannot email an owner about their own entry.
 *
 * Everything is re-read from the database by payment id. Nothing about the
 * recipient is taken from the caller: the chain is payment -> hostel_id ->
 * owner_id -> hms_profiles.email -> auth.users.email, and it deliberately never
 * falls back to hms_hostels.email/phone/whatsapp. Full-tier partners can UPDATE
 * hms_hostels straight from the browser (migration 094), so a hostel-level
 * contact fallback would let a partner redirect their own alerts to themselves.
 *
 * Never throws. The money is already committed by the time this runs, and the
 * callers' outer catch blocks turn a throw into { error }, which would show a
 * successful collection as failed to the person who just took the cash.
 */
export async function notifyOwnerPaymentRecorded(args: {
  paymentId: string;
  amountReceived: number;
  actorUserId: string;
  actorName: string;
  actorRole: "Manager" | "Partner";
}): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: payment } = await admin
      .from("hms_payments")
      .select("id, hostel_id, tenant_id, for_month, amount, late_fee, amount_paid, payment_method, status")
      .eq("id", args.paymentId)
      .maybeSingle();
    if (!payment) {
      console.error("[payment-alert] payment not found:", args.paymentId);
      return;
    }

    const [{ data: hostel }, { data: tenant }] = await Promise.all([
      admin.from("hms_hostels").select("name, owner_id").eq("id", payment.hostel_id).maybeSingle(),
      admin
        .from("hms_tenants")
        // Explicit column list, never select("*") — CNIC must never travel into
        // an email, which is a public surface the moment it is forwarded.
        .select("full_name, room:hms_rooms(room_number)")
        .eq("id", payment.tenant_id)
        .eq("hostel_id", payment.hostel_id)
        .maybeSingle(),
    ]);
    if (!hostel) {
      console.error("[payment-alert] hostel not found for payment:", args.paymentId);
      return;
    }

    // Belt and braces on top of the caller's role check.
    if (args.actorUserId === hostel.owner_id) return;

    let ownerEmail: string | null = null;
    const { data: profile } = await admin
      .from("hms_profiles")
      .select("email")
      .eq("id", hostel.owner_id)
      .maybeSingle();
    if (profile?.email) ownerEmail = profile.email as string;

    if (!ownerEmail) {
      const {
        data: { user },
      } = await admin.auth.admin.getUserById(hostel.owner_id);
      if (user?.email) ownerEmail = user.email;
    }

    if (!ownerEmail || ownerEmail.endsWith(SYNTHETIC_DOMAIN)) {
      console.error("[payment-alert] owner has no reachable email:", hostel.owner_id);
      return;
    }

    // `amount` is stored NET of any referral discount on all three write paths —
    // the pricing trigger folds it in — so this one formula holds everywhere.
    const remaining = Math.max(
      0,
      Number(payment.amount ?? 0) + Number(payment.late_fee ?? 0) - Number(payment.amount_paid ?? 0)
    );

    const room = Array.isArray(tenant?.room) ? tenant.room[0] : tenant?.room;
    const method = (payment.payment_method as string) ?? "";

    await sendOwnerPaymentAlertEmail({
      ownerEmail,
      hostelName: hostel.name as string,
      tenantName: (tenant?.full_name as string) ?? "A member",
      roomNumber: (room as { room_number?: string } | null)?.room_number ?? null,
      amountReceived: args.amountReceived,
      paymentMethod: METHOD_LABELS[method] ?? method,
      forMonth: formatMonthLong(payment.for_month as string),
      remainingBalance: remaining,
      // Read off the stored status rather than inferred from `remaining`: a
      // waived or over-paid bill leaves remaining at 0 without being a normal
      // full settlement.
      paidInFull: payment.status === "paid",
      recordedByName: args.actorName,
      recordedByRole: args.actorRole,
    });
  } catch (err) {
    console.error("[payment-alert] failed for payment", args.paymentId, err);
  }
}
