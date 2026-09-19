"use server";

import { unstable_rethrow } from "next/navigation";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";
import type { CurrencyCode } from "@paddle/paddle-node-sdk";
import { getPlanPriceId, ONBOARDING_FEE_USD, type BillingCycle } from "@/lib/paddle";
import { asPlan, applyPlanEntitlements, type Plan } from "@/lib/entitlements";
import { isManualBankBilling } from "@/lib/country-config";
import { priceFor, tierForPropertyCount, toMinorUnits, type PricingTier } from "@/lib/tier-pricing";

/**
 * Create a Paddle transaction for the owner's tier, then hand its id to the
 * browser to open checkout. Everything that affects the charge is decided HERE,
 * server-side, so the checkout cannot be tampered with:
 *   - the TIER is computed from the owner's billable-property count (basic=1,
 *     standard≤3, business≤10, enterprise=10+), never sent by the client;
 *   - the amount + currency come from lib/tier-pricing for the owner's country
 *     (their market), built into a FLAT inline price with quantity 1 (this is a
 *     tier price, NOT per-property);
 *   - owner_id (for webhook linking) is the authenticated user.
 *
 * Pakistan (manualBankBilling) never reaches here — it is invoiced by hand.
 * Enterprise returns { contactUs } (custom-quoted, no self-serve). Grandfathered
 * custom-rate clients keep their fixed USD figure. Owner-only (requireOwnerOrAbove).
 */
export async function createPlanCheckoutAction(input: {
  cycle: BillingCycle;
}): Promise<{ transactionId?: string; error?: string; contactUs?: boolean }> {
  try {
    await requireOwnerOrAbove();
    const ctx = await getAuthContext();
    if (!ctx?.user) throw new Error("Unauthorized");
    const ownerId = ctx.user.id;
    const cycle: BillingCycle = input.cycle === "annual" ? "annual" : "monthly";

    // Country drives the market/currency. Pakistan (manual bank billing) is never
    // charged by card here — it is invoiced by hand. Use the ONE shared test so
    // the billing UI, this gate, and tier-sync always agree (a null-country legacy
    // owner resolves to PK/manual — never accidentally card-charged).
    const country = ctx.profile?.country ?? null;
    // A manual-bank country (PK) owner may only card-checkout when explicitly opted
    // in (pk_card_enabled — new PK self-reg owners, priced per-branch via their
    // custom_unit_amount_usd below). Existing PK clients stay invoice-billed. Mirrors
    // the rail test in getOwnerBilling so the UI and this gate never disagree.
    const pkCardEnabled = ctx.profile?.pk_card_enabled === true;
    if (isManualBankBilling(country) && !pkCardEnabled) {
      return { error: "Your account is billed by invoice, not card checkout." };
    }

    const admin = createAdminClient();

    // Billable property count (a paused branch, billing_active=false, is not
    // charged and does not push up the tier).
    const { count } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("billing_active", true);
    const branchCount = Math.max(1, count ?? 1);

    // A grandfathered client pays a negotiated fixed USD rate on their super-admin
    // plan, DECOUPLED from the tier system — checked FIRST, before the enterprise
    // gate, so a legacy client who has grown past 10 properties still checks out at
    // their contracted rate instead of being forced to contact-us. This mirrors the
    // order in tier-sync (custom-rate skip precedes enterprise). Read server-side
    // (guarded column), never client input.
    const customMonthly = ctx.profile?.custom_unit_amount_usd;
    const useCustom = customMonthly != null && Number(customMonthly) > 0;

    // Tier is SERVER-AUTHORITATIVE for non-custom owners: the billable count decides
    // it (basic=1, standard≤3, business≤10, enterprise=10+). This is a FLAT tier
    // price — not per-property — so quantity is always 1.
    const tier: PricingTier = tierForPropertyCount(branchCount);

    // Enterprise (10+) is custom-quoted — no self-serve checkout. Does NOT apply to
    // grandfathered custom-rate clients (they keep their fixed rate at any count).
    if (!useCustom && tier === "enterprise") return { contactUs: true };

    const serverPlan = asPlan(ctx.profile?.plan);
    const stampedPlan: Plan | null = useCustom ? serverPlan : tier;

    // Onboarding fee: one-time, on the first card payment, if owed (not waived and
    // not already paid on either rail). Server-side only.
    const { data: billingRow } = await admin
      .from("hms_client_billing")
      .select("waive_onboarding, onboarding_paid")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const owesOnboarding = !!billingRow && !billingRow.waive_onboarding && !billingRow.onboarding_paid;

    const paddle = getPaddleServer();

    // Scaffold: fetch ONE existing catalog price (basic, this cycle) only to reuse
    // its product / tax mode / billing cycle for the inline price. The AMOUNT and
    // CURRENCY come from tier-pricing (the owner's market), not the catalog.
    const scaffold = await paddle.prices.get(getPlanPriceId("basic", cycle), { include: ["product"] });

    const p = priceFor(country, tier, cycle);
    // Grandfathered rate is a PER-BRANCH monthly USD figure — the total charge is
    // per-branch × billable branch count (annual = ×10). The tier rework pins
    // quantity to 1, so the branch multiple must be folded into the amount here,
    // otherwise a multi-branch legacy client would be charged for a single branch.
    // This equals the per-branch × branches total the billing UI displays.
    const customAmount = useCustom
      ? String(Math.round(Number(customMonthly) * (cycle === "annual" ? 10 : 1) * branchCount * 100))
      : null;

    const inlinePrice = {
      productId: scaffold.productId,
      description: scaffold.description,
      taxMode: scaffold.taxMode,
      billingCycle: scaffold.billingCycle
        ? { interval: scaffold.billingCycle.interval, frequency: scaffold.billingCycle.frequency }
        : null,
      // Owner's price is already resolved for their market — a single fixed unit
      // price, quantity 1 (flat tier price). No per-country overrides needed.
      unitPrice: customAmount
        ? { amount: customAmount, currencyCode: "USD" as const }
        : { amount: String(toMinorUnits(p.amount)), currencyCode: p.currency as CurrencyCode },
      unitPriceOverrides: [],
      quantity: { minimum: 1, maximum: 1 },
    };

    // One-time onboarding line — non-recurring (billingCycle null), inline product
    // so the checkout line reads "One-time onboarding fee", flat USD, quantity 1.
    const onboardingPrice = owesOnboarding
      ? {
          product: {
            name: "One-time onboarding fee",
            taxCategory: scaffold.product?.taxCategory ?? "standard",
          },
          description: "One-time onboarding fee",
          taxMode: scaffold.taxMode,
          billingCycle: null,
          unitPrice: { amount: String(ONBOARDING_FEE_USD * 100), currencyCode: "USD" as const },
          unitPriceOverrides: [],
          quantity: { minimum: 1, maximum: 1 },
        }
      : null;

    const customData: Record<string, unknown> = { owner_id: ownerId, cycle };
    if (stampedPlan) customData.plan = stampedPlan;
    if (owesOnboarding) customData.onboarding = true;

    type TxnItem = Parameters<typeof paddle.transactions.create>[0]["items"][number];
    const items: TxnItem[] = [{ price: inlinePrice, quantity: 1 }];
    if (onboardingPrice) items.push({ price: onboardingPrice, quantity: 1 });

    const txn = await paddle.transactions.create({ items, customData });
    return { transactionId: txn.id };
  } catch (err: unknown) {
    unstable_rethrow(err);
    console.error("[paddle] createPlanCheckoutAction failed:", err);
    return { error: "Could not start checkout. Please try again." };
  }
}

/**
 * After a completed checkout, activate the subscription by reading it DIRECTLY
 * from Paddle (outbound API call) rather than waiting for the inbound webhook —
 * which is delayed under load and completely unreachable in local/tunnel-less
 * environments. Mirrors exactly what the webhook does (upsert the subscription
 * row, apply the plan's entitlements, clear the trial/freeze), and is idempotent
 * so the webhook landing later is a harmless no-op.
 *
 * SECURITY: the transaction must carry THIS authenticated owner's owner_id (stamped
 * server-side at checkout) — never activate a subscription onto an account that
 * didn't pay for it.
 */
export async function reconcileCheckoutAction(input: {
  transactionId?: string;
}): Promise<{ active: boolean; plan?: string; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const ctx = await getAuthContext();
    if (!ctx?.user) return { active: false };
    const ownerId = ctx.user.id;
    const email = ctx.user.email ?? null;
    // Mirror the createPlanCheckoutAction gate: a PK card owner (pk_card_enabled)
    // is on the card rail, so they MUST be able to self-activate here. Gating on
    // country alone would leave the new PK cohort dependent on the inbound webhook —
    // the exact delay/unreachability this reconcile exists to work around.
    const pkCardEnabled = ctx.profile?.pk_card_enabled === true;
    if (isManualBankBilling(ctx.profile?.country ?? null) && !pkCardEnabled) return { active: false };

    const paddle = getPaddleServer();

    // Resolve the owner's subscription id. Prefer the known transaction (its
    // owner_id, stamped server-side at checkout, must match this owner). Fall back
    // to the owner's Paddle customer, looked up by their AUTHENTICATED email — a
    // subscription under that email's customer is theirs (email is unique per
    // account), which covers a returning tab with no stashed transaction id.
    let subId: string | null = null;
    let planFromTxn: string | undefined;
    if (input.transactionId) {
      const txn = await paddle.transactions.get(input.transactionId);
      const txnOwner = (txn.customData as { owner_id?: string } | null | undefined)?.owner_id;
      if (txnOwner === ownerId) {
        subId = txn.subscriptionId ?? null;
        planFromTxn = (txn.customData as { plan?: string } | null | undefined)?.plan;
      }
    }
    if (!subId && email) {
      const customerPage = await paddle.customers.list({ email: [email] }).next();
      const customerId = customerPage?.[0]?.id ?? null;
      if (customerId) {
        const subPage = await paddle.subscriptions.list({ customerId: [customerId] }).next();
        const chosen =
          (subPage ?? []).find((s) => ["active", "trialing", "past_due"].includes(s.status ?? "")) ??
          subPage?.[0] ??
          null;
        subId = chosen?.id ?? null;
      }
    }
    if (!subId) return { active: false }; // no subscription yet — payment still settling

    const sub = await paddle.subscriptions.get(subId);
    const item = sub.items?.[0];
    const unit = item?.price?.unitPrice?.amount;
    const plan = asPlan(
      (sub.customData as { plan?: string } | null | undefined)?.plan ?? planFromTxn
    );

    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin.from("hms_paddle_subscriptions").upsert(
      {
        owner_id: ownerId,
        paddle_subscription_id: sub.id,
        paddle_customer_id: sub.customerId ?? null,
        status: sub.status ?? "active",
        price_id: item?.price?.id ?? null,
        quantity: item?.quantity ?? 1,
        unit_amount: unit != null ? Number(unit) / 100 : null,
        currency_code: sub.currencyCode ?? item?.price?.unitPrice?.currencyCode ?? null,
        current_period_end: sub.currentBillingPeriod?.endsAt ?? null,
        last_transaction_id: input.transactionId ?? sub.id,
        last_paid_at: now,
        updated_at: now,
      },
      { onConflict: "owner_id" }
    );

    // Entitlements first, then the plan marker (same ordering as the webhook), and
    // clear the trial/freeze — a paid owner is no longer on the free trial.
    if (plan) await applyPlanEntitlements(admin, ownerId, plan);
    await admin
      .from("hms_profiles")
      .update({ frozen: false, trial_ends_at: null, ...(plan ? { plan } : {}) })
      .eq("id", ownerId);

    // `plan` is the categorical tier (basic|standard|business|enterprise) —
    // surfaced for analytics only; carries no PII or amount.
    return { active: ["active", "trialing"].includes(sub.status ?? ""), plan: plan ?? undefined };
  } catch (err: unknown) {
    console.error("[paddle] reconcileCheckoutAction failed:", err);
    return { active: false, error: "reconcile failed" };
  }
}
