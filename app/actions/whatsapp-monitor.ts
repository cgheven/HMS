"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return user;
}

export interface WhatsAppLogRow {
  id: string;
  hostel_id: string | null;
  hostel_name: string | null;
  tenant_name: string | null;
  phone: string;
  message_type: string;
  template: string | null;
  status: string;
  error: string | null;
  error_code: number | null;
  created_at: string;
}

export interface WhatsAppLogStats {
  total: number;
  delivered: number;
  /** Accepted by Meta but no delivery confirmation yet. */
  pending: number;
  /** Reached Meta, then bounced — e.g. the number is not a WhatsApp user. */
  undelivered: number;
  /** Never reached Meta at all. */
  failed: number;
}

/**
 * Every WhatsApp attempt, newest first, for the monitoring page.
 *
 * Deliberately NOT reading hms_whatsapp_failures: that table only records what
 * broke, so it can never answer "was this delivered?". hms_whatsapp_messages
 * holds one row per attempt and is advanced by the delivery webhook.
 */
export async function listWhatsAppLog(days = 30): Promise<{
  rows?: WhatsAppLogRow[];
  stats?: WhatsAppLogStats;
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const { data, error } = await admin
      .from("hms_whatsapp_messages")
      .select(
        "id, hostel_id, tenant_id, phone, message_type, template, status, error, error_code, created_at, hostel:hms_hostels(name), tenant:hms_tenants(full_name)"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;

    type Joined = WhatsAppLogRow & {
      hostel: { name: string } | { name: string }[] | null;
      tenant: { full_name: string } | { full_name: string }[] | null;
    };

    const rows: WhatsAppLogRow[] = ((data ?? []) as unknown as Joined[]).map((r) => {
      const h = Array.isArray(r.hostel) ? r.hostel[0] : r.hostel;
      const t = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
      return {
        id: r.id,
        hostel_id: r.hostel_id,
        hostel_name: h?.name ?? null,
        tenant_name: t?.full_name ?? null,
        phone: r.phone,
        message_type: r.message_type,
        template: r.template,
        status: r.status,
        error: r.error,
        error_code: r.error_code,
        created_at: r.created_at,
      };
    });

    const stats: WhatsAppLogStats = {
      total: rows.length,
      delivered: rows.filter((r) => r.status === "delivered" || r.status === "read").length,
      pending: rows.filter((r) => r.status === "queued" || r.status === "sent").length,
      undelivered: rows.filter((r) => r.status === "undelivered").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };

    return { rows, stats };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load WhatsApp log" };
  }
}
