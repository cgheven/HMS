import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";
import { asPlan, applyPlanEntitlements } from "@/lib/entitlements";
import { pktTodayDateString } from "@/lib/pkt-time";

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

function planOf(custom: Record<string, unknown> | null | undefined) {
  return asPlan(typeof custom?.["plan"] === "string" ? (custom!["plan"] as string) : null);
}

// supabase-js returns { error } instead of throwing. Bubble it up so the webhook
// handler's try/catch returns 500 and Paddle retries the (idempotent) event,
// rather than swallowing a failed write and marking the event processed.
function mustOk(res: { error: { message: string } | null }, label: string) {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
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
      // owner_id may not ride on the subscription event; fall back to the row the
      // first payment already linked by subscription id.
      let ownerId = ownerIdOf(s.customData);
      if (!ownerId && s.id) {
        const { data, error } = await admin
          .from("hms_paddle_subscriptions").select("owner_id").eq("paddle_subscription_id", s.id).maybeSingle();
        mustOk({ error }, "lookup owner by subscription");
        ownerId = (data?.owner_id as string | undefined) ?? null;
      }
      if (ownerId && s.id) {
        const item = s.items?.[0];
        const unit = item?.price?.unitPrice?.amount;
        mustOk(await admin.from("hms_paddle_subscriptions").upsert(
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
        ), "upsert subscription");
      }
      // Definitive cancellation revokes Standard entitlement: drop to Basic. Only
      // on `canceled` (terminal) — a past_due card retry keeps their access. This
      // cannot take down a live subdomain (migration 167 never releases a claimed
      // one); it turns referral off and locks the Standard upsells.
      if (type === "subscription.canceled" && ownerId) {
        // Entitlements first, plan last (same commit-marker ordering as above).
        await applyPlanEntitlements(admin, ownerId, "basic");
        mustOk(await admin.from("hms_profiles").update({ plan: "basic" }).eq("id", ownerId), "downgrade plan on cancel");
      }
    } else if (type === "transaction.completed" || type === "transaction.paid") {
      // A real payment. Record it against the owner's subscription row — this is
      // the signal the referral program will later count toward "3 consecutive
      // payments". Match by owner_id (from custom_data) first, else subscription id.
      const t = event.data as TxnLike;
      const ownerId = ownerIdOf(t.customData);
      const paidAt = t.billedAt ?? now;
      if (ownerId) {
        mustOk(await admin.from("hms_paddle_subscriptions").upsert(
          { owner_id: ownerId, last_transaction_id: t.id ?? null, last_paid_at: paidAt, updated_at: now },
          { onConflict: "owner_id" }
        ), "record payment on subscription");
        // A successful payment settles dues — lift any freeze automatically.
        mustOk(await admin.from("hms_profiles").update({ frozen: false }).eq("id", ownerId), "unfreeze on payment");
      } else if (t.subscriptionId) {
        mustOk(await admin
          .from("hms_paddle_subscriptions")
          .update({ last_transaction_id: t.id ?? null, last_paid_at: paidAt, updated_at: now })
          .eq("paddle_subscription_id", t.subscriptionId), "record payment by subscription id");
      }

      // Set the account's plan from the checkout's custom_data and make the
      // capability flags match it. Our subscriptions use an inline (non-catalog)
      // price, so price_id can't be reverse-mapped to a plan — custom_data.plan,
      // set server-side at checkout, is the reliable source. Only the first
      // payment of a plan carries it; renewals without it leave the plan intact.
      // Only propagate when the plan actually CHANGES, so a repeat payment can't
      // re-clobber the owner's branch flags.
      if (ownerId) {
        const plan = planOf(t.customData);
        if (plan) {
          const { data: prof, error: readErr } = await admin
            .from("hms_profiles").select("plan").eq("id", ownerId).maybeSingle();
          mustOk({ error: readErr }, "read current plan");
          if (prof?.plan !== plan) {
            // Apply entitlements FIRST, then persist plan as the commit marker.
            // The plan-change guard above uses `plan` as its idempotency key, so
            // if the (non-atomic) entitlement writes throw, plan must stay
            // unchanged — otherwise a retry would see the new plan and skip the
            // half-applied entitlements, leaving a paid owner un-entitled.
            await applyPlanEntitlements(admin, ownerId, plan);
            mustOk(await admin.from("hms_profiles").update({ plan }).eq("id", ownerId), "set plan");
          }
        }
      }

      // A card payment SUPERSEDES any overlapping bank/manual invoice. The Paddle
      // subscription covers from the payment date forward, so an unpaid platform
      // invoice whose period extends past that date would double-bill the owner —
      // cancel it. Fully-past arrears (period_end on/before the payment date) are
      // left owed. After the first payment there is nothing to cancel (manual
      // generation is skipped for Paddle owners), so this is a no-op on renewals.
      // Compare against the payment's Asia/Karachi calendar date — period_end is a
      // PKT business date, and paidAt's raw UTC slice is a day behind for a payment
      // landing 00:00–04:59 PKT, which could drop a real arrear a day early.
      if (ownerId) {
        mustOk(await admin
          .from("hms_platform_invoices")
          .update({ status: "cancelled" })
          .eq("owner_id", ownerId)
          .eq("status", "unpaid")
          .gt("period_end", pktTodayDateString(new Date(paidAt))), "supersede overlapping manual invoices");
      }

      // Receipt row for the /billing invoice history. Only when we can tie it to
      // an owner (owner_id in custom_data) and it's a real charge with an id.
      if (ownerId && t.id) {
        const grand = t.details?.totals?.grandTotal;
        mustOk(await admin.from("hms_paddle_transactions").upsert(
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
        ), "upsert receipt");
      }
    }
  } catch (e) {
    // Return 500 so Paddle retries; the event is NOT recorded as processed, so
    // the retry re-runs the handler (every write above is an idempotent upsert /
    // update, and mustOk turns a swallowed DB error into this retry).
    return new NextResponse(`handler error: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }

  // Best-effort dedup record. A failure here is safe (a redelivery just re-runs
  // the idempotent handler) but should be visible — a persistently failing insert
  // would silently mean every event reprocesses.
  const { error: recordErr } = await admin
    .from("hms_paddle_webhook_events").insert({ event_id: event.eventId, event_type: type });
  if (recordErr) console.error("[paddle] failed to record webhook event", event.eventId, recordErr.message);
  return NextResponse.json({ ok: true });
}
