"use server";

import { revalidatePath } from "next/cache";
import { startOfDay, endOfDay, startOfWeek, endOfWeek } from "date-fns";
import { getProfile, requireSuperAdmin } from "@/lib/auth";
import { requireSalesAuth, getSalesRepContext } from "@/lib/sales-auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { EMAIL_RE } from "@/lib/validation";
import { sendGroupedFollowUpDigests } from "@/lib/email";
import { PKT_OFFSET_MS } from "@/lib/pkt-time";
import type {
  PlatformLead,
  LeadActivity,
  LeadStatus,
  LeadActivityType,
  LeadPriority,
  SalesRep,
  SalesTarget,
} from "@/types";

// ── Caller resolution (admin OR the sales rep a lead is assigned to) ──────────

type Caller =
  | { kind: "admin"; userId: string }
  | { kind: "rep"; userId: string; salesRepId: string };

async function resolveCaller(): Promise<Caller | null> {
  // getProfile() is React cache()-wrapped, reusing it (instead of a second raw
  // hms_profiles query) avoids a duplicate auth.getUser() round trip per call.
  const profile = await getProfile();
  if (!profile) return null;

  if (profile.role === "super_admin") {
    return { kind: "admin", userId: profile.id };
  }

  const ctx = await getSalesRepContext();
  if (ctx && ctx.salesRep.supabase_user_id === profile.id) {
    return { kind: "rep", userId: profile.id, salesRepId: ctx.salesRep.id };
  }

  return null;
}

// Pakistan is a fixed UTC+5 offset (no DST) — bucket "today"/"this week" against
// that wall clock instead of the server process's local timezone (often UTC),
// so performance stats aren't off by hours around midnight PKT.
function pktBoundaries(now: Date) {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  return {
    todayStart: new Date(startOfDay(shifted).getTime() - PKT_OFFSET_MS),
    todayEnd: new Date(endOfDay(shifted).getTime() - PKT_OFFSET_MS),
    weekStart: new Date(startOfWeek(shifted, { weekStartsOn: 1 }).getTime() - PKT_OFFSET_MS),
    weekEnd: new Date(endOfWeek(shifted, { weekStartsOn: 1 }).getTime() - PKT_OFFSET_MS),
  };
}

async function isLeadAssignedToRep(leadId: string, salesRepId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hms_platform_leads")
    .select("assigned_to")
    .eq("id", leadId)
    .single();
  return data?.assigned_to === salesRepId;
}

const ALLOWED_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "follow_up",
  "demo_scheduled",
  "demo_done",
  "onboarding",
  "converted",
  "rejected",
];

const ALLOWED_PRIORITIES: LeadPriority[] = ["low", "medium", "high"];

const ALLOWED_ACTIVITY_TYPES: LeadActivityType[] = [
  "call",
  "visit",
  "demo",
  "note",
  "status_change",
  "whatsapp",
  "email",
];

// ── listLeadsForAdmin ──────────────────────────────────────────────────────────

export async function listLeadsForAdmin(): Promise<
  { leads: PlatformLead[] } | { error: string }
> {
  await requireSuperAdmin();
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_platform_leads")
      .select("*, sales_rep:hms_sales_reps(id,name)")
      // The sales board is the CRM pipeline only. Imported marketing lists live
      // in the same table so they share its dedupe, opt-out and send ledger —
      // but 300 scraped cold contacts on this board would bury the leads a rep
      // is actually working.
      .is("list_id", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { leads: (data ?? []) as PlatformLead[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list leads" };
  }
}

// ── listMyLeads ─────────────────────────────────────────────────────────────────

export async function listMyLeads(): Promise<{ leads: PlatformLead[] } | { error: string }> {
  const ctx = await requireSalesAuth();
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_platform_leads")
      .select("*")
      .is("list_id", null)
      .eq("assigned_to", ctx.salesRep.id)
      .order("next_follow_up_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { leads: (data ?? []) as PlatformLead[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list leads" };
  }
}

// ── createLead ───────────────────────────────────────────────────────────────────
// Manual entry point for leads a super admin or sales rep sources directly (cold
// call, referral, walk-in) — distinct from the public onboarding-form submission
// path in app/actions/onboarding.ts, which anonymous visitors use.

export interface CreateLeadInput {
  business_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  city?: string;
  branch_count?: number;
  notes?: string;
  source?: string;
  /** Admin-only: assign at creation time. Reps always self-assign, this is ignored for them. */
  assigned_to?: string | null;
}

export async function createLead(
  input: CreateLeadInput
): Promise<{ lead: PlatformLead } | { error: string }> {
  const caller = await resolveCaller();
  if (!caller) return { error: "Unauthorized" };

  const businessName = input.business_name.trim();
  const ownerName = input.owner_name.trim();
  const phone = input.phone.trim();
  if (businessName.length < 2) return { error: "Business name must be at least 2 characters." };
  if (ownerName.length < 2) return { error: "Owner name must be at least 2 characters." };
  if (phone.length < 7) return { error: "Phone number is too short." };
  // Validated here, not just at insert time — a malformed email would otherwise
  // only surface as an opaque failure later, when converting the lead to an owner account.
  if (input.email?.trim() && !EMAIL_RE.test(input.email.trim())) {
    return { error: "Enter a valid email address." };
  }

  const branchCount = Number.isFinite(input.branch_count) && (input.branch_count as number) >= 1
    ? Math.floor(input.branch_count as number)
    : 1;

  try {
    const admin = createAdminClient();

    let assignedTo: string | null = null;
    if (caller.kind === "rep") {
      assignedTo = caller.salesRepId;
    } else if (input.assigned_to) {
      const { data: rep } = await admin
        .from("hms_sales_reps")
        .select("id")
        .eq("id", input.assigned_to)
        .eq("is_active", true)
        .maybeSingle();
      if (!rep) return { error: "Invalid or inactive sales rep" };
      assignedTo = rep.id;
    }

    const { data, error } = await admin
      .from("hms_platform_leads")
      .insert({
        business_name: businessName,
        owner_name: ownerName,
        phone,
        email: input.email?.trim() || null,
        city: input.city?.trim() || null,
        branch_count: branchCount,
        notes: input.notes?.trim() || null,
        source: input.source?.trim() || (caller.kind === "rep" ? "sales_rep" : "super_admin"),
        status: "new",
        assigned_to: assignedTo,
        created_by: caller.userId,
      })
      .select("*, sales_rep:hms_sales_reps(id,name)")
      .single();

    if (error) throw error;

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return { lead: data as PlatformLead };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create lead" };
  }
}

// ── updateLead ───────────────────────────────────────────────────────────────────
// Correct a lead's details after the fact — typos, a phone taken down wrong, a city
// that was never right. Deliberately excludes status/priority/follow-up/assignment:
// those each have their own action that logs an activity trail, and quietly changing
// them here would bypass it.

export interface UpdateLeadInput {
  business_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  city?: string;
  branch_count?: number;
  notes?: string;
  source?: string;
}

export async function updateLead(
  leadId: string,
  input: UpdateLeadInput
): Promise<{ lead: PlatformLead } | { error: string }> {
  const caller = await resolveCaller();
  if (!caller) return { error: "Unauthorized" };

  // A rep may only fix their own leads; admins may fix any.
  if (caller.kind === "rep" && !(await isLeadAssignedToRep(leadId, caller.salesRepId))) {
    return { error: "You can only edit leads assigned to you" };
  }

  const businessName = input.business_name.trim();
  const ownerName = input.owner_name.trim();
  const phone = input.phone.trim();
  if (businessName.length < 2) return { error: "Business name must be at least 2 characters." };
  if (ownerName.length < 2) return { error: "Owner name must be at least 2 characters." };
  if (phone.length < 7) return { error: "Phone number is too short." };
  if (input.email?.trim() && !EMAIL_RE.test(input.email.trim())) {
    return { error: "Enter a valid email address." };
  }

  const branchCount = Number.isFinite(input.branch_count) && (input.branch_count as number) >= 1
    ? Math.floor(input.branch_count as number)
    : 1;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_platform_leads")
      .update({
        business_name: businessName,
        owner_name: ownerName,
        phone,
        email: input.email?.trim() || null,
        city: input.city?.trim() || null,
        branch_count: branchCount,
        notes: input.notes?.trim() || null,
        source: input.source?.trim() || null,
      })
      .eq("id", leadId)
      .select("*, sales_rep:hms_sales_reps(id,name)")
      .single();

    if (error) throw error;
    if (!data) return { error: "Lead not found" };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await writeAuditLog({
      actor_id: caller.userId,
      actor_email: user?.email ?? "",
      action: "lead.update",
      entity: "platform_lead",
      entity_id: leadId,
      meta: { business_name: businessName },
    });

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return { lead: data as PlatformLead };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update lead" };
  }
}

// ── assignLead ──────────────────────────────────────────────────────────────────

export async function assignLead(
  leadId: string,
  salesRepId: string | null
): Promise<{ error?: string }> {
  const caller = await requireSuperAdmin();
  try {
    const admin = createAdminClient();

    if (salesRepId !== null) {
      const { data: rep } = await admin
        .from("hms_sales_reps")
        .select("id")
        .eq("id", salesRepId)
        .eq("is_active", true)
        .maybeSingle();
      if (!rep) return { error: "Invalid or inactive sales rep" };
    }

    const { error } = await admin
      .from("hms_platform_leads")
      .update({ assigned_to: salesRepId })
      .eq("id", leadId);

    if (error) throw error;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: user?.email ?? "",
      action: "lead.assign",
      entity: "platform_lead",
      entity_id: leadId,
      meta: { sales_rep_id: salesRepId },
    });

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to assign lead" };
  }
}

// ── updateLeadStage ─────────────────────────────────────────────────────────────

export async function updateLeadStage(
  leadId: string,
  status: LeadStatus
): Promise<{ error?: string }> {
  try {
    if (!ALLOWED_STATUSES.includes(status)) return { error: "Invalid lead status" };

    const caller = await resolveCaller();
    if (!caller) return { error: "Unauthorized" };

    if (caller.kind === "rep" && !(await isLeadAssignedToRep(leadId, caller.salesRepId))) {
      return { error: "Unauthorized" };
    }

    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_platform_leads")
      .update({ status })
      .eq("id", leadId);
    if (error) throw error;

    const { error: activityError } = await admin.from("hms_lead_activities").insert({
      lead_id: leadId,
      sales_rep_id: caller.kind === "rep" ? caller.salesRepId : null,
      actor_id: caller.userId,
      type: "status_change",
      notes: `Status changed to ${status}`,
    });
    if (activityError) throw activityError;

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update lead stage" };
  }
}

// ── setLeadFollowUpDate ──────────────────────────────────────────────────────────

export async function setLeadFollowUpDate(
  leadId: string,
  date: string | null
): Promise<{ error?: string }> {
  try {
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { error: "Invalid follow-up date" };
    }

    const caller = await resolveCaller();
    if (!caller) return { error: "Unauthorized" };

    if (caller.kind === "rep" && !(await isLeadAssignedToRep(leadId, caller.salesRepId))) {
      return { error: "Unauthorized" };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_platform_leads")
      .update({ next_follow_up_date: date })
      .eq("id", leadId);
    if (error) throw error;

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to set follow-up date" };
  }
}

// ── setLeadPriority ──────────────────────────────────────────────────────────────

export async function setLeadPriority(
  leadId: string,
  priority: LeadPriority
): Promise<{ error?: string }> {
  try {
    if (!ALLOWED_PRIORITIES.includes(priority)) return { error: "Invalid priority" };

    const caller = await resolveCaller();
    if (!caller) return { error: "Unauthorized" };

    if (caller.kind === "rep" && !(await isLeadAssignedToRep(leadId, caller.salesRepId))) {
      return { error: "Unauthorized" };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_platform_leads")
      .update({ priority })
      .eq("id", leadId);
    if (error) throw error;

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to set priority" };
  }
}

// ── deleteLead ──────────────────────────────────────────────────────────────────
// Admin-only — sales reps can lose/win/reassign leads but never delete outright,
// since that would also erase the rep's own activity history for it.

export async function deleteLead(leadId: string): Promise<{ error?: string }> {
  const caller = await requireSuperAdmin();
  try {
    const admin = createAdminClient();
    const supabase = await createClient();

    // Snapshot before delete — the row (and its business_name/owner_name) is gone
    // afterward, so this is the only chance to make the audit entry self-contained.
    const [{ data: lead }, { data: { user } }] = await Promise.all([
      admin.from("hms_platform_leads").select("business_name, owner_name, phone").eq("id", leadId).maybeSingle(),
      supabase.auth.getUser(),
    ]);

    // hms_lead_activities.lead_id is ON DELETE CASCADE, so the timeline goes with it.
    const { error } = await admin.from("hms_platform_leads").delete().eq("id", leadId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: user?.email ?? "",
      action: "lead.delete",
      entity: "platform_lead",
      entity_id: leadId,
      meta: lead ?? {},
    });

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete lead" };
  }
}

// ── sendFollowUpDigestEmail ─────────────────────────────────────────────────────
// On-demand version of the /api/cron/lead-followups job — sends whatever set of
// leads the admin currently has filtered to on the leads page, instead of waiting
// for the 9 AM PKT run. Routing is per-lead: a lead assigned to a rep goes to that
// rep's email (admin CC'd for confirmation), an unassigned lead goes to the admin.

type LeadWithRepEmail = PlatformLead & {
  sales_rep: { id: string; name: string; email: string | null; is_active: boolean } | null;
};

export async function sendFollowUpDigestEmail(
  leadIds: string[]
): Promise<{ error?: string; sent?: number; recipients?: number }> {
  const caller = await requireSuperAdmin();
  try {
    if (leadIds.length === 0) return { error: "No leads selected" };

    const adminEmail = process.env.LEADS_FOLLOWUP_DIGEST_EMAIL;
    if (!adminEmail) return { error: "Digest recipient email is not configured" };

    const admin = createAdminClient();
    const supabase = await createClient();

    const [{ data, error }, { data: { user } }] = await Promise.all([
      admin
        .from("hms_platform_leads")
        .select("*, sales_rep:hms_sales_reps(id,name,email,is_active)")
        .in("id", leadIds)
        .order("next_follow_up_date", { ascending: true }),
      supabase.auth.getUser(),
    ]);
    if (error) throw error;

    const leads = (data ?? []) as LeadWithRepEmail[];
    if (leads.length === 0) return { error: "No matching leads found" };

    const { sentCount, recipientCount } = await sendGroupedFollowUpDigests(leads, adminEmail);

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: user?.email ?? "",
      action: "lead.followup_digest_sent",
      entity: "platform_lead",
      meta: { count: sentCount, recipients: recipientCount, lead_ids: leadIds },
    });

    return { sent: sentCount, recipients: recipientCount };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send digest email" };
  }
}

// ── logLeadActivity ─────────────────────────────────────────────────────────────

export interface LogLeadActivityInput {
  type: LeadActivityType;
  outcome?: string;
  notes?: string;
  occurred_at?: string;
}

export async function logLeadActivity(
  leadId: string,
  input: LogLeadActivityInput
): Promise<{ error?: string }> {
  try {
    if (!ALLOWED_ACTIVITY_TYPES.includes(input.type)) return { error: "Invalid activity type" };

    const caller = await resolveCaller();
    if (!caller) return { error: "Unauthorized" };

    if (caller.kind === "rep" && !(await isLeadAssignedToRep(leadId, caller.salesRepId))) {
      return { error: "Unauthorized" };
    }

    const admin = createAdminClient();
    const { error } = await admin.from("hms_lead_activities").insert({
      lead_id: leadId,
      sales_rep_id: caller.kind === "rep" ? caller.salesRepId : null,
      actor_id: caller.userId,
      type: input.type,
      outcome: input.outcome ?? null,
      notes: input.notes ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    });

    if (error) throw error;

    revalidatePath("/super-admin/leads");
    revalidatePath("/sales");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to log activity" };
  }
}

// ── listLeadActivities ────────────────────────────────────────────────────────

export async function listLeadActivities(
  leadId: string
): Promise<{ activities: LeadActivity[] } | { error: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { error: "Unauthorized" };

    if (caller.kind === "rep" && !(await isLeadAssignedToRep(leadId, caller.salesRepId))) {
      return { error: "Unauthorized" };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_lead_activities")
      .select("*, sales_rep:hms_sales_reps(id,name)")
      .eq("lead_id", leadId)
      .order("occurred_at", { ascending: false });

    if (error) throw error;
    return { activities: (data ?? []) as LeadActivity[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list activities" };
  }
}

// ── Sales performance ────────────────────────────────────────────────────────

function countCallsVisits(rows: { type: string }[]): { calls: number; visits: number } {
  return {
    calls: rows.filter((r) => r.type === "call").length,
    visits: rows.filter((r) => r.type === "visit").length,
  };
}

function inRange(occurredAt: string, start: Date, end: Date): boolean {
  const t = new Date(occurredAt);
  return t >= start && t <= end;
}

export interface SalesPerformanceRow {
  salesRep: { id: string; name: string };
  target: SalesTarget | null;
  today: { calls: number; visits: number };
  week: { calls: number; visits: number };
  leadsAssigned: number;
  leadsConverted: number;
}

// ── getSalesPerformance ────────────────────────────────────────────────────────

export async function getSalesPerformance(): Promise<
  { performance: SalesPerformanceRow[] } | { error: string }
> {
  await requireSuperAdmin();
  try {
    const admin = createAdminClient();

    const { todayStart, todayEnd, weekStart, weekEnd } = pktBoundaries(new Date());

    const [repsRes, activitiesRes, leadsRes] = await Promise.all([
      admin
        .from("hms_sales_reps")
        .select("*, target:hms_sales_targets(*)")
        .eq("is_active", true),
      admin
        .from("hms_lead_activities")
        .select("sales_rep_id, type, occurred_at")
        .gte("occurred_at", weekStart.toISOString())
        .in("type", ["call", "visit"]),
      admin.from("hms_platform_leads").select("assigned_to, status").is("list_id", null),
    ]);

    if (repsRes.error) throw repsRes.error;
    if (activitiesRes.error) throw activitiesRes.error;
    if (leadsRes.error) throw leadsRes.error;

    const reps = (repsRes.data ?? []) as (SalesRep & {
      target: SalesTarget[] | SalesTarget | null;
    })[];
    const activities = (activitiesRes.data ?? []) as {
      sales_rep_id: string | null;
      type: string;
      occurred_at: string;
    }[];
    const leads = (leadsRes.data ?? []) as { assigned_to: string | null; status: string }[];

    const performance: SalesPerformanceRow[] = reps.map((rep) => {
      const repActivities = activities.filter((a) => a.sales_rep_id === rep.id);
      const todayActivities = repActivities.filter((a) => inRange(a.occurred_at, todayStart, todayEnd));
      const weekActivities = repActivities.filter((a) => inRange(a.occurred_at, weekStart, weekEnd));
      const repLeads = leads.filter((l) => l.assigned_to === rep.id);
      const target = Array.isArray(rep.target) ? (rep.target[0] ?? null) : (rep.target ?? null);

      return {
        salesRep: { id: rep.id, name: rep.name },
        target,
        today: countCallsVisits(todayActivities),
        week: countCallsVisits(weekActivities),
        leadsAssigned: repLeads.length,
        leadsConverted: repLeads.filter((l) => l.status === "converted").length,
      };
    });

    return { performance };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load sales performance" };
  }
}

// ── getMyPerformance ─────────────────────────────────────────────────────────

export async function getMyPerformance(): Promise<
  | {
      today: { calls: number; visits: number };
      week: { calls: number; visits: number };
      target: SalesTarget | null;
      leadsAssigned: number;
      leadsConverted: number;
    }
  | { error: string }
> {
  const ctx = await requireSalesAuth();
  try {
    const admin = createAdminClient();

    const { todayStart, todayEnd, weekStart, weekEnd } = pktBoundaries(new Date());

    const [activitiesRes, leadsRes] = await Promise.all([
      admin
        .from("hms_lead_activities")
        .select("type, occurred_at")
        .eq("sales_rep_id", ctx.salesRep.id)
        .gte("occurred_at", weekStart.toISOString())
        .in("type", ["call", "visit"]),
      admin.from("hms_platform_leads").select("status").is("list_id", null).eq("assigned_to", ctx.salesRep.id),
    ]);

    if (activitiesRes.error) throw activitiesRes.error;
    if (leadsRes.error) throw leadsRes.error;

    const activities = (activitiesRes.data ?? []) as { type: string; occurred_at: string }[];
    const leads = (leadsRes.data ?? []) as { status: string }[];

    const todayActivities = activities.filter((a) => inRange(a.occurred_at, todayStart, todayEnd));
    const weekActivities = activities.filter((a) => inRange(a.occurred_at, weekStart, weekEnd));

    return {
      today: countCallsVisits(todayActivities),
      week: countCallsVisits(weekActivities),
      target: ctx.salesRep.target ?? null,
      leadsAssigned: leads.length,
      leadsConverted: leads.filter((l) => l.status === "converted").length,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load performance" };
  }
}
