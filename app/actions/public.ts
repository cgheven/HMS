"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicHostel } from "@/types";

export async function getPublicHostels(): Promise<{ hostels?: PublicHostel[]; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_hostels")
      .select("id,name,address,phone,email,total_capacity,city,area,maps_url,description,hostel_type,amenities")
      .eq("listing_enabled", true)
      .order("name");
    if (error) throw error;

    const hostels = (data ?? []) as Omit<PublicHostel, "available_beds">[];
    if (hostels.length === 0) return { hostels: [] };

    const ids = hostels.map((h) => h.id);
    const { data: rooms } = await admin
      .from("hms_rooms")
      .select("hostel_id, capacity, occupied")
      .in("hostel_id", ids)
      .eq("status", "available");

    const availMap: Record<string, number> = {};
    for (const r of rooms ?? []) {
      availMap[r.hostel_id] = (availMap[r.hostel_id] ?? 0) + Math.max(0, r.capacity - r.occupied);
    }

    return {
      hostels: hostels.map((h) => ({ ...h, available_beds: availMap[h.id] ?? 0 })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load hostels" };
  }
}

export async function joinWaitlist(
  hostelId: string,
  name: string,
  phone: string,
): Promise<{ error?: string }> {
  try {
    if (!name.trim() || !phone.trim()) throw new Error("Name and phone are required");
    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_waitlist")
      .insert({ hostel_id: hostelId, name: name.trim(), phone: phone.trim() });
    if (error) throw error;
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to join waitlist" };
  }
}
