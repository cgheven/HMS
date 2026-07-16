import { createAdminClient } from "@/lib/supabase/admin";

export async function writeAuditLog(data: {
  actor_id: string;
  actor_email: string;
  action: string;
  entity: string;
  entity_id?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("hms_audit_log").insert({
      actor_id: data.actor_id,
      actor_email: data.actor_email,
      action: data.action,
      entity: data.entity,
      entity_id: data.entity_id ?? null,
      meta: data.meta ?? null,
    });
  } catch {
    // Audit failures must never block the main action
  }
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
