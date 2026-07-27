"use server";

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWaitlistEmail } from "@/lib/email";
import type { PublicHostel, PublicHostelDetail, PublicRoom, FoodItem } from "@/types";

// ---------------------------------------------------------------------------
// Image validation helpers (F-004: magic-byte check)
// ---------------------------------------------------------------------------

const CNIC_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const CNIC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const CNIC_EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validate image magic bytes server-side.
 * The client-supplied Content-Type header is attacker-controlled; we must
 * verify the actual file content against known image signatures.
 *
 * Signatures:
 *   JPEG  : FF D8 FF
 *   PNG   : 89 50 4E 47 0D 0A 1A 0A
 *   WebP  : 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF....WEBP)
 */
function validateImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 12) return false;

  // JPEG: starts with FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;

  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return true;

  // WebP: RIFF at bytes 0-3 and WEBP at bytes 8-11
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;

  return false;
}

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

// Given any one branch's slug, resolve the business (owner) it belongs to and
// return every publicly-listed branch under that same owner — so a business
// gets one shareable page for all its branches, instead of tenants browsing
// a global directory that also surfaces competitors.
export const getPublicHostelsByOwner = cache(async function getPublicHostelsByOwner(
  slug: string
): Promise<{ ownerName?: string | null; branches?: PublicHostel[]; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data: anchor, error: anchorErr } = await admin
      .from("hms_hostels")
      .select("owner_id")
      .eq("slug", slug)
      .eq("listing_enabled", true)
      .maybeSingle();
    if (anchorErr || !anchor) return { error: "Hostel not found" };

    const { data, error } = await admin
      .from("hms_hostels")
      .select("id,owner_id,name,address,phone,whatsapp,email,total_capacity,city,area,maps_url,description,hostel_type,amenities,slug,food_closed_on_sundays,cover_image_url")
      .eq("owner_id", anchor.owner_id)
      .eq("listing_enabled", true)
      .order("name");
    if (error) throw error;

    const hostels = (data ?? []) as (Omit<PublicHostel, "available_beds" | "owner_name">)[];
    if (hostels.length === 0) return { error: "Hostel not found" };

    const ids = hostels.map((h) => h.id);
    const [{ data: rooms }, { data: profile }] = await Promise.all([
      admin
        .from("hms_rooms")
        .select("hostel_id, capacity, occupied")
        .in("hostel_id", ids)
        .eq("status", "available"),
      admin.from("hms_profiles").select("full_name").eq("id", anchor.owner_id).maybeSingle(),
    ]);

    const availMap: Record<string, number> = {};
    for (const r of rooms ?? []) {
      availMap[r.hostel_id] = (availMap[r.hostel_id] ?? 0) + Math.max(0, r.capacity - r.occupied);
    }

    return {
      ownerName: profile?.full_name ?? null,
      branches: hostels.map((h) => ({
        ...h,
        owner_name: profile?.full_name ?? null,
        available_beds: availMap[h.id] ?? 0,
      })),
    };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
});

export const getPublicHostel = cache(async function getPublicHostel(slug: string): Promise<{ hostel?: PublicHostelDetail; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data: hostelData, error: hostelErr } = await admin
      .from("hms_hostels")
      .select("id,owner_id,name,address,phone,whatsapp,email,total_capacity,city,area,maps_url,description,hostel_type,amenities,slug,food_closed_on_sundays,food_menu_type,cover_image_url,form_config")
      .eq("slug", slug)
      .eq("listing_enabled", true)
      .single();

    if (hostelErr || !hostelData) return { error: "Hostel not found" };

    const hostelId = hostelData.id;
    const isWeeklyMenu = hostelData.food_menu_type === "weekly";

    // Current month bounds — only relevant for the monthly menu query below.
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
        .select("id,room_number,floor,type,capacity,occupied,monthly_rent,status,has_ac,has_cooler,has_attached_washroom,photo_path,photo_path_2,photo_path_3,photo_path_4,photo_path_5")
        .eq("hostel_id", hostelId)
        .neq("status", "maintenance")
        .order("room_number"),
      isWeeklyMenu
        ? admin
            .from("hms_food_items")
            .select("*")
            .eq("hostel_id", hostelId)
            .not("day_of_week", "is", null)
            .order("day_of_week")
            .order("sort_order")
        : admin
            .from("hms_food_items")
            .select("*")
            .eq("hostel_id", hostelId)
            .gte("date", monthStart)
            .lte("date", monthEnd)
            .order("date")
            .order("sort_order"),
      admin
        .from("hms_package_configs")
        .select("id,hostel_id,food_monthly_rate,food_bd_rate,food_3meals_rate,food_breakfast_rate,food_lunch_rate,food_dinner_rate,food_all_meals_rate,ac_per_unit_rate,security_deposit,notice_period_days,package_prices,seater_prices,washroom_premium,created_at,updated_at")
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
});

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


export async function uploadApplicationCnic(
  hostelId: string,
  formData: FormData
): Promise<{ path?: string; error?: string }> {
  try {
    const file = formData.get("file") as File | null;
    if (!file) return { error: "No file provided." };

    // Validate MIME type
    if (!CNIC_ALLOWED_MIME.has(file.type)) {
      return { error: "Invalid file type. Only JPEG, PNG, and WebP images are allowed." };
    }

    // Validate size
    if (file.size > CNIC_MAX_BYTES) {
      return { error: "File too large. Maximum size is 5 MB." };
    }

    // Validate magic bytes
    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    if (!validateImageMagicBytes(buf)) {
      return { error: "Invalid image file. Please upload a valid JPEG, PNG, or WebP image." };
    }

    const admin = createAdminClient();

    // SECURITY: verify hostel exists and is publicly listed before accepting any document
    const { data: hostelCheck } = await admin
      .from("hms_hostels")
      .select("id")
      .eq("id", hostelId)
      .eq("listing_enabled", true)
      .maybeSingle();
    if (!hostelCheck) return { error: "Hostel not found." };

    const ext = CNIC_EXT_MAP[file.type] ?? "jpg";
    const path = `${hostelId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await admin.storage
      .from("application-docs")
      .upload(path, buf, { contentType: file.type, upsert: false });

    if (uploadError) return { error: "Upload failed. Please try again." };

    return { path };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}
