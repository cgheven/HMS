import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function writeAuditLog(data: {
  actor_id: string;
  actor_email: string;
  action: string;
  entity: string;
  entity_id?: string;
  hostel_id?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminClient();
    const row: Record<string, unknown> = {
      actor_id: data.actor_id,
      actor_email: data.actor_email,
      action: data.action,
      entity: data.entity,
      entity_id: data.entity_id ?? null,
      meta: data.meta ?? null,
    };
    // Migration 248 adds hms_audit_log.hostel_id for the branch-scoped resident-
    // PII trail. Only send the column when the caller actually scopes a row to a
    // branch — the legacy super-admin/CRM callers pass nothing, so their insert
    // keeps its pre-248 shape and never fails (PGRST204) if this code ships
    // before 248 is applied, which would otherwise silently kill that trail.
    if (data.hostel_id !== undefined && data.hostel_id !== null) row.hostel_id = data.hostel_id;
    await admin.from("hms_audit_log").insert(row);
  } catch {
    // Audit failures must never block the main action
  }
}

// GDPR resident-PII trail. Deliberate, minimal, tamper-evident — distinct from
// hms_activity_log, which snapshots whole tenant rows (the thing erasure must
// later scrub). CRITICAL contract: meta records field NAMES and event facts,
// NEVER PII VALUES (e.g. { fields: ["phone","cnic"] }, { docType, docId }) —
// otherwise this log becomes a PII store that itself defeats erasure.
//
// The actor is resolved from the authenticated session here so call sites need
// only name the event; every write is swallowed on failure and can never block
// or alter the action it is attached to.
export async function logPiiAudit(data: {
  hostelId: string | null;
  action: string;
  tenantId: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await writeAuditLog({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: data.action,
      entity: "tenant",
      entity_id: data.tenantId,
      hostel_id: data.hostelId ?? undefined,
      meta: data.meta,
    });
  } catch {
    // never block the main action
  }
}

// The resident personal-data fields a pii_update event may report as changed.
// Column names only — the values are never recorded (see logPiiAudit contract).
export const RESIDENT_PII_FIELDS = [
  "full_name", "phone", "email", "cnic", "id_type", "father_name",
  "emergency_contact", "emergency_phone", "emergency_relationship",
  "permanent_address", "permanent_province", "permanent_district",
  "date_of_birth", "address_line1", "address_line2", "city",
  "county_state", "postcode", "address_country", "vehicle_number",
] as const;

// Which PII columns an edit actually changed. Only fields the update payload
// carries are considered (an edit form that never writes address_line1 must not
// report it as cleared), and null/undefined/"" are treated as the same empty so
// a no-op re-save records nothing.
export function changedPiiFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>
): string[] {
  const norm = (v: unknown) => (v === null || v === undefined || v === "" ? null : v);
  const changed: string[] = [];
  for (const field of RESIDENT_PII_FIELDS) {
    if (!(field in after)) continue;
    if (norm(before?.[field]) !== norm(after[field])) changed.push(field);
  }
  return changed;
}

// Day-to-day product usage (tenants, payments, kitchen, etc.) — distinct from
// writeAuditLog, which is super-admin/CRM actions only. Most "add" flows insert
// directly from the browser and get logged automatically via a DB trigger
// (see supabase/migrations/088_activity_log.sql); this covers the few actions
// that run server-side instead, where the acting user is already in scope.
export async function logActivity(data: {
  hostel_id: string | null;
  actor_id: string;
  action: string;
  entity: string;
  entity_id?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("hms_activity_log").insert({
      hostel_id: data.hostel_id,
      actor_id: data.actor_id,
      action: data.action,
      entity: data.entity,
      entity_id: data.entity_id ?? null,
      meta: data.meta ?? null,
    });
  } catch {
    // Activity logging must never block the main action
  }
}
