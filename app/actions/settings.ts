"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOwnerOrPartnerTierWrite } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import type { PaymentMethodAccount, WifiNetwork, MealTimes } from "@/types";

export async function savePaymentRecoverySettings({
  payment_methods,
  reminder_template,
}: {
  payment_methods: PaymentMethodAccount[];
  reminder_template: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Branch-scoped settings (bank accounts + reminder template for this
    // branch's tenants), so a full-tier partner may edit them. The write itself
    // goes through the session client and is additionally gated by the
    // members_update_hostels RLS policy, which is full-tier only.
    await requireOwnerOrPartnerTierWrite("full");
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("No active hostel");
    const { hostelId } = ctx;
    const supabase = await createClient();

    const { error } = await supabase
      .from("hms_hostels")
      .update({
        payment_methods,
        reminder_template: reminder_template.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", hostelId);

    if (error) throw error;

    revalidatePath("/settings");
    revalidatePath("/payments");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Optional per-branch billing date (migration 272). billing_anchor_day:
// null | 1..31. null clears it (back to per-tenant anniversary billing) and,
// per the agreed behaviour, leaves already-PAID bills untouched — the pricing
// trigger freezes any collected row, so clearing the anchor only affects future
// and still-pending bills. bill_leftover_days_separately toggles whether a
// mid-month joiner's partial days get their own bill (true) or merge into the
// first full-month bill (false, default).
export async function saveBillingSettings({
  billing_anchor_day,
  bill_leftover_days_separately,
}: {
  billing_anchor_day: number | null;
  bill_leftover_days_separately: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOwnerOrPartnerTierWrite("full");
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("No active hostel");
    const { hostelId } = ctx;

    // Validate: null (off) or an integer day 1..31. Anything else is rejected
    // rather than silently coerced — this drives money.
    let anchor: number | null = null;
    if (billing_anchor_day !== null && billing_anchor_day !== undefined) {
      const day = Math.trunc(Number(billing_anchor_day));
      if (!Number.isFinite(day) || day < 1 || day > 31) {
        return { success: false, error: "Billing date must be a day between 1 and 31, or left empty." };
      }
      anchor = day;
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("hms_hostels")
      .update({
        billing_anchor_day: anchor,
        bill_leftover_days_separately: !!bill_leftover_days_separately,
        updated_at: new Date().toISOString(),
      })
      .eq("id", hostelId);

    if (error) throw error;

    revalidatePath("/settings");
    revalidatePath("/payments");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function trimMealTimeRange(r?: { from: string; to: string }): { from: string; to: string } | undefined {
  const from = r?.from?.trim() ?? "";
  const to = r?.to?.trim() ?? "";
  return from && to ? { from, to } : undefined;
}

export async function saveWelcomeSettings({
  wifi_networks,
  welcome_message_template,
  meal_times,
}: {
  wifi_networks: WifiNetwork[];
  welcome_message_template: string;
  meal_times: MealTimes;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Same branch-scoped, full-tier-partner-editable shape as
    // savePaymentRecoverySettings above.
    await requireOwnerOrPartnerTierWrite("full");
    const ctx = await getAuthContext();
    if (!ctx?.hostelId) throw new Error("No active hostel");
    const { hostelId } = ctx;
    const supabase = await createClient();

    // Drop any meal whose from/to isn't fully filled in — half-entered rows
    // shouldn't render a broken "Breakfast: 7:00 AM -" line.
    const cleanedMealTimes: MealTimes = {
      breakfast: trimMealTimeRange(meal_times.breakfast),
      lunch: trimMealTimeRange(meal_times.lunch),
      dinner: trimMealTimeRange(meal_times.dinner),
    };

    // Sanitize each network's coverage: drop blank tokens and de-duplicate, so
    // the stored JSON is clean regardless of what the client posted. Only
    // "floor:" / "room:" tokens are kept — anything else is discarded rather
    // than trusted into the resident-matching later.
    const cleanedWifi: WifiNetwork[] = (wifi_networks ?? []).map((w) => {
      const coverage = Array.from(
        new Set((w.coverage ?? []).map((t) => (t ?? "").trim()).filter((t) => /^(floor|room):.+/i.test(t)))
      );
      return { id: w.id, name: w.name, password: w.password, ...(coverage.length ? { coverage } : {}) };
    });

    const { error } = await supabase
      .from("hms_hostels")
      .update({
        wifi_networks: cleanedWifi,
        welcome_message_template: welcome_message_template.trim() || null,
        meal_times: cleanedMealTimes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", hostelId);

    if (error) throw error;

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
