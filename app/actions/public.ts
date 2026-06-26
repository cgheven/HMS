"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendWaitlistEmail } from "@/lib/email";
import type { PublicHostel, PublicHostelDetail, PublicRoom, FoodItem } from "@/types";

export async function getPublicHostels(): Promise<{ hostels?: PublicHostel[]; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_hostels")
      .select("id,owner_id,name,address,phone,whatsapp,email,total_capacity,city,area,maps_url,description,hostel_type,amenities,slug,food_closed_on_sundays,cover_image_url")
      .eq("listing_enabled", true)
      .order("name");
    if (error) throw error;

    const hostels = (data ?? []) as (Omit<PublicHostel, "available_beds" | "owner_name">)[];
    if (hostels.length === 0) return { hostels: [] };

    const ids      = hostels.map((h) => h.id);
    const ownerIds = [...new Set(hostels.map((h) => h.owner_id))];

    const [{ data: rooms }, { data: profiles }] = await Promise.all([
      admin
        .from("hms_rooms")
        .select("hostel_id, capacity, occupied")
        .in("hostel_id", ids)
        .eq("status", "available"),
      admin
        .from("hms_profiles")
        .select("id, full_name")
        .in("id", ownerIds),
    ]);

    const availMap: Record<string, number> = {};
    for (const r of rooms ?? []) {
      availMap[r.hostel_id] = (availMap[r.hostel_id] ?? 0) + Math.max(0, r.capacity - r.occupied);
    }

    const ownerMap: Record<string, string | null> = {};
    for (const p of profiles ?? []) {
      ownerMap[p.id] = p.full_name;
    }

    return {
      hostels: hostels.map((h) => ({
        ...h,
        owner_name: ownerMap[h.owner_id] ?? null,
        available_beds: availMap[h.id] ?? 0,
      })),
    };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function getPublicHostel(slug: string): Promise<{ hostel?: PublicHostelDetail; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data: hostelData, error: hostelErr } = await admin
      .from("hms_hostels")
      .select("id,owner_id,name,address,phone,whatsapp,email,total_capacity,city,area,maps_url,description,hostel_type,amenities,slug,food_closed_on_sundays,cover_image_url")
      .eq("slug", slug)
      .eq("listing_enabled", true)
      .single();

    if (hostelErr || !hostelData) return { error: "Hostel not found" };

    const hostelId = hostelData.id;

    // Current month bounds
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const monthStart = `${y}-${m}-01`;
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const monthEnd = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;

    const [{ data: profile }, { data: rooms }, { data: foodItems }, { data: pkgConfig }] = await Promise.all([
      admin.from("hms_profiles").select("full_name").eq("id", hostelData.owner_id).maybeSingle(),
      admin
        .from("hms_rooms")
        .select("id,room_number,floor,type,capacity,occupied,monthly_rent,status,has_ac,has_cooler,photo_path,photo_path_2,photo_path_3,photo_path_4,photo_path_5")
        .eq("hostel_id", hostelId)
        .neq("status", "maintenance")
        .order("room_number"),
      admin
        .from("hms_food_items")
        .select("*")
        .eq("hostel_id", hostelId)
        .gte("date", monthStart)
        .lte("date", monthEnd)
        .order("date")
        .order("sort_order"),
      admin
        .from("hms_package_configs")
        .select("id,hostel_id,food_monthly_rate,food_bd_rate,food_3meals_rate,ac_per_unit_rate,created_at,updated_at")
        .eq("hostel_id", hostelId)
        .maybeSingle(),
    ]);

    const available_beds = (rooms ?? []).reduce(
      (sum, r) => sum + Math.max(0, r.capacity - r.occupied),
      0
    );

    return {
      hostel: {
        ...hostelData,
        owner_name: profile?.full_name ?? null,
        available_beds,
        rooms: (rooms ?? []) as PublicRoom[],
        food_menu: (foodItems ?? []) as FoodItem[],
        package_config: pkgConfig ?? null,
      },
    };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function joinWaitlist(
  hostelId: string,
  name: string,
  phone: string,
): Promise<{ error?: string }> {
  try {
    const cleanName  = name.trim().slice(0, 100);
    const cleanPhone = phone.trim().slice(0, 20);
    if (!cleanName || !cleanPhone) throw new Error("Name and phone are required");
    const admin = createAdminClient();

    // SECURITY: validate hostel is publicly listed; grab name+owner for email notification
    const { data: hostelCheck } = await admin
      .from("hms_hostels")
      .select("id, name, owner_id")
      .eq("id", hostelId)
      .eq("listing_enabled", true)
      .maybeSingle();
    if (!hostelCheck) return { error: "Hostel not found." };

    // SECURITY: rate-limit — max 3 waitlist entries per phone per 24 hours across all hostels
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await admin
      .from("hms_waitlist")
      .select("id", { count: "exact", head: true })
      .eq("phone", cleanPhone)
      .gte("created_at", since24h);
    if ((recentCount ?? 0) >= 3) {
      return { error: "Too many requests. Please try again tomorrow." };
    }

    // SECURITY: atomic dedup via upsert to eliminate TOCTOU race
    const { error } = await admin
      .from("hms_waitlist")
      .upsert(
        { hostel_id: hostelId, name: cleanName, phone: cleanPhone },
        { onConflict: "hostel_id,phone", ignoreDuplicates: true }
      );
    if (error) return { error: "Something went wrong. Please try again." };

    // Fire-and-forget owner notification — never blocks the response
    void (async () => {
      try {
        const { data: { user: owner } } = await admin.auth.admin.getUserById(hostelCheck.owner_id);
        if (!owner?.email) return;
        await sendWaitlistEmail({
          ownerEmail: owner.email,
          hostelName: hostelCheck.name,
          name: cleanName,
          phone: cleanPhone,
        });
      } catch {
        // Email failure must never surface to the user
      }
    })();

    return {};
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}


export async function submitApplication(
  hostelId: string,
  data: {
    full_name: string;
    phone: string;
    email?: string;
    cnic?: string;
    room_preference?: string;
    package_tier: string;
    move_in_date?: string;
    notes?: string;
  }
): Promise<{ error?: string }> {
  try {
    if (!data.full_name.trim() || !data.phone.trim()) throw new Error("Name and phone are required");
    const admin = createAdminClient();

    // SECURITY: validate hostel is publicly listed before accepting any application
    const { data: targetHostel } = await admin
      .from("hms_hostels")
      .select("id")
      .eq("id", hostelId)
      .eq("listing_enabled", true)
      .maybeSingle();
    if (!targetHostel) return { error: "Hostel not found." };

    const payload = {
      hostel_id: hostelId,
      full_name: data.full_name.trim().slice(0, 100),
      phone: data.phone.trim().slice(0, 20),
      email: data.email?.trim().slice(0, 200) || null,
      cnic: data.cnic?.trim().slice(0, 20) || null,
      room_preference: data.room_preference?.trim().slice(0, 50) || null,
      package_tier: data.package_tier,
      move_in_date: data.move_in_date || null,
      notes: data.notes?.trim().slice(0, 500) || null,
    };
    const { error } = await admin.from("hms_tenant_applications").insert(payload);
    if (error) throw error;
    return {};
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}
