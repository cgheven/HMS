"use server";

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ComplaintCategory } from "@/types";

// Kept in sync with the hms_complaints CHECK constraint (migration
// 138_complaint_qr_feature.sql) — this is the single unified category
// vocabulary used by both the public tenant form and the owner-facing
// internal complaint form (components/modules/complaints/complaints-client.tsx).
const VALID_CATEGORIES = new Set<ComplaintCategory>([
  "kitchen",
  "staff",
  "cleanliness",
  "maintenance",
  "security",
  "other",
]);

const DESCRIPTION_MAX_LENGTH = 2000;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Public, no-login complaint submission — reached by scanning a QR code
 * printed at the hostel. Anyone can hit this action, so it must independently
 * re-verify everything server-side: the hostel (via complaint_code), that the
 * phone belongs to a currently active tenant (name is display-only, never
 * part of the identity check — tenants type it inconsistently), and a
 * per-tenant rate limit to block spam once a real tenant is matched. Room is
 * NOT collected from the tenant — it's read off the matched tenant's own
 * record, since a self-reported room number isn't a real secret (it's on
 * their own door) and phone alone already uniquely resolves the tenant.
 */
export async function submitComplaintAction(
  complaintCode: string,
  fullName: string,
  phone: string,
  category: ComplaintCategory,
  description: string
): Promise<{ error: string | null }> {
  try {
    const cleanCode = complaintCode?.trim();
    const cleanName = fullName?.trim();
    const cleanPhone = phone?.trim();
    const cleanDescription = description?.trim();

    if (!cleanCode) return { error: "Invalid complaint link." };
    if (!cleanName) return { error: "Name is required." };
    if (!cleanPhone) return { error: "Phone number is required." };
    if (!VALID_CATEGORIES.has(category)) return { error: "Invalid category." };
    if (!cleanDescription) return { error: "Please describe the issue." };
    if (cleanDescription.length > DESCRIPTION_MAX_LENGTH) {
      return { error: `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.` };
    }

    const admin = createAdminClient();

    // SECURITY: resolve hostel via complaint_code only — never trust a
    // client-supplied hostel_id. Not gated on listing_enabled (see
    // getPublicHostelByComplaintCode).
    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("id")
      .eq("complaint_code", cleanCode)
      .maybeSingle();
    if (!hostel) return { error: "Hostel not found." };

    // SECURITY: identity check is phone ONLY — name is stored for display
    // purposes and never matched (tenants type it inconsistently). If more
    // than one active tenant happens to share a phone (e.g. a shared family
    // number), the first match is used — low-stakes for a complaint record,
    // unlike a payment or identity-sensitive action.
    const normalizedInputPhone = normalizePhone(cleanPhone);
    const { data: tenants } = await admin
      .from("hms_tenants")
      .select("id, phone, room_id")
      .eq("hostel_id", hostel.id)
      .eq("is_active", true);
    const tenant = (tenants ?? []).find(
      (t) => normalizePhone(t.phone ?? "") === normalizedInputPhone
    );
    if (!tenant) {
      return {
        error:
          "We couldn't verify an active tenant with that phone number. Please double check and try again, or contact the hostel directly.",
      };
    }

    // SECURITY: rate-limit — max 5 complaints per tenant per rolling 24h to
    // block spam while comfortably allowing a couple of genuine issues in a day.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await admin
      .from("hms_complaints")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", since24h);
    if ((recentCount ?? 0) >= 5) {
      return { error: "Too many complaints submitted recently. Please try again tomorrow." };
    }

    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

    const { error } = await admin.from("hms_complaints").insert({
      hostel_id: hostel.id,
      tenant_id: tenant.id,
      room_id: tenant.room_id,
      title: `${categoryLabel} complaint`,
      description: cleanDescription,
      category,
      status: "open",
      priority: "medium",
    });
    if (error) return { error: "Something went wrong. Please try again." };

    revalidatePath("/complaints");
    return { error: null };
  } catch (err: unknown) {
    unstable_rethrow(err);
    // Never surface raw error text to an anonymous, unauthenticated caller.
    return { error: "An unexpected error occurred. Please try again." };
  }
}
