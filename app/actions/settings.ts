"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOwnerOrPartnerTier, requireOwnerOrAbove } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSubdomain, subdomainError } from "@/lib/subdomain";
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
    await requireOwnerOrPartnerTier("full");
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
    await requireOwnerOrPartnerTier("full");
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

    const { error } = await supabase
      .from("hms_hostels")
      .update({
        wifi_networks,
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

// ── Branded subdomain (owner self-service) ────────────────────────────────────
// {label}.hostels.yourpulse.io serves this business's public listing.
//
// Owner-level, so it covers every branch — not a per-branch setting despite
// living on a page with a branch switcher.
//
// ONE TIME ONLY. Once set, an owner cannot change or clear it: the address goes
// onto signs, WhatsApp messages and Google, and a rename silently breaks every
// copy already in the wild. Renaming stays a Super Admin action so there is a
// human in the loop who can weigh that. Enforced here, not just in the UI.
//
// Writes through the service role deliberately. A BEFORE UPDATE trigger
// (migration 155) rejects any change to this column while auth.uid() is set,
// which is what stops an owner claiming a rival's name straight from devtools.
// Service-role connections have a null auth.uid(), so this action is the only
// door — and it checks ownership itself before opening it.

export async function getMySubdomain(): Promise<{ subdomain?: string | null; error?: string }> {
  try {
    const profile = await requireOwnerOrAbove();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_profiles")
      .select("subdomain")
      .eq("id", profile.id)
      .maybeSingle();
    if (error) throw error;

    return { subdomain: data?.subdomain ?? null };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to load subdomain" };
  }
}

export async function claimMySubdomain(
  subdomain: string
): Promise<{ subdomain?: string; error?: string }> {
  try {
    const profile = await requireOwnerOrAbove();

    const value = normalizeSubdomain(subdomain);
    const reason = subdomainError(value);
    if (reason) return { error: reason };

    const admin = createAdminClient();

    // Re-read rather than trusting anything the browser sent: this is the
    // one-time gate, and it is the only thing standing between a client and a
    // rename that breaks their printed material.
    const { data: existing, error: readErr } = await admin
      .from("hms_profiles")
      .select("subdomain")
      .eq("id", profile.id)
      .maybeSingle();
    if (readErr) throw readErr;

    if (existing?.subdomain) {
      return { error: "Your subdomain is already set and cannot be changed. Contact support if it's wrong." };
    }

    const { data: clash } = await admin
      .from("hms_profiles")
      .select("id")
      .eq("subdomain", value)
      .neq("id", profile.id)
      .maybeSingle();
    if (clash) return { error: "That subdomain is already taken. Try another." };

    // Guarded on subdomain IS NULL so two tabs racing can't both claim; the
    // loser updates zero rows rather than overwriting the winner.
    const { data: updated, error } = await admin
      .from("hms_profiles")
      .update({ subdomain: value })
      .eq("id", profile.id)
      .is("subdomain", null)
      .select("subdomain");
    if (error) {
      if (error.code === "23505") return { error: "That subdomain was just taken. Try another." };
      if (error.code === "23514") return { error: "Not a valid subdomain" };
      throw error;
    }
    if (!updated || updated.length === 0) {
      return { error: "Your subdomain is already set and cannot be changed." };
    }

    revalidatePath("/settings");
    return { subdomain: value };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to save subdomain" };
  }
}
