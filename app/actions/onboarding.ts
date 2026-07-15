"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateAnnualPrice } from "@/lib/pricing";
import { headers } from "next/headers";

export interface OnboardingFormData {
  business_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  city?: string;
  branch_count: number;
  hostel_type?: string;
  source?: string;
  message?: string;
  // honeypot — must be empty
  website_url?: string;
}

const VALID_HOSTEL_TYPES = ["boys", "girls", "mixed", "family"];

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

  const hostelType = formData.hostel_type?.trim();
  if (hostelType && !VALID_HOSTEL_TYPES.includes(hostelType)) {
    return { success: false, error: "Invalid hostel type." };
  }

  // --- Get client IP from headers (use rightmost entry set by trusted proxy, not client) ---
  let ipAddress: string | null = null;
  try {
    const headersList = await headers();
    ipAddress =
      headersList.get("x-vercel-forwarded-for") ??
      headersList.get("x-real-ip") ??
      headersList.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
      null;
  } catch {
    // non-fatal
  }

  // --- IP-based rate limiting (uses admin client to bypass RLS which blocks anon reads) ---
  if (ipAddress) {
    const adminForCount = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await adminForCount
      .from("hms_platform_leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ipAddress)
      .gte("created_at", oneHourAgo);
    if (countErr) {
      // Fail closed: cannot verify rate limit
      return { success: false, error: "Service temporarily unavailable. Please try again." };
    }
    if (typeof count === "number" && count >= 5) {
      // Silently succeed to avoid leaking rate-limit info to bots
      return { success: true };
    }
  }

  // --- Insert into hms_platform_leads ---
  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient.from("hms_platform_leads").insert({
      business_name: businessName,
      owner_name: ownerName,
      phone,
      email: formData.email?.trim() || null,
      city: formData.city?.trim() || null,
      branch_count: branchCount,
      hostel_type: hostelType || null,
      source: formData.source?.trim() || null,
      notes: formData.message?.trim() || null,
      status: "new",
      ip_address: ipAddress,
      quoted_annual_price: calculateAnnualPrice(branchCount),
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
