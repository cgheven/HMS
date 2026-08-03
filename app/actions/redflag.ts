"use server";

/**
 * Server Actions for RedFlag — the cross-organisation tenant-defaulter registry.
 *
 * This is the only feature in the product where one organisation reads another
 * organisation's data, so the trust boundary is drawn deliberately:
 *
 *   1. The hostel is ALWAYS resolved server-side from the session + the
 *      hms_active_hostel cookie. No action accepts a hostel id from the client.
 *      A client-supplied branch would be a direct gender-segregation bypass.
 *   2. Cross-organisation reads go exclusively through the SECURITY DEFINER
 *      functions in migration 143, which re-verify branch access and apply the
 *      gender filter INSIDE the database. There is no RLS policy that exposes
 *      another org's rows, so there is no second door to forget about.
 *   3. Those functions read auth.uid(). The service-role client has no
 *      auth.uid(), so every RPC here MUST use the RLS client (createClient()).
 *      Calling them with createAdminClient() would fail the access check and,
 *      worse, would look like a permissions bug rather than the guard working.
 *   4. Masking happens in SQL. Nothing in this file ever un-masks a value.
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/data";
import { getProfile, requireOwnerOrPartnerTier } from "@/lib/auth";
import { getManagerContext } from "@/lib/manager-auth";
import { normalizeCnic } from "@/lib/cnic";
import { normalizePhoneDigits, formatPhoneDisplay } from "@/lib/phone";
import { sendRedflagNoticeEmail, sendRedflagResolvedEmail } from "@/lib/redflag-email";
import { REDFLAG_ENABLED } from "@/lib/redflag-flag";
import type { RedflagListRow, RedflagStatus, RedflagMatch, RedflagReason } from "@/types";
import { isRedflagReason } from "@/types";

// NOTE: this file is "use server" — Turbopack allows ONLY async function
// exports here. No types, no constants, no `export type { … } from`. Every
// RedFlag type lives in types/index.ts and is imported, never re-exported.

// ---------------------------------------------------------------------------
// Limits. Deliberately conservative — every one of these is a defence against a
// hostile *authenticated* caller, not against a typo.
// ---------------------------------------------------------------------------

/** Returned when the registry itself cannot be reached — most often because
 *  migration 143 has not been applied. Distinct from DISCLAIMER_NOT_ACCEPTED so
 *  the UI shows "unavailable" rather than an acceptance gate it cannot satisfy,
 *  and distinct from an empty result so it never reads as "nobody is reported". */
const REDFLAG_UNAVAILABLE = "RedFlag is not available right now. Please try again later.";

const MAX_NAME_LEN = 120;
const MAX_NOTES_LEN = 1000;      // the column allows 2000; the app is stricter
const MAX_AMOUNT = 9_999_999.99;
const MAX_MONTHS = 600;

/** MIRRORS the per-user hourly budget enforced inside the SQL functions
 *  (migration 143). The DATABASE is the enforcement point, not this file: the
 *  count below is read-then-act with nothing serialising the two steps, so N
 *  concurrent calls all observe the same under-limit count, and PostgREST can
 *  be called directly without passing through this action at all. The SQL
 *  functions count the same window and the same actions inside the same
 *  transaction as the read they guard, which is what actually stops abuse.
 *
 *  This copy exists only so a user who is over budget gets a sentence they can
 *  understand instead of a raw SQL exception. Counts BOTH 'searched' and
 *  'viewed' so the bulk registry read shares the targeted-lookup budget.
 *
 *  KEEP IN STEP with the constant in migration 143. If they drift, the SQL one
 *  wins and this one only produces a misleading message. */
const LOOKUPS_PER_HOUR = 300;

/** Audit actions that consume the hourly budget. Both are cross-organisation
 *  reads; only the shape of the query differs. */
const BUDGETED_ACTIONS = ["searched", "viewed"] as const;

/** The tenant-add flow awaits this check before saving. try/catch covers a
 *  thrown request and an { error } result, but NOT an unbounded hang — which
 *  would leave the operator staring at a stuck "Checking…" button and unable to
 *  admit a tenant. A registry outage must never block taking money, so the
 *  lookup fails open on timeout. */
const LOOKUP_TIMEOUT_MS = 8_000;

/** Registry page size. The SQL list function clamps p_limit server-side; this
 *  is the app-side default and the ceiling accepted from the client. */
const LIST_PAGE_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Control characters, including the bidi overrides that let a display name be
 *  rendered as something other than what is stored. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** A redirect() thrown inside a Server Action surfaces as an Error carrying a
 *  digest of the form "NEXT_REDIRECT;<type>;<url>;...". Matched on the digest
 *  rather than an internal Next.js import so it cannot break on a minor upgrade;
 *  a false negative simply falls through to the normal error path. */
function isRedirectError(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Coerce an untrusted number into [min, max]; anything unparseable becomes the
 *  fallback. Never throws — these values arrive from the client. */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(v: unknown, max: number): string {
  return String(v ?? "").replace(CONTROL_CHARS, "").trim().slice(0, max);
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(onTimeout()), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cross-organisation reads by this user in the last rolling hour, counted over
 *  both budgeted actions. Advisory: the authoritative count is taken inside the
 *  SQL function, in the same transaction as the read it guards. */
async function countRecentLookups(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await createAdminClient()
    .from("hms_redflag_audit")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", userId)
    .in("action", [...BUDGETED_ACTIONS])
    .gte("created_at", since);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Shared entry guard. Every action begins here.
//
// Returns the caller's server-resolved branch, or a sentinel the UI knows how
// to act on. 'DISCLAIMER_NOT_ACCEPTED' is a specific string rather than a
// generic failure because the UI opens the acceptance gate on it — a user who
// has not accepted the terms is not an error case, they are a first-time user.
//
// NO PATH THROUGH THIS FUNCTION MAY redirect(). checkTenantRedflagAction is
// awaited on the critical path of adding a tenant, and a redirect() thrown
// inside a Server Action is not catchable by the caller's try/catch — Next.js
// converts it into a client navigation. A guard that redirected would throw an
// operator (manager or otherwise) onto /login mid-form and destroy the tenant
// they were typing. requireOwnerOrPartnerTier() is therefore only ever called
// for a role it cannot redirect on: owner, super_admin and partner, where it
// either returns the profile or throws a plain Error the action turns into a
// toast. Every other caller is resolved, or refused, right here.
// ---------------------------------------------------------------------------

type ScopeKind = "owner" | "manager";
type Scope = { hostelId: string; userId: string; kind: ScopeKind };

/** Roles that reach RedFlag through the owner/partner guard. Anything else is
 *  either a manager (resolved via getManagerContext) or has no access at all. */
const OWNER_ROLES = ["owner", "super_admin", "partner"];

async function resolveScope(
  minTier: "read_only" | "standard",
  opts: { requireDisclaimer?: boolean; allowManager?: boolean } = {},
): Promise<{ scope?: Scope; error?: string }> {
  const profile = await getProfile();

  // ---- Manager path -------------------------------------------------------
  // Managers hold no hms_profiles row with an owner-ish role, so the owner
  // guard below would redirect them. They are resolved from their own context
  // instead, which carries the same server-resolved active branch every other
  // manager page uses. Never from a client-supplied hostel id.
  if (!profile || !OWNER_ROLES.includes(profile.role)) {
    const mgr = await getManagerContext();
    if (!mgr) return { error: profile ? "You do not have access to RedFlag." : "Not signed in." };
    if (opts.allowManager === false) {
      return { error: "Only the branch owner can do this in RedFlag." };
    }
    if (!mgr.activeHostel) return { error: "No active branch selected." };
    const managerUserId = mgr.manager.supabase_user_id;
    if (!managerUserId) return { error: "You do not have access to RedFlag." };
    // The disclaimer is an owner-level acceptance (there is no manager UI for
    // it and managers cannot write hms_redflag_acceptances), so it is not
    // gated here. Managers only ever reach the read-only advisory lookup,
    // which is covered by the owner's acceptance for the branch.
    return { scope: { hostelId: mgr.activeHostel.id, userId: managerUserId, kind: "manager" } };
  }

  // ---- Owner / super_admin / partner path ---------------------------------
  // Safe to call now: with the role already known to be one of OWNER_ROLES,
  // requireOwnerOrPartnerTier() has no redirect branch left — it returns, or
  // throws a plain Error for a partner whose tier falls short.
  await requireOwnerOrPartnerTier(minTier);

  const ctx = await getAuthContext();
  if (!ctx?.user) return { error: "Not signed in." };
  if (!ctx.hostelId) return { error: "No active branch selected." };

  if (opts.requireDisclaimer !== false) {
    const supabase = await createClient();
    const { data: accepted, error: acceptErr } = await supabase
      .from("hms_redflag_acceptances")
      .select("user_id")
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    // A FAILED query is not a declined disclaimer. supabase-js reports a missing
    // table as a returned error with data === null, so discarding it made an
    // unreachable registry indistinguishable from "you have not agreed yet" —
    // which then raised an acceptance gate whose accept button hit the very same
    // missing table, and told the operator "No red flags reported yet" when the
    // truth was that nobody could look.
    if (acceptErr) return { error: REDFLAG_UNAVAILABLE };
    if (!accepted) return { error: "DISCLAIMER_NOT_ACCEPTED" };
  }

  return { scope: { hostelId: ctx.hostelId, userId: ctx.user.id, kind: "owner" } };
}

// ---------------------------------------------------------------------------
// checkTenantRedflagAction — the lookup. Called from the Check Tenant page AND
// automatically from every tenant-creation path (tenants-client.tsx on save,
// applications.ts on approve), for owners, partners AND managers.
//
// CONTRACT: this action must RETURN. Always. It must never throw and must never
// redirect, for any caller, valid input or hostile. It is awaited before the
// tenant row is written, and the check is advisory — a registry that is down,
// slow, out of budget or simply unavailable to this role must produce an empty
// result, not an interruption. A redirect() here is the worst outcome of all:
// it is not catchable by the caller's try/catch (Next.js turns it into a client
// navigation), so it would drag an operator to /login with a half-filled form.
//
// MANAGERS: allowed in, and answered with an empty result today. The three
// cross-org SQL functions gate on hms_redflag_can_access_hostel(), which
// recognises direct owners, hms_owner_hostels rows and active partners — it
// does not know about hms_manager_hostels, and managers hold no RLS grant of
// any kind (see lib/portal-data.ts). Running the RPC under the service-role
// client is not an alternative: the service role has no auth.uid(), so the same
// gate fails and the masking CASEs lose the identity they key on. Re-reading
// hms_redflags directly with the admin client and masking in TypeScript is
// deliberately rejected — masking and the gender filter live in SQL and are not
// reimplemented here. So a manager can: trigger the check without being logged
// out, and add tenants normally. A manager cannot: see cross-org reports. The
// day migration 143's access function learns hms_manager_hostels, delete the
// short-circuit below and managers get live results with no other change.
// ---------------------------------------------------------------------------

export async function checkTenantRedflagAction(
  input: { cnic?: string; phone?: string },
): Promise<{ matches?: RedflagMatch[]; error?: string; degraded?: boolean }> {
  try {
    // requireDisclaimer:false deliberately. Reading the registry is not
    // publishing to it, and this action is swallowed by the tenant-add path —
    // so gating it on acceptance meant that until an owner happened to open
    // /redflag and accept, NO tenant add and NO application approval ever
    // produced a warning, with nothing on screen saying the check was skipped.
    // The disclaimer still gates filing, in reportDefaulterAction and again in
    // the RLS INSERT policy, which is where consent actually belongs.
    // The rollout flag has to gate traffic, not just pixels. With RedFlag off
    // the page 404s and nobody can accept the disclaimer, so running the check
    // anyway would spend two round trips, an audit row and a budget slot on
    // every tenant save and every application approval — permanently, for a
    // result no one can see or act on. Not `degraded`: the check is switched
    // off, which is not the same as having failed.
    if (!REDFLAG_ENABLED) return { matches: [] };

    const { scope, error } = await resolveScope("read_only", { requireDisclaimer: false });
    if (error || !scope) return { error };

    // Fail open, silently — see MANAGERS above. Not an error: an error string
    // here would surface as a scary toast on a perfectly normal tenant add.
    if (scope.kind === "manager") return { matches: [] };

    // Normalised here as well as in SQL. The DB normalisers are the authority,
    // but rejecting an unusable key before the round trip means a mistyped
    // number never consumes a rate-limit slot.
    const cnicDigits = (normalizeCnic(input.cnic) ?? "").replace(/\D/g, "") || null;
    const phoneDigits = normalizePhoneDigits(input.phone);
    if (!cnicDigits && !phoneDigits) {
      return { error: "Enter a CNIC or a phone number to check." };
    }
    if (cnicDigits && cnicDigits.length !== 13) {
      return { error: "That CNIC looks incomplete — it should be 13 digits." };
    }

    // Courtesy pre-check ONLY. It is check-then-act and cannot be relied on:
    // parallel calls all read the same under-limit count, and the RPC is
    // reachable without this action. The budget that actually holds is inside
    // hms_redflag_search(); this exists so the common case returns a sentence a
    // front-desk user can act on rather than a raw SQL error.
    const supabase = await createClient();
    type RpcResult = { data: unknown; error: { message: string } | null };

    // Fanned out rather than chained. The count is advisory — SQL enforces the
    // real budget inside hms_redflag_search() — so awaiting it before the search
    // only bought a friendlier error message, at the cost of a second serial
    // round trip on every tenant save and every application approval. Running
    // both together keeps the friendlier message and costs one round trip.
    const [overBudget, result] = await Promise.all([
      countRecentLookups(scope.userId),
      withTimeout<RpcResult>(
        (async () => {
          const r = await supabase.rpc("hms_redflag_search", {
            p_hostel_id: scope.hostelId,
            p_cnic_digits: cnicDigits,
            p_phone_digits: phoneDigits,
          });
          return { data: r.data, error: r.error ? { message: r.error.message } : null };
        })(),
        LOOKUP_TIMEOUT_MS,
        () => ({ data: null, error: { message: "RedFlag lookup timed out." } }),
      ),
    ]);

    if (overBudget >= LOOKUPS_PER_HOUR) {
      // `degraded` rather than a bare error: the tenant-add path converts an
      // error into an empty match list, which is indistinguishable from "this
      // person is clean". The caller needs to be able to tell the operator that
      // the check did not run. Checked before result.error so an over-budget
      // caller gets the actionable sentence rather than the raw 53400.
      return {
        degraded: true,
        error: `RedFlag check unavailable — you have used all ${LOOKUPS_PER_HOUR} checks this hour.`,
      };
    }

    // Also degraded, not clean: a timeout means we do not know, and the caller
    // must be able to say so rather than imply a clear result.
    if (result.error) return { degraded: true, error: result.error.message };

    const rows = ((result.data ?? []) as unknown) as {
      id: string; full_name: string; cnic_masked: string | null; phone_masked: string | null;
      amount: string | number; months_unpaid: number | null; reason: string | null;
      status: RedflagStatus;
      reported_at: string; match_kind: "cnic" | "phone"; reported_by_self: boolean;
      reported_by_hostel_name: string | null; reported_by_hostel_phone: string | null;
    }[];

    return {
      matches: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        cnicMasked: r.cnic_masked,
        phoneMasked: r.phone_masked,
        amount: Number(r.amount),
        monthsUnpaid: r.months_unpaid,
        // Falls back to the column's own default rather than trusting the value:
        // every row written before the reason column existed is an unpaid-rent
        // report, and an unrecognised string must never reach the UI as a label.
        reason: isRedflagReason(r.reason) ? r.reason : "unpaid_rent",
        status: r.status,
        reportedAt: r.reported_at,
        matchKind: r.match_kind,
        reportedBySelf: r.reported_by_self,
        reportedByHostelName: r.reported_by_hostel_name ?? null,
        reportedByHostelPhone: r.reported_by_hostel_phone ?? null,
      })),
    };
  } catch (err: unknown) {
    // Last-ditch net for the contract above. resolveScope no longer has a
    // redirect path, but this action is awaited mid-form by three callers and
    // none of them can catch a redirect, so one that appeared here later — a new
    // guard, a helper that starts redirecting — would silently start throwing
    // operators onto /login again. Swallowed into the benign empty result
    // instead. Everything else (including Next's dynamic-rendering bailouts,
    // which must propagate) still goes through unstable_rethrow below.
    if (isRedirectError(err)) return { matches: [] };
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// reportDefaulterAction
// ---------------------------------------------------------------------------

/** Whether the reported member was actually told. "no_email" is the common
 *  case today — most tenant records carry no email address. */
export type RedflagNotifyResult = "sent" | "no_email" | "failed";

export async function reportDefaulterAction(input: {
  /** The tenant being reported, by id. Identity (name, CNIC, phone, email) is
   *  read from THAT row server-side and never taken from the client.
   *
   *  Re-deriving the person from a client-sent CNIC/phone is what broke this:
   *  phone numbers are not unique — one branch has six tenants sharing a single
   *  number — so a match-by-phone returned whichever row came back first, which
   *  is how a report filed against Musab Khan resolved to Moiz Arain and the
   *  notice went nowhere. An id identifies exactly one person; a phone does not. */
  tenantId: string;
  amount: string | number;
  reason: RedflagReason;
  monthsUnpaid?: string | number;
  notes?: string;
  confirmed: boolean;
}): Promise<{ success?: boolean; id?: string; error?: string; notified?: RedflagNotifyResult }> {
  try {
    // Filing a report publishes a named accusation to other companies. That is
    // a standard-tier action, never read_only, and never a manager — a manager
    // gets a plain { error }, never a redirect, because this action is also
    // reachable from surfaces a manager can load.
    const { scope, error } = await resolveScope("standard", { allowManager: false });
    if (error || !scope) return { error };

    // The legal confirmation is a server-side precondition, not a UI courtesy.
    if (input.confirmed !== true) {
      return { error: "Please confirm the declaration before submitting." };
    }

    if (!input.tenantId || !UUID_RE.test(input.tenantId)) {
      return { error: "Choose the member you are reporting from the list." };
    }

    // Scoped to the caller's own branch, so the id cannot be used to reach a
    // tenant of another organisation. This is both the ownership check and the
    // source of every identity field written below — one lookup, one person, no
    // opportunity for the row we authorise and the row we notify to differ.
    const supabaseCheck = await createClient();
    const { data: tenant, error: tenantErr } = await supabaseCheck
      .from("hms_tenants")
      .select("id, full_name, cnic, phone, email")
      .eq("id", input.tenantId)
      .eq("hostel_id", scope.hostelId)
      .eq("is_waiting", false)
      .maybeSingle();
    if (tenantErr) return { error: tenantErr.message };
    if (!tenant) {
      return {
        error:
          "You can only report someone who stayed at your branch. Choose them from the list rather than typing their details.",
      };
    }

    const fullName = cleanText(tenant.full_name, MAX_NAME_LEN);
    if (fullName.length < 2) return { error: "That member has no name on record." };

    const cnicDisplay = normalizeCnic(tenant.cnic as string | null);
    const cnicDigits = (cnicDisplay ?? "").replace(/\D/g, "") || null;
    const phoneDigits = normalizePhoneDigits(tenant.phone as string | null);
    if (!cnicDigits && !phoneDigits) {
      return { error: "That member has no CNIC or phone on record — without one the report cannot be found by anyone." };
    }
    if (cnicDigits && cnicDigits.length !== 13) {
      return { error: "That member's CNIC looks incomplete — it should be 13 digits." };
    }

    const amount = Number.parseFloat(String(input.amount));
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
      return { error: `Enter an amount between 0 and ${MAX_AMOUNT.toLocaleString()}.` };
    }

    // This is a public RPC endpoint; the chip row is not the gate. Anything
    // outside the five allowed values is refused here rather than left to the
    // CHECK constraint, which would surface as a raw Postgres error.
    if (!isRedflagReason(input.reason)) {
      return { error: "Choose why the money is owed." };
    }
    const reason = input.reason;

    // Months only mean something for rent. A months value attached to a theft
    // or a damage report is dropped rather than stored, so no reader can be
    // shown "3 months" next to a broken geyser.
    let monthsUnpaid: number | null = null;
    if (reason === "unpaid_rent" && input.monthsUnpaid != null && String(input.monthsUnpaid).trim() !== "") {
      const m = Number.parseInt(String(input.monthsUnpaid), 10);
      if (!Number.isInteger(m) || m < 0 || m > MAX_MONTHS) {
        return { error: "Months unpaid must be a whole number." };
      }
      monthsUnpaid = m;
    }

    const notes = cleanText(input.notes, MAX_NOTES_LEN) || null;

    // gender and reported_by_owner_id are pinned by the BEFORE INSERT trigger
    // from the branch itself — deliberately not sent from here, so that even a
    // compromised server action cannot file into the other gender's registry.
    const supabase = await createClient();
    const { data: created, error: insErr } = await supabase
      .from("hms_redflags")
      .insert({
        reported_by_hostel_id: scope.hostelId,
        reported_tenant_id: tenant.id,
        full_name: fullName,
        cnic_digits: cnicDigits,
        cnic_display: cnicDisplay,
        phone_digits: phoneDigits,
        phone_display: tenant.phone ? formatPhoneDisplay(tenant.phone as string) : null,
        amount,
        months_unpaid: monthsUnpaid,
        reason,
        notes,
      })
      .select("id")
      .single();

    if (insErr) return { error: insErr.message };

    // No audit insert here. The AFTER INSERT trigger on hms_redflags writes the
    // action='reported' row, so it is written even when the row arrives through
    // PostgREST without passing through this action. Writing it here too would
    // double-count every report and inflate the hourly budget.

    // Notify the person listed. The address comes from the very row that was
    // authorised above, so the person we notify is by construction the person
    // reported — no second lookup, and no chance of resolving to a different
    // tenant who happens to share a phone number.
    const notifyEmail = (tenant.email as string | null) || null;
    let notified: RedflagNotifyResult = notifyEmail ? "failed" : "no_email";

    if (notifyEmail) {
      try {
        const admin = createAdminClient();
        const { data: hostelRow } = await admin
          .from("hms_hostels")
          .select("name, phone")
          .eq("id", scope.hostelId)
          .maybeSingle();

        await sendRedflagNoticeEmail({
          toEmail: notifyEmail,
          tenantName: fullName,
          hostelName: (hostelRow?.name as string | null) ?? "your hostel",
          ownerContact: (hostelRow?.phone as string | null) ?? null,
          amount,
        });
        notified = "sent";
      } catch (mailErr) {
        // Awaited rather than fire-and-forget, and logged rather than swallowed.
        // The report still stands whatever happens here — but this exists for
        // transparency, and a notice that quietly never sends would look exactly
        // like one that works. The owner is told which of the two it was.
        console.error("[redflag] notice email failed", mailErr);
        notified = "failed";
      }
    }

    revalidatePath("/redflag");
    return { success: true, id: created.id, notified };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// resolveRedflagAction — marks dues settled. Only the filing org can do this;
// the RLS UPDATE policy enforces that, this is defence in depth.
// ---------------------------------------------------------------------------

/** Finds the tenant behind a report and tells them it was settled. Mirrors the
 *  report path's matching (normalised CNIC first, then normalised phone) so the
 *  same person is reached by both messages, or neither. Never throws: a mail
 *  failure must not undo a resolution that is already committed. */
async function notifyResolved(args: {
  hostelId: string;
  fullName: string;
  amount: number;
  cnicDigits: string | null;
  phoneDigits: string | null;
  tenantId: string | null;
}): Promise<RedflagNotifyResult> {
  try {
    const admin = createAdminClient();
    const { data: hostelRow } = await admin
      .from("hms_hostels")
      .select("name")
      .eq("id", args.hostelId)
      .maybeSingle();

    let email: string | null = null;

    if (args.tenantId) {
      // The tenancy recorded at file time. Exact, and immune to the shared-phone
      // problem that made the old matching resolve to the wrong person.
      const { data: t } = await admin
        .from("hms_tenants")
        .select("email")
        .eq("id", args.tenantId)
        .eq("hostel_id", args.hostelId)
        .maybeSingle();
      email = (t?.email as string | null) || null;
    } else {
      // Reports filed before migration 148 carry no tenant id, so they still
      // have to be matched. CNIC is tried alone first because it identifies one
      // person; phone is consulted only if that finds nobody, and only when it
      // is unambiguous — several tenants sharing a number means we genuinely do
      // not know who to write to, and mailing the wrong person about someone
      // else's debt is worse than sending nothing.
      const { data: tenants } = await admin
        .from("hms_tenants")
        .select("cnic, phone, email")
        .eq("hostel_id", args.hostelId);
      const rows = tenants ?? [];

      const byCnic = args.cnicDigits
        ? rows.filter((t) => String(t.cnic ?? "").replace(/\D/g, "") === args.cnicDigits)
        : [];
      const byPhone = args.phoneDigits
        ? rows.filter((t) => normalizePhoneDigits(t.phone as string | null) === args.phoneDigits)
        : [];

      const match =
        byCnic.length === 1 ? byCnic[0] : byPhone.length === 1 ? byPhone[0] : null;
      email = (match?.email as string | null) || null;
    }

    if (!email) return "no_email";

    await sendRedflagResolvedEmail({
      toEmail: email,
      tenantName: args.fullName,
      hostelName: (hostelRow?.name as string | null) ?? "your hostel",
      amount: args.amount,
    });
    return "sent";
  } catch (mailErr) {
    console.error("[redflag] resolved email failed", mailErr);
    return "failed";
  }
}

export async function resolveRedflagAction(
  id: string
): Promise<{ success?: boolean; error?: string; notified?: RedflagNotifyResult }> {
  try {
    // Managers are refused with a plain { error }, never a redirect.
    const { scope, error } = await resolveScope("standard", { allowManager: false });
    if (error || !scope) return { error };
    if (!id || !UUID_RE.test(id)) return { error: "Invalid report id." };

    const supabase = await createClient();
    const { data: updated, error: updErr } = await supabase
      .from("hms_redflags")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      // cnic_digits/phone_digits come back so the person can be found again to
      // be told; they are used here and never returned to the client.
      .select("id, full_name, amount, cnic_digits, phone_digits, reported_tenant_id")
      .maybeSingle();

    if (updErr) return { error: updErr.message };
    // No row came back => the RLS policy filtered it out. Reported as not-found
    // rather than "denied", so this cannot be used to probe which ids exist.
    if (!updated) return { error: "Report not found." };

    // No audit insert here. The AFTER UPDATE trigger on hms_redflags writes the
    // 'resolved' / 'edited' row, so the trail survives a direct PostgREST
    // update and is written exactly once.

    // Close the loop. Someone told they owe money is entitled to be told when
    // it is recorded settled — otherwise the only message we ever send them is
    // the accusation. Same matching rule as the report path.
    const notified = await notifyResolved({
      hostelId: scope.hostelId,
      fullName: (updated.full_name as string | null) ?? "",
      amount: Number(updated.amount ?? 0),
      cnicDigits: (updated.cnic_digits as string | null) ?? null,
      phoneDigits: (updated.phone_digits as string | null) ?? null,
      tenantId: (updated.reported_tenant_id as string | null) ?? null,
    });

    revalidatePath("/redflag");
    return { success: true, notified };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export async function listRedflagsAction(
  input: {
    limit?: number; offset?: number; search?: string;
    status?: "reported" | "resolved"; onlyMine?: boolean; reason?: RedflagReason;
  } = {},
): Promise<{ rows?: RedflagListRow[]; hasMore?: boolean; nextOffset?: number; total?: number; error?: string }> {
  try {
    // Owner-surface only: the registry pages live under /redflag, which no
    // manager route mounts. Refused with an { error }, never a redirect.
    const { scope, error } = await resolveScope("read_only", { allowManager: false });
    if (error || !scope) return { error };

    // Both are hostile input — this is a public RPC endpoint. Clamped here and
    // clamped again by the SQL function's own ceiling; a caller asking for
    // 1e9 rows gets a page, not the registry.
    const limit = clampInt(input.limit, 1, LIST_PAGE_MAX, LIST_PAGE_MAX);
    const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);

    // The registry is a BULK cross-organisation read: names and amounts for
    // every report visible to this branch's gender. It is paged rather than
    // unbounded so one call can no longer copy the whole registry, and the
    // action='viewed' audit row is now written INSIDE hms_redflag_list() — it
    // is therefore recorded even when PostgREST is called directly, and it
    // counts against the same hourly budget as a targeted search. Nothing is
    // audited from here; a second insert would double-count every page.
    // Every filter is passed to SQL rather than applied to the rows that come
    // back. Filtering here would only ever see the current page, so a search
    // would answer "no match" for someone reported on page 2 — which on this
    // feature reads as a clean bill of health. The whole registry is filtered,
    // then paged.
    const search = cleanText(input.search, 120) || null;
    const status = input.status === "reported" || input.status === "resolved" ? input.status : null;
    // Unrecognised => no reason filter at all, never a filter on a value no row
    // can hold: that would return nothing and read as "nobody is reported".
    const reason = isRedflagReason(input.reason) ? input.reason : null;

    const supabase = await createClient();
    const { data, error: rpcErr } = await supabase.rpc("hms_redflag_list", {
      p_hostel_id: scope.hostelId,
      p_limit: limit,
      p_offset: offset,
      p_search: search,
      p_status: status,
      p_only_mine: input.onlyMine === true,
      // Omitted entirely when unset so the call still resolves against the
      // pre-145 six-argument signature; p_reason is the optional last parameter.
      ...(reason ? { p_reason: reason } : {}),
    });
    if (rpcErr) return { error: rpcErr.message };

    const rows = (data ?? []) as {
      id: string; full_name: string; cnic_masked: string | null; phone_masked: string | null;
      amount: string | number; months_unpaid: number | null; reason: string | null;
      status: RedflagStatus;
      reported_at: string; resolved_at: string | null; reported_by_self: boolean;
      total_count: string | number;
      reported_by_hostel_name: string | null; reported_by_hostel_phone: string | null;
    }[];

    return {
      rows: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        cnicMasked: r.cnic_masked,
        phoneMasked: r.phone_masked,
        amount: Number(r.amount),
        monthsUnpaid: r.months_unpaid,
        reason: isRedflagReason(r.reason) ? r.reason : "unpaid_rent",
        status: r.status,
        notes: null, // never exposed across orgs
        reportedAt: r.reported_at,
        resolvedAt: r.resolved_at,
        reportedBySelf: r.reported_by_self,
        reportedByHostelName: r.reported_by_hostel_name ?? null,
        reportedByHostelPhone: r.reported_by_hostel_phone ?? null,
      })),
      // A full page back means there is probably another one. The SQL function
      // may hand back fewer than asked when its own ceiling is lower, which
      // simply ends the pagination — never a silent infinite "Load more".
      hasMore: rows.length >= limit,
      nextOffset: offset + rows.length,
      // Same for every row; the SQL computes it once over the filtered set so
      // the page can say "3 of 247" without a second round trip.
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// listReportableTenantsAction — the people you can file a report about.
//
// Reporting is a pick, not a form. Typing a name and CNIC by hand produced the
// two failure modes this registry can least afford: a typo makes the report
// permanently unfindable (indistinguishable from "never reported"), and a
// mistyped CNIC flags an innocent stranger who has no way to know. Selecting a
// tenant takes both identifiers straight from the record that was captured at
// check-in, already normalised.
//
// It also removes a whole class of abuse: every report now traces to a real
// tenancy in the reporter's own branch. There is deliberately NO free-text
// escape hatch — someone who never joined owes nothing, so there is nothing to
// report.
// ---------------------------------------------------------------------------

export async function listReportableTenantsAction(): Promise<{
  tenants?: {
    id: string; fullName: string; cnic: string | null; phone: string | null;
    roomNumber: string | null; checkOut: string | null; alreadyReported: boolean;
  }[];
  error?: string;
}> {
  try {
    const { scope, error } = await resolveScope("standard", { allowManager: false });
    if (error || !scope) return { error };

    const supabase = await createClient();
    const [{ data: tenants, error: tErr }, { data: mine, error: mineErr }] = await Promise.all([
      supabase
        .from("hms_tenants")
        .select("id, full_name, cnic, phone, check_out, is_active, room:hms_rooms(room_number)")
        .eq("hostel_id", scope.hostelId)
        .eq("is_waiting", false)
        .order("check_out", { ascending: false, nullsFirst: false })
        .order("full_name"),
      // Filed already, so the picker can grey them out rather than let someone
      // report the same person twice and split the amount across two entries.
      supabase
        .from("hms_redflags")
        .select("cnic_digits, phone_digits, reported_tenant_id")
        .eq("reported_by_hostel_id", scope.hostelId)
        .eq("status", "reported"),
    ]);

    if (tErr) return { error: tErr.message };
    // Not ignorable. If this read fails, every tenant comes back
    // alreadyReported:false, the duplicate warning never renders, and the same
    // person gets filed twice with the debt split across two rows — in a
    // registry with no DELETE path.
    if (mineErr) return { error: mineErr.message };

    const reportedTenantIds = new Set((mine ?? []).map((r) => r.reported_tenant_id).filter(Boolean));
    const reportedCnic = new Set((mine ?? []).map((r) => r.cnic_digits).filter(Boolean));

    const rows = (tenants ?? [])
      .map((t) => {
        const rel = t.room as unknown as { room_number?: string } | { room_number?: string }[] | null;
        const room = Array.isArray(rel) ? rel[0] : rel;
        const cnicDigits = String(t.cnic ?? "").replace(/\D/g, "") || null;
        const phoneDigits = normalizePhoneDigits(t.phone as string | null);
        return {
          id: t.id as string,
          fullName: t.full_name as string,
          cnic: (t.cnic as string | null) ?? null,
          phone: (t.phone as string | null) ?? null,
          roomNumber: room?.room_number ?? null,
          checkOut: (t.check_out as string | null) ?? null,
          isActive: !!t.is_active,
          // By tenant id, then by CNIC for rows filed before migration 148.
          // Deliberately NOT by phone: numbers are shared (six tenants on one
          // number in live data), so a phone match would grey out five innocent
          // people the moment the sixth was reported.
          alreadyReported:
            reportedTenantIds.has(t.id as string) ||
            (!!cnicDigits && reportedCnic.has(cnicDigits)),
          hasKey: !!cnicDigits || !!phoneDigits,
        };
      })
      // A tenant with neither CNIC nor phone cannot be found by anyone, so a
      // report about them would be write-only. Excluded rather than offered and
      // then rejected on submit.
      .filter((t) => t.hasKey)
      // Someone who has left is the usual case; still-resident names sort last
      // so the common choice is at the top of the list.
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? 1 : -1;
        if (a.checkOut && b.checkOut) return b.checkOut.localeCompare(a.checkOut);
        return a.fullName.localeCompare(b.fullName);
      })
      .map(({ hasKey: _hasKey, isActive: _isActive, ...rest }) => rest);

    return { tenants: rows };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Disclaimer gate
// ---------------------------------------------------------------------------

export async function acceptRedflagDisclaimerAction(): Promise<{ success?: boolean; error?: string }> {
  try {
    // Deliberately does NOT require the disclaimer — this is the action that
    // grants it. It still requires a signed-in owner/partner with a branch;
    // the acceptance is per owner account and there is no manager surface for
    // it, so a manager is refused with an { error }, never a redirect.
    const { scope, error } = await resolveScope("read_only", {
      requireDisclaimer: false,
      allowManager: false,
    });
    if (error || !scope) return { error };

    const supabase = await createClient();
    // INSERT, not upsert. hms_redflag_acceptances has a SELECT and an INSERT
    // policy but deliberately no UPDATE policy — an acceptance is a dated record
    // of consent, not a mutable setting. An upsert therefore fails under RLS the
    // moment a row already exists, and would surface a raw Postgres error on a
    // path the user experiences as "I already agreed to this".
    //
    // A duplicate key here means the caller has accepted before, which is the
    // outcome this action exists to produce — so it is success, not a conflict.
    const { error: insErr } = await supabase
      .from("hms_redflag_acceptances")
      .insert({ user_id: scope.userId, accepted_at: new Date().toISOString(), version: 1 });

    if (insErr && insErr.code !== "23505") return { error: insErr.message };
    revalidatePath("/redflag");
    return { success: true };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
