"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import {
  startLogin, completeLogin, addGuest, probeSession,
  type PendingLogin, type LoginSession, type HotelEyeGuest,
} from "@/lib/hotel-eye-client";
import { HOTEL_EYE_PROVINCES, HOTEL_EYE_DISTRICTS, HOTEL_EYE_CHUNK_MAX } from "@/lib/hotel-eye-vocabulary";
import { visitPurposeLabel } from "@/lib/visit-purpose";

// Every action here is owner-only and resolves the hostel server-side from the
// session — a hostel_id is never trusted from the client. The credentials table
// is reached solely through the admin client, matching its zero-policy RLS.

async function resolveHostel(): Promise<{ id: string; type: string | null }> {
  await requireOwnerOrAbove();
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return { id: ctx.hostelId, type: (ctx.hostel?.hostel_type ?? null) as string | null };
}

// Boys hostel → every guest Male, girls → Female. Gender is a property of the
// hostel, so it is never asked per tenant — see the integration plan.
function genderForHostel(type: string | null): "Male" | "Female" {
  return (type ?? "").toLowerCase().startsWith("girl") ? "Female" : "Male";
}

// ── Settings (never returns the password) ─────────────────────────────────
export interface HotelEyeSettings {
  configured: boolean;
  username: string;
  portalUrl: string;
  defaultProvince: string | null;
  defaultDistrict: string | null;
  lastSyncedAt: string | null;
}

export async function getHotelEyeSettings(): Promise<{ settings?: HotelEyeSettings; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const { data } = await createAdminClient()
      .from("hms_hotel_eye_credentials")
      // password_encrypted deliberately NOT selected — it never leaves the server.
      .select("username, portal_url, default_province, default_district, last_synced_at")
      .eq("hostel_id", hostelId)
      .maybeSingle();
    return {
      settings: {
        configured: !!data,
        username: data?.username ?? "",
        portalUrl: data?.portal_url ?? "https://hoteleye.punjab.gov.pk",
        defaultProvince: data?.default_province ?? null,
        defaultDistrict: data?.default_district ?? null,
        lastSyncedAt: data?.last_synced_at ?? null,
      },
    };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not load settings." };
  }
}

export async function saveHotelEyeCredentials(input: {
  username: string;
  password: string; // blank on edit = keep the stored one
  portalUrl: string;
  defaultProvince: string | null;
  defaultDistrict: string | null;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const username = input.username.trim();
    if (!username) return { success: false, error: "Username is required." };
    if (!/^https:\/\/[\w.-]+\.gov\.pk\/?$/i.test(input.portalUrl.trim())) {
      // Pinned to a government host: this password is only ever replayed to the
      // official portal, never to an arbitrary URL a client could be tricked into.
      return { success: false, error: "Portal URL must be an official *.gov.pk address." };
    }
    if (input.defaultProvince && !HOTEL_EYE_PROVINCES.includes(input.defaultProvince)) {
      return { success: false, error: "Invalid province." };
    }
    const admin = createAdminClient();

    const row: Record<string, unknown> = {
      hostel_id: hostelId,
      username,
      portal_url: input.portalUrl.trim().replace(/\/$/, ""),
      default_province: input.defaultProvince,
      default_district: input.defaultDistrict,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (input.password.trim()) {
      // New row or full replace: password_encrypted is present, so upsert is safe.
      row.password_encrypted = encryptSecret(input.password.trim());
      ({ error } = await admin.from("hms_hotel_eye_credentials").upsert(row, { onConflict: "hostel_id" }));
    } else {
      // Edit that keeps the saved password. It MUST be an update, not an upsert:
      // password_encrypted is NOT NULL with no default, so an upsert's insert arm
      // would violate the constraint even though the row already exists.
      const { data: existing } = await admin
        .from("hms_hotel_eye_credentials").select("hostel_id").eq("hostel_id", hostelId).maybeSingle();
      if (!existing) return { success: false, error: "Enter the portal password." };
      ({ error } = await admin.from("hms_hotel_eye_credentials").update(row).eq("hostel_id", hostelId));
    }
    if (error) return { success: false, error: "Could not save the credentials." };
    // A saved session belongs to the OLD login. Drop it whenever credentials
    // change so the next sync re-authenticates rather than reusing a session that
    // may no longer match the username/password on file.
    await admin.from("hms_hotel_eye_credentials")
      .update({ session_blob: null, session_saved_at: null }).eq("hostel_id", hostelId);
    revalidatePath("/police-verification");
    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

// ── Pending queue ─────────────────────────────────────────────────────────
export interface PendingGuest {
  id: string;
  name: string;
  cnic: string | null;
  room: string | null;
  status: string;
  province: string | null;
  district: string | null;
}

export async function getPendingGuests(): Promise<{ guests?: PendingGuest[]; missing?: number; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const { data } = await createAdminClient()
      .from("hms_tenants")
      .select("id, full_name, cnic, bed_number, room:hms_rooms(room_number), hotel_eye_status, permanent_province, permanent_district")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .neq("hotel_eye_status", "synced")
      .order("created_at", { ascending: false });
    const guests = (data ?? []).map((t) => {
      const room = (t as { room?: { room_number?: string } | null }).room;
      return {
        id: t.id as string,
        name: t.full_name as string,
        cnic: (t.cnic as string) ?? null,
        room: room?.room_number ?? (t.bed_number as string) ?? null,
        status: t.hotel_eye_status as string,
        province: (t.permanent_province as string) ?? null,
        district: (t.permanent_district as string) ?? null,
      };
    });
    // How many of those cannot be filed yet because a required field is missing.
    const missing = guests.filter((g) => !g.cnic || !g.province || !g.district).length;
    return { guests, missing };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not load the queue." };
  }
}

// ── The two-step, human-CAPTCHA sync ──────────────────────────────────────
// The pending-login blob (cookies + form fields) is encrypted before it leaves
// the server, so the browser holds an opaque token during the ~seconds the owner
// spends reading the CAPTCHA, never the session itself.

export async function startHotelEyeSync(): Promise<{
  token?: string;
  captcha?: { base64: string; mediaType: string };
  error?: string;
}> {
  try {
    const { id: hostelId } = await resolveHostel();
    const { data: cred } = await createAdminClient()
      .from("hms_hotel_eye_credentials").select("portal_url").eq("hostel_id", hostelId).maybeSingle();
    if (!cred) return { error: "Set up the portal credentials first." };

    const { pending, captcha } = await startLogin(cred.portal_url);
    return { token: encryptSecret(JSON.stringify(pending)), captcha };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not reach the portal." };
  }
}

export interface SyncOutcome {
  filed: number;
  failed: { name: string; reason: string }[];
  skipped: { name: string; reason: string }[];
}

// Step 1b (optional): reuse a session cached from an earlier sync, so a run a
// few minutes later can skip the CAPTCHA entirely. Probes the portal cheaply —
// a dead session is cleared and the caller falls back to the CAPTCHA flow.
export async function resumeHotelEyeSync(): Promise<{ ready?: boolean; captchaNeeded?: boolean; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const admin = createAdminClient();
    const { data: cred } = await admin
      .from("hms_hotel_eye_credentials").select("session_blob").eq("hostel_id", hostelId).maybeSingle();
    if (!cred) return { error: "Set up the portal credentials first." };
    if (!cred.session_blob) return { captchaNeeded: true };

    let session: LoginSession;
    try { session = JSON.parse(decryptSecret(cred.session_blob)) as LoginSession; }
    catch { await clearSession(hostelId); return { captchaNeeded: true }; }

    // The session stays SERVER-SIDE. The client is told only whether it can file
    // without a CAPTCHA — never handed the session, encrypted or otherwise.
    if (await probeSession(session)) return { ready: true };
    await clearSession(hostelId);
    return { captchaNeeded: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    // A probe failure is not fatal — just fall back to the CAPTCHA.
    return { captchaNeeded: true };
  }
}

async function clearSession(hostelId: string): Promise<void> {
  await createAdminClient().from("hms_hotel_eye_credentials")
    .update({ session_blob: null, session_saved_at: null }).eq("hostel_id", hostelId);
}

// Step 2a: log in with the human-entered CAPTCHA and hand back an ENCRYPTED
// session token. Filing is a separate call, so one CAPTCHA opens a session the
// client then reuses across every chunk.
export async function completeHotelEyeLogin(input: {
  token: string;
  captchaText: string;
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    if (!input.captchaText.trim()) return { error: "Type the CAPTCHA before syncing." };

    const admin = createAdminClient();
    const { data: cred } = await admin
      .from("hms_hotel_eye_credentials")
      .select("username, password_encrypted")
      .eq("hostel_id", hostelId).maybeSingle();
    if (!cred) return { error: "Set up the portal credentials first." };

    let pending: PendingLogin;
    try { pending = JSON.parse(decryptSecret(input.token)) as PendingLogin; }
    catch { return { error: "This sync session is invalid — start again." }; }

    const login = await completeLogin(
      pending, cred.username, decryptSecret(cred.password_encrypted), input.captchaText
    );
    if (!login.authenticated || !login.session) return { error: login.error ?? "Login failed." };

    // The LoginSession (portal URL + cookies) is encrypted before it reaches the
    // browser, exactly like the pre-login blob — the client holds an opaque token.
    // Stored SERVER-SIDE only. The client is never handed the session; the next
    // chunk call reads it back from here. A sync minutes later reuses it instead
    // of asking for another CAPTCHA — see resumeHotelEyeSync.
    await admin.from("hms_hotel_eye_credentials")
      .update({ session_blob: encryptSecret(JSON.stringify(login.session)), session_saved_at: new Date().toISOString() })
      .eq("hostel_id", hostelId);
    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Login failed." };
  }
}

export interface ChunkResult {
  filed: number;
  failed: { name: string; reason: string }[];
  skipped: { name: string; reason: string }[];
  // Set when the portal bounced us to login mid-chunk. `remaining` are the ids
  // not yet attempted, so the client can resume them after one fresh CAPTCHA
  // without re-filing anyone.
  sessionExpired?: boolean;
  remaining?: string[];
}

// Step 2b: file one chunk on an already-open session. Called repeatedly by the
// client, each call filing at most HOTEL_EYE_CHUNK_MAX guests.
export async function fileHotelEyeChunk(input: {
  tenantIds: string[];
}): Promise<{ result?: ChunkResult; error?: string; captchaNeeded?: boolean }> {
  try {
    const { id: hostelId, type: hostelType } = await resolveHostel();
    const ids = input.tenantIds.slice(0, HOTEL_EYE_CHUNK_MAX);
    if (ids.length === 0) return { error: "Nothing to file." };

    const admin = createAdminClient();
    const { data: cred } = await admin
      .from("hms_hotel_eye_credentials")
      // The session is read back from the row — it is never accepted from, nor
      // returned to, the client.
      .select("default_province, default_district, session_blob")
      .eq("hostel_id", hostelId).maybeSingle();
    if (!cred) return { error: "Set up the portal credentials first." };
    if (!cred.session_blob) return { captchaNeeded: true, error: "No active session — solve the CAPTCHA to continue." };

    let session: LoginSession;
    try { session = JSON.parse(decryptSecret(cred.session_blob)) as LoginSession; }
    catch { await clearSession(hostelId); return { captchaNeeded: true, error: "This sync session is invalid — start again." }; }

    const gender = genderForHostel(hostelType);
    const { data: tenants } = await admin
      .from("hms_tenants")
      .select("id, full_name, cnic, father_name, phone, permanent_address, permanent_province, permanent_district, check_in, bed_number, room:hms_rooms(room_number), purpose_of_visit, purpose_of_visit_detail, hotel_eye_status")
      .eq("hostel_id", hostelId)
      .in("id", ids)
      .eq("is_active", true);

    // Preserve the caller's order, and keep track of what we have not attempted
    // so a mid-chunk session expiry can report an accurate `remaining`.
    const byId = new Map((tenants ?? []).map((t) => [t.id as string, t]));
    const result: ChunkResult = { filed: 0, failed: [], skipped: [] };

    for (let i = 0; i < ids.length; i++) {
      const t = byId.get(ids[i]);
      if (!t) { continue; } // vanished (deleted / deactivated) since selection
      const name = t.full_name as string;
      if (t.hotel_eye_status === "synced") { result.skipped.push({ name, reason: "already filed" }); continue; }

      const province = (t.permanent_province as string) || cred.default_province || "";
      const district = (t.permanent_district as string) || cred.default_district || "";
      const missingFields = [
        !t.cnic && "CNIC", !t.father_name && "father's name", !province && "province", !district && "district",
      ].filter(Boolean);
      if (missingFields.length) { result.skipped.push({ name, reason: `missing ${missingFields.join(", ")}` }); continue; }
      if (!HOTEL_EYE_PROVINCES.includes(province) || !(HOTEL_EYE_DISTRICTS[province] ?? []).includes(district)) {
        result.skipped.push({ name, reason: "province/district not a valid portal value" });
        continue;
      }

      const room = (t as { room?: { room_number?: string } | null }).room;
      const guest: HotelEyeGuest = {
        cnic: (t.cnic as string).replace(/\D/g, ""),
        name,
        fatherName: t.father_name as string,
        address: (t.permanent_address as string) || district,
        gender,
        cellNo: ((t.phone as string) ?? "").replace(/\D/g, ""),
        province,
        district,
        roomNo: room?.room_number ?? (t.bed_number as string) ?? "",
        checkInDate: ((t.check_in as string) ?? new Date().toISOString()).slice(0, 10),
        visitPurpose: visitPurposeLabel(
          t.purpose_of_visit as string | null, t.purpose_of_visit_detail as string | null
        ) ?? "",
      };

      const res = await addGuest(session, guest);

      if (res.authExpired) {
        // Stop immediately; everything filed so far is already saved. Hand back
        // the ids from this point on so the client can resume after a new CAPTCHA.
        result.sessionExpired = true;
        result.remaining = ids.slice(i);
        await clearSession(hostelId); // the cached session is dead — don't reuse it
        break;
      }
      if (res.success) {
        result.filed += 1;
        await admin.from("hms_tenants").update({
          hotel_eye_status: "synced", hotel_eye_synced_at: new Date().toISOString(),
        }).eq("id", t.id).eq("hostel_id", hostelId);
      } else {
        result.failed.push({ name, reason: res.error ?? "portal rejected the entry" });
        await admin.from("hms_tenants").update({ hotel_eye_status: "failed" }).eq("id", t.id).eq("hostel_id", hostelId);
      }

      // Gentle pacing between portal writes — a tight loop of POSTs is what trips
      // a government portal's rate limiting. Skipped after the last entry.
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 400));
    }

    await admin.from("hms_hotel_eye_credentials")
      .update({ last_synced_at: new Date().toISOString() }).eq("hostel_id", hostelId);
    revalidatePath("/police-verification");
    revalidatePath("/tenants");
    return { result };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Sync failed." };
  }
}
