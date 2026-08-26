"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { normalizePhoneDigits } from "@/lib/phone";
import { parseLeadList, cleanHostelName, normalizeCity, isPkMobile } from "@/lib/lead-list-import";
import { fetchAllPages, chunk } from "@/lib/supabase/fetch-all";
import type { CampaignResponse, LeadList } from "@/types";

async function requireSuperAdmin() {
  const profile = await getProfile();
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return profile;
}

/** Supabase caps a single insert payload well below the size of a scraped
 *  list, and one failed 300-row statement loses the whole import. */
const INSERT_CHUNK = 200;

const RESPONSES: CampaignResponse[] = [
  "replied", "interested", "not_interested", "wrong_number", "converted",
];

export async function listLeadLists(): Promise<{ lists: LeadList[]; error?: string }> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [{ data: lists, error }, members, sends] = await Promise.all([
      admin.from("hms_lead_lists").select("id, name, notes, created_at").order("created_at", { ascending: false }),
      // Counted here rather than stored on the list: a denormalised count is one
      // missed webhook away from disagreeing with the table underneath it.
      fetchAllPages<{ id: string; list_id: string }>((from, to) =>
        admin
          .from("hms_platform_leads")
          .select("id, list_id")
          .not("list_id", "is", null)
          .is("archived_at", null)
          .order("id")
          .range(from, to)
      ),
      // Read whole and intersected in memory rather than filtered by .in() on
      // the contact ids. That list is one id per imported hostel, and PostgREST
      // puts .in() values in the URL — 397 of them is already past what the
      // gateway accepts, which would have broken this page (and so the whole
      // Marketing route) on the second import.
      fetchAllPages<{ lead_id: string }>((from, to) =>
        admin
          .from("hms_lead_campaign_sends")
          .select("lead_id")
          .neq("status", "failed")
          .order("lead_id")
          .range(from, to)
      ),
    ]);
    if (error) throw error;
    if (members.error) throw new Error(members.error);
    if (sends.error) throw new Error(sends.error);

    const messaged = new Set(sends.data.map((s) => s.lead_id));
    const total = new Map<string, number>();
    const sent = new Map<string, number>();
    for (const m of members.data) {
      total.set(m.list_id, (total.get(m.list_id) ?? 0) + 1);
      if (messaged.has(m.id)) sent.set(m.list_id, (sent.get(m.list_id) ?? 0) + 1);
    }

    return {
      lists: (lists ?? []).map((l) => ({
        id: l.id as string,
        name: l.name as string,
        notes: (l.notes as string | null) ?? null,
        created_at: l.created_at as string,
        contact_count: total.get(l.id as string) ?? 0,
        messaged_count: sent.get(l.id as string) ?? 0,
      })),
    };
  } catch (err) {
    unstable_rethrow(err);
    return { lists: [], error: err instanceof Error ? err.message : "Could not load lists" };
  }
}

/**
 * Every canonical number already known to us — CRM leads and every other list.
 *
 * The preview asks for this before parsing so "already on a list" is decided
 * against the whole database, not just against the file. One shared table only
 * buys cross-list dedupe if something actually looks across it.
 *
 * Paged, because a truncated read here fails silently in the worst possible
 * direction: numbers past row 1000 look unknown, the preview reports them as
 * fresh, and the import creates a second copy of a hostel that is already on a
 * list — which is how one owner gets two identical WhatsApp messages minutes
 * apart from the number every tenant's rent reminder uses.
 */
async function knownDigits(admin: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const { data, error } = await fetchAllPages<{ id: string; phone: string }>((from, to) =>
    admin.from("hms_platform_leads").select("id, phone").order("id").range(from, to)
  );
  if (error) throw new Error(error);
  const out = new Set<string>();
  for (const r of data) {
    const d = normalizePhoneDigits(r.phone);
    if (d) out.add(d);
  }
  return out;
}

export async function existingLeadDigits(): Promise<{ digits: string[]; error?: string }> {
  try {
    await requireSuperAdmin();
    return { digits: [...(await knownDigits(createAdminClient()))] };
  } catch (err) {
    unstable_rethrow(err);
    return { digits: [], error: err instanceof Error ? err.message : "Could not load numbers" };
  }
}

/**
 * Commit an imported list.
 *
 * Re-parses the raw rows server-side rather than trusting the preview's output:
 * the preview runs in the browser, and what it hands back is user input like
 * any other. Re-running the same shared parser against a freshly-read set of
 * existing numbers also closes the window where a second import lands between
 * preview and commit.
 */
export async function importLeadList(input: {
  name: string;
  notes?: string;
  rows: Record<string, unknown>[];
}): Promise<{ list_id?: string; imported?: number; skipped?: number; error?: string }> {
  try {
    const profile = await requireSuperAdmin();

    const name = input.name.trim();
    if (name.length < 2) throw new Error("Give the list a name");
    if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error("Nothing to import");
    if (input.rows.length > 20000) throw new Error("That file is too large — split it into smaller lists");

    const admin = createAdminClient();

    const { contacts, dropped } = parseLeadList(input.rows, await knownDigits(admin));
    if (contacts.length === 0) throw new Error("No hostel in that file has a usable mobile number");

    const { data: list, error: listErr } = await admin
      .from("hms_lead_lists")
      .insert({ name, notes: input.notes?.trim() || null, created_by: profile.id })
      .select("id")
      .single();
    if (listErr) throw listErr;

    const listId = list!.id as string;
    const rows = contacts.map((c) => ({
      business_name: c.business_name,
      // NOT NULL in the schema, and a scrape carries no owner. campaignGreeting
      // treats "Unknown" as unusable and falls back to the business name, so
      // the greeting stays coherent.
      owner_name: "Unknown",
      phone: c.phone,
      city: c.city,
      email: c.email,
      status: "new" as const,
      source: "imported_list",
      list_id: listId,
      created_by: profile.id,
    }));

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const { error } = await admin.from("hms_platform_leads").insert(rows.slice(i, i + INSERT_CHUNK));
      if (error) throw error;
    }

    const skipped = Object.values(dropped).reduce((a, b) => a + b, 0);
    await writeAuditLog({
      actor_id: profile.id,
      actor_email: profile.email ?? "",
      action: "lead_list_imported",
      entity: "hms_lead_lists",
      entity_id: listId,
      meta: { name, imported: rows.length, skipped, dropped },
    });

    revalidatePath("/super-admin/marketing");
    return { list_id: listId, imported: rows.length, skipped };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not import the list" };
  }
}

export async function renameLeadList(listId: string, name: string): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error("Give the list a name");
    const admin = createAdminClient();
    const { error } = await admin.from("hms_lead_lists").update({ name: trimmed }).eq("id", listId);
    if (error) throw error;
    await writeAuditLog({
      actor_id: profile.id, actor_email: profile.email ?? "",
      action: "lead_list_renamed", entity: "hms_lead_lists", entity_id: listId,
      meta: { name: trimmed },
    });
    revalidatePath("/super-admin/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not rename the list" };
  }
}

/** Cascades its contacts away — that is what the FK is for, and a list nobody
 *  wants any more should not leave 300 orphan rows behind. Refuses once the
 *  list has been messaged: those rows carry the send ledger that stops the same
 *  numbers being blasted a second time. */
export async function deleteLeadList(listId: string): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    const admin = createAdminClient();

    // The membership read is paged and the ledger check is chunked. A list is
    // hundreds of rows by design, and both a truncated membership read and an
    // over-long .in() would answer "nobody has been messaged" — which is the
    // answer that lets the delete through and destroys the send record.
    const [{ data: list }, members] = await Promise.all([
      admin.from("hms_lead_lists").select("name").eq("id", listId).maybeSingle(),
      fetchAllPages<{ id: string }>((from, to) =>
        admin.from("hms_platform_leads").select("id").eq("list_id", listId).order("id").range(from, to)
      ),
    ]);
    if (!list) throw new Error("That list no longer exists");
    if (members.error) throw new Error(members.error);

    const ids = members.data.map((m) => m.id);
    let messaged = 0;
    for (const batch of chunk(ids)) {
      const { count, error } = await admin
        .from("hms_lead_campaign_sends")
        .select("lead_id", { count: "exact", head: true })
        .neq("status", "failed")
        .in("lead_id", batch);
      if (error) throw error;
      messaged += count ?? 0;
    }
    if (messaged > 0) {
      throw new Error(
        `${messaged} hostel${messaged === 1 ? " on" : "s on"} this list ${messaged === 1 ? "has" : "have"} already been messaged. Deleting it would lose the record that stops them being messaged again — remove those entries individually instead.`
      );
    }

    const { error } = await admin.from("hms_lead_lists").delete().eq("id", listId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id, actor_email: profile.email ?? "",
      action: "lead_list_deleted", entity: "hms_lead_lists", entity_id: listId,
      meta: { name: list.name, contacts: ids.length },
    });
    revalidatePath("/super-admin/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not delete the list" };
  }
}

export async function updateLeadListEntry(input: {
  lead_id: string;
  business_name: string;
  phone: string;
  city: string;
  email: string;
  campaign_response: CampaignResponse | null;
}): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    const admin = createAdminClient();

    const { data: lead } = await admin
      .from("hms_platform_leads")
      .select("id, list_id, phone")
      .eq("id", input.lead_id)
      .maybeSingle();
    if (!lead) throw new Error("That entry no longer exists");
    // The CRM has its own editor, with a pipeline, a rep and an activity log
    // this form knows nothing about. Editing a sales lead through here would
    // silently blank none of it, but it is still the wrong door.
    if (!lead.list_id) throw new Error("This is a CRM lead — edit it on the Leads page");

    const business_name = cleanHostelName(input.business_name);
    if (business_name.length < 2) throw new Error("Hostel name is required");

    const digits = normalizePhoneDigits(input.phone);
    if (!digits) throw new Error("That does not look like a valid Pakistani number");
    if (!isPkMobile(digits)) throw new Error("That is a landline — WhatsApp needs a mobile number");

    if (digits !== normalizePhoneDigits(lead.phone as string)) {
      // Paged: a truncated read reports "no clash" for every number past row
      // 1000, which is the answer that lets the duplicate through.
      const { data: all, error: allErr } = await fetchAllPages<
        { id: string; business_name: string; phone: string }
      >((from, to) =>
        admin.from("hms_platform_leads").select("id, business_name, phone").order("id").range(from, to)
      );
      if (allErr) throw new Error(allErr);
      const clash = all.find(
        (l) => l.id !== input.lead_id && normalizePhoneDigits(l.phone) === digits
      );
      if (clash) throw new Error(`That number is already on the list as "${clash.business_name}"`);
    }

    const response = input.campaign_response;
    if (response !== null && !RESPONSES.includes(response)) throw new Error("Unknown response");

    const email = input.email.trim().toLowerCase();
    const { error } = await admin
      .from("hms_platform_leads")
      .update({
        business_name,
        phone: input.phone.trim(),
        city: normalizeCity(input.city),
        email: email.includes("@") ? email : null,
        campaign_response: response,
      })
      .eq("id", input.lead_id);
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id, actor_email: profile.email ?? "",
      action: "lead_list_entry_updated", entity: "hms_platform_leads", entity_id: input.lead_id,
      meta: { business_name, campaign_response: response },
    });
    revalidatePath("/super-admin/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not save the entry" };
  }
}

/** The one-click version of the field above — the whole point of the Response
 *  column is that logging a reply should not need a dialog. */
export async function setCampaignResponse(
  leadId: string,
  response: CampaignResponse | null
): Promise<{ error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    if (response !== null && !RESPONSES.includes(response)) throw new Error("Unknown response");
    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_platform_leads")
      .update({ campaign_response: response })
      .eq("id", leadId);
    if (error) throw error;
    await writeAuditLog({
      actor_id: profile.id, actor_email: profile.email ?? "",
      action: "campaign_response_set", entity: "hms_platform_leads", entity_id: leadId,
      meta: { campaign_response: response },
    });
    revalidatePath("/super-admin/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not save the response" };
  }
}

/**
 * Remove one entry.
 *
 * Hard delete only for a contact nobody has messaged. Once a campaign has gone
 * out, deleting the row cascades hms_lead_campaign_sends with it and nulls the
 * message log's lead_id — the permanent "already sent" guard disappears and the
 * same number becomes blastable tomorrow. Those are archived instead: gone from
 * every list and every audience, still holding their place in the ledger.
 */
export async function deleteLeadListEntry(leadId: string): Promise<{ archived?: boolean; error?: string }> {
  try {
    const profile = await requireSuperAdmin();
    const admin = createAdminClient();

    const { data: lead } = await admin
      .from("hms_platform_leads")
      .select("id, list_id, business_name")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) throw new Error("That entry no longer exists");
    if (!lead.list_id) throw new Error("This is a CRM lead — delete it on the Leads page");

    const { count } = await admin
      .from("hms_lead_campaign_sends")
      .select("lead_id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .neq("status", "failed");

    const archived = (count ?? 0) > 0;
    const { error } = archived
      ? await admin.from("hms_platform_leads").update({ archived_at: new Date().toISOString() }).eq("id", leadId)
      : await admin.from("hms_platform_leads").delete().eq("id", leadId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: profile.id, actor_email: profile.email ?? "",
      action: archived ? "lead_list_entry_archived" : "lead_list_entry_deleted",
      entity: "hms_platform_leads", entity_id: leadId,
      meta: { business_name: lead.business_name },
    });
    revalidatePath("/super-admin/marketing");
    return { archived };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not remove the entry" };
  }
}
