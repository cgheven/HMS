"use server";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export interface OnboardingFormData {
  business_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  city?: string;
  branch_count: number;
  message?: string;
  // honeypot — must be empty
  website_url?: string;
}

export async function submitOnboarding(
  formData: OnboardingFormData
): Promise<{ success: boolean; error?: string }> {
  // --- Honeypot check ---
  if (formData.website_url && formData.website_url.trim() !== "") {
    // Bot filled the honeypot field — silently succeed from the bot's perspective
    return { success: true };
  }

  // --- Field validation ---
  const businessName = formData.business_name?.trim();
  const ownerName = formData.owner_name?.trim();
  const phone = formData.phone?.trim();

  if (!businessName) return { success: false, error: "Business name is required." };
  if (!ownerName) return { success: false, error: "Your name is required." };
  if (!phone) return { success: false, error: "WhatsApp number is required." };
  if (phone.length < 7) return { success: false, error: "Please enter a valid phone number." };

  const branchCount =
    typeof formData.branch_count === "number"
      ? formData.branch_count
      : parseInt(String(formData.branch_count), 10) || 1;

  if (branchCount < 1) return { success: false, error: "Branch count must be at least 1." };

  // --- Get client IP from headers (best-effort) ---
  let ipAddress: string | null = null;
  try {
    const headersList = await headers();
    ipAddress =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headersList.get("x-real-ip") ??
      null;
  } catch {
    // non-fatal
  }

  // --- F-005: IP-based rate limiting ---
  // Reject if more than 5 submissions from the same IP in the last hour.
  if (ipAddress) {
    try {
      const supabase = await createClient();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("hms_platform_leads")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ipAddress)
        .gte("created_at", oneHourAgo);
      if (typeof count === "number" && count >= 5) {
        // Silently succeed to avoid leaking rate-limit info to bots
        return { success: true };
      }
    } catch {
      // non-fatal: if the rate-limit check fails, proceed with insert
    }
  }

  // --- Insert into hms_platform_leads ---
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("hms_platform_leads").insert({
      business_name: businessName,
      owner_name: ownerName,
      phone,
      email: formData.email?.trim() || null,
      city: formData.city?.trim() || null,
      branch_count: branchCount,
      notes: formData.message?.trim() || null,
      status: "new",
      ip_address: ipAddress,
    });

    if (error) {
      console.error("[submitOnboarding] DB error:", error.message);
      return { success: false, error: "Something went wrong. Please try again." };
    }

    return { success: true };
  } catch (e) {
    console.error("[submitOnboarding] unexpected error:", e);
    return { success: false, error: "Something went wrong. Please try again." };
  }
}
