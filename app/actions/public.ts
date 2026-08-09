"use server";

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWaitlistEmail } from "@/lib/email";
import { getMonthRange } from "@/lib/utils";
import type { PublicHostel, PublicHostelDetail, PublicHostelComplaintInfo, PublicRoom, FoodItem, PackageConfig } from "@/types";
import { buildPackageOptions } from "@/lib/room-pricing";

/** Public commercial facts per branch, kept beside PublicHostel rather than on
 *  it so the shared type doesn't grow fields most of its consumers ignore. */
export interface BranchPublicInfo {
  hostel_id: string;
  /** Cheapest advertised monthly rate, or null when this branch has no pricing set. */
  from_price: number | null;
  security_deposit: number | null;
  notice_period_days: number | null;
}

/** Everything the public site needs about the OWNER rather than a branch. One
 *  shape shared by both entry points so /find/{slug} and the branded subdomain
 *  can never drift; previously this was hand-duplicated at three call sites. */
export type OwnerSitePayload = {
  ownerName?: string | null;
  logoUrl?: string | null;
  instagramHandle?: string | null;
  facebookHandle?: string | null;
  /** Owner-chosen appearance, resolved from NULL to "light" here so no caller
   *  has to know that NULL is the default. Honoured by every route under the
   *  branded subdomain — home, branch and application form — so the site is one
   *  palette end to end. The path routes (/find/{slug}, /join/{slug}) belong to
   *  the Pulse directory rather than to one owner and stay light. */
  theme?: "light" | "dark";
  branches?: PublicHostel[];
  branchInfo?: BranchPublicInfo[];
  error?: string;
};

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

// Every publicly-listed branch under one owner, plus that owner's display name.
// The single implementation behind BOTH public entry points — /find/{slug}
// (anchored on a branch slug) and {subdomain}.hostels.yourpulse.io (anchored on
// hms_profiles.subdomain). Not exported: this file is "use server", so anything
// exported becomes a callable server action, and an owner_id-keyed lookup must
// never be reachable from the browser.
async function branchesForOwner(ownerId: string): Promise<OwnerSitePayload> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("hms_hostels")
    .select("id,owner_id,name,address,phone,whatsapp,email,total_capacity,city,area,maps_url,description,hostel_type,amenities,slug,food_closed_on_sundays,cover_image_url")
    .eq("owner_id", ownerId)
    .eq("listing_enabled", true)
    .order("name");
  if (error) throw error;

  const hostels = (data ?? []) as (Omit<PublicHostel, "available_beds" | "owner_name">)[];
  if (hostels.length === 0) return { error: "Hostel not found" };

  const ids = hostels.map((h) => h.id);
  const [{ data: rooms }, { data: profile, error: profileErr }, { data: configs }] = await Promise.all([
    // Room shape matches what buildPackageOptions needs, so the headline price
    // is derived exactly the way the branch page derives it.
    admin
      .from("hms_rooms")
      .select("id, hostel_id, room_number, floor, type, capacity, occupied, monthly_rent, status, has_ac, has_cooler, has_attached_washroom")
      .in("hostel_id", ids)
      .neq("status", "maintenance"),
    // One query, not two: these owner-level columns ride along inside the
    // existing fan-out, so branding, socials and theme cost no extra round trip.
    admin
      .from("hms_profiles")
      .select("full_name, business_name, logo_url, instagram_handle, facebook_handle, public_theme")
      .eq("id", ownerId)
      .maybeSingle(),
    admin
      .from("hms_package_configs")
      .select("*")
      .in("hostel_id", ids),
  ]);

  // A renamed or missing column here comes back as an error with data = null,
  // and without this line that reads as "this owner has no profile": the
  // trading name, logo and socials would silently blank on every client's
  // public page with nothing in the logs. Throw so the wrappers' catch turns it
  // into the visible "Something went wrong" instead.
  if (profileErr) throw profileErr;

  // Availability counts only rooms actually on offer, matching the badge shown
  // on each card.
  const availMap: Record<string, number> = {};
  const roomsByHostel = new Map<string, typeof rooms>();
  for (const r of rooms ?? []) {
    if (r.status === "available") {
      availMap[r.hostel_id] = (availMap[r.hostel_id] ?? 0) + Math.max(0, r.capacity - r.occupied);
    }
    const list = roomsByHostel.get(r.hostel_id) ?? [];
    list.push(r);
    roomsByHostel.set(r.hostel_id, list);
  }

  const configMap = new Map(
    (configs ?? []).map((c) => [c.hostel_id as string, c])
  );

  const branchInfo: BranchPublicInfo[] = hostels.map((h) => {
    const cfg = configMap.get(h.id) ?? null;

    // Cheapest price a visitor can ACTUALLY book, computed room by room through
    // the same helper the branch detail page uses. Scanning seater_prices
    // directly — the obvious shortcut — quotes rates for room shapes the branch
    // may not own: at Rajput the cheapest seater entry is the 4-bed non-AC rate,
    // but every 4-bed room there has AC, so that price applies to no room at
    // all and the branch page one click away shows something different.
    let fromPrice: number | null = null;
    for (const room of roomsByHostel.get(h.id) ?? []) {
      if (room.status !== "available") continue;
      if (room.capacity - room.occupied <= 0) continue;
      const cheapest = buildPackageOptions(room as unknown as PublicRoom, cfg as PackageConfig | null)
        .filter((o) => !o.disabled && o.price > 0)
        .reduce<number | null>((min, o) => (min == null || o.price < min ? o.price : min), null);
      if (cheapest != null && (fromPrice == null || cheapest < fromPrice)) fromPrice = cheapest;
    }

    // `!= null`, not truthiness: a deposit or notice period of 0 is a real,
    // deliberate setting. Treating it as "unknown" made one branch's Rs 8,000
    // read as the whole business's answer on a branch that charges nothing.
    return {
      hostel_id: h.id,
      from_price: fromPrice,
      security_deposit: cfg?.security_deposit != null ? Number(cfg.security_deposit) : null,
      notice_period_days: cfg?.notice_period_days != null ? Number(cfg.notice_period_days) : null,
    };
  });

  // Trading name first, personal name only as a fallback. Without this the
  // public site headlines the owner's own name — "Najam" where "Najam Hostels"
  // belongs — which reads as an unfinished profile to a prospect.
  const brandName =
    (profile as { business_name?: string | null } | null)?.business_name?.trim() || profile?.full_name || null;
  const brandLogo = (profile as { logo_url?: string | null } | null)?.logo_url ?? null;

  const site = profile as {
    instagram_handle?: string | null;
    facebook_handle?: string | null;
    public_theme?: string | null;
  } | null;

  // Anything that is not exactly "dark" resolves to light, including NULL and
  // any value a widened CHECK might introduce later. Light is what every client
  // is served today, so an owner who never opens the Appearance control can
  // never be flipped by a schema change.
  const theme: "light" | "dark" = site?.public_theme === "dark" ? "dark" : "light";

  return {
    ownerName: brandName,
    logoUrl: brandLogo,
    instagramHandle: site?.instagram_handle ?? null,
    facebookHandle: site?.facebook_handle ?? null,
    theme,
    branchInfo,
    branches: hostels.map((h) => ({
      ...h,
      owner_name: brandName,
      available_beds: availMap[h.id] ?? 0,
    })),
  };
}

// Given any one branch's slug, resolve the business (owner) it belongs to and
// return every publicly-listed branch under that same owner — so a business
// gets one shareable page for all its branches, instead of tenants browsing
// a global directory that also surfaces competitors.
export const getPublicHostelsByOwner = cache(async function getPublicHostelsByOwner(
  slug: string
): Promise<OwnerSitePayload> {
  try {
    const admin = createAdminClient();

    const { data: anchor, error: anchorErr } = await admin
      .from("hms_hostels")
      .select("owner_id")
      .eq("slug", slug)
      .eq("listing_enabled", true)
      .maybeSingle();
    if (anchorErr || !anchor) return { error: "Hostel not found" };

    return await branchesForOwner(anchor.owner_id);
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
});

// Subdomain entry point — {subdomain}.hostels.yourpulse.io. Resolves the owner
// from hms_profiles.subdomain, then hands off to the exact same branch
// resolution /find/{slug} uses, so the two can never drift.
//
// An owner whose branches are all listing_enabled = false resolves to zero
// branches and returns the same "Hostel not found" the path-based route does,
// which the caller turns into a 404 — an unlisted business stays unlisted on
// its subdomain too.
export const getPublicHostelsBySubdomain = cache(async function getPublicHostelsBySubdomain(
  subdomain: string
): Promise<OwnerSitePayload> {
  try {
    const normalized = subdomain.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(normalized)) return { error: "Hostel not found" };

    const admin = createAdminClient();

    const { data: owner, error: ownerErr } = await admin
      .from("hms_profiles")
      .select("id")
      .eq("subdomain", normalized)
      .maybeSingle();
    if (ownerErr || !owner) return { error: "Hostel not found" };

    return await branchesForOwner(owner.id);
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
    // Pakistan-anchored (getMonthRange), not the server process's own OS
    // timezone — this is a public, unauthenticated route that can be served
    // by any edge/serverless instance regardless of its own default timezone.
    const { start: monthStart, end: monthEnd } = getMonthRange();

    const [{ data: profile }, { data: rooms }, { data: foodItems }, { data: pkgConfig }] = await Promise.all([
      admin.from("hms_profiles").select("full_name, business_name").eq("id", hostelData.owner_id).maybeSingle(),
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
        .select("id,hostel_id,food_monthly_rate,food_bd_rate,food_3meals_rate,food_breakfast_rate,food_lunch_rate,food_dinner_rate,food_all_meals_rate,ac_per_unit_rate,security_deposit,registration_fee,ac_maintenance_rate,notice_period_days,package_prices,seater_prices,washroom_premium,created_at,updated_at")
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
        // Same trading-name-first rule as the business page, so a branch page
        // and the site it sits under never disagree about who runs it.
        owner_name:
          (profile as { business_name?: string | null } | null)?.business_name?.trim() ||
          profile?.full_name ||
          null,
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

// Resolves a hostel for the public QR complaint form via its short
// complaint_code. Deliberately NOT gated on listing_enabled — that flag only
// controls the public directory/marketing listing, and has nothing to do
// with whether a currently-resident tenant can file a complaint against a
// hostel that has simply opted out of the public directory.
export const getPublicHostelByComplaintCode = cache(async function getPublicHostelByComplaintCode(
  code: string
): Promise<{ hostel?: PublicHostelComplaintInfo; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_hostels")
      .select("id,name,city,area")
      .eq("complaint_code", code)
      .maybeSingle();

    if (error || !data) return { error: "Hostel not found" };

    return { hostel: data as PublicHostelComplaintInfo };
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
