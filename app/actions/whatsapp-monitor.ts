"use server";
import { getProfile } from "@/lib/auth";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { WhatsAppAudience } from "@/lib/whatsapp-audience";

/**
 * Delegates to lib/auth's cache()d getProfile instead of re-authenticating.
 *
 * This file used to run its own getUser() + profile SELECT. So did four other
 * action files and the super-admin layout — six uncached copies of the same two
 * round trips. One Dashboard render performed the identical auth check three to
 * four times, and with functions in us-east and Postgres in Singapore each of
 * those round trips cost ~264ms.
 *
 * Deliberately keeps THROWING rather than calling lib/auth's requireSuperAdmin,
 * which redirects: these are server actions whose callers catch the error and
 * surface it in the UI, and a redirect() thrown inside those catch blocks would
 * be swallowed as a generic failure.
 */
async function requireSuperAdmin() {
  const profile = await getProfile();
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return profile;
}

export interface WhatsAppLogRow {
  id: string;
  hostel_id: string | null;
  hostel_name: string | null;
  tenant_name: string | null;
  owner_name: string | null;
  /** tenant_name, else owner_name, else null — never a phone number, so the UI
   *  can decide how to present an unresolved recipient. */
  recipient_name: string | null;
  audience: WhatsAppAudience;
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
        "id, hostel_id, tenant_id, owner_id, lead_id, phone, message_type, template, status, error, error_code, created_at, hostel:hms_hostels(name), tenant:hms_tenants(full_name), lead:hms_platform_leads(owner_name, business_name)"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;

    type Joined = WhatsAppLogRow & {
      tenant_id: string | null;
      owner_id: string | null;
      lead_id: string | null;
      hostel: { name: string } | { name: string }[] | null;
      tenant: { full_name: string } | { full_name: string }[] | null;
      lead:
        | { owner_name: string; business_name: string }
        | { owner_name: string; business_name: string }[]
        | null;
    };

    const joined = (data ?? []) as unknown as Joined[];

    // Owners resolved in ONE query keyed on owner_id, never by phone. A phone
    // lookup was tried and rejected: 923313454321 belongs to two profiles (a
    // shared test number), so it would print the wrong client's name on a real
    // message — worse than showing none.
    const ownerIds = [...new Set(joined.map((r) => r.owner_id).filter((v): v is string => !!v))];
    const ownerNames = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await admin
        .from("hms_profiles")
        .select("id, full_name, email")
        .in("id", ownerIds);
      for (const o of owners ?? []) {
        ownerNames.set(o.id as string, (o.full_name as string) || (o.email as string) || "");
      }
    }

    const rows: WhatsAppLogRow[] = joined.map((r) => {
      const h = Array.isArray(r.hostel) ? r.hostel[0] : r.hostel;
      const t = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
      const l = Array.isArray(r.lead) ? r.lead[0] : r.lead;
      const ownerName = r.owner_id ? ownerNames.get(r.owner_id) ?? null : null;
      // Joined, not resolved by phone — a lead row already carries its own name.
      const leadName = l ? l.owner_name || l.business_name || null : null;

      // Purpose split, so chasing our own money is never mixed in with service
      // messages about the client's business.
      const audience: WhatsAppAudience = r.tenant_id
        ? "tenant"
        : r.owner_id
        ? r.template === "hms_client_billing_due"
          ? "client_invoice"
          : "client_account"
        : r.lead_id
        ? "lead"
        : "unknown";

      return {
        id: r.id,
        hostel_id: r.hostel_id,
        hostel_name: h?.name ?? null,
        tenant_name: t?.full_name ?? null,
        owner_name: ownerName,
        recipient_name: t?.full_name ?? ownerName ?? leadName ?? null,
        audience,
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
