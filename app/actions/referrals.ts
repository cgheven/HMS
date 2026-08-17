"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove, requireOwnerOrPartnerTier } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { getAuthContext } from "@/lib/data";
import { processInBatches } from "@/lib/batch";
import { normalizePhoneDigits } from "@/lib/phone";
import { pktTodayDateString, pktYearMonth } from "@/lib/pkt-time";
import {
  generateReferralCode,
  isReferralStale,
  REFERRAL_PENDING_TTL_DAYS,
} from "@/lib/referrals";
import { linkReferralForNewTenant } from "@/lib/referral-attribution";
import {
  detachReferralRewards,
  grantReferralRewards,
  voidReferralRewardsForReferral,
  voidReferralRewardsForTenant,
} from "@/lib/referral-rewards";
import type {
  Profile,
  ReferralDuplicateRow,
  ReferralOverview,
  ReferralRewardRole,
  ReferralRewardRow,
  ReferralRewardStatus,
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
  /** hms_hostels.owner_id, NOT the caller's id — referral scope is the owner's,
   *  and a partner acting on the branch must resolve to the owner who pays. */
  ownerId: string | null;
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
    .select(
      "id, name, owner_id, referral_enabled, referral_referrer_percent, referral_referred_percent"
    )
    .eq("id", hostelId)
    .single();
  if (error) throw error;

  return {
    hostelId,
    hostelName: hostel?.name ?? "",
    ownerId: (hostel?.owner_id as string | null) ?? null,
    enabled: hostel?.referral_enabled === true,
    referrerPercent: clampPercent(hostel?.referral_referrer_percent),
    referredPercent: clampPercent(hostel?.referral_referred_percent),
    ownerHostels: (ctx?.hostels ?? []).map((h) => ({ id: h.id, name: h.name })),
    profile,
    admin,
  };
}

/**
 * Every branch the caller may legitimately see, active one first.
 *
 * Rewards are read and written OWNER-WIDE: a link shared at branch A is
 * legitimately answered by an admission at branch B, and the owner must be able
 * to see and undo that from wherever they are standing. Scoping by these ids
 * rather than by hms_referral_rewards.owner_id keeps a partner confined to the
 * branches their partnership actually grants them.
 */
function rewardScopeIds(branch: {
  hostelId: string;
  ownerHostels: { id: string }[];
}): string[] {
  return Array.from(new Set([branch.hostelId, ...branch.ownerHostels.map((h) => h.id)]));
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

// ── Reward ledger ─────────────────────────────────────────────────────────────

type RewardDbRow = {
  id: string;
  referral_id: string | null;
  role: ReferralRewardRole;
  status: ReferralRewardStatus;
  tenant_id: string;
  hostel_id: string;
  counterparty_name: string | null;
  percent: number;
  for_month: string | null;
  applied_amount: number | string | null;
  expires_on: string;
  created_at: string;
  void_reason: string | null;
  tenant: { full_name: string; monthly_rent: number } | { full_name: string; monthly_rent: number }[] | null;
};

const REWARD_COLUMNS =
  "id, referral_id, role, status, tenant_id, hostel_id, counterparty_name, percent, " +
  "for_month, applied_amount, expires_on, created_at, void_reason, " +
  "tenant:hms_tenants(full_name, monthly_rent)";

/**
 * Deliberately unpaginated, and deliberately excluding 'void'.
 *
 * Every non-void row corresponds to a real admission, so the set is bounded by
 * the branch's own throughput. 'void' is the only class that can grow without
 * one — toggling the feature off voids every open reward at once — and it is
 * also the only class nothing on the page adds up.
 */
function ownerRewardsQuery(admin: AdminClient, hostelIds: string[]) {
  return admin
    .from("hms_referral_rewards")
    .select(REWARD_COLUMNS)
    .in("hostel_id", hostelIds)
    .neq("status", "void")
    .order("created_at", { ascending: false });
}

function tenantOf(r: RewardDbRow): { full_name: string; monthly_rent: number } | null {
  return (Array.isArray(r.tenant) ? r.tenant[0] : r.tenant) ?? null;
}

/** What a still-open reward will cost when it lands. An estimate on purpose: the
 *  rupees are only fixed when the bill it sits on is priced, and a checkout can
 *  pro-rate that rent underneath it. */
function estimateRewardValue(r: RewardDbRow): number {
  return Math.round((Number(tenantOf(r)?.monthly_rent ?? 0) * Number(r.percent ?? 0)) / 100);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortMonth(forMonth: string | null): string {
  if (!forMonth) return "";
  const month = Number(forMonth.slice(5, 7));
  return MONTH_ABBR[month - 1] ?? forMonth;
}

function rupees(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-PK")}`;
}

/**
 * One line an owner can read without knowing the state machine.
 *
 * A referral produces at most two rewards (one per side), so this collapses both
 * into the single fact that matters: money already given beats money queued,
 * queued beats unqualified, and an outcome with no reward row at all is
 * explained from hms_referrals.rewards_skipped_reason — otherwise "joined, and
 * nothing happened" is unanswerable at the support desk.
 */
function rewardSummaryFor(rows: RewardDbRow[] | undefined, skippedReason: string | null): string | null {
  if (!rows || rows.length === 0) {
    const reason = skippedReason ?? "";
    if (reason.includes("referrer_left")) return "No reward — referrer had checked out";
    if (reason.includes("percent_zero")) return "No reward — the discount was set to 0%";
    if (reason.includes("referrer_cap_90d")) return "No reward — referrer is at their 90-day cap";
    return null;
  }

  const applied = rows.filter((r) => r.status === "applied");
  const open = rows.filter((r) => r.status === "scheduled" || r.status === "held");

  if (applied.length > 0) {
    const total = applied.reduce((sum, r) => sum + Number(r.applied_amount ?? 0), 0);
    const month = shortMonth(applied[0].for_month);
    const base = `Applied ${rupees(total)}${month ? ` · ${month}` : ""}`;
    return open.length > 0 ? `${base} · ${open.length} more queued` : base;
  }

  const scheduled = rows
    .filter((r) => r.status === "scheduled" && r.for_month)
    .sort((a, b) => (a.for_month ?? "").localeCompare(b.for_month ?? ""));
  if (scheduled.length > 0) return `Queued · ${shortMonth(scheduled[0].for_month)}`;

  if (rows.some((r) => r.status === "held")) return "Held — waiting for first payment";

  const expired = rows.find((r) => r.status === "expired");
  if (expired) {
    return expired.void_reason === "no_open_month"
      ? "Expired — no open bill left to use it on"
      : "Expired — the offer ran out";
  }
  return null;
}

type RewardLedger = {
  rewards: ReferralRewardRow[];
  discountGivenThisMonth: number;
  discountGivenTotal: number;
  /** tenant_id -> what that referrer has earned and is still owed. */
  byReferrer: Map<string, { earned: number; pendingValue: number }>;
  openRewardCount: number;
  openRewardValue: number;
  byReferral: Map<string, RewardDbRow[]>;
};

/** Every number on the page comes off this ONE array — no second aggregate
 *  query can disagree with the list the owner is looking at. */
function buildRewardLedger(
  rows: RewardDbRow[],
  branchNameById: Map<string, string>,
  currentMonthKey: string
): RewardLedger {
  const rewards: ReferralRewardRow[] = [];
  const byReferral = new Map<string, RewardDbRow[]>();
  let discountGivenThisMonth = 0;
  let discountGivenTotal = 0;
  // Per referrer: what they have actually had taken off a bill, and what is
  // still coming. Built here rather than from the mapped rows because only the
  // raw row carries the tenant's rent, which an unapplied reward is estimated from.
  const byReferrer = new Map<string, { earned: number; pendingValue: number }>();
  let openRewardCount = 0;
  let openRewardValue = 0;

  for (const r of rows) {
    const tenant = tenantOf(r);
    const appliedAmount = r.applied_amount === null ? null : Number(r.applied_amount);

    rewards.push({
      id: r.id,
      role: r.role,
      status: r.status,
      tenantId: r.tenant_id,
      tenantName: tenant?.full_name ?? null,
      counterpartyName: r.counterparty_name,
      percent: Number(r.percent ?? 0),
      forMonth: r.for_month,
      appliedAmount,
      hostelName: branchNameById.get(r.hostel_id) ?? null,
      expiresOn: r.expires_on,
      createdAt: r.created_at,
    });

    if (r.status === "applied") {
      discountGivenTotal += appliedAmount ?? 0;
      if (r.for_month === currentMonthKey) discountGivenThisMonth += appliedAmount ?? 0;
    }
    if (r.role === "referrer") {
      const m = byReferrer.get(r.tenant_id) ?? { earned: 0, pendingValue: 0 };
      if (r.status === "applied") m.earned += appliedAmount ?? 0;
      else if (r.status === "scheduled" || r.status === "held") m.pendingValue += estimateRewardValue(r);
      byReferrer.set(r.tenant_id, m);
    }
    if (r.status === "scheduled" || r.status === "held") {
      openRewardCount += 1;
      openRewardValue += estimateRewardValue(r);
    }
    if (r.referral_id) {
      const bucket = byReferral.get(r.referral_id);
      if (bucket) bucket.push(r);
      else byReferral.set(r.referral_id, [r]);
    }
  }

  return {
    rewards, discountGivenThisMonth, discountGivenTotal,
    openRewardCount, openRewardValue, byReferral, byReferrer,
  };
}

function currentMonthKey(): string {
  const { year, month } = pktYearMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
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
    const branch = await resolveBranch();
    const { hostelId, hostelName, enabled, ownerHostels, admin, referrerPercent, referredPercent } =
      branch;

    const scopeIds = rewardScopeIds(branch);
    const monthKey = currentMonthKey();
    const branchNameById = new Map<string, string>([
      [hostelId, hostelName],
      ...ownerHostels.map((h) => [h.id, h.name] as [string, string]),
    ]);

    // Switching the feature off must never hide a live liability. The reconciler
    // voids open rewards branch by branch on its next run, so between the toggle
    // and that run there are real discounts still landing on real bills — and
    // this is the only screen that can say so.
    if (!enabled) {
      const { data, error } = await ownerRewardsQuery(admin, scopeIds);
      if (error) throw error;
      const ledger = buildRewardLedger(
        (data ?? []) as unknown as RewardDbRow[],
        branchNameById,
        monthKey
      );
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
          rewards: ledger.rewards,
          discountGivenThisMonth: ledger.discountGivenThisMonth,
          discountGivenTotal: ledger.discountGivenTotal,
          openRewardCount: ledger.openRewardCount,
          openRewardValue: ledger.openRewardValue,
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

    const [tenantsRes, codesRes, referralsRes, otherTenantsRes, duplicatesRes, rewardsRes] =
      await Promise.all([
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
            "id, name, phone, phone_digits, status, created_at, referrer_tenant_id, matched_tenant_id, matched_at, rejected_at, rejected_by, rewards_skipped_reason"
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
        ownerRewardsQuery(admin, scopeIds),
      ]);

    if (tenantsRes.error) throw tenantsRes.error;
    if (codesRes.error) throw codesRes.error;
    if (referralsRes.error) throw referralsRes.error;
    if (otherTenantsRes.error) throw otherTenantsRes.error;
    if (rewardsRes.error) throw rewardsRes.error;

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
      rewards_skipped_reason: string | null;
    };
    const referrals = (referralsRes.data ?? []) as ReferralDbRow[];

    const ledger = buildRewardLedger(
      (rewardsRes.data ?? []) as unknown as RewardDbRow[],
      branchNameById,
      monthKey
    );

    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const codeByTenant = new Map((codesRes.data ?? []).map((c) => [c.tenant_id, c.code]));

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
        // Only a referral that actually reached 'joined' can have produced money;
        // anything else is a lead, and labelling it with a reward state would
        // read as a promise the branch never made.
        rewardSummary:
          r.status === "joined"
            ? rewardSummaryFor(ledger.byReferral.get(r.id), r.rewards_skipped_reason)
            : null,
      };
    });

    type ReferrerTally = {
      pending: number; joined: number; total: number; lastAt: string | null;
    };
    const countsByReferrer = new Map<string, ReferrerTally>();
    // referralRows arrives newest-first, so the FIRST row seen for a referrer is
    // their most recent — no date comparison needed.
    for (const row of referralRows) {
      const counts = countsByReferrer.get(row.referrerTenantId)
        ?? { pending: 0, joined: 0, total: 0, lastAt: null };
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "joined") counts.joined += 1;
      counts.total += 1;
      counts.lastAt ??= row.createdAt;
      countsByReferrer.set(row.referrerTenantId, counts);
    }

    const referrers: ReferrerRow[] = tenants
      .filter(isResident)
      .map((t) => {
        const room = Array.isArray(t.room) ? t.room[0] : t.room;
        const counts = countsByReferrer.get(t.id);
        const money = ledger.byReferrer.get(t.id);
        return {
          tenantId: t.id,
          tenantName: t.full_name,
          roomNumber: room?.room_number ?? null,
          code: codeByTenant.get(t.id) ?? null,
          phone: t.phone ?? null,
          pending: counts?.pending ?? 0,
          joined: counts?.joined ?? 0,
          totalReferred: counts?.total ?? 0,
          discountEarned: money?.earned ?? 0,
          discountPending: money?.pendingValue ?? 0,
          lastReferralAt: counts?.lastAt ?? null,
        };
      })
      // Most recent referral activity first — a link handed out in March that
      // has never been used is not what the owner opened this page to see.
      // Everyone who has never referred anybody falls to the bottom, alphabetical.
      .sort((a, b) => {
        if (a.lastReferralAt && b.lastReferralAt) {
          return a.lastReferralAt < b.lastReferralAt ? 1 : a.lastReferralAt > b.lastReferralAt ? -1 : 0;
        }
        if (a.lastReferralAt) return -1;
        if (b.lastReferralAt) return 1;
        return a.tenantName.localeCompare(b.tenantName);
      });

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
        rewards: ledger.rewards,
        discountGivenThisMonth: ledger.discountGivenThisMonth,
        discountGivenTotal: ledger.discountGivenTotal,
        openRewardCount: ledger.openRewardCount,
        openRewardValue: ledger.openRewardValue,
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


/**
 * Not gated on the entitlement, unlike the three code-minting actions.
 *
 * Rejecting is how an owner STOPS a discount that is still landing on bills, and
 * open rewards outlive the switch by up to four months. Requiring the feature to
 * be on before the owner may turn a payout off locks them out of their own money
 * at exactly the moment they most want out.
 */
export async function rejectReferral(
  referralId: string
): Promise<{ success?: boolean; voided?: number; error?: string }> {
  try {
    const { hostelId, admin, profile } = await resolveBranch();

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

    // Both sides, and they may sit at two different branches — which is why this
    // is keyed on the referral and not on a tenant. Fail-open: the status change
    // above is the owner's decision and must stand even if the ledger call fails.
    const voided = await voidReferralRewardsForReferral(admin, referralId, "referral_rejected");

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral.reject",
      entity: "referral",
      entity_id: referralId,
      meta: { rewards_voided: voided },
    });

    revalidatePath("/marketing");
    revalidatePath("/payments");
    return { success: true, voided };
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
): Promise<{ success?: boolean; status?: ReferralStatus; granted?: number; error?: string }> {
  try {
    const { hostelId, admin, profile } = await resolveBranch();

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

    // Re-grant rather than un-void: the void is permanent by design, and the
    // grant RPC is idempotent on (referral, role), so this re-derives both sides
    // from the branch's CURRENT percentages instead of resurrecting stale rows.
    // A no-op when the restored status is 'pending' — nothing to pay yet.
    const granted =
      restored === "joined" ? await grantReferralRewards(admin, referralId) : 0;

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral.undo_reject",
      entity: "referral",
      entity_id: referralId,
      meta: { restored_status: restored, rewards_granted: granted },
    });

    revalidatePath("/marketing");
    revalidatePath("/payments");
    // The restored status comes from the DB's own matched_tenant_id, so the
    // caller never has to guess it from a name that may not have resolved.
    return { success: true, status: restored, granted };
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
 *
 * Not gated on the entitlement: setting a percentage to 0 is the owner's only
 * way to stop FUTURE grants, and it must stay reachable on a branch whose
 * feature switch has been turned off underneath live rewards.
 *
 * LOWERING A PERCENT DOES NOT RE-PRICE ANYTHING ALREADY GRANTED. A reward row
 * snapshots its own percent at grant time (migration 184) precisely so a
 * collected bill can be re-derived off a rent that later moved; the new number
 * only ever applies to rewards granted from now on. The open count and value
 * come back so the caller can say exactly that before the owner confirms.
 */
export async function updateReferralPercentages(
  referrerPercent: number,
  referredPercent: number
): Promise<{ error?: string; openRewardCount?: number; openRewardValue?: number }> {
  try {
    const branch = await resolveBranch();
    const {
      hostelId,
      admin,
      profile,
      referrerPercent: prevReferrer,
      referredPercent: prevReferred,
    } = branch;

    const nextReferrer = clampPercent(referrerPercent);
    const nextReferred = clampPercent(referredPercent);
    const isLowering = nextReferrer < prevReferrer || nextReferred < prevReferred;

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
      meta: {
        referrer_percent: nextReferrer,
        referred_percent: nextReferred,
        previous_referrer_percent: prevReferrer,
        previous_referred_percent: prevReferred,
      },
    });

    revalidatePath("/marketing");
    if (!isLowering) return {};

    // Branch-scoped, not owner-wide: these two columns are this branch's own
    // P&L, and a reward granted at another branch was priced off that branch's
    // numbers.
    const { data: open } = await admin
      .from("hms_referral_rewards")
      .select(REWARD_COLUMNS)
      .eq("hostel_id", hostelId)
      .in("status", ["scheduled", "held"]);

    const openRows = (open ?? []) as unknown as RewardDbRow[];
    return {
      openRewardCount: openRows.length,
      openRewardValue: openRows.reduce((sum, r) => sum + estimateRewardValue(r), 0),
    };
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

// ── lookupReferralForAdmission ────────────────────────────────────────────────

/** A phone number typed into the admission form is answered with a NAME, which
 *  makes this a phone -> identity oracle for anyone who can reach the action.
 *  Metered per user rather than per branch: the account is the thing being
 *  abused, and a branch-wide bucket would let one compromised session spend the
 *  whole branch's allowance. */
const ADMISSION_LOOKUP_HOURLY_LIMIT = 90;

type AdmissionReferralLookup = {
  found: boolean;
  /** The name the REFERRED person was submitted under. Returned so the admission
   *  form can prefill it — the owner already typed the phone, and re-typing a name
   *  the system already holds is both wasted work and a chance to mis-spell it
   *  against the referral it has to match. */
  referredName: string | null;
  referrerName: string | null;
  referrerRoom: string | null;
  referredPercent: number;
  submittedAt: string | null;
  expiresOn: string | null;
  /** False whenever the referrer sits at a different branch — including one this
   *  caller cannot see, in which case no name and no room come back either. */
  sameBranch: boolean;
  reason?: "expired" | "already_referred" | "not_enabled" | "percent_zero";
};

const NO_MATCH: AdmissionReferralLookup = {
  found: false,
  referredName: null,
  referrerName: null,
  referrerRoom: null,
  referredPercent: 0,
  submittedAt: null,
  expiresOn: null,
  sameBranch: false,
};

/** Same fixed-offset arithmetic hms_referral_find_pending does in SQL
 *  ((created_at at time zone 'Asia/Karachi')::date + ttl), so the date the
 *  screen prints is the date the RPC will actually enforce. */
function pendingExpiresOn(createdAt: string): string {
  return pktTodayDateString(
    new Date(new Date(createdAt).getTime() + REFERRAL_PENDING_TTL_DAYS * 86_400_000)
  );
}

/**
 * What the admission banner shows while the owner is typing a new tenant's
 * number. READ ONLY — it never claims the referral; hms_attribute_referral does
 * that, off the saved row, through the same hms_referral_find_pending predicate
 * used here. The screen therefore cannot promise a discount the RPC will refuse.
 *
 * Returns the minimum the banner can render and nothing else: never the raw
 * phone, never ip_address, never the referral id, and — when the referrer is at
 * a branch this caller has no access to — never the name or the room either.
 * Confirming "somebody at another of your branches referred this number" is the
 * most it will admit to in that case.
 *
 * Deliberately NOT written to hms_activity_log: it fires on every keystroke-idle
 * of a phone field, and burying the real admission entries under thousands of
 * lookup rows makes the log worse at the one job it has. The rate bucket above
 * is where abuse of it shows up.
 */
export async function lookupReferralForAdmission(
  phone: string
): Promise<AdmissionReferralLookup> {
  try {
    const branch = await resolveBranch();
    const { hostelId, ownerId, enabled, admin, profile, referredPercent } = branch;

    if (!enabled || !ownerId) return { ...NO_MATCH, reason: "not_enabled" };

    const digits = normalizePhoneDigits(typeof phone === "string" ? phone : "");
    if (!digits) return NO_MATCH;

    // Fanned out, not chained. The meter gates the ANSWER, not the query, so
    // running them together still refuses a rate-limited caller — the result is
    // discarded before it is returned and nothing can be enumerated. Chaining
    // them cost a full round trip on every keystroke pause, which is time
    // somebody spends standing at the desk watching a blank field.
    const [
      { data: allowed, error: rateErr },
      { data: referralId, error: findErr },
    ] = await Promise.all([
      admin.rpc("hms_referral_rate_hit", {
        p_bucket: `admission_lookup:${profile.id}`,
        p_limit: ADMISSION_LOOKUP_HOURLY_LIMIT,
      }),
      admin.rpc("hms_referral_find_pending", {
        p_owner_id: ownerId,
        p_phone_digits: digits,
        p_as_of: pktTodayDateString(),
        p_ttl_days: REFERRAL_PENDING_TTL_DAYS,
      }),
    ]);

    // Logged, not swallowed: a meter that has quietly stopped counting on the one
    // endpoint that answers a phone number with a name must be visible.
    if (rateErr) console.error("[lookupReferralForAdmission] rate meter failed:", rateErr.code);
    // Answers exactly like a miss. A caller told it hit a ceiling knows there is
    // one to walk around.
    if (allowed === false) return NO_MATCH;
    if (findErr) throw findErr;

    if (!referralId) {
      // Only reached on a miss, so it costs nothing on the common path. 'joined'
      // is the lifetime anti-recycling rule (migration 184) and is the single
      // most confusing outcome for an owner — "I know Ali sent them" deserves a
      // better answer than a blank banner.
      const { data: prior } = await admin
        .from("hms_referrals")
        .select("status")
        .eq("owner_id", ownerId)
        .eq("phone_digits", digits)
        .in("status", ["joined", "pending"])
        .limit(5);

      const statuses = (prior ?? []).map((p) => p.status as string);
      if (statuses.includes("joined")) return { ...NO_MATCH, reason: "already_referred" };
      if (statuses.includes("pending")) return { ...NO_MATCH, reason: "expired" };
      return NO_MATCH;
    }

    // ONE query with an FK join, not two sequential round trips. This runs on
    // every idle of the phone field while somebody stands at the desk, so each
    // saved hop is felt.
    const { data: referral } = await admin
      .from("hms_referrals")
      .select("id, name, created_at, referrer_tenant_id, promised_referred_percent, referrer:hms_tenants!hms_referrals_referrer_tenant_id_fkey(id, full_name, hostel_id, room:hms_rooms(room_number))")
      .eq("id", referralId as string)
      .maybeSingle();
    if (!referral) return NO_MATCH;

    const referrer = Array.isArray(referral.referrer) ? referral.referrer[0] : referral.referrer;
    const referrerHostelId = (referrer?.hostel_id as string | null) ?? null;
    const visible = referrerHostelId !== null && rewardScopeIds(branch).includes(referrerHostelId);
    const room = Array.isArray(referrer?.room) ? referrer?.room[0] : referrer?.room;

    // LEAST(what the public page promised this visitor, what the branch that
    // will actually pay stands behind today) — the identical expression
    // hms_grant_referral_rewards uses, so the banner cannot over-promise.
    const effectivePercent = Math.min(
      clampPercent(referral.promised_referred_percent),
      referredPercent
    );

    return {
      found: true,
      // Not gated on `visible`: this is the name of the person standing in front
      // of the operator, not the referrer's, so there is nothing to withhold.
      referredName: (referral.name as string | null) ?? null,
      referrerName: visible ? (referrer?.full_name as string | null) ?? null : null,
      referrerRoom: visible ? room?.room_number ?? null : null,
      referredPercent: effectivePercent,
      submittedAt: referral.created_at as string,
      expiresOn: pendingExpiresOn(referral.created_at as string),
      sameBranch: referrerHostelId === hostelId,
      ...(effectivePercent < 1 ? { reason: "percent_zero" as const } : {}),
    };
  } catch (err) {
    unstable_rethrow(err);
    // The banner is decoration on a path that must never fail to admit anybody.
    return NO_MATCH;
  }
}

// ── Reward escape hatches ─────────────────────────────────────────────────────

const MONTH_KEY = /^\d{4}-\d{2}$/;

/** Matches every for_month a real row can hold, plus the unplaced NULLs the
 *  void/detach RPCs already catch on their own. */
const ALL_MONTHS = "1900-01";

/**
 * Thin wrapper over hms_detach_referral_rewards.
 *
 * It exists only because the Active -> Waiting revert lives in
 * components/modules/tenants/tenants-client.tsx, which writes hms_tenants
 * DIRECTLY FROM THE BROWSER — and hms_referral_rewards has RLS on with zero
 * policies and no grant to `authenticated` (migration 184), so that client
 * cannot touch the ledger itself.
 *
 * Detach, not void: attribution is a one-shot pending -> joined transition that
 * can never re-grant, so voiding here would make moving a tenant to the waiting
 * list and back permanently destroy a reward they had earned.
 */
export async function detachReferralRewardsForTenant(
  tenantId: string,
  fromMonth: string
): Promise<{ detached?: number; error?: string }> {
  try {
    const { hostelId, admin, profile } = await resolveBranch();
    if (!MONTH_KEY.test(fromMonth)) throw new Error("Invalid month");

    // Re-derived from the caller's own branch, so a forged tenant id from another
    // owner's account reaches nothing.
    await requireBranchTenant(admin, hostelId, tenantId);

    const detached = await detachReferralRewards(
      admin,
      tenantId,
      fromMonth,
      "tenant_moved_to_waiting"
    );

    if (detached > 0) {
      await logActivity({
        hostel_id: hostelId,
        actor_id: profile.id,
        action: "referral_reward.detach",
        entity: "tenant",
        entity_id: tenantId,
        meta: { from_month: fromMonth, detached },
      });
      revalidatePath("/marketing");
      revalidatePath("/payments");
    }

    return { detached };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not update referral rewards" };
  }
}

/**
 * The panic button: cancels every reward still owed, across every branch the
 * caller can see, permanently.
 *
 * Owner-wide rather than branch-scoped because a reward granted through a branch-A
 * link is billed at branch B — stopping only the branch the owner happens to be
 * standing on would leave the other half of the same referral still paying out.
 *
 * Driven per TENANT, not per referral: a reward whose hms_referrals row has since
 * been deleted carries referral_id NULL (ON DELETE SET NULL, migration 184) and
 * would be invisible to a referral-keyed sweep while still discounting bills.
 */
export async function stopAllReferralRewards(): Promise<{ voided?: number; error?: string }> {
  try {
    const branch = await resolveBranch();
    const { hostelId, admin, profile } = branch;

    const { data: open, error } = await admin
      .from("hms_referral_rewards")
      .select("tenant_id")
      .in("hostel_id", rewardScopeIds(branch))
      .in("status", ["scheduled", "held"]);
    if (error) throw error;

    const tenantIds = Array.from(new Set((open ?? []).map((r) => r.tenant_id as string)));

    // Collected rather than accumulated with `+=`: these callbacks run ten at a
    // time and `n += await …` reads n BEFORE the await resolves, so concurrent
    // completions silently overwrite each other's count.
    const counts: number[] = [];
    await processInBatches(tenantIds, 10, async (tenantId) => {
      counts.push(
        await voidReferralRewardsForTenant(admin, tenantId, ALL_MONTHS, "owner_stopped_all")
      );
    });
    const voided = counts.reduce((sum, n) => sum + n, 0);

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral_reward.stop_all",
      entity: "hostel",
      entity_id: hostelId,
      meta: { tenants: tenantIds.length, voided },
    });

    revalidatePath("/marketing");
    revalidatePath("/payments");
    return { voided };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not stop referral rewards" };
  }
}

/** void_reason is stored and rendered back to the owner, so the free-text a
 *  caller supplies is capped and stripped of newlines rather than trusted. */
function sanitizeReason(reason: unknown, fallback: string): string {
  const text = (typeof reason === "string" ? reason : "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : fallback;
}

/**
 * Cancel ONE reward. Cancelling money is the one action here a standard partner
 * must not have, so it is tier-gated rather than merely owner-or-above.
 *
 * Written directly instead of through a wrapper because the RPCs in migration 185
 * are all keyed on a referral or a tenant — both of which would take the other
 * side of the same referral down with it, which is exactly what this is for
 * avoiding. The bill is re-priced afterwards through hms_referral_touch_bill, the
 * same function every RPC in that migration uses, so the ledger and the bill can
 * never be observably out of step.
 */
export async function revokeReferralReward(
  rewardId: string,
  reason: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("full");
    const branch = await resolveBranch();
    const { hostelId, admin, profile } = branch;

    const { data: reward } = await admin
      .from("hms_referral_rewards")
      .select("id, tenant_id, for_month, status")
      .eq("id", rewardId)
      .in("hostel_id", rewardScopeIds(branch))
      .maybeSingle();
    if (!reward) throw new Error("Reward not found");
    if (!["scheduled", "held"].includes(reward.status as string)) {
      throw new Error("Only a queued or held reward can be cancelled.");
    }

    const voidReason = sanitizeReason(reason, "owner_revoked");

    // .in("status", …) again on the write: between the read above and here the
    // bill may have been collected, and rewriting an 'applied' row would detach
    // a discount from money already taken.
    const { data: updated, error } = await admin
      .from("hms_referral_rewards")
      .update({
        status: "void",
        voided_at: new Date().toISOString(),
        void_reason: voidReason,
        for_month: null,
      })
      .eq("id", rewardId)
      .in("status", ["scheduled", "held"])
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("That reward has already been settled.");

    if (reward.for_month) {
      await admin.rpc("hms_referral_touch_bill", {
        p_tenant_id: reward.tenant_id as string,
        p_month: reward.for_month as string,
      });
    }

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral_reward.revoke",
      entity: "referral_reward",
      entity_id: rewardId,
      meta: { reason: voidReason, for_month: reward.for_month },
    });

    revalidatePath("/marketing");
    revalidatePath("/payments");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not cancel that reward" };
  }
}

/**
 * Re-run the grant for a referral whose reward never landed — a referrer who was
 * on the waiting list at admission time, a percentage set after the fact.
 *
 * `role` is a request, not an instruction: hms_grant_referral_rewards is the ONLY
 * writer of reward rows in the system, it is idempotent on (referral_id, role),
 * and it re-evaluates both sides against today's percentages and today's
 * qualification state. Asking for one side and calling it is therefore correct —
 * the side that already exists is left alone. The check below is what turns
 * "nothing happened" into a sentence the owner can act on.
 */
export async function grantReferralRewardManually(
  referralId: string,
  role: ReferralRewardRole
): Promise<{ granted?: number; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("full");
    const branch = await resolveBranch();
    const { hostelId, admin, profile } = branch;

    if (role !== "referred" && role !== "referrer") throw new Error("Unknown reward side");

    const scopeIds = rewardScopeIds(branch);

    const { data: referral } = await admin
      .from("hms_referrals")
      .select("id, status, hostel_id")
      .eq("id", referralId)
      .in("hostel_id", scopeIds)
      .maybeSingle();
    if (!referral) throw new Error("Referral not found");
    if (referral.status !== "joined") {
      throw new Error("Only a referral that has already joined can be paid out.");
    }

    const { data: existing } = await admin
      .from("hms_referral_rewards")
      .select("id")
      .eq("referral_id", referralId)
      .eq("role", role)
      .neq("status", "void")
      .maybeSingle();
    if (existing) throw new Error("That side of this referral has already been granted.");

    const granted = await grantReferralRewards(admin, referralId);

    // The RPC refuses on its own terms — referrer checked out, percentage at 0,
    // no open month left before the reward expires — and records why in
    // hms_referrals.rewards_skipped_reason, which the Marketing table renders.
    if (granted === 0) {
      throw new Error(
        "Nothing could be granted — check the branch percentage and whether the tenant is still resident."
      );
    }

    await logActivity({
      hostel_id: hostelId,
      actor_id: profile.id,
      action: "referral_reward.grant_manual",
      entity: "referral",
      entity_id: referralId,
      meta: { role, granted },
    });

    revalidatePath("/marketing");
    revalidatePath("/payments");
    return { granted };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Could not grant that reward" };
  }
}
