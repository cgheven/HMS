"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import {
  startLogin, completeLogin, addGuest, probeSession, listFiledCnics,
  type PendingLogin, type LoginSession, type HotelEyeGuest,
} from "@/lib/hotel-eye-client";
import { HOTEL_EYE_PROVINCES, HOTEL_EYE_DISTRICTS } from "@/lib/hotel-eye-vocabulary";
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
  lastError: string | null;
}

export async function getPendingGuests(): Promise<{ guests?: PendingGuest[]; missing?: number; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const { data } = await createAdminClient()
      .from("hms_tenants")
      .select("id, full_name, cnic, bed_number, room:hms_rooms(room_number), hotel_eye_status, hotel_eye_last_error, permanent_province, permanent_district")
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
        lastError: (t.hotel_eye_last_error as string) ?? null,
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

// Step 2b: kick off a BACKGROUND sync of the selected guests and return at once.
// The browser is never the driver — it hands the queue over and is free to close.
// Filing runs server-side (Next `after`), on the session the CAPTCHA opened,
// updating each tenant's status as it goes.
export async function startHotelEyeBackgroundSync(input: {
  tenantIds: string[];
}): Promise<{ queued?: number; error?: string; captchaNeeded?: boolean }> {
  try {
    const { id: hostelId, type: hostelType } = await resolveHostel();
    if (input.tenantIds.length === 0) return { error: "Nothing selected to sync." };

    const admin = createAdminClient();
    const { data: cred } = await admin
      .from("hms_hotel_eye_credentials").select("session_blob").eq("hostel_id", hostelId).maybeSingle();
    if (!cred) return { error: "Set up the portal credentials first." };
    if (!cred.session_blob) return { captchaNeeded: true };

    // Mark the selection "queued" now, so the page shows "Syncing…" even after
    // the browser is closed and reopened. Bounded to this hostel's own active,
    // not-yet-synced tenants.
    const { data: queuedRows } = await admin
      .from("hms_tenants")
      .update({ hotel_eye_status: "queued", hotel_eye_last_error: null, hotel_eye_last_attempt_at: new Date().toISOString() })
      .eq("hostel_id", hostelId)
      .in("id", input.tenantIds)
      .eq("is_active", true)
      .neq("hotel_eye_status", "synced")
      .select("id");
    const ids = (queuedRows ?? []).map((r) => r.id as string);
    if (ids.length === 0) return { queued: 0 };

    revalidatePath("/police-verification");
    // Runs AFTER the response is sent — survives the browser closing, bounded
    // only by the route's maxDuration (set to 300s on the page).
    after(async () => { await drainHotelEyeQueue(hostelId, hostelType, ids); });
    return { queued: ids.length };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not start the sync." };
  }
}

// The server-side worker. Never called from the client — only scheduled by
// startHotelEyeBackgroundSync via `after`. Dedupes against the portal, files the
// rest in paced order, and records the outcome per tenant.
async function drainHotelEyeQueue(hostelId: string, hostelType: string | null, ids: string[]): Promise<void> {
  const admin = createAdminClient();
  const { data: cred } = await admin
    .from("hms_hotel_eye_credentials")
    .select("default_province, default_district, session_blob").eq("hostel_id", hostelId).maybeSingle();

  // No usable session → put the queued rows back to pending so they aren't stuck
  // showing "Syncing…", and stop. The owner re-syncs (one CAPTCHA) next time.
  const resetQueued = async (rest: string[]) => {
    if (rest.length) await admin.from("hms_tenants")
      .update({ hotel_eye_status: "not_synced" }).in("id", rest).eq("hostel_id", hostelId).eq("hotel_eye_status", "queued");
  };
  if (!cred?.session_blob) { await resetQueued(ids); return; }
  let session: LoginSession;
  try { session = JSON.parse(decryptSecret(cred.session_blob)) as LoginSession; }
  catch { await clearSession(hostelId); await resetQueued(ids); return; }

  // Read who is already on the portal — the automatic dedupe. Digits-only set.
  const filed = await listFiledCnics(session);
  const gender = genderForHostel(hostelType);

  const { data: tenants } = await admin
    .from("hms_tenants")
    .select("id, full_name, cnic, father_name, phone, permanent_address, permanent_province, permanent_district, check_in, bed_number, room:hms_rooms(room_number), purpose_of_visit, purpose_of_visit_detail")
    .eq("hostel_id", hostelId).in("id", ids);
  const byId = new Map((tenants ?? []).map((t) => [t.id as string, t]));

  const mark = (id: string, fields: Record<string, unknown>) =>
    admin.from("hms_tenants").update(fields).eq("id", id).eq("hostel_id", hostelId);

  for (let i = 0; i < ids.length; i++) {
    const t = byId.get(ids[i]);
    if (!t) continue; // deleted/deactivated since it was queued
    const province = (t.permanent_province as string) || cred.default_province || "";
    const district = (t.permanent_district as string) || cred.default_district || "";
    const cnicDigits = ((t.cnic as string) ?? "").replace(/\D/g, "");

    // Missing/invalid data → record why, don't loop on it.
    const missing = [!cnicDigits && "CNIC", !t.father_name && "father's name", !province && "province", !district && "district"].filter(Boolean);
    if (missing.length || !HOTEL_EYE_PROVINCES.includes(province) || !(HOTEL_EYE_DISTRICTS[province] ?? []).includes(district)) {
      await mark(ids[i], { hotel_eye_status: "failed", hotel_eye_last_error: missing.length ? `missing ${missing.join(", ")}` : "province/district not a valid portal value", hotel_eye_last_attempt_at: new Date().toISOString() });
      continue;
    }

    // AUTO-DEDUPE: already on the portal → mark synced, never post again.
    if (filed && cnicDigits && filed.has(cnicDigits)) {
      await mark(ids[i], { hotel_eye_status: "synced", hotel_eye_synced_at: new Date().toISOString(), hotel_eye_last_error: null });
      continue;
    }

    const room = (t as { room?: { room_number?: string } | null }).room;
    const res = await addGuest(session, {
      cnic: cnicDigits,
      name: t.full_name as string,
      fatherName: t.father_name as string,
      address: (t.permanent_address as string) || district,
      gender,
      cellNo: ((t.phone as string) ?? "").replace(/\D/g, ""),
      province, district,
      roomNo: room?.room_number ?? (t.bed_number as string) ?? "",
      checkInDate: ((t.check_in as string) ?? new Date().toISOString()).slice(0, 10),
      visitPurpose: visitPurposeLabel(t.purpose_of_visit as string | null, t.purpose_of_visit_detail as string | null) ?? "",
    });

    if (res.authExpired) {
      // Session died with no human present to solve a new CAPTCHA. Leave the
      // rest pending for the next sync and stop; nothing filed is lost.
      await clearSession(hostelId);
      await resetQueued(ids.slice(i));
      break;
    }
    if (res.success) {
      await mark(ids[i], { hotel_eye_status: "synced", hotel_eye_synced_at: new Date().toISOString(), hotel_eye_last_error: null });
    } else {
      await mark(ids[i], { hotel_eye_status: "failed", hotel_eye_last_error: res.error ?? "portal rejected the entry", hotel_eye_last_attempt_at: new Date().toISOString() });
    }
    // Gentle pacing between portal writes; skipped after the last one.
    if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 400));
  }

  await admin.from("hms_hotel_eye_credentials").update({ last_synced_at: new Date().toISOString() }).eq("hostel_id", hostelId);
  revalidatePath("/police-verification");
  revalidatePath("/tenants");
}
