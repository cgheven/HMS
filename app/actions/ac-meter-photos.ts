"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getManagerContext } from "@/lib/manager-auth";
import { getAuthContext } from "@/lib/data";
import type { StaffPermission } from "@/types";

// AC meter photo evidence — see migration 158.
//
// Two readings get a photo: the tenant's meter value at move-in, and the room's
// value each month. Both are anchored to the row that already holds the number
// they prove (hms_tenants.joining_meter_reading / hms_room_ac_readings.
// meter_reading), so a photo can never be attached to a reading that isn't
// there, and can never outlive it.

// Bucket is PUBLIC (migration 159) — reads are a plain URL built client-side,
// so there is no view action here. Writes stay owner-gated below.
const BUCKET = "ac-meter-photos";
const MAX_BYTES = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Trust the bytes, not the headers.
 *
 * file.type is client-supplied and file.size is client-supplied; both are
 * trivially forged. Same reasoning (and the same signatures) as
 * validateDocMagicBytes in app/actions/tenants.ts, minus PDF — a meter reading
 * is a photograph, so accepting documents here would widen the upload surface
 * for a case that does not exist.
 */
function isRealImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true; // WebP
  return false;
}

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

/**
 * Resolve the caller's branch, for owners, partners AND managers.
 *
 * Managers are a separate auth world in this codebase — they hold no RLS grants
 * and never appear in getAuthContext, so requireOwnerOrPartnerTier redirects
 * them to /login. That mattered here: managers add tenants and apply AC units,
 * so gating the photo on owner-only auth would have bounced a manager to the
 * login screen half way through saving a tenant, losing the form.
 *
 * Checked manager-first because getManagerContext returns null for everyone
 * else, and it throws rather than redirect()s so a failure surfaces as an
 * error message in the dialog instead of a navigation.
 *
 * Permission parity with the write being evidenced, deliberately: the same
 * capability that lets someone record the number lets them attach its proof.
 * Anything stricter just means numbers land without evidence.
 */
async function guard(managerPermissions: StaffPermission[]): Promise<string> {
  const manager = await getManagerContext();
  if (manager) {
    if (!manager.activeHostel) throw new Error("Unauthorized: no active hostel");
    if (!managerPermissions.some((p) => manager.permissions.has(p))) {
      throw new Error("Your access level does not permit this action.");
    }
    return manager.activeHostel.id;
  }
  await requireOwnerOrPartnerTier("standard");
  return resolveHostelId();
}

/** Attaching a move-in photo rides with adding or editing the tenant itself. */
const JOIN_PERMS: StaffPermission[] = ["add_members", "edit_members"];
/** The monthly photo rides with applying the units — applyRoomACUnitsAsManager's own gate. */
const MONTHLY_PERMS: StaffPermission[] = ["collect_payments"];

/**
 * Strip EXIF (and every other APPn/comment segment) from a JPEG.
 *
 * These photos are taken on a phone standing at the meter, so the camera writes
 * GPS coordinates, device model and a timestamp into the file. The bucket is
 * public (migration 159), so anyone who ends up with a photo URL would
 * otherwise also get the hostel's exact coordinates — a much bigger disclosure
 * than the picture of a dial that was actually consented to.
 *
 * Byte-level segment removal rather than a re-encode: it is lossless, keeps the
 * image identical for dispute purposes, and needs no image library (sharp is
 * only a transitive dep here, not one this project declares).
 *
 * JPEG layout: SOI, then a chain of `FF xx <2-byte big-endian length> payload`
 * segments, until SOS (FFDA) after which the entropy-coded scan runs to EOI and
 * must be copied verbatim. APP1 (FFE1) is where EXIF lives; APP2-APPF and COM
 * (FFFE) can carry XMP/IPTC with the same data, so they go too. APP0 (FFE0,
 * JFIF) is kept — it holds only density info and some decoders expect it.
 */
function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf; // not a JPEG

  const keep: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let i = 2;

  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break; // desynced — bail out and keep the original
    const marker = buf[i + 1];

    if (marker === 0xda) {           // SOS: scan data follows, copy the rest as-is
      keep.push(buf.subarray(i));
      return Buffer.concat(keep);
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push(buf.subarray(i, i + 2)); // standalone marker, no length
      i += 2;
      continue;
    }

    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break; // malformed — keep the original
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) keep.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }

  // Only trust the rebuild if it reached SOS above; anything else means the
  // structure was not what we expected, and a stored photo matters more than a
  // stripped one.
  return buf;
}

async function readImage(formData: FormData): Promise<{ buffer: Buffer; ext: string; contentType: string }> {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided");

  const ext = ALLOWED_MIME[file.type];
  if (!ext) throw new Error("Only JPEG, PNG, or WebP images are allowed.");

  // Size-check the actual bytes, never the client-supplied file.size.
  const raw = Buffer.from(await file.arrayBuffer());
  if (raw.length > MAX_BYTES) throw new Error("Photo too large. Maximum size is 10 MB.");
  if (!isRealImage(raw)) throw new Error("Invalid file content. Only real image files are accepted.");

  // Validate first, then strip: never hand attacker-controlled bytes to the
  // parser before they have been confirmed to be an image.
  const buffer = file.type === "image/jpeg" ? stripJpegMetadata(raw) : raw;

  return { buffer, ext, contentType: file.type };
}

/** Replace-in-place: the old object is removed only after the new path is committed. */
async function swap(
  admin: ReturnType<typeof createAdminClient>,
  previous: string | null,
  next: string
): Promise<void> {
  if (previous && previous !== next) {
    await admin.storage.from(BUCKET).remove([previous]);
  }
}

// ── Move-in photo (per tenant) ──────────────────────────────────────────────

export async function uploadJoiningMeterPhoto(
  tenantId: string,
  formData: FormData
): Promise<{ path?: string; error?: string }> {
  try {
    const hostelId = await guard(JOIN_PERMS);
    if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID");

    const admin = createAdminClient();

    // Re-scope the tenant to the caller's active branch. Without this, a
    // tenantId from another hostel would be accepted — the admin client below
    // bypasses RLS, so this check is the only thing preventing it.
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("id, hostel_id, joining_meter_photo")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!tenant) throw new Error("Forbidden");

    const { buffer, ext, contentType } = await readImage(formData);

    // hostelId first so one storage policy scopes the whole bucket; random
    // filename so nothing user-controlled reaches the path.
    const path = `${hostelId}/join/${tenantId}/${randomUUID()}.${ext}`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await admin
      .from("hms_tenants")
      .update({ joining_meter_photo: path })
      .eq("id", tenantId)
      .eq("hostel_id", hostelId);

    if (dbErr) {
      // Never leave an object nothing points at.
      await admin.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr.message);
    }

    await swap(admin, tenant.joining_meter_photo as string | null, path);

    revalidatePath("/tenants");
    revalidatePath("/payments");
    return { path };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteJoiningMeterPhoto(
  tenantId: string
): Promise<{ error?: string }> {
  try {
    const hostelId = await guard(JOIN_PERMS);
    if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID");

    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("joining_meter_photo")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!tenant) throw new Error("Forbidden");

    const path = tenant.joining_meter_photo as string | null;
    if (!path) return {};

    const { error: dbErr } = await admin
      .from("hms_tenants")
      .update({ joining_meter_photo: null })
      .eq("id", tenantId)
      .eq("hostel_id", hostelId);
    if (dbErr) throw new Error(dbErr.message);

    await admin.storage.from(BUCKET).remove([path]);

    revalidatePath("/tenants");
    revalidatePath("/payments");
    return {};
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Monthly photo (per room, per month) ─────────────────────────────────────

export async function uploadMonthlyMeterPhoto(
  roomId: string,
  forMonth: string,
  formData: FormData
): Promise<{ path?: string; error?: string }> {
  try {
    const hostelId = await guard(MONTHLY_PERMS);
    if (!UUID_RE.test(roomId)) throw new Error("Invalid room ID");
    if (!MONTH_RE.test(forMonth)) throw new Error("Invalid month format");

    const admin = createAdminClient();

    // The reading row must already exist: the photo evidences a number, so
    // there is nothing to attach it to until the units have been applied. This
    // also scopes the room to the caller's branch in the same query.
    const { data: reading } = await admin
      .from("hms_room_ac_readings")
      .select("id, meter_photo")
      .eq("room_id", roomId)
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .maybeSingle();
    if (!reading) {
      throw new Error("Apply this month's AC units first, then attach the meter photo.");
    }

    const { buffer, ext, contentType } = await readImage(formData);

    const path = `${hostelId}/monthly/${roomId}/${forMonth}/${randomUUID()}.${ext}`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await admin
      .from("hms_room_ac_readings")
      .update({ meter_photo: path, updated_at: new Date().toISOString() })
      .eq("id", reading.id);

    if (dbErr) {
      await admin.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr.message);
    }

    await swap(admin, reading.meter_photo as string | null, path);

    revalidatePath("/payments");
    return { path };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteMonthlyMeterPhoto(
  roomId: string,
  forMonth: string
): Promise<{ error?: string }> {
  try {
    const hostelId = await guard(MONTHLY_PERMS);
    if (!UUID_RE.test(roomId)) throw new Error("Invalid room ID");
    if (!MONTH_RE.test(forMonth)) throw new Error("Invalid month format");

    const admin = createAdminClient();
    const { data: reading } = await admin
      .from("hms_room_ac_readings")
      .select("id, meter_photo")
      .eq("room_id", roomId)
      .eq("hostel_id", hostelId)
      .eq("for_month", forMonth)
      .maybeSingle();
    if (!reading) throw new Error("Forbidden");

    const path = reading.meter_photo as string | null;
    if (!path) return {};

    const { error: dbErr } = await admin
      .from("hms_room_ac_readings")
      .update({ meter_photo: null, updated_at: new Date().toISOString() })
      .eq("id", reading.id);
    if (dbErr) throw new Error(dbErr.message);

    await admin.storage.from(BUCKET).remove([path]);

    revalidatePath("/payments");
    return {};
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
