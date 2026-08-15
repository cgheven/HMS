"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { getAuthContext } from "@/lib/data";
import { processInBatches } from "@/lib/batch";
import { normalizePhoneDigits } from "@/lib/phone";
import { generateReferralCode, isReferralStale } from "@/lib/referrals";
import { linkReferralForNewTenant } from "@/lib/referral-attribution";
import type {
  Profile,
  ReferralDuplicateRow,
  ReferralOverview,
  ReferralRow,
  ReferralStatus,
  ReferrerRow,
} from "@/types";

// hms_referral_codes and hms_referrals have RLS on with ZERO policies and no
// grants to anon/authenticated (migration 173). Every statement in this file
// therefore runs on createAdminClient() — a session client gets "permission
// denied" on the very first select.

type AdminClient = ReturnType<typeof createAdminClient>;

const NOT_ENABLED =
  "Referrals aren't enabled for this branch yet. Contact support to have this feature turned on.";

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

/**
 * The branch is always re-derived from the caller's own cookie + ownership,
 * never from an argument, so a forged hostel_id in a request body reaches
 * nothing. Returns the entitlement alongside it because every action here is
 * gated on it, and the caller's other branches because attribution is scoped
 * per OWNER by the database (a person referred at branch A can join branch B).
 */
/** The column is CHECK-constrained 0-100, but this number is rendered to the
 *  public as a promise, so it is clamped on the way out too rather than trusted. */
function clampPercent(v: unknown): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

async function resolveBranch(): Promise<{
  hostelId: string;
  hostelName: string;
  enabled: boolean;
  ownerHostels: { id: string; name: string }[];
  referrerPercent: number;
  referredPercent: number;
  profile: Profile;
  admin: AdminClient;
}> {
  const profile = await requireOwnerOrAbove();
  const ctx = await getAuthContext();
  const hostelId = await resolveHostelId();
  const admin = createAdminClient();

  const { data: hostel, error } = await admin
    .from("hms_hostels")
    .select("id, name, referral_enabled, referral_referrer_percent, referral_referred_percent")
    .eq("id", hostelId)
    .single();
  if (error) throw error;

  return {
    hostelId,
    hostelName: hostel?.name ?? "",
    enabled: hostel?.referral_enabled === true,
    referrerPercent: clampPercent(hostel?.referral_referrer_percent),
    referredPercent: clampPercent(hostel?.referral_referred_percent),
    ownerHostels: (ctx?.hostels ?? []).map((h) => ({ id: h.id, name: h.name })),
    profile,
    admin,
  };
}

async function requireEnabledBranch() {
  const branch = await resolveBranch();
  if (!branch.enabled) throw new Error(NOT_ENABLED);
  return branch;
}

type BranchTenant = { id: string; full_name: string; is_active: boolean; is_waiting: boolean };

async function requireBranchTenant(
  admin: AdminClient,
  hostelId: string,
  tenantId: string
): Promise<BranchTenant> {
  const { data: tenant } = await admin
    .from("hms_tenants")
    .select("id, full_name, is_active, is_waiting")
    .eq("id", tenantId)
    .eq("hostel_id", hostelId)
    .maybeSingle();
  if (!tenant) throw new Error("Tenant not found");
  return tenant as BranchTenant;
}

/**
 * "Active" here is the house definition — is_active AND NOT is_waiting. The two
 * flags are not redundant: a waiting-list row carries is_active = true while
 * the person has never moved in, and handing them a live referral link is both
 * wrong and visibly out of step with the Tenants page's own active count.
 */
function isResident(t: { is_active: boolean; is_waiting: boolean }): boolean {
  return t.is_active && !t.is_waiting;
}

/**
 * Insert a code, tolerating both unique violations the table can raise: the
 * global one on lower(code) (two random draws collided) and the partial one on
 * tenant_id (a second click, or a second tab, got there first). Only the
 * second has an answer already in the table, which is why the retry re-reads
 * before drawing again.
 */
async function mintCode(admin: AdminClient, hostelId: string, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { error } = await admin
      .from("hms_referral_codes")
      .insert({ tenant_id: tenantId, hostel_id: hostelId, code });
    if (!error) return code;
    if (error.code !== "23505") throw error;

    const { data: existing } = await admin
      .from("hms_referral_codes")
      .select("code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (existing?.code) return existing.code;
  }
  throw new Error("Could not create a referral link. Please try again.");
}

// ── getReferralOverview ───────────────────────────────────────────────────────

/**
 * Everything the Marketing page renders. READ ONLY.
 *
 * Attribution is derived HERE and not during tenant creation — that is the
 * whole design. Admitting a tenant runs no new code for any client, so this
 * feature cannot break the four admission paths no matter what it does wrong.
 *
 * A phone match now persists as 'joined' with no click. The earlier design made
 * the owner confirm each one, which bought less than it appeared to: the attack
 * it guarded against — submitting numbers hoping one later walks in — is already
 * dead, because a referrer is capped at 25 pending rows that expire in 14 days
 * against a branch admitting a handful of people a month.
 *
 * The risk that survives is a tenant pre-submitting the number of someone they
 * know is joining anyway, and no owner could judge that at confirmation time
 * either. It is caught by seeing both names afterwards, which is why Reject
 * stays. matched_at is stamped with the tenant's real admission date, never the
 * moment somebody happened to open this page.
 *
 * The write is guarded by .eq("status","pending"): idempotent across reloads,
 * safe under two concurrent page loads, and unable to resurrect a referral the
 * owner already rejected.
 *
 * Returns `enabled: false` rather than throwing when the branch has no
 * entitlement: the page has an explanatory empty state for that, and an
 * exception there would render a broken page instead.
 */
export async function getReferralOverview(): Promise<{
  data?: ReferralOverview;
  error?: string;
}> {
  try {
    const { hostelId, hostelName, enabled, ownerHostels, admin, referrerPercent, referredPercent } =
      await resolveBranch();

    if (!enabled) {
      return {
        data: {
          hostelId,
          hostelName,
          enabled: false,
          referrerPercent,
          referredPercent,
          referrers: [],
          referrals: [],
          duplicateClaims: [],
        },
      };
    }

    const otherHostels = ownerHostels.filter((h) => h.id !== hostelId);
    const otherHostelIds = otherHostels.map((h) => h.id);

    type OtherTenantRow = {
      id: string;
      full_name: string;
      phone: string | null;
      created_at: string;
      hostel_id: string;
    };

    const [tenantsRes, codesRes, referralsRes, otherTenantsRes, duplicatesRes] = await Promise.all([
      admin
        .from("hms_tenants")
        .select(
          "id, full_name, phone, is_active, is_waiting, created_at, room:hms_rooms(room_number)"
        )
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: false }),
      admin
        .from("hms_referral_codes")
        .select("tenant_id, code")
        .eq("hostel_id", hostelId)
        .eq("is_active", true),
      admin
        .from("hms_referrals")
        .select(
          "id, name, phone, phone_digits, status, created_at, referrer_tenant_id, matched_tenant_id, matched_at, rejected_at, rejected_by"
        )
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: false }),
      // The pending-uniqueness rule is per OWNER, so a submission made through a
      // branch-A link is legitimately answered by an admission at branch B.
      // Candidates are drawn account-wide; the display stays branch-scoped.
      otherHostelIds.length > 0
        ? admin
            .from("hms_tenants")
            .select("id, full_name, phone, created_at, hostel_id")
            .in("hostel_id", otherHostelIds)
            .eq("is_active", true)
            .eq("is_waiting", false)
        : Promise.resolve({ data: [] as OtherTenantRow[], error: null }),
      admin
        .from("hms_referral_duplicate_claims")
        .select("id, name, phone, created_at, referrer_tenant_id")
        .eq("hostel_id", hostelId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (tenantsRes.error) throw tenantsRes.error;
    if (codesRes.error) throw codesRes.error;
    if (referralsRes.error) throw referralsRes.error;
    if (otherTenantsRes.error) throw otherTenantsRes.error;

    type TenantRow = {
      id: string;
      full_name: string;
      phone: string | null;
      is_active: boolean;
      is_waiting: boolean;
      created_at: string;
      room: { room_number: string } | { room_number: string }[] | null;
    };
    const tenants = (tenantsRes.data ?? []) as unknown as TenantRow[];
    const otherTenants = (otherTenantsRes.data ?? []) as unknown as OtherTenantRow[];

    type ReferralDbRow = {
      id: string;
      name: string;
      phone: string;
      phone_digits: string;
      status: ReferralStatus;
      created_at: string;
      referrer_tenant_id: string;
      matched_tenant_id: string | null;
      matched_at: string | null;
      rejected_at: string | null;
      rejected_by: string | null;
    };
    const referrals = (referralsRes.data ?? []) as ReferralDbRow[];

    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const codeByTenant = new Map((codesRes.data ?? []).map((c) => [c.tenant_id, c.code]));
    const branchNameById = new Map(otherHostels.map((h) => [h.id, h.name]));

    type Candidate = {
      id: string;
      name: string;
      phone: string | null;
      createdAt: string;
      /** Null when the candidate is at the branch being viewed. */
      branchName: string | null;
    };
    const candidates: Candidate[] = [
      ...tenants.filter(isResident).map((t) => ({
        id: t.id,
        name: t.full_name,
        phone: t.phone,
        createdAt: t.created_at,
        branchName: null,
      })),
      ...otherTenants.map((t) => ({
        id: t.id,
        name: t.full_name,
        phone: t.phone,
        createdAt: t.created_at,
        branchName: branchNameById.get(t.hostel_id) ?? null,
      })),
    ];
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    // Oldest admission first, so a submission resolves to the FIRST person
    // admitted on that number after it arrived rather than to whichever
    // relative moved in most recently — Pakistani households genuinely share
    // one number across several residents.
    const candidatesByPhone = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const digits = normalizePhoneDigits(c.phone);
      if (!digits) continue;
      const bucket = candidatesByPhone.get(digits);
      if (bucket) bucket.push(c);
      else candidatesByPhone.set(digits, [c]);
    }
    for (const bucket of candidatesByPhone.values()) {
      bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    // A tenant already on the roll when the submission arrived was not brought
    // in by it — matching those would turn "refer yourself" into a live
    // attribution, and would credit anyone whose number a resident happens to
    // know.


    // One extra round trip, and only when there is something to name.
    const rejectedByIds = Array.from(
      new Set(referrals.map((r) => r.rejected_by).filter((id): id is string => !!id))
    );
    let rejecterNames = new Map<string, string>();
    if (rejectedByIds.length > 0) {
      const { data: profiles } = await admin
        .from("hms_profiles")
        .select("id, full_name")
        .in("id", rejectedByIds);
      rejecterNames = new Map(
        (profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? "—"])
      );
    }

    const referralRows: ReferralRow[] = referrals.map((r) => {
      // These rows were read BEFORE the auto-link above ran, so a freshly linked
      // referral would otherwise render as pending until the next load.
      const matched = r.matched_tenant_id ? candidateById.get(r.matched_tenant_id) ?? null : null;
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        // Derived, never persisted: a write here would put an unattended update
        // back on a path driven by anonymous submissions, which is the exact
        // shape of the attribution bug the security review removed.
        status: isReferralStale(r.status, r.created_at) ? "expired" : r.status,
        createdAt: r.created_at,
        referrerTenantId: r.referrer_tenant_id,
        referrerName: tenantById.get(r.referrer_tenant_id)?.full_name ?? null,
        matchedTenantName:
          matched?.name ?? (r.matched_tenant_id ? tenantById.get(r.matched_tenant_id)?.full_name ?? null : null),
        matchedAt: r.matched_at,
        rejectedAt: r.rejected_at,
        rejectedByName: r.rejected_by ? rejecterNames.get(r.rejected_by) ?? null : null,
      };
    });

    const countsByReferrer = new Map<string, { pending: number; joined: number }>();
    for (const row of referralRows) {
      const counts = countsByReferrer.get(row.referrerTenantId) ?? { pending: 0, joined: 0 };
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "joined") counts.joined += 1;
      countsByReferrer.set(row.referrerTenantId, counts);
    }

    const referrers: ReferrerRow[] = tenants
      .filter(isResident)
      .map((t) => {
        const room = Array.isArray(t.room) ? t.room[0] : t.room;
        const counts = countsByReferrer.get(t.id);
        return {
          tenantId: t.id,
          tenantName: t.full_name,
          roomNumber: room?.room_number ?? null,
          code: codeByTenant.get(t.id) ?? null,
          phone: t.phone ?? null,
          pending: counts?.pending ?? 0,
          joined: counts?.joined ?? 0,
        };
      })
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName));

    // Tolerated rather than thrown: hms_referral_duplicate_claims arrives with
    // migration 174, and a Marketing page that 500s because one supporting
    // table is not there yet is worse than one missing a panel.
    if (duplicatesRes.error) {
      console.warn("[getReferralOverview] duplicate claims unavailable:", duplicatesRes.error.code);
    }
    const duplicateClaims: ReferralDuplicateRow[] = (
      (duplicatesRes.error ? [] : duplicatesRes.data ?? []) as {
        id: string;
        name: string;
        phone: string;
        created_at: string;
        referrer_tenant_id: string;
      }[]
    ).map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      createdAt: d.created_at,
      referrerName: tenantById.get(d.referrer_tenant_id)?.full_name ?? null,
    }));


    return {
      data: {
        hostelId,
        hostelName,
        enabled: true,
        referrerPercent,
        referredPercent,
        referrers,
        referrals: referralRows,
        duplicateClaims,
      },
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to load referrals" };
  }
}

// ── Codes ─────────────────────────────────────────────────────────────────────

export async function ensureReferralCode(
  tenantId: string
): Promise<{ code?: string; error?: string }> {
  try {
    const { hostelId, admin } = await requireEnabledBranch();
    const tenant = await requireBranchTenant(admin, hostelId, tenantId);
    if (!isResident(tenant)) {
      throw new Error("Only tenants who have moved in can have a referral link.");
    }

    const { data: existing } = await admin
      .from("hms_referral_codes")
      .select("code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (existing?.code) return { code: existing.code };

    const code = await mintCode(admin, hostelId, tenantId);
    revalidatePath("/marketing");
    return { code };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to create referral link" };
  }
}

export async function ensureCodesForAllActiveTenants(): Promise<{
  created?: number;
  error?: string;
}> {
  try {
    const { hostelId, admin } = await requireEnabledBranch();

    const [tenantsRes, codesRes] = await Promise.all([
      admin
        .from("hms_tenants")
        .select("id")
        .eq("hostel_id", hostelId)
        .eq("is_active", true)
        .eq("is_waiting", false),
      admin
        .from("hms_referral_codes")
        .select("tenant_id")
        .eq("hostel_id", hostelId)
        .eq("is_active", true),
    ]);
    if (tenantsRes.error) throw tenantsRes.error;
    if (codesRes.error) throw codesRes.error;

    const withCode = new Set((codesRes.data ?? []).map((c) => c.tenant_id));
    const missing = (tenantsRes.data ?? []).map((t) => t.id).filter((id) => !withCode.has(id));

    let created = 0;
    await processInBatches(missing, 20, async (tenantId) => {
      await mintCode(admin, hostelId, tenantId);
      created += 1;
    });

    revalidatePath("/marketing");
    return { created };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to create referral links" };
  }
}

/**
 * Deactivates rather than deletes: submissions already made against the old
 * code keep pointing at a row that still exists, so the history stays readable
 * after a link has been abused and replaced.
 */
export async function rotateReferralCode(
  tenantId: string
): Promise<{ code?: string; error?: string }> {
  try {
    const { hostelId, admin, profile } = await requireEnabledBranch();
    const tenant = await requireBranchTenant(admin, hostelId, tenantId);
    if (!isResident(tenant)) {
      throw new Error("Only tenants who have moved in can have a referral link.");
    }

    const { error: deactivateErr } = await admin
      .from("hms_referral_codes")
      .update({ is_active: false })
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .eq("is_active", true);
    if (deactivateErr) throw deactivateErr;

    const code = await mintCode(admin, hostelId, tenantId);

    // Rotation kills a URL that is already out in the world; who did it and
    // when is the only way to answer "my link stopped working".
    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral_code.rotate",
      entity: "referral_code",
      entity_id: tenantId,
    });

    revalidatePath("/marketing");
    return { code };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to rotate referral link" };
  }
}

// ── Submissions ───────────────────────────────────────────────────────────────


export async function rejectReferral(referralId: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const { hostelId, admin, profile } = await requireEnabledBranch();

    const { data, error } = await admin
      .from("hms_referrals")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_by: profile.id,
      })
      .eq("id", referralId)
      .eq("hostel_id", hostelId)
      .neq("status", "rejected")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Referral not found");

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral.reject",
      entity: "referral",
      entity_id: referralId,
    });

    revalidatePath("/marketing");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to reject referral" };
  }
}

/**
 * Restores to 'joined' when a match was already recorded, and to 'pending'
 * otherwise. That is not cosmetic: the unique index only covers pending rows,
 * so sending a matched referral back to pending could collide with a genuinely
 * new submission for the same number.
 */
export async function undoRejectReferral(
  referralId: string
): Promise<{ success?: boolean; status?: ReferralStatus; error?: string }> {
  try {
    const { hostelId, admin, profile } = await requireEnabledBranch();

    const { data: row } = await admin
      .from("hms_referrals")
      .select("id, matched_tenant_id")
      .eq("id", referralId)
      .eq("hostel_id", hostelId)
      .eq("status", "rejected")
      .maybeSingle();
    if (!row) throw new Error("Referral not found");

    const restored: ReferralStatus = row.matched_tenant_id ? "joined" : "pending";

    const { error } = await admin
      .from("hms_referrals")
      .update({ status: restored, rejected_at: null, rejected_by: null })
      .eq("id", referralId)
      .eq("hostel_id", hostelId);

    if (error) {
      if (error.code === "23505") {
        throw new Error("This number already has another pending referral. Reject that one first.");
      }
      throw error;
    }

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral.undo_reject",
      entity: "referral",
      entity_id: referralId,
      meta: { restored_status: restored },
    });

    revalidatePath("/marketing");
    // The restored status comes from the DB's own matched_tenant_id, so the
    // caller never has to guess it from a name that may not have resolved.
    return { success: true, status: restored };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to restore referral" };
  }
}

// ── updateReferralPercentages ─────────────────────────────────────────────────

/**
 * The discount is the OWNER's money, so unlike referral_enabled this is theirs
 * to set — there is deliberately no self-grant trigger on these two columns.
 *
 * referredPercent is what the public /ref page promises a stranger, so the two
 * are written together: a page advertising a number the owner has since changed
 * is a promise nobody agreed to honour.
 */
export async function updateReferralPercentages(
  referrerPercent: number,
  referredPercent: number
): Promise<{ error?: string }> {
  try {
    const { hostelId, admin, profile } = await requireEnabledBranch();

    const nextReferrer = clampPercent(referrerPercent);
    const nextReferred = clampPercent(referredPercent);

    const { error } = await admin
      .from("hms_hostels")
      .update({
        referral_referrer_percent: nextReferrer,
        referral_referred_percent: nextReferred,
        updated_at: new Date().toISOString(),
      })
      .eq("id", hostelId);
    if (error) throw error;

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral_percentages.update",
      entity: "hostel",
      entity_id: hostelId,
      meta: { referrer_percent: nextReferrer, referred_percent: nextReferred },
    });

    revalidatePath("/marketing");
    return {};
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not save the percentages" };
  }
}

// ── attributeReferralForTenant ────────────────────────────────────────────────

/**
 * The owner's own Add Tenant path inserts hms_tenants DIRECTLY FROM THE BROWSER
 * (components/modules/tenants/tenants-client.tsx), so it cannot call the
 * server-only attribution helper the three server-side admission paths use.
 * This is that hook, and nothing more.
 *
 * Takes only a tenant id: the phone, branch and check-in are re-read server-side
 * from the row itself, so a caller cannot claim an attribution for a number or a
 * branch that is not actually on the tenant.
 *
 * Returns void and never throws — the dialog calls it without awaiting, exactly
 * as it already does for the welcome WhatsApp, so attribution can never delay or
 * fail an admission.
 */
export async function attributeReferralForTenant(tenantId: string): Promise<void> {
  try {
    const { hostelId, admin } = await resolveBranch();

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("id, phone, check_in, hostel_id")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    if (!tenant) return;

    await linkReferralForNewTenant(admin, {
      tenantId: tenant.id as string,
      hostelId: tenant.hostel_id as string,
      phone: tenant.phone as string | null,
      checkIn: tenant.check_in as string | null,
    });
  } catch {
    // Fail-open by construction: the tenant already exists.
  }
}
