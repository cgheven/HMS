"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { processInBatches } from "@/lib/batch";
import { normalizePhoneDigits } from "@/lib/phone";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { isRealImage } from "@/lib/image-bytes";
import {
  parseMetaTemplate, campaignGreeting, buildClientFingerprint, matchExistingClient,
  type CampaignTemplate, type HeaderImageSource, type MetaTemplate,
} from "@/lib/lead-campaigns";
import type {
  CampaignAudienceRow, CampaignHistoryRow, CampaignResponse, CampaignSendSummary,
  LeadAudienceBlock, LeadStatus,
} from "@/types";
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
 * How long a number is off-limits after any marketing message.
 *
 * Rolling, not calendar-day: a blast at 23:50 followed by another at 00:10 is
 * two messages twenty minutes apart, and a calendar rule would wave it through.
 *
 * The unique index only ever stopped the SAME template reaching the same lead
 * twice. Nothing stopped two different templates minutes apart, and that is not
 * hypothetical — v1 landed on a number at 17:30 and v4 at 17:58, and the only
 * thing that objected was Meta, by silently dropping the second one (131049).
 * Getting throttled costs the whole WABA, which is the same number every
 * tenant's rent reminder goes out on.
 */
const MARKETING_COOLDOWN_HOURS = 24;

// Campaign header artwork — see migration 202. Public bucket, because Meta
// fetches the link itself and arrives with none of our cookies.
const HEADER_BUCKET = "marketing-assets";
const HEADER_MAX_BYTES = 5 * 1024 * 1024;
const HEADER_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** Meta's own rule for template names, and the only thing that reaches the
 *  storage path below — so it is also what stops a name like "../x" from
 *  writing outside the bucket prefix. */
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,120}$/;

/**
 * Uploaded header images, keyed by template name.
 *
 * The bucket is the index — there is no table to keep in sync, so an image is
 * live the moment it lands and gone the moment it is deleted. Listing costs one
 * request per page load, against a bucket that holds one file per campaign.
 *
 * A missing bucket (migration 202 not yet applied) returns {} rather than
 * throwing: templates then resolve to their bundled artwork exactly as before,
 * which is the same behaviour this page had yesterday.
 */
async function listHeaderImages(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(HEADER_BUCKET).list("", { limit: 200 });
  if (error || !data) return {};

  const out: Record<string, string> = {};
  for (const f of data) {
    const dot = f.name.lastIndexOf(".");
    if (dot <= 0) continue;
    const { data: pub } = admin.storage.from(HEADER_BUCKET).getPublicUrl(f.name);
    // Cache-busted on the object's own mtime. The path is fixed per template,
    // so a replacement would otherwise keep serving the previous picture from
    // the CDN — to the browser preview, and to Meta, which is the half that
    // would actually reach prospects.
    const stamp = Date.parse(f.updated_at ?? f.created_at ?? "");
    out[f.name.slice(0, dot)] = Number.isNaN(stamp) ? pub.publicUrl : `${pub.publicUrl}?v=${stamp}`;
  }
  return out;
}

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
  const [res, uploaded] = await Promise.all([
    fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${waba}/message_templates` +
        `?fields=name,language,status,category,components&limit=200`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    ),
    listHeaderImages(),
  ]);

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
    .map((t) => parseMetaTemplate(t, origin, uploaded))
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
  not_a_client: boolean;
  email: string | null;
  list_id: string | null;
  campaign_response: CampaignResponse | null;
  sales_rep: { id: string; name: string } | { id: string; name: string }[] | null;
  lead_list: { id: string; name: string } | { id: string; name: string }[] | null;
}

/**
 * Everything the page needs to decide who gets messaged, computed in one place
 * so the UI and the send action can never disagree about eligibility.
 *
 * The blocks below are recomputed inside sendLeadCampaign too. The UI's job is
 * to explain them; it is emphatically not the enforcement point.
 *
 * `template.name` doubles as the ledger's campaign_key — the thing that
 * actually identifies the message is the thing that answers "has this lead had
 * it already?".
 *
 * Takes the whole template, not just its name, because eligibility depends on
 * what the template actually asks for. A body with no {{1}} sends identical
 * text to everyone, and refusing a lead for having no usable name would then
 * be excluding them over a value that is never read.
 */
/** "3 hours ago" beats a timestamp when the only question is whether the
 *  cooldown has run out. */
function describeAge(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

async function buildAudience(template: CampaignTemplate): Promise<CampaignAudienceRow[]> {
  const templateName = template.name;
  const needsGreeting = template.bodyParamCount === 1;
  const admin = createAdminClient();

  const cooldownSince = new Date(
    Date.now() - MARKETING_COOLDOWN_HOURS * 60 * 60 * 1000
  ).toISOString();

  const [
    leadPages, sendPages, messagePages, { data: deadNumbers },
    { data: recent }, { data: profiles }, { data: hostels },
  ] = await Promise.all([
    // Paged, all three. PostgREST caps an unbounded select at 1000 rows without
    // saying so, and these three decide who gets messaged: sendLeadCampaign()
    // re-derives eligibility from this very function, and a lead past row 1000
    // is not blocked, it is ABSENT — which the send summary reports as
    // "skipped". Every filter and the order must match across pages or rows
    // fall between the windows, so each one orders by id.
    fetchAllPages<LeadRow>((from, to) =>
      admin
        .from("hms_platform_leads")
        // FK join rather than a second query + JS map — the rep name is only ever
        // used alongside the lead it belongs to.
        .select(
          "id, business_name, owner_name, phone, email, city, status, assigned_to, converted_hostel_id, marketing_opt_out, not_a_client, list_id, campaign_response, sales_rep:hms_sales_reps(id,name), lead_list:hms_lead_lists(id,name)"
        )
        // Archived entries are removed from every audience but keep their place
        // in the send ledger, so a number that has already been messaged cannot
        // come back through a re-import.
        .is("archived_at", null)
        // created_at desc is load-bearing, not cosmetic: the duplicate-number
        // collapse below reverses this list so the OLDEST row per number wins —
        // the lead the sales team has been working, rather than the accidental
        // re-entry. id is only the tiebreaker that makes the order total, which
        // paging needs; created_at alone is not unique and rows would fall
        // between two windows.
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: LeadRow[] | null; error: { message: string } | null }>
    ),
    fetchAllPages<{ lead_id: string; status: string; created_at: string }>((from, to) =>
      admin
        .from("hms_lead_campaign_sends")
        .select("lead_id, status, created_at")
        .eq("campaign_key", templateName)
        .order("id")
        .range(from, to)
    ),
    fetchAllPages<{ lead_id: string; status: string; error_code: number | null; created_at: string }>(
      (from, to) =>
        admin
          .from("hms_whatsapp_messages")
          .select("lead_id, status, error_code, created_at")
          .eq("template", templateName)
          .not("lead_id", "is", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to)
    ),
    // Numbers Meta has told us are not WhatsApp accounts, across EVERY campaign
    // rather than only this one. A dead number does not come back to life for a
    // new template, and scoping this to the current template would rediscover
    // each one by wasting a send on it.
    admin
      .from("hms_whatsapp_messages")
      .select("lead_id")
      .eq("error_code", 131026)
      .not("lead_id", "is", null),
    // Every marketing message sent in the cooldown window, by number rather
    // than by lead — the recipient is a person with one phone, not a CRM row.
    // 'failed' is excluded because it never reached Meta at all, so it cannot
    // have reached them either; everything else did leave the building.
    admin
      .from("hms_whatsapp_messages")
      .select("phone, created_at")
      .eq("message_type", "marketing")
      .neq("status", "failed")
      .gte("created_at", cooldownSince)
      .order("created_at", { ascending: false }),
    // Everything that says "this is already a customer". converted_hostel_id
    // alone is useless here — it is null for all 15 hostels, because every one
    // of them was onboarded outside this CRM — so the fingerprint below matches
    // on phone, owner name and business name too.
    admin.from("hms_profiles").select("phone, full_name, business_name, email"),
    admin.from("hms_hostels").select("name"),
  ]);

  // A partial audience is worse than none: it silently drops hostels from the
  // list and from every count above it, and the admin has no way to tell.
  const pageErr = leadPages.error ?? sendPages.error ?? messagePages.error;
  if (pageErr) throw new Error(pageErr);
  const leads = leadPages.data;
  const sends = sendPages.data;
  const messages = messagePages.data;

  const fingerprint = buildClientFingerprint(
    (hostels ?? []) as { name: string | null }[],
    (profiles ?? []) as { phone: string | null; full_name: string | null; business_name: string | null; email: string | null }[],
    normalizePhoneDigits
  );

  // Anything not 'failed' locks the lead — mirrors the partial unique index.
  const claimed = new Map<string, string>();
  for (const s of sends ?? []) {
    if (s.status !== "failed") claimed.set(s.lead_id as string, s.created_at as string);
  }

  const dead = new Set((deadNumbers ?? []).map((m) => m.lead_id as string));

  // Newest first, so the first row per number is the most recent contact.
  const lastMessaged = new Map<string, string>();
  for (const m of recent ?? []) {
    const digits = normalizePhoneDigits(m.phone as string);
    if (digits && !lastMessaged.has(digits)) lastMessaged.set(digits, m.created_at as string);
  }

  /**
   * One lead per phone number gets to be the real one.
   *
   * Three pairs in the list are the same hostel entered twice — "Murad Hostel"
   * and "Murad Boys hostel" on one number — and the send ledger cannot catch
   * that, because it dedupes on lead id. Left alone, the owner gets two
   * identical WhatsApp messages seconds apart from the same business number
   * every tenant's rent reminder uses.
   *
   * Oldest wins: the first record is the one the sales team has been working,
   * and the later row is the accident.
   */
  const canonical = new Map<string, { id: string; name: string }>();
  for (const lead of [...((leads ?? []) as unknown as LeadRow[])].reverse()) {
    const digits = normalizePhoneDigits(lead.phone);
    if (digits && !canonical.has(digits)) {
      canonical.set(digits, { id: lead.id, name: lead.business_name });
    }
  }

  // Ordered newest-first, so the first row per lead is the current status.
  const delivery = new Map<string, { status: string; at: string; code: number | null }>();
  for (const m of messages ?? []) {
    const id = m.lead_id as string;
    if (!delivery.has(id)) {
      delivery.set(id, {
        status: m.status as string,
        at: m.created_at as string,
        code: (m.error_code as number | null) ?? null,
      });
    }
  }

  return ((leads ?? []) as unknown as LeadRow[]).map((lead) => {
    const rep = Array.isArray(lead.sales_rep) ? lead.sales_rep[0] : lead.sales_rep;
    const list = Array.isArray(lead.lead_list) ? lead.lead_list[0] : lead.lead_list;
    const digits = normalizePhoneDigits(lead.phone);
    const greeting = campaignGreeting(lead.owner_name, lead.business_name);
    const sentAt = claimed.get(lead.id) ?? null;
    const d = delivery.get(lead.id);

    // Strongest evidence first: an explicit CRM conversion beats a fuzzy match,
    // and both beat nothing. The reason travels to the UI so a human can judge
    // a name match at a glance instead of opening the lead.
    const clientMatch =
      lead.converted_hostel_id ? "Converted through this CRM"
      : lead.status === "converted" ? "Marked converted in the pipeline"
      : matchExistingClient(lead, fingerprint, normalizePhoneDigits);

    // Meta told us this number is not on WhatsApp. It is the only reliable
    // signal for "wrong number" — a digit-perfect Pakistani mobile that simply
    // belongs to nobody looks fine to every check we can run locally.
    const badNumber = dead.has(lead.id);

    const twin = digits ? canonical.get(digits) : undefined;
    const isDuplicate = !!twin && twin.id !== lead.id;

    const messagedAt = digits ? lastMessaged.get(digits) ?? null : null;

    const blocked: LeadAudienceBlock | null =
      lead.marketing_opt_out ? "opted_out"
      : sentAt ? "already_sent"
      : clientMatch && !lead.not_a_client ? "existing_client"
      : lead.status === "rejected" ? "rejected"
      : isDuplicate ? "duplicate_number"
      : messagedAt ? "recently_messaged"
      : !digits ? "no_phone"
      : badNumber ? "bad_number"
      : needsGreeting && !greeting ? "no_name"
      : null;

    const blockDetail =
      blocked === "duplicate_number" ? `Same number as “${twin!.name}”, which is on the list`
      : blocked === "recently_messaged" ? `Last marketing message ${describeAge(messagedAt!)}`
      : null;

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
      block_detail: blockDetail,
      client_match: clientMatch,
      not_a_client: lead.not_a_client,
      delivery: d?.status ?? null,
      error_code: d?.code ?? null,
      sent_at: sentAt ?? d?.at ?? null,
      list_id: lead.list_id,
      list_name: list?.name ?? null,
      email: lead.email,
      campaign_response: lead.campaign_response,
    };
  });
}

export async function listCampaignAudience(
  templateName: string
): Promise<{ rows?: CampaignAudienceRow[]; error?: string }> {
  try {
    await requireSuperAdmin();
    // Resolved from Meta rather than taken from the request: whether a lead is
    // eligible depends on the template's shape, and that is not the client's to
    // assert.
    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);
    if (!template) throw new Error(`${templateName} is no longer an approved marketing template`);
    return { rows: await buildAudience(template) };
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

  if (!(await isReachable(template.headerImageUrl))) {
    throw new Error(
      `Header image is not reachable: ${template.headerImageUrl} — ` +
        `upload one from the message preview on this page. ` +
        `Meta accepts sends with a broken image and then silently fails to deliver them.`
    );
  }
}

/** One HEAD request, never throwing — a network error and a 404 mean the same
 *  thing to Meta, which is that the picture will not be there. */
async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Replaces the header artwork for one template, from the Marketing page.
 *
 * This exists because the alternative was a deploy. Header images used to be a
 * convention over the app bundle — public/marketing/{template}.png — so a
 * template approved by Meta on a Tuesday could not be sent, or even tested,
 * until someone committed a PNG and shipped it. Storage is public the instant
 * the upload lands, from a dev machine as much as from production, since Meta
 * fetches the link itself and never touches this app's origin.
 *
 * The upload is verified reachable before it is reported as done. That check is
 * the same one the send path runs, and for the same reason: Meta returns 200
 * for a send whose image 404s and then fails it asynchronously, so a header
 * that is broken here would look fine right up until nothing arrived.
 */
export async function uploadCampaignHeaderImage(
  templateName: string,
  formData: FormData
): Promise<{ url?: string; source?: HeaderImageSource; error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    if (!TEMPLATE_NAME_RE.test(templateName)) throw new Error("Invalid template name");

    // Re-resolved from Meta, not trusted from the request: this writes a file
    // that goes out to prospects, so the name has to belong to a real approved
    // template that actually takes an image.
    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);
    if (!template) throw new Error(`${templateName} is not an approved marketing template`);
    if (template.headerFormat !== "IMAGE") {
      throw new Error(`${templateName} has a ${template.headerFormat.toLowerCase()} header — it takes no image`);
    }

    const file = formData.get("file") as File | null;
    if (!file) throw new Error("No file provided");

    const ext = HEADER_MIME[file.type];
    if (!ext) throw new Error("Only JPEG, PNG or WebP images are accepted.");

    // The actual bytes, never the client-supplied file.size or file.type —
    // same rule as the AC meter photo upload.
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > HEADER_MAX_BYTES) throw new Error("Image too large. Maximum size is 5 MB.");
    if (!isRealImage(bytes)) throw new Error("That file is not a real image.");

    const admin = createAdminClient();
    const path = `${templateName}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(HEADER_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (upErr) throw upErr;

    // One template, one image. A previous upload in a different format would
    // otherwise still be sitting there, and which of the two won would come
    // down to the order the bucket listing happened to return.
    const stale = Object.values(HEADER_MIME)
      .filter((e) => e !== ext)
      .map((e) => `${templateName}.${e}`);
    await admin.storage.from(HEADER_BUCKET).remove(stale);

    const uploaded = await listHeaderImages();
    const url = uploaded[templateName];
    if (!url) throw new Error("Upload succeeded but the file could not be found afterwards");
    if (!(await isReachable(url))) {
      throw new Error("Uploaded, but the public URL is not reachable — check that the marketing-assets bucket is public");
    }

    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: "campaign_header_image_uploaded",
      entity: "storage.objects",
      entity_id: path,
      meta: { template: templateName, bytes: bytes.length, content_type: file.type },
    });

    revalidatePath("/super-admin/marketing");
    return { url, source: "uploaded" };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }
}

/**
 * Deletes the uploaded artwork, falling the template back to whatever it
 * resolved to before — the bundled file, or nothing.
 *
 * Returns the re-resolved URL rather than null, because "removed" does not mean
 * "no header": hms_lead_feature_update still has its picture in the app bundle,
 * and telling the page otherwise would show a missing-image warning for a
 * template that sends perfectly well.
 */
export async function removeCampaignHeaderImage(
  templateName: string
): Promise<{ url?: string | null; source?: HeaderImageSource | null; error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    if (!TEMPLATE_NAME_RE.test(templateName)) throw new Error("Invalid template name");

    const admin = createAdminClient();
    const paths = Object.values(HEADER_MIME).map((e) => `${templateName}.${e}`);
    const { error } = await admin.storage.from(HEADER_BUCKET).remove(paths);
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: "campaign_header_image_removed",
      entity: "storage.objects",
      entity_id: templateName,
      meta: { template: templateName },
    });

    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);

    revalidatePath("/super-admin/marketing");
    return { url: template?.headerImageUrl ?? null, source: template?.headerImageSource ?? null };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not remove the image" };
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
    const audience = await buildAudience(template);
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
      // Same rule as the block above: a greeting is only required by a template
      // that has somewhere to put one.
      if (!digits || (template.bodyParamCount === 1 && !row.greeting)) {
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

      const args = buildSendArgs(template, row.greeting ?? "");
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

/**
 * Clears — or restores — the existing-client block on one lead.
 *
 * Client detection is fuzzy on purpose: the three real clients hiding in the
 * lead list were only findable by last-7-digit phone and name overlap, and that
 * same looseness flags a handful of unrelated hostels that merely share a word.
 * A false positive costs a sale, so it has to be dismissible in one click —
 * and the dismissal is permanent, because the match will keep recurring.
 *
 * Separate from marketing_opt_out in both directions: that one suppresses,
 * this one un-suppresses, and collapsing them would make an admin correcting a
 * bad match indistinguishable from one honouring a do-not-contact request.
 */
export async function setLeadNotAClient(
  leadId: string,
  notAClient: boolean
): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_platform_leads")
      .update({ not_a_client: notAClient })
      .eq("id", leadId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: notAClient ? "lead_marked_not_a_client" : "lead_client_block_restored",
      entity: "hms_platform_leads",
      entity_id: leadId,
    });

    revalidatePath("/super-admin/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to update lead" };
  }
}

/**
 * How every campaign performed, not just the one currently selected.
 *
 * Counted from the send ledger rather than from hms_whatsapp_messages, because
 * the ledger is what defines a campaign: a test send writes a message row but
 * deliberately no ledger row, and folding those in would inflate a blast's
 * reach with sends to ourselves.
 *
 * Delivery state then comes from the message log, newest row per lead, since
 * that is the only place Meta's webhook writes to.
 */
export async function listCampaignHistory(): Promise<{
  rows?: CampaignHistoryRow[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    // Both grow with every send, so both page. Truncated, this table would
    // quietly under-report older campaigns — and comparing one campaign against
    // another is the only thing it is for.
    const [sendPages, messagePages] = await Promise.all([
      fetchAllPages<{ campaign_key: string; lead_id: string; status: string; created_at: string }>(
        (from, to) =>
          admin
            .from("hms_lead_campaign_sends")
            .select("campaign_key, lead_id, status, created_at")
            .order("created_at", { ascending: true })
            .order("id")
            .range(from, to)
      ),
      fetchAllPages<{ lead_id: string; template: string; status: string; created_at: string }>(
        (from, to) =>
          admin
            .from("hms_whatsapp_messages")
            .select("lead_id, template, status, created_at")
            .not("lead_id", "is", null)
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to)
      ),
    ]);
    if (sendPages.error) throw new Error(sendPages.error);
    if (messagePages.error) throw new Error(messagePages.error);
    const sends = sendPages.data;
    const messages = messagePages.data;

    // Newest message per (template, lead) — a retried send must count once.
    const latest = new Map<string, string>();
    for (const m of messages ?? []) {
      const key = `${m.template as string}::${m.lead_id as string}`;
      if (!latest.has(key)) latest.set(key, m.status as string);
    }

    const byCampaign = new Map<string, CampaignHistoryRow>();
    for (const s of sends ?? []) {
      const key = s.campaign_key as string;
      let row = byCampaign.get(key);
      if (!row) {
        row = {
          campaign_key: key,
          recipients: 0, delivered: 0, read: 0, undelivered: 0, failed: 0,
          first_sent_at: null, last_sent_at: null,
        };
        byCampaign.set(key, row);
      }

      const at = s.created_at as string;
      if (!row.first_sent_at || at < row.first_sent_at) row.first_sent_at = at;
      if (!row.last_sent_at || at > row.last_sent_at) row.last_sent_at = at;

      // A ledger row that never reached Meta is a failure of the blast, not a
      // recipient — counting it in reach would flatter every campaign.
      if (s.status === "failed") {
        row.failed++;
        continue;
      }
      row.recipients++;

      const state = latest.get(`${key}::${s.lead_id as string}`);
      // read implies delivered — a funnel that lets them diverge reads as broken.
      if (state === "read") { row.read++; row.delivered++; }
      else if (state === "delivered") row.delivered++;
      else if (state === "undelivered" || state === "failed") row.undelivered++;
    }

    return {
      rows: [...byCampaign.values()].sort((a, b) =>
        (b.last_sent_at ?? "").localeCompare(a.last_sent_at ?? "")
      ),
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to load campaign history" };
  }
}


/**
 * Adds a hostel to the campaign list without leaving this page.
 *
 * Prospecting happens on Google Maps and Facebook, in a tab next to this one.
 * Routing every find through the Client Leads form to come back and blast it is
 * the kind of detour that ends with names in a notes app instead of the CRM, so
 * this creates a real lead — the same row Client Leads shows, visible to the
 * sales team, not a marketing-only side list.
 *
 * Duplicate phones are refused rather than merged. Two rows for one hostel means
 * two messages to one owner, and the campaign ledger cannot catch it because it
 * dedupes on lead id, not on the number behind it.
 */
export async function addCampaignLead(input: {
  business_name: string;
  owner_name: string;
  phone: string;
  city: string;
}): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();

    const business = input.business_name.trim();
    const owner = input.owner_name.trim();
    const city = input.city.trim();
    if (business.length < 2) throw new Error("Hostel name is required");

    const digits = normalizePhoneDigits(input.phone);
    if (!digits) throw new Error("That does not look like a valid Pakistani number");

    const admin = createAdminClient();

    // Compared on normalized digits, not raw text: 0321-4272165 and +923214272165
    // are the same owner and would otherwise both be created and both messaged.
    const { data: existing, error: existingErr } = await fetchAllPages<
      { id: string; business_name: string; phone: string }
    >((from, to) =>
      admin.from("hms_platform_leads").select("id, business_name, phone").order("id").range(from, to)
    );
    if (existingErr) throw new Error(existingErr);
    const clash = existing.find((l) => normalizePhoneDigits(l.phone) === digits);
    if (clash) throw new Error(`That number is already on the list as "${clash.business_name}"`);

    const { error } = await admin.from("hms_platform_leads").insert({
      business_name: business,
      // NOT NULL in the schema, and "Unknown" is what the existing rows use when
      // nobody found a name. campaignGreeting treats it as unusable and falls
      // back to the business name, so the greeting stays coherent either way.
      owner_name: owner || "Unknown",
      phone: input.phone.trim(),
      city: city || null,
      status: "new",
      source: "marketing",
      created_by: profile.id,
    });
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: "lead_created",
      entity: "hms_platform_leads",
      meta: { business_name: business, source: "marketing" },
    });

    revalidatePath("/super-admin/marketing");
    revalidatePath("/super-admin/leads");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not add the hostel" };
  }
}
