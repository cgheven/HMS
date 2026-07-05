"use server";

import { createAdminClient } from "@/lib/supabase/admin";

const VALID_PLANS = new Set(["single", "small", "medium", "large"]);

function cap(value: string | undefined | null, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

export async function submitDemoRequest(data: {
  contact_name: string;
  hostel_name: string;
  phone: string;
  city?: string;
  plan_interest?: string;
  message?: string;
}): Promise<{ error?: string }> {
  const contact_name = cap(data.contact_name, 100);
  const hostel_name  = cap(data.hostel_name, 150);
  const phone        = cap(data.phone, 20);

  if (!contact_name) return { error: "Name is required" };
  if (!hostel_name)  return { error: "Hostel name is required" };
  if (!phone)        return { error: "Phone number is required" };

  const plan_interest =
    data.plan_interest && VALID_PLANS.has(data.plan_interest)
      ? data.plan_interest
      : null;

  const city    = cap(data.city, 100)    || null;
  const message = cap(data.message, 500) || null;

  const admin = createAdminClient();
  const { error } = await admin.from("hms_inquiries").insert({
    contact_name,
    hostel_name,
    phone,
    city,
    plan_interest,
    message,
  });

  if (error) return { error: "Something went wrong. Please try again." };
  return {};
}
