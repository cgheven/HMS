"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import type { PaymentMethodAccount } from "@/types";

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
