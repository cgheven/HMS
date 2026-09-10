"use server";

import { unstable_rethrow } from "next/navigation";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";
import { getPlanPriceId, type PlanKey, type BillingCycle } from "@/lib/paddle";
import { asPlan } from "@/lib/entitlements";

/**
 * Create a Paddle transaction for the owner's chosen plan, then hand its id to
 * the browser to open checkout. Everything that affects the charge is decided
 * HERE, server-side, so the checkout cannot be tampered with:
 *   - plan/cycle are re-validated to a fixed enum and mapped to a price id here;
 *   - quantity = the owner's ACTUAL branch count (not sent by the client);
 *   - owner_id (for webhook linking) is the authenticated user.
 *
 * Quantity is LOCKED: Paddle only hides the checkout quantity stepper when a
 * price's minimum === maximum. Catalog prices are shared (branch count varies
 * per owner), so we charge with an INLINE price built by copying the catalog
 * price's unit price + per-country overrides and pinning quantity to exactly
 * the branch count. Same numbers the plan card previews (no drift), but the
 * stepper is gone and the customer can't pay for fewer branches than they run.
 *
 * Owner-only: billing is account-level (partners are redirected off /billing;
 * managers have no owner context). requireOwnerOrAbove enforces it.
 */
export async function createPlanCheckoutAction(input: {
  plan: PlanKey;
  cycle: BillingCycle;
}): Promise<{ transactionId?: string; error?: string }> {
  try {
    await requireOwnerOrAbove();
    const ctx = await getAuthContext();
    if (!ctx?.user) throw new Error("Unauthorized");
    const ownerId = ctx.user.id;

    // Sanitise to the known enums — never trust the raw input for pricing.
    const inputPlan: PlanKey = input.plan === "standard" ? "standard" : "basic";
    const cycle: BillingCycle = input.cycle === "annual" ? "annual" : "monthly";

    // A grandfathered client has a negotiated per-branch USD rate. When present we
    // charge THAT instead of the standard plan price — a fixed rate with no
    // per-country overrides. It's a monthly figure; annual mirrors the catalog's
    // pay-10-get-12 (× 10). Read server-side (guarded column), never client input.
    const customMonthly = ctx.profile?.custom_unit_amount_usd;
    const useCustom = customMonthly != null && Number(customMonthly) > 0;

    // For a custom-rate owner the plan is NOT chosen at checkout — the price is
    // decoupled from the plan, so trusting input.plan would let them pay their
    // fixed rate while self-granting a higher tier's features (the webhook applies
    // entitlements from customData.plan). Use the super-admin-set plan; if they
    // have none, stamp no plan at all so the webhook makes no entitlement change.
    const serverPlan = asPlan(ctx.profile?.plan);
    const effectivePlan: PlanKey | null = useCustom ? serverPlan : inputPlan;
    const priceId = getPlanPriceId(effectivePlan ?? "basic", cycle);

    // Locked quantity: the owner's real branch count, counted server-side.
    const admin = createAdminClient();
    const { count } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId);
    const quantity = Math.max(1, count ?? 1);

    const paddle = getPaddleServer();

    // Pull the catalog price and mirror it into an inline price whose quantity
    // is pinned (min === max === branch count) so the checkout stepper is hidden
    // and the amount is fixed. Copying the catalog price keeps the localized
    // per-country pricing identical to what the plan card shows.
    const catalog = await paddle.prices.get(priceId);
    const customAmount = useCustom
      ? String(Math.round(Number(customMonthly) * (cycle === "annual" ? 10 : 1) * 100))
      : null;
    const inlinePrice = {
      productId: catalog.productId,
      description: catalog.description,
      taxMode: catalog.taxMode,
      billingCycle: catalog.billingCycle
        ? { interval: catalog.billingCycle.interval, frequency: catalog.billingCycle.frequency }
        : null,
      unitPrice: customAmount
        ? { amount: customAmount, currencyCode: "USD" as const }
        : { amount: catalog.unitPrice.amount, currencyCode: catalog.unitPrice.currencyCode },
      // A negotiated rate is a single fixed USD figure — no per-country overrides.
      unitPriceOverrides: useCustom
        ? []
        : catalog.unitPriceOverrides.map((o) => ({
            countryCodes: o.countryCodes,
            unitPrice: { amount: o.unitPrice.amount, currencyCode: o.unitPrice.currencyCode },
          })),
      quantity: { minimum: quantity, maximum: quantity },
    };

    // Stamp the plan only when we have an authoritative one — omitting it makes
    // the webhook leave the owner's plan/entitlements untouched.
    const customData: Record<string, unknown> = { owner_id: ownerId, cycle };
    if (effectivePlan) customData.plan = effectivePlan;
    const txn = await paddle.transactions.create({
      items: [{ price: inlinePrice, quantity }],
      customData,
    });

    return { transactionId: txn.id };
  } catch (err: unknown) {
    unstable_rethrow(err);
    // Log the real cause server-side; hand the client a generic message so
    // internal/config details (price-not-configured, Paddle/DB errors) don't leak.
    console.error("[paddle] createPlanCheckoutAction failed:", err);
    return { error: "Could not start checkout. Please try again." };
  }
}
