import "server-only";
import type { CurrencyCode } from "@paddle/paddle-node-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";
import { getPlanPriceId, type BillingCycle } from "@/lib/paddle";
import { asPlan, applyPlanEntitlements } from "@/lib/entitlements";
import { trackServerEvent } from "@/lib/analytics-server";
import { isManualBankBilling } from "@/lib/country-config";
import { priceFor, tierForPropertyCount, toMinorUnits, customRateMonthlyUsd, type PricingTier } from "@/lib/tier-pricing";

const TIER_RANK: Record<PricingTier, number> = { basic: 0, standard: 1, business: 2, enterprise: 3 };

type UpdateItem = Parameters<Awaited<ReturnType<typeof getPaddleServer>>["subscriptions"]["update"]>[1]["items"] extends (infer U)[] | undefined ? U : never;

// Build the inline Paddle price for a target tier (flat tier price, quantity 1).
// Shared by the charge, preview, and sync paths so all three price identically —
// scaffolded from the basic price's product/tax/billing-cycle, amount overridden to
// the country+tier price in minor units. Returns the target minor amount too, so a
// caller can verify the applied price matches what it intended to charge.
async function buildTierInlinePrice(
  paddle: ReturnType<typeof getPaddleServer>,
  country: string | null,
  toTier: PricingTier,
  cycle: BillingCycle
) {
  const scaffold = await paddle.prices.get(getPlanPriceId("basic", cycle), { include: ["product"] });
  const p = priceFor(country, toTier, cycle);
  const inlinePrice = {
    productId: scaffold.productId,
    description: scaffold.description,
    taxMode: scaffold.taxMode,
    billingCycle: scaffold.billingCycle
      ? { interval: scaffold.billingCycle.interval, frequency: scaffold.billingCycle.frequency }
      : null,
    unitPrice: { amount: String(toMinorUnits(p.amount)), currencyCode: p.currency as CurrencyCode },
    unitPriceOverrides: [],
    quantity: { minimum: 1, maximum: 1 },
  };
  return { inlinePrice, targetMinor: toMinorUnits(p.amount), currency: p.currency };
}

export type TierSyncResult =
  | { status: "charged"; from: PricingTier; to: PricingTier }
  | { status: "scheduled"; from: PricingTier; to: PricingTier }
  | { status: "noop" }
  | { status: "skipped"; reason: string }
  | { status: "contactUs" }
  | { status: "error"; error: string };

/**
 * Reconcile the owner's Paddle subscription to the tier their billable-property
 * count now requires, called AFTER a property is added, removed, or a branch is
 * paused/reactivated for billing. Best-effort: it swallows its own errors
 * (returns { status: "error" }) so a Paddle hiccup can never roll back the
 * property/billing change that triggered it.
 *
 * SECURITY: this is an INTERNAL server helper, deliberately NOT a `use server`
 * server action — it takes a caller-supplied ownerId and mutates that owner's
 * plan/entitlements/subscription through the service-role client (bypassing the
 * DB guard triggers). Exposing it as a public action would be an IDOR: any
 * authenticated user could charge or downgrade any owner by UUID. It must only
 * be imported by trusted server code that has already established the ownerId
 * (createBranch → authenticated user.id; super-admin actions → requireSuperAdmin).
 *
 * - Crossing UP a tier → prorated_immediately (charge the tier-price difference
 *   for the remaining period now; full new-tier price at renewal). Plan +
 *   entitlements advance HERE (the owner is gaining access they now pay for).
 * - Crossing DOWN a tier → prorated_next_billing_period (no mid-cycle refund; the
 *   lower price applies from the next renewal). Plan + entitlements are DEFERRED
 *   to that renewal (the transaction.paid webhook stamps customData.plan) so paid
 *   features are never stripped while the owner is still billed the higher tier.
 * - Same tier → noop. Enterprise (10+) → contactUs (leave on business, no self-serve).
 * - Skipped for PK/manual, grandfathered custom-rate, or no live subscription.
 */
// Custom-rate (per-branch) counterpart to the tier reconcile below: re-sync the
// FLAT subscription amount to per-branch × current billable count after a branch
// is removed, paused, or reactivated. An INCREASE (reactivate/add) charges the
// proration immediately; a DECREASE (remove/pause) applies at the next renewal
// (no mid-cycle refund). No plan/entitlement change — the owner keeps their
// contracted plan; only the amount scales with branch count.
async function syncCustomRateSubscriptionForOwner(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
  customMonthly: number,
  pkCard: boolean,
  fromPlan: PricingTier
): Promise<TierSyncResult> {
  const { data: subRow } = await admin
    .from("hms_paddle_subscriptions")
    .select("paddle_subscription_id, status")
    .eq("owner_id", ownerId)
    .maybeSingle();
  const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
  const subId = sub?.paddle_subscription_id ?? null;
  if (!subId || !sub?.status || sub.status === "canceled") return { status: "skipped", reason: "no-subscription" };

  const { count } = await admin
    .from("hms_hostels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("billing_active", true);
  const branchCount = Math.max(1, count ?? 1);

  // pk_card owners at 21+ branches are custom-quoted — leave the subscription as
  // it is rather than auto-repricing to a bogus amount.
  const monthlyTotal = customRateMonthlyUsd(pkCard, customMonthly, branchCount);
  if (monthlyTotal == null) return { status: "skipped", reason: "custom-quote" };

  const paddle = getPaddleServer();
  const live = await paddle.subscriptions.get(subId);
  const cycle: BillingCycle = live.billingCycle?.interval === "year" ? "annual" : "monthly";
  const { inlinePrice, targetMinor } = await buildCustomRateInlinePrice(paddle, monthlyTotal, cycle);

  const mirror = async (s: typeof live) => {
    const it = s.items?.[0];
    const u = it?.price?.unitPrice?.amount;
    await admin.from("hms_paddle_subscriptions").update({
      status: s.status ?? undefined,
      quantity: it?.quantity ?? 1,
      unit_amount: u != null ? Number(u) / 100 : undefined,
      currency_code: s.currencyCode ?? it?.price?.unitPrice?.currencyCode ?? undefined,
      current_period_end: s.currentBillingPeriod?.endsAt ?? undefined,
      updated_at: new Date().toISOString(),
    }).eq("owner_id", ownerId);
  };

  const currentMinor = live.items?.[0]?.price?.unitPrice?.amount != null ? Number(live.items[0].price!.unitPrice!.amount) : null;
  if (currentMinor === targetMinor) { await mirror(live); return { status: "noop" }; }

  const goingUp = currentMinor == null || targetMinor > currentMinor;
  const updated = await paddle.subscriptions.update(subId, {
    items: [{ price: inlinePrice, quantity: 1 } as UpdateItem],
    prorationBillingMode: goingUp ? "prorated_immediately" : "prorated_next_billing_period",
    customData: { owner_id: ownerId, cycle, per_branch: true, branches: branchCount },
  });
  await mirror(updated);
  return goingUp
    ? { status: "charged", from: fromPlan, to: fromPlan }
    : { status: "scheduled", from: fromPlan, to: fromPlan };
}

export async function syncSubscriptionTierForOwner(ownerId: string): Promise<TierSyncResult> {
  try {
    const admin = createAdminClient();

    const { data: profile } = await admin
      .from("hms_profiles")
      .select("country, custom_unit_amount_usd, pk_card_enabled, plan")
      .eq("id", ownerId)
      .maybeSingle();
    const prof = profile as { country?: string | null; custom_unit_amount_usd?: number | null; pk_card_enabled?: boolean | null; plan?: string | null } | null;
    const country = prof?.country ?? null;

    // Per-branch (custom-rate / pk_card) owners re-sync the amount to the current
    // branch count — this closes the leak on the remove / pause / reactivate paths
    // (createBranch handles the add). pk_card owners reprice on the volume schedule;
    // legacy custom-rate owners on their flat rate × count. MUST precede the
    // manual-bank skip: a PK legacy client on a $18/branch Paddle contract is on the
    // Paddle rail even though isManualBankBilling("PK") is true — checking manual
    // first would wrongly exempt exactly the owners this fix targets.
    if (prof?.custom_unit_amount_usd != null && Number(prof.custom_unit_amount_usd) > 0) {
      return await syncCustomRateSubscriptionForOwner(admin, ownerId, Number(prof.custom_unit_amount_usd), prof?.pk_card_enabled === true, asPlan(prof?.plan) ?? "basic");
    }
    if (isManualBankBilling(country)) return { status: "skipped", reason: "manual" };

    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions")
      .select("paddle_subscription_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
    const subId = sub?.paddle_subscription_id ?? null;
    // No live subscription (never paid, or cancelled): nothing to prorate — the
    // next checkout/renewal picks up the right tier.
    if (!subId || !sub?.status || sub.status === "canceled") return { status: "skipped", reason: "no-subscription" };

    const { count } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("billing_active", true);
    const branchCount = Math.max(1, count ?? 1);
    const toTier: PricingTier = tierForPropertyCount(branchCount);
    const fromTier: PricingTier = asPlan(prof?.plan) ?? "basic";

    const paddle = getPaddleServer();
    // Read the live subscription up front — we mirror it into our local row on
    // EVERY outcome (even a no-op) so the billing page never shows a stale amount.
    // The webhook that normally mirrors it is delayed under load and cannot reach a
    // localhost/tunnel-less app, so we cannot depend on it.
    const live = await paddle.subscriptions.get(subId);
    const cycle: BillingCycle = live.billingCycle?.interval === "year" ? "annual" : "monthly";

    const mirror = async (s: typeof live) => {
      const it = s.items?.[0];
      const u = it?.price?.unitPrice?.amount;
      await admin
        .from("hms_paddle_subscriptions")
        .update({
          status: s.status ?? undefined,
          quantity: it?.quantity ?? 1,
          unit_amount: u != null ? Number(u) / 100 : undefined,
          currency_code: s.currencyCode ?? it?.price?.unitPrice?.currencyCode ?? undefined,
          current_period_end: s.currentBillingPeriod?.endsAt ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", ownerId);
    };

    // Same tier → nothing to charge; just refresh the mirror (self-heals a stale
    // display after a missed webhook).
    if (toTier === fromTier) { await mirror(live); return { status: "noop" }; }
    // Crossing into Enterprise is custom-quoted — never self-serve. Leave the
    // subscription; refresh the mirror; the caller surfaces a "contact us" prompt.
    if (toTier === "enterprise") { await mirror(live); return { status: "contactUs" }; }

    const goingUp = TIER_RANK[toTier] > TIER_RANK[fromTier];
    const prorationBillingMode = goingUp ? "prorated_immediately" : "prorated_next_billing_period";
    const scaffold = await paddle.prices.get(getPlanPriceId("basic", cycle), { include: ["product"] });
    const p = priceFor(country, toTier, cycle);

    const inlinePrice = {
      productId: scaffold.productId,
      description: scaffold.description,
      taxMode: scaffold.taxMode,
      billingCycle: scaffold.billingCycle
        ? { interval: scaffold.billingCycle.interval, frequency: scaffold.billingCycle.frequency }
        : null,
      unitPrice: { amount: String(toMinorUnits(p.amount)), currencyCode: p.currency as CurrencyCode },
      unitPriceOverrides: [],
      quantity: { minimum: 1, maximum: 1 },
    };

    type UpdateItem = Parameters<typeof paddle.subscriptions.update>[1]["items"] extends (infer U)[] | undefined ? U : never;
    const updated = await paddle.subscriptions.update(subId, {
      items: [{ price: inlinePrice, quantity: 1 } as UpdateItem],
      prorationBillingMode,
      customData: { owner_id: ownerId, cycle, plan: toTier },
    });
    await mirror(updated);

    if (goingUp) {
      // Going UP: charged the prorated difference NOW and gains the higher tier's
      // access, so advance plan + entitlements immediately (don't wait on webhook
      // timing). The transaction.paid webhook is idempotent, so a later duplicate is
      // harmless.
      await applyPlanEntitlements(admin, ownerId, toTier);
      await admin.from("hms_profiles").update({ plan: toTier }).eq("id", ownerId);
      // Analytics (server-confirmed upgrade). No-op unless GA4_API_SECRET set;
      // never awaited so it can't delay this billing operation. Categorical only.
      void trackServerEvent(ownerId, "subscription_upgraded", { from_plan: fromTier, to_plan: toTier });
      return { status: "charged", from: fromTier, to: toTier };
    }

    // Going DOWN: the lower price only takes effect at the next renewal, so DO NOT
    // strip plan/entitlements now — that would remove paid features while the owner
    // is still billed the higher tier through end of period. The renewal transaction
    // carries customData.plan = toTier and the webhook applies it then.
    void trackServerEvent(ownerId, "subscription_downgraded", { from_plan: fromTier, to_plan: toTier });
    return { status: "scheduled", from: fromTier, to: toTier };
  } catch (err: unknown) {
    console.error("[tier-sync] syncSubscriptionTierForOwner failed:", err);
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Refresh the LOCAL subscription mirror (amount/status/period + the plan the
 * subscription carries) from Paddle — WITHOUT changing the tier or charging. A
 * cheap, side-effect-safe self-heal for the billing page so a delayed or
 * (on localhost) unreachable webhook never leaves the display stale. No-op for
 * manual/PK, grandfathered, no-subscription, or cancelled owners.
 */
export async function reconcileSubscriptionMirror(ownerId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("hms_profiles")
      .select("country, custom_unit_amount_usd")
      .eq("id", ownerId)
      .maybeSingle();
    const prof = profile as { country?: string | null; custom_unit_amount_usd?: number | null } | null;
    if (isManualBankBilling(prof?.country ?? null)) return;
    // Grandfathered custom-rate mirrors a list price, not their charge — leave it.
    if (prof?.custom_unit_amount_usd != null && Number(prof.custom_unit_amount_usd) > 0) return;

    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions")
      .select("paddle_subscription_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
    const subId = sub?.paddle_subscription_id ?? null;
    if (!subId || !sub?.status || sub.status === "canceled") return;

    const paddle = getPaddleServer();
    const s = await paddle.subscriptions.get(subId);
    const it = s.items?.[0];
    const u = it?.price?.unitPrice?.amount;
    await admin
      .from("hms_paddle_subscriptions")
      .update({
        status: s.status ?? undefined,
        quantity: it?.quantity ?? 1,
        unit_amount: u != null ? Number(u) / 100 : undefined,
        currency_code: s.currencyCode ?? it?.price?.unitPrice?.currencyCode ?? undefined,
        current_period_end: s.currentBillingPeriod?.endsAt ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId);

    // Reflect the plan the subscription carries (if set) so entitlements match.
    const plan = asPlan((s.customData as { plan?: string } | null | undefined)?.plan);
    if (plan) {
      await applyPlanEntitlements(admin, ownerId, plan);
      await admin.from("hms_profiles").update({ plan }).eq("id", ownerId);
    }
  } catch (err: unknown) {
    console.error("[tier-sync] reconcileSubscriptionMirror failed:", err);
  }
}

/**
 * PAY-FIRST tier upgrade: charge the owner's card the prorated difference to move
 * to `toTier` and CONFIRM the payment succeeded BEFORE the caller creates the
 * property. Uses Paddle onPaymentFailure:'prevent_change' — if the immediate
 * proration charge fails, Paddle does NOT apply the tier change and this returns
 * { ok:false }, so no property is ever created on an unpaid upgrade.
 *
 * FAILS CLOSED: any unexpected error returns ok:false (caller must not create).
 *
 * Returns applied:false (but ok:true, safe to create) when no charge is due:
 * manual/PK, grandfathered custom-rate, not actually an upgrade, or no live
 * subscription yet (trial/unpaid — the tier is billed at conversion).
 *
 * SECURITY: server-only, ownerId supplied by trusted caller (createBranch →
 * authenticated user.id) — see the note on syncSubscriptionTierForOwner.
 */
export async function chargeTierUpgradeForOwner(
  ownerId: string,
  toTier: PricingTier
): Promise<{ ok: boolean; applied: boolean; reason?: string; error?: string }> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("hms_profiles")
      .select("country, custom_unit_amount_usd, plan")
      .eq("id", ownerId)
      .maybeSingle();
    const prof = profile as { country?: string | null; custom_unit_amount_usd?: number | null; plan?: string | null } | null;
    const country = prof?.country ?? null;

    if (isManualBankBilling(country)) return { ok: true, applied: false, reason: "manual" };
    if (prof?.custom_unit_amount_usd != null && Number(prof.custom_unit_amount_usd) > 0) {
      return { ok: true, applied: false, reason: "custom-rate" };
    }
    // Enterprise is custom-quoted — never a self-serve charge.
    if (toTier === "enterprise") return { ok: false, applied: false, error: "Enterprise is custom-quoted." };

    const fromTier: PricingTier = asPlan(prof?.plan) ?? "basic";
    // Not an upgrade (already at or above the target) → nothing to charge; safe to create.
    if (TIER_RANK[toTier] <= TIER_RANK[fromTier]) return { ok: true, applied: false, reason: "no-upgrade" };

    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions")
      .select("paddle_subscription_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
    const subId = sub?.paddle_subscription_id ?? null;
    // No live subscription (trial / unpaid): don't charge now — the tier is billed
    // when they subscribe/convert. Safe to create.
    if (!subId || !sub?.status || sub.status === "canceled") return { ok: true, applied: false, reason: "no-subscription" };

    const paddle = getPaddleServer();
    const live = await paddle.subscriptions.get(subId);
    const cycle: BillingCycle = live.billingCycle?.interval === "year" ? "annual" : "monthly";
    const { inlinePrice, targetMinor, currency: targetCurrency } = await buildTierInlinePrice(paddle, country, toTier, cycle);

    let updated: Awaited<ReturnType<typeof paddle.subscriptions.update>>;
    try {
      // Deliberately NOT wrapped in a client-side timeout: abandoning an in-flight
      // charge would leave an ambiguous state (Paddle may still capture it) and a
      // retry could double-charge. We await the real result; onPaymentFailure below
      // is what protects us — a failed charge reverts the change and throws.
      updated = await paddle.subscriptions.update(subId, {
        items: [{ price: inlinePrice, quantity: 1 } as UpdateItem],
        prorationBillingMode: "prorated_immediately",
        // If the prorated charge fails, Paddle reverts the change — nothing is
        // upgraded and this throws, so the caller does not create the property.
        onPaymentFailure: "prevent_change",
        customData: { owner_id: ownerId, cycle, plan: toTier },
      });
    } catch (payErr: unknown) {
      console.error("[tier-sync] chargeTierUpgradeForOwner: payment/update failed:", payErr);
      return { ok: false, applied: false, error: "Payment could not be completed." };
    }

    // Guard against a silent no-apply: the updated subscription's current price MUST
    // now equal the target tier price, or we treat the charge as not confirmed.
    const uItem = updated.items?.[0];
    const uUnit = uItem?.price?.unitPrice?.amount != null ? Number(uItem.price!.unitPrice!.amount) : null;
    if (uUnit == null || uUnit !== targetMinor) {
      console.error("[tier-sync] chargeTierUpgradeForOwner: change not applied (price mismatch)");
      return { ok: false, applied: false, error: "The upgrade could not be confirmed. Please try again." };
    }

    // Charge confirmed → mirror locally and advance plan + entitlements.
    await admin
      .from("hms_paddle_subscriptions")
      .update({
        status: updated.status ?? undefined,
        quantity: uItem?.quantity ?? 1,
        unit_amount: uUnit / 100,
        currency_code: updated.currencyCode ?? uItem?.price?.unitPrice?.currencyCode ?? targetCurrency,
        current_period_end: updated.currentBillingPeriod?.endsAt ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId);
    await applyPlanEntitlements(admin, ownerId, toTier);
    await admin.from("hms_profiles").update({ plan: toTier }).eq("id", ownerId);
    // Analytics (server-confirmed pay-first upgrade). No-op unless GA4_API_SECRET
    // is set; never awaited. Categorical tiers only.
    void trackServerEvent(ownerId, "subscription_upgraded", { from_plan: fromTier, to_plan: toTier });
    return { ok: true, applied: true };
  } catch (err: unknown) {
    // FAIL CLOSED — never let the caller create a property on an unconfirmed upgrade.
    console.error("[tier-sync] chargeTierUpgradeForOwner failed:", err);
    return { ok: false, applied: false, error: "Could not process the upgrade. Please try again." };
  }
}

// Inline Paddle price for a custom-rate (per-branch) owner: a FLAT USD amount for
// the whole subscription = the monthly USD TOTAL (already folds in the branch
// count — flat rate × count for legacy owners, the volume schedule for pk_card
// owners) × cycle multiple (annual ×10), quantity 1. Identical shape to the
// initial checkout (app/actions/paddle.ts). Returns the target minor amount so the
// caller can verify the charge applied.
async function buildCustomRateInlinePrice(
  paddle: ReturnType<typeof getPaddleServer>,
  monthlyTotalUsd: number,
  cycle: BillingCycle
) {
  const scaffold = await paddle.prices.get(getPlanPriceId("basic", cycle), { include: ["product"] });
  const amountMinor = Math.round(monthlyTotalUsd * (cycle === "annual" ? 10 : 1) * 100);
  const inlinePrice = {
    productId: scaffold.productId,
    description: scaffold.description,
    taxMode: scaffold.taxMode,
    billingCycle: scaffold.billingCycle
      ? { interval: scaffold.billingCycle.interval, frequency: scaffold.billingCycle.frequency }
      : null,
    unitPrice: { amount: String(amountMinor), currencyCode: "USD" as CurrencyCode },
    unitPriceOverrides: [],
    quantity: { minimum: 1, maximum: 1 },
  };
  return { inlinePrice, targetMinor: amountMinor };
}

/**
 * Pay-first charge for a CUSTOM-RATE / pk_card (per-branch) owner adding a branch.
 * The tier path (chargeTierUpgradeForOwner) deliberately exempts these owners, so
 * without this their per-branch flat amount was NEVER re-synced on a branch add —
 * they could create billing-active branches for free (revenue leak). This updates
 * their live Paddle subscription to per-branch × `billableCount` (the NEW total,
 * i.e. existing + the one about to be added), charges the proration immediately,
 * and CONFIRMS the new amount applied before returning ok — fail closed, exactly
 * like the tier path, so createBranch never creates on an unconfirmed charge.
 *
 * INTERNAL server helper (service-role), not a `use server` action.
 */
export async function chargeCustomRateForBranchCount(
  ownerId: string,
  billableCount: number
): Promise<{ ok: boolean; applied: boolean; reason?: string; error?: string }> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("hms_profiles")
      .select("custom_unit_amount_usd, pk_card_enabled")
      .eq("id", ownerId)
      .maybeSingle();
    const prof = profile as { custom_unit_amount_usd?: number | null; pk_card_enabled?: boolean | null } | null;
    const customMonthly = prof?.custom_unit_amount_usd;
    const pkCard = prof?.pk_card_enabled === true;
    // Only per-branch (custom-rate) owners belong here; anyone else is charged via
    // the tier path. Safe to proceed with creation for a non-custom owner.
    if (customMonthly == null || Number(customMonthly) <= 0) return { ok: true, applied: false, reason: "not-custom-rate" };

    // pk_card owners at 21+ branches are custom-quoted — block the self-serve add.
    const monthlyTotal = customRateMonthlyUsd(pkCard, Number(customMonthly), billableCount);
    if (monthlyTotal == null) {
      return { ok: false, applied: false, reason: "custom-quote", error: "20+ branches is custom-priced — please contact us to add more branches." };
    }

    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions")
      .select("paddle_subscription_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
    const subId = sub?.paddle_subscription_id ?? null;
    // No live subscription (trial / not yet subscribed): the full amount is billed
    // when they subscribe/convert, so nothing to charge now. Safe to create.
    if (!subId || !sub?.status || sub.status === "canceled") return { ok: true, applied: false, reason: "no-subscription" };

    const paddle = getPaddleServer();
    const live = await paddle.subscriptions.get(subId);
    const cycle: BillingCycle = live.billingCycle?.interval === "year" ? "annual" : "monthly";
    const { inlinePrice, targetMinor } = await buildCustomRateInlinePrice(paddle, monthlyTotal, cycle);

    let updated: Awaited<ReturnType<typeof paddle.subscriptions.update>>;
    try {
      updated = await paddle.subscriptions.update(subId, {
        items: [{ price: inlinePrice, quantity: 1 } as UpdateItem],
        prorationBillingMode: "prorated_immediately",
        onPaymentFailure: "prevent_change",
        customData: { owner_id: ownerId, cycle, per_branch: true, branches: billableCount },
      });
    } catch (payErr: unknown) {
      console.error("[tier-sync] chargeCustomRateForBranchCount: payment/update failed:", payErr);
      return { ok: false, applied: false, error: "Payment could not be completed." };
    }

    const uItem = updated.items?.[0];
    const uUnit = uItem?.price?.unitPrice?.amount != null ? Number(uItem.price!.unitPrice!.amount) : null;
    if (uUnit == null || uUnit !== targetMinor) {
      console.error("[tier-sync] chargeCustomRateForBranchCount: change not applied (amount mismatch)");
      return { ok: false, applied: false, error: "The charge could not be confirmed. Please try again." };
    }

    // Charge confirmed → mirror the subscription locally. No plan/entitlement change:
    // custom-rate owners keep their contracted plan; only the amount scales with branches.
    await admin
      .from("hms_paddle_subscriptions")
      .update({
        status: updated.status ?? undefined,
        quantity: uItem?.quantity ?? 1,
        unit_amount: uUnit / 100,
        currency_code: updated.currencyCode ?? uItem?.price?.unitPrice?.currencyCode ?? "USD",
        current_period_end: updated.currentBillingPeriod?.endsAt ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId);
    return { ok: true, applied: true };
  } catch (err: unknown) {
    // FAIL CLOSED — never let createBranch create on an unconfirmed charge.
    console.error("[tier-sync] chargeCustomRateForBranchCount failed:", err);
    return { ok: false, applied: false, error: "Could not process the branch charge. Please try again." };
  }
}

/**
 * PREVIEW the immediate (prorated) charge for moving an owner to `toTier`, WITHOUT
 * charging anything. Read-only — uses Paddle's previewUpdate. Used to show a
 * confirmation ("you'll be charged X now") before the owner commits to adding a
 * property. Returns { willCharge:false } for the cases that never charge now
 * (manual/PK, grandfathered, not an upgrade, trial/no live subscription,
 * enterprise). `amount` is a minor-unit string in `currency`.
 *
 * On preview failure it returns willCharge:true with no amount — the UI then warns
 * "an upgrade charge applies" without a figure rather than implying it's free.
 *
 * SECURITY: server-only, ownerId supplied by trusted caller — see the note on
 * syncSubscriptionTierForOwner.
 */
export async function previewTierUpgradeForOwner(
  ownerId: string,
  toTier: PricingTier
): Promise<{ willCharge: boolean; amount?: string; currency?: string; reason?: string }> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("hms_profiles")
      .select("country, custom_unit_amount_usd, plan")
      .eq("id", ownerId)
      .maybeSingle();
    const prof = profile as { country?: string | null; custom_unit_amount_usd?: number | null; plan?: string | null } | null;
    const country = prof?.country ?? null;

    if (isManualBankBilling(country)) return { willCharge: false, reason: "manual" };
    if (prof?.custom_unit_amount_usd != null && Number(prof.custom_unit_amount_usd) > 0) {
      return { willCharge: false, reason: "custom-rate" };
    }
    if (toTier === "enterprise") return { willCharge: false, reason: "enterprise" };

    const fromTier: PricingTier = asPlan(prof?.plan) ?? "basic";
    if (TIER_RANK[toTier] <= TIER_RANK[fromTier]) return { willCharge: false, reason: "no-upgrade" };

    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions")
      .select("paddle_subscription_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
    const subId = sub?.paddle_subscription_id ?? null;
    if (!subId || !sub?.status || sub.status === "canceled") return { willCharge: false, reason: "no-subscription" };

    const paddle = getPaddleServer();
    const live = await paddle.subscriptions.get(subId);
    const cycle: BillingCycle = live.billingCycle?.interval === "year" ? "annual" : "monthly";
    const { inlinePrice } = await buildTierInlinePrice(paddle, country, toTier, cycle);

    const preview = await paddle.subscriptions.previewUpdate(subId, {
      items: [{ price: inlinePrice, quantity: 1 } as UpdateItem],
      prorationBillingMode: "prorated_immediately",
    });
    const r = preview.updateSummary?.result;
    if (r && r.action === "charge" && Number(r.amount) > 0) {
      return { willCharge: true, amount: r.amount, currency: r.currencyCode };
    }
    // A credit or zero net → no immediate charge is taken.
    return { willCharge: false, reason: "no-immediate-charge", currency: r?.currencyCode };
  } catch (err: unknown) {
    console.error("[tier-sync] previewTierUpgradeForOwner failed:", err);
    // Fail toward warning, not silence: tell the UI a charge applies (no figure).
    return { willCharge: true, reason: "preview-failed" };
  }
}

/**
 * PREVIEW the prorated charge for a CUSTOM-RATE / pk_card (per-branch) owner adding
 * a branch — the read-only counterpart to chargeCustomRateForBranchCount, so the
 * Add Property dialog shows the real "+$X now" figure instead of implying it's free.
 * `billableCount` is the NEW total (existing + the one about to be added).
 */
export async function previewCustomRateBranchAdd(
  ownerId: string,
  billableCount: number
): Promise<{ willCharge: boolean; amount?: string; currency?: string; reason?: string }> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("hms_profiles")
      .select("custom_unit_amount_usd, pk_card_enabled")
      .eq("id", ownerId)
      .maybeSingle();
    const prof = profile as { custom_unit_amount_usd?: number | null; pk_card_enabled?: boolean | null } | null;
    const customMonthly = prof?.custom_unit_amount_usd;
    const pkCard = prof?.pk_card_enabled === true;
    if (customMonthly == null || Number(customMonthly) <= 0) return { willCharge: false, reason: "not-custom-rate" };

    // pk_card owner at 21+ branches — custom-quoted, no self-serve figure to show.
    const monthlyTotal = customRateMonthlyUsd(pkCard, Number(customMonthly), billableCount);
    if (monthlyTotal == null) return { willCharge: false, reason: "custom-quote" };

    const { data: subRow } = await admin
      .from("hms_paddle_subscriptions")
      .select("paddle_subscription_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    const sub = subRow as { paddle_subscription_id?: string | null; status?: string | null } | null;
    const subId = sub?.paddle_subscription_id ?? null;
    if (!subId || !sub?.status || sub.status === "canceled") return { willCharge: false, reason: "no-subscription" };

    const paddle = getPaddleServer();
    const live = await paddle.subscriptions.get(subId);
    const cycle: BillingCycle = live.billingCycle?.interval === "year" ? "annual" : "monthly";
    const { inlinePrice } = await buildCustomRateInlinePrice(paddle, monthlyTotal, cycle);

    const preview = await paddle.subscriptions.previewUpdate(subId, {
      items: [{ price: inlinePrice, quantity: 1 } as UpdateItem],
      prorationBillingMode: "prorated_immediately",
    });
    const r = preview.updateSummary?.result;
    if (r && r.action === "charge" && Number(r.amount) > 0) {
      return { willCharge: true, amount: r.amount, currency: r.currencyCode };
    }
    return { willCharge: false, reason: "no-immediate-charge", currency: r?.currencyCode };
  } catch (err: unknown) {
    console.error("[tier-sync] previewCustomRateBranchAdd failed:", err);
    return { willCharge: true, reason: "preview-failed" };
  }
}
