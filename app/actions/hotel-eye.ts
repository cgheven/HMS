"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import {
  startLogin, completeLogin, addGuest, probeSession, listFiledEntriesBetween,
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
  /** Summary of the most recent sync run, shown so the owner sees the result of a
   *  background sync whenever they return. null until the first run finishes.
   *  `note` is set (and counts stale) when a run couldn't complete. */
  lastSync: { filed: number; matched: number; failed: number; at: string; note: string | null } | null;
}

export async function getHotelEyeSettings(): Promise<{ settings?: HotelEyeSettings; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const { data } = await createAdminClient()
      .from("hms_hotel_eye_credentials")
      // password_encrypted deliberately NOT selected — it never leaves the server.
      .select("username, portal_url, default_province, default_district, last_synced_at, last_sync_filed, last_sync_matched, last_sync_failed, last_sync_at, last_sync_note")
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
        lastSync: data?.last_sync_at
          ? { filed: data.last_sync_filed ?? 0, matched: data.last_sync_matched ?? 0, failed: data.last_sync_failed ?? 0, at: data.last_sync_at, note: data.last_sync_note ?? null }
          : null,
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

// ── Synced view (positive confirmation of who is on the portal) ────────────
export interface SyncedGuest {
  id: string;
  name: string;
  cnic: string | null;
  room: string | null;
  syncedAt: string | null;
  /** True when this tenant was matched to an existing portal entry (dedupe)
   *  rather than freshly filed by us — surfaced so the owner can see dedupe work. */
  viaDedupe: boolean;
  /** The stay's check-in date (YYYY-MM-DD). For a dedupe match this is the date
   *  of the entry already on the portal — shown next to "Already on portal". */
  checkIn: string | null;
}

export async function getSyncedGuests(): Promise<{ guests?: SyncedGuest[]; error?: string }> {
  try {
    const { id: hostelId } = await resolveHostel();
    const { data } = await createAdminClient()
      .from("hms_tenants")
      .select("id, full_name, cnic, bed_number, check_in, room:hms_rooms(room_number), hotel_eye_synced_at, hotel_eye_last_error")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .eq("hotel_eye_status", "synced")
      .order("hotel_eye_synced_at", { ascending: false });
    const guests = (data ?? []).map((t) => {
      const room = (t as { room?: { room_number?: string } | null }).room;
      return {
        id: t.id as string,
        name: t.full_name as string,
        cnic: (t.cnic as string) ?? null,
        room: room?.room_number ?? (t.bed_number as string) ?? null,
        syncedAt: (t.hotel_eye_synced_at as string) ?? null,
        viaDedupe: ((t.hotel_eye_last_error as string) ?? "").startsWith("already on portal"),
        checkIn: ((t.check_in as string) ?? "").slice(0, 10) || null,
      };
    });
    return { guests };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not load synced guests." };
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

// ── Watch-list mirror (local dedupe source) ────────────────────────────────
// A copy of the portal's watch list in our own DB, so dedupe never has to hit
// the government portal to answer "is this CNIC already filed?". Refreshed from
// the live portal read during a sync, and written the moment we file a guest.
type HotelEyeAdmin = ReturnType<typeof createAdminClient>;

// The dedupe key is the STAY, not the person: same CNIC + same check-in date.
const stayKey = (cnic: string, checkIn: string) => `${cnic}|${(checkIn ?? "").slice(0, 10)}`;

async function upsertWatchlist(
  admin: HotelEyeAdmin,
  hostelId: string,
  entries: { cnic: string; checkIn: string; name?: string | null }[],
  source: "portal" | "filed_by_us",
): Promise<void> {
  const now = new Date().toISOString();
  const rows = entries
    .filter((e) => e.cnic)
    .map((e) => {
      const row: Record<string, unknown> = { hostel_id: hostelId, cnic: e.cnic, check_in: (e.checkIn ?? "").slice(0, 10), source, last_seen_at: now };
      // Only set name when we actually have one, so a portal read never
      // overwrites a stored name back to null on conflict.
      if (e.name) row.name = e.name;
      return row;
    });
  if (rows.length) await admin.from("hms_hotel_eye_watchlist").upsert(rows, { onConflict: "hostel_id,cnic,check_in" });
}

/**
 * What this hostel already has on the portal, per our mirror:
 *  - keys: "cnic|checkIn" stay keys (the normal, precise dedupe).
 *  - wildcardCnics: CNICs whose stored check-in couldn't be read (''). We can't
 *    tell which stay those are, so we treat ANY tenant with that CNIC as already
 *    filed — erring toward NOT duplicating on the government portal when a portal
 *    date is unparseable (a defensive fallback; normal rows carry a real date).
 */
async function loadWatchlist(admin: HotelEyeAdmin, hostelId: string): Promise<{ keys: Set<string>; wildcardCnics: Set<string> }> {
  const { data } = await admin.from("hms_hotel_eye_watchlist").select("cnic, check_in").eq("hostel_id", hostelId);
  const keys = new Set<string>();
  const wildcardCnics = new Set<string>();
  for (const r of data ?? []) {
    const cnic = r.cnic as string;
    const ci = ((r.check_in as string) ?? "").slice(0, 10);
    keys.add(stayKey(cnic, ci));
    if (!ci) wildcardCnics.add(cnic);
  }
  return { keys, wildcardCnics };
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
  // Records a run that couldn't complete, so the queue reverting to pending isn't
  // silent — the owner sees WHY on the page instead of guessing.
  const noteAbort = async (note: string) =>
    admin.from("hms_hotel_eye_credentials").update({ last_sync_at: new Date().toISOString(), last_sync_note: note }).eq("hostel_id", hostelId);

  if (!cred?.session_blob) { await resetQueued(ids); await noteAbort("The portal session wasn't ready — please sync again."); return; }
  let session: LoginSession;
  try { session = JSON.parse(decryptSecret(cred.session_blob)) as LoginSession; }
  catch { await clearSession(hostelId); await resetQueued(ids); await noteAbort("The portal session expired — please sync again."); return; }

  const gender = genderForHostel(hostelType);
  let nFiled = 0, nMatched = 0, nFailed = 0;

  const { data: tenants } = await admin
    .from("hms_tenants")
    .select("id, full_name, cnic, father_name, phone, permanent_address, permanent_province, permanent_district, check_in, bed_number, room:hms_rooms(room_number), purpose_of_visit, purpose_of_visit_detail")
    .eq("hostel_id", hostelId).in("id", ids);
  const byId = new Map((tenants ?? []).map((t) => [t.id as string, t]));

  const tenantCheckIn = (t: { check_in?: unknown }) => ((t.check_in as string) ?? new Date().toISOString()).slice(0, 10);

  // The portal's watch list only returns rows for a DATE filter (empty and
  // CNIC filters return nothing). So read the exact check-in dates of THIS batch
  // from the portal and mirror them, then dedupe by stay (cnic + check-in). Only
  // dates we successfully read let us file; a date we couldn't read leaves its
  // guests pending (never filed blind → no duplicate).
  const wantedDates = Array.from(new Set((tenants ?? []).map(tenantCheckIn).filter(Boolean)));
  const readDates = new Set<string>();
  // The portal appears to cap a single response at ~20 rows. If a date comes back
  // full, we can't trust "not found" for it — a guest could be on an unreturned
  // page — so we still dedupe against what we DID read, but never FILE a new guest
  // for that date (they defer to `unread`). Below the cap, the read is complete.
  const HOTEL_EYE_PAGE_CAP = 20;
  const cappedDates = new Set<string>();
  for (const d of wantedDates) {
    const entries = await listFiledEntriesBetween(session, d, d);
    if (entries) {
      readDates.add(d);
      if (entries.length >= HOTEL_EYE_PAGE_CAP) cappedDates.add(d);
      if (entries.length) await upsertWatchlist(admin, hostelId, entries, "portal");
    }
    await new Promise((r) => setTimeout(r, 300)); // gentle pacing on reads
  }
  const known = await loadWatchlist(admin, hostelId);

  // If not a single date could be read AND we have no stored mirror to fall back
  // on, we can't dedupe at all — abort rather than file blind.
  if (readDates.size === 0 && known.keys.size === 0) { await resetQueued(ids); await noteAbort("Couldn't reach the portal to check for duplicates — please sync again."); return; }

  const mark = (id: string, fields: Record<string, unknown>) =>
    admin.from("hms_tenants").update(fields).eq("id", id).eq("hostel_id", hostelId);
  const unread: string[] = []; // queued rows we couldn't verify this run

  for (let i = 0; i < ids.length; i++) {
    const t = byId.get(ids[i]);
    if (!t) continue; // deleted/deactivated since it was queued
    const province = (t.permanent_province as string) || cred.default_province || "";
    const district = (t.permanent_district as string) || cred.default_district || "";
    const cnicDigits = ((t.cnic as string) ?? "").replace(/\D/g, "");
    const checkIn = tenantCheckIn(t);

    // Missing/invalid data → record why, don't loop on it.
    const missing = [!cnicDigits && "CNIC", !t.father_name && "father's name", !province && "province", !district && "district"].filter(Boolean);
    if (missing.length || !HOTEL_EYE_PROVINCES.includes(province) || !(HOTEL_EYE_DISTRICTS[province] ?? []).includes(district)) {
      await mark(ids[i], { hotel_eye_status: "failed", hotel_eye_last_error: missing.length ? `missing ${missing.join(", ")}` : "province/district not a valid portal value", hotel_eye_last_attempt_at: new Date().toISOString() });
      nFailed++;
      continue;
    }

    // AUTO-DEDUPE by STAY: this exact stay (same CNIC + check-in) is already on
    // the portal → mark synced, never post again. The marker carries the matched
    // stay's check-in date so the owner sees it was a match, not a fresh filing.
    // A returning guest with a NEW check-in does NOT match here and is filed below.
    if (cnicDigits && (known.keys.has(stayKey(cnicDigits, checkIn)) || known.wildcardCnics.has(cnicDigits))) {
      await mark(ids[i], { hotel_eye_status: "synced", hotel_eye_synced_at: new Date().toISOString(), hotel_eye_last_error: `already on portal — check-in ${checkIn}` });
      nMatched++;
      continue;
    }

    // We only FILE when this run FULLY read the guest's check-in date from the
    // portal (so "not found" is trustworthy). If the date couldn't be read, or came
    // back at the response cap (possibly truncated), leave them pending rather than
    // risk a duplicate.
    if (!readDates.has(checkIn) || cappedDates.has(checkIn)) { unread.push(ids[i]); continue; }

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
      // Record OUR filing (this stay) in the mirror immediately, so a later sync
      // never re-files it even before the next portal read. Also add its stay key
      // to the in-memory set so the SAME stay later in THIS batch (two tenant rows
      // sharing a CNIC + check-in — the column has no unique constraint) is deduped
      // rather than posted twice.
      await upsertWatchlist(admin, hostelId, [{ cnic: cnicDigits, checkIn, name: t.full_name as string }], "filed_by_us");
      known.keys.add(stayKey(cnicDigits, checkIn));
      await mark(ids[i], { hotel_eye_status: "synced", hotel_eye_synced_at: new Date().toISOString(), hotel_eye_last_error: null });
      nFiled++;
    } else {
      await mark(ids[i], { hotel_eye_status: "failed", hotel_eye_last_error: res.error ?? "portal rejected the entry", hotel_eye_last_attempt_at: new Date().toISOString() });
      nFailed++;
    }
    // Gentle pacing between portal writes; skipped after the last one.
    if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 400));
  }

  // Guests whose check-in date we couldn't read this run: put them back to
  // pending (not stuck on "Syncing…") — the next sync re-reads their date.
  await resetQueued(unread);

  // Persist the run's result so the owner sees it whenever they return, even
  // though the sync ran in the background after the browser was free to close.
  await admin.from("hms_hotel_eye_credentials").update({
    last_synced_at: new Date().toISOString(),
    last_sync_filed: nFiled,
    last_sync_matched: nMatched,
    last_sync_failed: nFailed,
    last_sync_at: new Date().toISOString(),
    // A completed run clears any earlier abort note — unless some guests couldn't
    // be verified against the portal, in which case say so.
    last_sync_note: unread.length ? `${unread.length} guest${unread.length === 1 ? "" : "s"} couldn't be checked against the portal — please sync again.` : null,
  }).eq("hostel_id", hostelId);
  revalidatePath("/police-verification");
  revalidatePath("/tenants");
}
