"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { processInBatches } from "@/lib/batch";
import { normalizePhoneDigits } from "@/lib/phone";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { parseMetaTemplate, campaignGreeting, type CampaignTemplate, type MetaTemplate } from "@/lib/lead-campaigns";
import type { CampaignAudienceRow, CampaignSendSummary, LeadStatus } from "@/types";
import { siteUrl } from "@/lib/site-url";

/** Throws rather than redirects — these are server actions whose callers catch
 *  and surface the message, and a redirect() thrown inside those catch blocks
 *  would be swallowed as a generic failure. Same reasoning as
 *  app/actions/whatsapp-monitor.ts. */
async function requireSuperAdmin() {
  const profile = await getProfile();
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return profile;
}

const META_API_VERSION = "v25.0";
const SEND_CONCURRENCY = 5;

/**
 * Every APPROVED MARKETING template on the WABA, read live.
 *
 * Live rather than a hardcoded registry so approving a template in WhatsApp
 * Manager is the only step needed to make it sendable, and so the preview
 * shown before a blast is the approved wording rather than what was submitted.
 *
 * Restricted to MARKETING on purpose: the utility templates on this WABA chase
 * tenant rent and client invoices, and offering them on a page that messages
 * prospects invites sending a rent reminder to someone who is not a customer.
 */
async function fetchApprovedTemplates(): Promise<CampaignTemplate[]> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WABA_ID;
  if (!token || !waba) throw new Error("WHATSAPP_TOKEN or WABA_ID is not configured");

  const origin = siteUrl();
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${waba}/message_templates` +
      `?fields=name,language,status,category,components&limit=200`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail = raw.slice(0, 200);
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error?.message) detail = parsed.error.message;
    } catch {
      // Not JSON — keep the raw text.
    }
    throw new Error(`Could not read templates from Meta: ${detail}`);
  }

  const json = await res.json();
  return ((json?.data ?? []) as MetaTemplate[])
    .filter((t) => t.status === "APPROVED" && t.category === "MARKETING")
    .map((t) => parseMetaTemplate(t, origin))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCampaignTemplates(): Promise<{
  templates?: CampaignTemplate[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    return { templates: await fetchApprovedTemplates() };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to load templates" };
  }
}

interface LeadRow {
  id: string;
  business_name: string;
  owner_name: string;
  phone: string;
  city: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  converted_hostel_id: string | null;
  marketing_opt_out: boolean;
  sales_rep: { id: string; name: string } | { id: string; name: string }[] | null;
}

/**
 * Everything the page needs to decide who gets messaged, computed in one place
 * so the UI and the send action can never disagree about eligibility.
 *
 * The blocks below are recomputed inside sendLeadCampaign too. The UI's job is
 * to explain them; it is emphatically not the enforcement point.
 *
 * `templateName` doubles as the ledger's campaign_key — the thing that
 * actually identifies the message is the thing that answers "has this lead had
 * it already?".
 */
async function buildAudience(templateName: string): Promise<CampaignAudienceRow[]> {
  const admin = createAdminClient();

  const [{ data: leads }, { data: sends }, { data: messages }, { data: profiles }] = await Promise.all([
    admin
      .from("hms_platform_leads")
      // FK join rather than a second query + JS map — the rep name is only ever
      // used alongside the lead it belongs to.
      .select(
        "id, business_name, owner_name, phone, city, status, assigned_to, converted_hostel_id, marketing_opt_out, sales_rep:hms_sales_reps(id,name)"
      )
      .order("created_at", { ascending: false }),
    admin
      .from("hms_lead_campaign_sends")
      .select("lead_id, status, created_at")
      .eq("campaign_key", templateName),
    admin
      .from("hms_whatsapp_messages")
      .select("lead_id, status, created_at")
      .eq("template", templateName)
      .not("lead_id", "is", null)
      .order("created_at", { ascending: false }),
    // "We already have some clients onboarded" — converted_hostel_id only
    // catches the ones converted THROUGH this CRM. A client onboarded any
    // other way is invisible to it, so match on phone as well.
    admin.from("hms_profiles").select("phone").not("phone", "is", null),
  ]);

  const clientPhones = new Set(
    (profiles ?? [])
      .map((p) => normalizePhoneDigits(p.phone as string))
      .filter((d): d is string => !!d)
  );

  // Anything not 'failed' locks the lead — mirrors the partial unique index.
  const claimed = new Map<string, string>();
  for (const s of sends ?? []) {
    if (s.status !== "failed") claimed.set(s.lead_id as string, s.created_at as string);
  }

  // Ordered newest-first, so the first row per lead is the current status.
  const delivery = new Map<string, { status: string; at: string }>();
  for (const m of messages ?? []) {
    const id = m.lead_id as string;
    if (!delivery.has(id)) delivery.set(id, { status: m.status as string, at: m.created_at as string });
  }

  return ((leads ?? []) as unknown as LeadRow[]).map((lead) => {
    const rep = Array.isArray(lead.sales_rep) ? lead.sales_rep[0] : lead.sales_rep;
    const digits = normalizePhoneDigits(lead.phone);
    const greeting = campaignGreeting(lead.owner_name, lead.business_name);
    const sentAt = claimed.get(lead.id) ?? null;
    const d = delivery.get(lead.id);

    const blocked =
      lead.marketing_opt_out ? "opted_out"
      : sentAt ? "already_sent"
      : !digits ? "no_phone"
      : !greeting ? "no_name"
      : null;

    const warnings: CampaignAudienceRow["warnings"] = [];
    if (lead.converted_hostel_id || lead.status === "converted") warnings.push("converted");
    else if (digits && clientPhones.has(digits)) warnings.push("existing_client");
    if (lead.status === "rejected") warnings.push("rejected");

    return {
      lead_id: lead.id,
      business_name: lead.business_name,
      owner_name: lead.owner_name,
      phone: lead.phone,
      city: lead.city,
      status: lead.status,
      assigned_to: lead.assigned_to,
      assigned_to_name: rep?.name ?? null,
      marketing_opt_out: lead.marketing_opt_out,
      greeting: greeting?.value ?? null,
      greeting_from_business: greeting?.usedBusinessName ?? false,
      blocked,
      warnings,
      delivery: d?.status ?? null,
      sent_at: sentAt ?? d?.at ?? null,
    };
  });
}

export async function listCampaignAudience(
  templateName: string
): Promise<{ rows?: CampaignAudienceRow[]; error?: string }> {
  try {
    await requireSuperAdmin();
    return { rows: await buildAudience(templateName) };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to load campaign audience" };
  }
}

export async function setLeadMarketingOptOut(
  leadId: string,
  optOut: boolean
): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_platform_leads")
      .update({ marketing_opt_out: optOut })
      .eq("id", leadId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: optOut ? "lead_marketing_opt_out" : "lead_marketing_opt_in",
      entity: "hms_platform_leads",
      entity_id: leadId,
    });

    revalidatePath("/super-admin/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to update opt-out" };
  }
}

/**
 * Refuses to start a campaign whose header image cannot be fetched.
 *
 * This is not belt-and-braces, it is the difference between a recoverable
 * mistake and an unrecoverable one. Meta ACCEPTS a send whose image 404s — it
 * returns a message id and 200 — then fails asynchronously with error 131053
 * ("Media upload error") and the webhook marks it undelivered. Nothing in the
 * send path can see that.
 *
 * So without this check, "Send to 53" would claim all 53 ledger rows as 'sent',
 * report success, and deliver nothing. Because the partial unique index only
 * exempts 'failed', every one of those leads would be permanently barred from
 * ever receiving the campaign. One HEAD request prevents that.
 */
async function assertHeaderImageReachable(template: CampaignTemplate): Promise<void> {
  if (template.headerFormat !== "IMAGE") return;
  if (!template.headerImageUrl) {
    throw new Error(`${template.name} has an image header but no image URL could be derived`);
  }

  let ok = false;
  try {
    const res = await fetch(template.headerImageUrl, { method: "HEAD", cache: "no-store" });
    ok = res.ok;
  } catch {
    ok = false;
  }

  if (!ok) {
    throw new Error(
      `Header image is not reachable: ${template.headerImageUrl} — ` +
        `upload it to public/marketing/${template.name}.png and deploy. ` +
        `Meta accepts sends with a broken image and then silently fails to deliver them.`
    );
  }
}

/** Header parameter + body values for one recipient. */
function buildSendArgs(template: CampaignTemplate, greeting: string) {
  const body = template.bodyParamCount === 1 ? [greeting] : [];
  const headerImageUrl = template.headerFormat === "IMAGE" ? template.headerImageUrl ?? undefined : undefined;
  return { body, headerImageUrl };
}

/**
 * Sends one approved template to an explicit list of leads.
 *
 * The claim goes into hms_lead_campaign_sends BEFORE the Meta call, and the
 * partial unique index is what actually prevents a duplicate — not the
 * disabled button, not the "already sent" badge. A double-click, a second tab
 * or a retried request loses the race and is skipped. Marketing is the one
 * message type where sending twice is worse than not sending at all: it is
 * what gets a number reported, and this is the same number every tenant rent
 * reminder goes out on.
 */
export async function sendLeadCampaign(
  templateName: string,
  leadIds: string[]
): Promise<{ data?: CampaignSendSummary; error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    if (leadIds.length === 0) throw new Error("No leads selected");

    // Re-resolved from Meta, never trusted from the request: a template can be
    // paused or rejected between the page loading and Send being pressed.
    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);
    if (!template) throw new Error(`${templateName} is no longer an approved marketing template`);
    if (template.unsupported) throw new Error(template.unsupported);
    await assertHeaderImageReachable(template);

    const admin = createAdminClient();

    // Eligibility recomputed from the database, never taken from the request.
    // The page could be minutes stale, and an opt-out recorded in the meantime
    // must win.
    const audience = await buildAudience(templateName);
    const byId = new Map(audience.map((r) => [r.lead_id, r]));

    const summary: CampaignSendSummary = {
      requested: leadIds.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    const eligible = leadIds
      .map((id) => byId.get(id))
      .filter((r): r is CampaignAudienceRow => {
        if (!r || r.blocked) {
          summary.skipped++;
          return false;
        }
        return true;
      });

    await processInBatches(eligible, SEND_CONCURRENCY, async (row) => {
      const digits = normalizePhoneDigits(row.phone);
      if (!digits || !row.greeting) {
        summary.skipped++;
        return;
      }

      const { data: claim, error: claimErr } = await admin
        .from("hms_lead_campaign_sends")
        .insert({
          lead_id: row.lead_id,
          campaign_key: templateName,
          phone: digits,
          status: "pending",
          sent_by: profile.id,
        })
        .select("id")
        .maybeSingle();

      // 23505 — another request already claimed this lead. Not an error.
      if (claimErr || !claim) {
        summary.skipped++;
        return;
      }

      const args = buildSendArgs(template, row.greeting);
      const result = await sendWhatsAppTemplateMessage(
        digits,
        template.name,
        template.language,
        args.body,
        { hostelId: null, tenantId: null, leadId: row.lead_id, messageType: "marketing" },
        { headerImageUrl: args.headerImageUrl }
      );

      await admin
        .from("hms_lead_campaign_sends")
        .update({
          status: result.ok ? "sent" : "failed",
          wamid: result.wamid ?? null,
          error: result.ok ? null : result.error ?? "Unknown error",
        })
        .eq("id", claim.id);

      if (!result.ok) {
        summary.failed++;
        summary.errors.push({
          name: row.owner_name || row.business_name,
          error: result.error ?? "Unknown error",
        });
        return;
      }

      summary.sent++;

      // Surfaces the campaign in the lead's own timeline, so a rep opening the
      // lead sees it was messaged rather than calling about it cold.
      await admin.from("hms_lead_activities").insert({
        lead_id: row.lead_id,
        actor_id: profile.id,
        type: "whatsapp",
        outcome: "sent",
        notes: `Marketing campaign: ${template.name}`,
      });
    });

    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: "lead_campaign_sent",
      entity: "hms_lead_campaign_sends",
      meta: {
        template: template.name,
        requested: summary.requested,
        sent: summary.sent,
        skipped: summary.skipped,
        failed: summary.failed,
      },
    });

    revalidatePath("/super-admin/marketing");
    return { data: summary };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to send campaign" };
  }
}

/**
 * One message to an arbitrary number, for checking a campaign before it goes
 * to real prospects.
 *
 * Deliberately touches neither the send ledger nor any lead row: a test must
 * never consume a lead's one-shot at a campaign, and it must stay repeatable.
 * It is still logged in hms_whatsapp_messages like any other send.
 */
export async function sendCampaignTest(
  templateName: string,
  phone: string,
  greeting: string
): Promise<{ error?: string }> {
  try {
    await requireSuperAdmin();

    const digits = normalizePhoneDigits(phone);
    if (!digits) throw new Error("That does not look like a valid phone number");

    const name = greeting.trim() || "there";

    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);
    if (!template) throw new Error(`${templateName} is no longer an approved marketing template`);
    if (template.unsupported) throw new Error(template.unsupported);
    await assertHeaderImageReachable(template);

    const args = buildSendArgs(template, name);
    const result = await sendWhatsAppTemplateMessage(
      digits,
      template.name,
      template.language,
      args.body,
      { hostelId: null, tenantId: null, messageType: "marketing" },
      { headerImageUrl: args.headerImageUrl }
    );
    if (!result.ok) throw new Error(result.error ?? "Meta rejected the message");

    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Test send failed" };
  }
}
