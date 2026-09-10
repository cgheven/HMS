import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";

// Node runtime: the Paddle SDK + signature verification need Node crypto, not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loose structural views of the entities we read — the SDK's per-event union is
// verbose, and we only touch a handful of fields defensively.
type SubLike = {
  id?: string;
  customerId?: string;
  status?: string;
  customData?: Record<string, unknown> | null;
  currencyCode?: string;
  currentBillingPeriod?: { endsAt?: string | null } | null;
  items?: Array<{ quantity?: number; price?: { id?: string; unitPrice?: { amount?: string; currencyCode?: string } } }>;
};
type TxnLike = {
  id?: string;
  subscriptionId?: string | null;
  customerId?: string;
  customData?: Record<string, unknown> | null;
  billedAt?: string | null;
  status?: string;
  invoiceNumber?: string | null;
  currencyCode?: string;
  details?: { totals?: { grandTotal?: string | null; currencyCode?: string } | null } | null;
};

function ownerIdOf(custom: Record<string, unknown> | null | undefined): string | null {
  const v = custom?.["owner_id"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  // 500 (not 400) so Paddle retries once the secret is configured, rather than
  // treating a missing secret as a permanently-bad event.
  if (!secret) return new NextResponse("Webhook not configured", { status: 500 });

  const signature = req.headers.get("paddle-signature") ?? "";
  const rawBody = await req.text(); // RAW body — required for signature verification

  let event;
  try {
    event = await getPaddleServer().webhooks.unmarshal(rawBody, secret, signature);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }
  if (!event) return new NextResponse("Unrecognised event", { status: 400 });

  const admin = createAdminClient();

  // Idempotency: Paddle can redeliver. Skip anything already processed.
  const { data: seen } = await admin
    .from("hms_paddle_webhook_events")
    .select("event_id")
    .eq("event_id", event.eventId)
    .maybeSingle();
  if (seen) return NextResponse.json({ ok: true, duplicate: true });

  const type = String(event.eventType);
  const now = new Date().toISOString();

  try {
    if (type.startsWith("subscription.")) {
      const s = event.data as SubLike;
      const ownerId = ownerIdOf(s.customData);
      if (ownerId && s.id) {
        const item = s.items?.[0];
        const unit = item?.price?.unitPrice?.amount;
        await admin.from("hms_paddle_subscriptions").upsert(
          {
            owner_id: ownerId,
            paddle_subscription_id: s.id,
            paddle_customer_id: s.customerId ?? null,
            status: s.status ?? "active",
            price_id: item?.price?.id ?? null,
            quantity: item?.quantity ?? null,
            unit_amount: unit != null ? Number(unit) / 100 : null,
            currency_code: s.currencyCode ?? item?.price?.unitPrice?.currencyCode ?? null,
            current_period_end: s.currentBillingPeriod?.endsAt ?? null,
            updated_at: now,
          },
          { onConflict: "owner_id" }
        );
      }
    } else if (type === "transaction.completed" || type === "transaction.paid") {
      // A real payment. Record it against the owner's subscription row — this is
      // the signal the referral program will later count toward "3 consecutive
      // payments". Match by owner_id (from custom_data) first, else subscription id.
      const t = event.data as TxnLike;
      const ownerId = ownerIdOf(t.customData);
      const paidAt = t.billedAt ?? now;
      if (ownerId) {
        await admin.from("hms_paddle_subscriptions").upsert(
          { owner_id: ownerId, last_transaction_id: t.id ?? null, last_paid_at: paidAt, updated_at: now },
          { onConflict: "owner_id" }
        );
      } else if (t.subscriptionId) {
        await admin
          .from("hms_paddle_subscriptions")
          .update({ last_transaction_id: t.id ?? null, last_paid_at: paidAt, updated_at: now })
          .eq("paddle_subscription_id", t.subscriptionId);
      }

      // Receipt row for the /billing invoice history. Only when we can tie it to
      // an owner (owner_id in custom_data) and it's a real charge with an id.
      if (ownerId && t.id) {
        const grand = t.details?.totals?.grandTotal;
        await admin.from("hms_paddle_transactions").upsert(
          {
            transaction_id: t.id,
            owner_id: ownerId,
            paddle_subscription_id: t.subscriptionId ?? null,
            amount: grand != null ? Number(grand) / 100 : null,
            currency_code: t.details?.totals?.currencyCode ?? t.currencyCode ?? null,
            status: t.status ?? "completed",
            invoice_number: t.invoiceNumber ?? null,
            billed_at: paidAt,
          },
          { onConflict: "transaction_id" }
        );
      }
    }
  } catch (e) {
    // Return 500 so Paddle retries; the event is NOT recorded as processed, so
    // the retry runs the handler again (all writes above are idempotent upserts).
    return new NextResponse(`handler error: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }

  await admin.from("hms_paddle_webhook_events").insert({ event_id: event.eventId, event_type: type });
  return NextResponse.json({ ok: true });
}
