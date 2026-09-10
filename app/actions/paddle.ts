"use server";

import { unstable_rethrow } from "next/navigation";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddleServer } from "@/lib/paddle-server";
import { getPlanPriceId, type PlanKey, type BillingCycle } from "@/lib/paddle";

/**
 * Create a Paddle transaction for the owner's chosen plan, then hand its id to
 * the browser to open checkout. Everything that affects the charge is decided
 * HERE, server-side, so the checkout cannot be tampered with:
 *   - plan/cycle are re-validated to a fixed enum and mapped to a price id here;
 *   - quantity = the owner's ACTUAL branch count (not sent by the client);
 *   - owner_id (for webhook linking) is the authenticated user.
 * Opening checkout with this transaction id also LOCKS the line items, so the
 * quantity stepper can't be edited in the overlay.
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
    const plan: PlanKey = input.plan === "standard" ? "standard" : "basic";
    const cycle: BillingCycle = input.cycle === "annual" ? "annual" : "monthly";
    const priceId = getPlanPriceId(plan, cycle);

    // Locked quantity: the owner's real branch count, counted server-side.
    const admin = createAdminClient();
    const { count } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId);
    const quantity = Math.max(1, count ?? 1);

    const txn = await getPaddleServer().transactions.create({
      items: [{ priceId, quantity }],
      customData: { owner_id: ownerId, plan, cycle },
    });

    return { transactionId: txn.id };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
