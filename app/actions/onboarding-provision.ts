"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { sendClientCredentialsEmail } from "@/lib/email";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, clientProvisionedParams } from "@/lib/whatsapp-templates";
import { EMPTY_ONBOARDING_CONFIG } from "@/types";
import type {
  OnboardingBranchConfig, OnboardingData, PartnerTier,
} from "@/types";

// Turns a submitted intake into a live account in one call.
//
// createHostelForClient() (the pre-existing manual path) writes only
// hms_hostels + hms_owner_hostels, so hostels created through it have no
// hms_package_configs row and the first AC bill throws "AC per-unit rate is not
// configured". This path writes the config too, which is the whole point of
// collecting it — a provisioned hostel is ready to bill on day one.

const VALID_TIERS = new Set<PartnerTier>(["read_only", "standard", "full"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function num(v: string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function genPassword(): string {
  return `Pulse${randomBytes(12).toString("base64url")}!`;
}

/** Shared config with this branch's overrides layered on top. */
function configFor(data: OnboardingData, idx: number): OnboardingBranchConfig {
  return {
    ...EMPTY_ONBOARDING_CONFIG,
    ...data.config,
    ...(data.branches[idx]?.overrides ?? {}),
  };
}

export interface ProvisionResult {
  ownerEmail?: string;
  ownerPassword?: string;
  hostelIds?: string[];
  partnerCredentials?: { name: string; email: string; password: string | null }[];
  /** False when the credentials email failed — the Super Admin must then share
   *  the password by hand, and no WhatsApp went out claiming otherwise. */
  credentialsEmailed?: boolean;
  emailError?: string;
  error?: string;
}

export async function provisionOnboarding(submissionId: string): Promise<ProvisionResult> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { data: row, error: loadErr } = await admin
      .from("hms_onboarding_submissions")
      .select("id, status, data, lead_id")
      .eq("id", submissionId)
      .single();

    if (loadErr || !row) throw new Error("Submission not found");
    if (row.status === "provisioned") throw new Error("This submission has already been provisioned.");
    if (row.status !== "submitted") throw new Error("This submission is not ready to provision yet.");

    const data = row.data as OnboardingData;
    const ownerEmail = data.owner?.email?.trim().toLowerCase() ?? "";
    const ownerName = data.owner?.name?.trim() ?? "";

    if (!EMAIL_RE.test(ownerEmail)) throw new Error("Submission has no valid owner email.");
    if (!data.branches?.length) throw new Error("Submission has no branches.");
    if (data.branches.some((b) => !b.name?.trim())) throw new Error("Every branch must have a name.");

    // 1. Owner auth user. An existing email is a hard stop rather than a silent
    //    reuse — provisioning twice onto a real account would be destructive.
    const { data: existingProfile } = await admin
      .from("hms_profiles").select("id").eq("email", ownerEmail).maybeSingle();
    if (existingProfile) {
      throw new Error(`An account already exists for ${ownerEmail}. Resolve the duplicate before provisioning.`);
    }

    const ownerPassword = genPassword();
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: ownerName, phone: data.owner?.phone?.trim() || null },
    });
    if (authErr) throw authErr;
    const ownerId = created.user.id;

    await admin.from("hms_profiles").upsert(
      {
        id: ownerId,
        email: ownerEmail,
        full_name: ownerName || null,
        phone: data.owner?.phone?.trim() || null,
        role: "owner",
        is_active: true,
      },
      { onConflict: "id" }
    );

    // hms_handle_new_profile still auto-creates a starter "My Hostel" for
    // role='owner' (migration 095 narrowed it to owners only). Clear it before
    // inserting the real branches. Child rows first, for the FK.
    await admin.from("hms_owner_hostels").delete().eq("owner_id", ownerId);
    await admin.from("hms_hostels").delete().eq("owner_id", ownerId);

    // 2. Branches + their package configs.
    const hostelIds: string[] = [];
    for (let i = 0; i < data.branches.length; i++) {
      const b = data.branches[i];
      const cfg = configFor(data, i);

      const { data: hostel, error: hostelErr } = await admin
        .from("hms_hostels")
        .insert({
          owner_id: ownerId,
          name: b.name.trim(),
          city: b.city?.trim() || null,
          area: b.area?.trim() || null,
          address: b.address?.trim() || null,
          phone: b.phone?.trim() || null,
          whatsapp: b.phone?.trim() || null,
          email: ownerEmail,
          total_capacity: num(b.total_capacity),
          hostel_type: cfg.hostel_type,
          amenities: cfg.amenities ?? [],
          food_closed_on_sundays: !!cfg.food_closed_on_sundays,
          payment_methods: cfg.payment_methods ?? [],
          listing_enabled: true,
        })
        .select("id")
        .single();
      if (hostelErr) throw new Error(`Branch "${b.name}": ${hostelErr.message}`);

      const hostelId = (hostel as { id: string }).id;
      hostelIds.push(hostelId);

      await admin.from("hms_owner_hostels").insert({
        owner_id: ownerId, hostel_id: hostelId, is_primary: i === 0,
      });

      // The row createHostelForClient never writes.
      const { error: cfgErr } = await admin.from("hms_package_configs").upsert(
        {
          hostel_id: hostelId,
          ac_per_unit_rate: num(cfg.ac_per_unit_rate),
          security_deposit: num(cfg.security_deposit),
          notice_period_days: num(cfg.notice_period_days, 30),
          food_breakfast_rate: num(cfg.food_breakfast_rate),
          food_lunch_rate: num(cfg.food_lunch_rate),
          food_dinner_rate: num(cfg.food_dinner_rate),
          food_all_meals_rate: num(cfg.food_all_meals_rate),
          seater_prices: cfg.seater_prices ?? {},
        },
        { onConflict: "hostel_id" }
      );
      if (cfgErr) throw new Error(`Pricing for "${b.name}": ${cfgErr.message}`);
    }

    // 3. Partners. Non-fatal individually — the account is already usable, and a
    //    partner that fails is easier to add by hand than to unwind everything.
    const partnerCredentials: ProvisionResult["partnerCredentials"] = [];
    for (const p of data.partners ?? []) {
      const email = p.email?.trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) continue;
      const tier: PartnerTier = VALID_TIERS.has(p.tier) ? p.tier : "read_only";

      const targets = p.branchIndexes?.length
        ? p.branchIndexes.filter((i) => i >= 0 && i < hostelIds.length)
        : hostelIds.map((_, i) => i);
      if (targets.length === 0) continue;

      try {
        const { data: existing } = await admin
          .from("hms_profiles").select("id, role").eq("email", email).maybeSingle();

        let partnerId: string;
        let password: string | null = null;

        if (existing) {
          if (existing.role !== "partner") continue; // don't repurpose a real account
          partnerId = existing.id;
        } else {
          password = genPassword();
          const { data: pu, error: puErr } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: p.name?.trim() || null, phone: p.phone?.trim() || null, role: "partner" },
          });
          if (puErr) continue;
          partnerId = pu.user.id;
          await admin.from("hms_profiles").upsert(
            {
              id: partnerId, email, full_name: p.name?.trim() || null,
              phone: p.phone?.trim() || null, is_active: true,
            },
            { onConflict: "id" }
          );
        }

        for (const idx of targets) {
          await admin.from("hms_partnerships").upsert(
            {
              hostel_id: hostelIds[idx], partner_id: partnerId,
              created_by: ownerId, is_active: true, tier,
            },
            { onConflict: "hostel_id,partner_id" }
          );
        }
        partnerCredentials.push({ name: p.name?.trim() || email, email, password });
      } catch {
        // skip this partner; the rest of the account stands
      }
    }

    // 4. Close out the submission and the lead it came from.
    await admin
      .from("hms_onboarding_submissions")
      .update({ status: "provisioned", owner_id: ownerId })
      .eq("id", submissionId);

    if (row.lead_id) {
      await admin
        .from("hms_platform_leads")
        .update({ status: "converted", converted_hostel_id: hostelIds[0] })
        .eq("id", row.lead_id);
    }

    // requireSuperAdmin returns hms_profiles, which carries no email column —
    // read it off the session user for the audit trail.
    const { data: { user: actor } } = await (await createClient()).auth.getUser();

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: actor?.email ?? "",
      action: "super_admin.provision_onboarding",
      entity: "hostel",
      entity_id: hostelIds[0],
      meta: {
        submission_id: submissionId,
        owner_email: ownerEmail,
        branch_count: hostelIds.length,
        partner_count: partnerCredentials.length,
      },
    });

    // Credentials by EMAIL only. The password never goes over WhatsApp: Meta
    // rejects credential delivery as a utility template, and a WhatsApp message
    // persists in chat history, cloud backups and lock-screen previews. Email is
    // the account the password is for, so it introduces no new reader.
    //
    // Non-fatal: the account and branches already exist by this point, and the
    // Super Admin still sees the password on screen to share by hand. Failing
    // the whole provisioning over an email would be worse than reporting it.
    let credentialsEmailed = false;
    let emailError: string | undefined;
    try {
      const { data: firstHostel } = await admin
        .from("hms_hostels").select("name").eq("id", hostelIds[0]).maybeSingle();
      await sendClientCredentialsEmail({
        clientName: ownerName,
        businessName: firstHostel?.name ?? "your hostel",
        email: ownerEmail,
        password: ownerPassword,
      });
      credentialsEmailed = true;

      // Only NOW may the WhatsApp go out — its approved body states "we have
      // emailed the details", which would be a lie if the email had failed.
      const digits = (data.owner?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
      if (digits.length >= 11) {
        await sendWhatsAppTemplateMessage(
          digits,
          TEMPLATES.clientProvisioned.name,
          TEMPLATES.clientProvisioned.language,
          clientProvisionedParams({
            clientName: ownerName,
            businessName: firstHostel?.name,
            email: ownerEmail,
          }),
          { hostelId: hostelIds[0], tenantId: null, ownerId, messageType: "welcome" }
        );
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : "Could not email credentials";
      console.error("[onboarding-provision] credential delivery failed:", emailError);
    }

    revalidatePath("/super-admin/onboarding");
    return { ownerEmail, ownerPassword, hostelIds, partnerCredentials, credentialsEmailed, emailError };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not provision this account." };
  }
}

export interface SubmissionRow {
  id: string;
  status: string;
  token: string;
  created_at: string;
  submitted_at: string | null;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  branchCount: number;
  branchNames: string[];
  partnerCount: number;
  data: OnboardingData;
}

export async function listOnboardingSubmissions(): Promise<{
  submissions?: SubmissionRow[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_onboarding_submissions")
      .select("id, status, token, created_at, submitted_at, data")
      .neq("status", "abandoned")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    const submissions: SubmissionRow[] = (data ?? []).map((r) => {
      const d = (r.data ?? {}) as OnboardingData;
      return {
        id: r.id,
        status: r.status,
        token: r.token,
        created_at: r.created_at,
        submitted_at: r.submitted_at,
        ownerName: d.owner?.name ?? "",
        ownerEmail: d.owner?.email ?? "",
        ownerPhone: d.owner?.phone ?? "",
        branchCount: d.branches?.length ?? 0,
        branchNames: (d.branches ?? []).map((b) => b.name).filter(Boolean),
        partnerCount: d.partners?.length ?? 0,
        data: d,
      };
    });

    return { submissions };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not load submissions." };
  }
}
