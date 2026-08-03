-- RedFlag — the shared tenant-defaulter registry.
--
-- WHY THIS IS DIFFERENT FROM EVERY OTHER TABLE IN THIS SCHEMA
-- Every table added since 001 is single-org: an owner sees their own hostels
-- and nothing else, and the whole model bottoms out at
-- `hms_hostels.owner_id = auth.uid()` (or the hms_owner_hostels junction, or
-- hms_partner_hostel_ids() from 093). hms_redflags is the FIRST table that is
-- deliberately readable ACROSS organisations: hostel A reports a tenant who
-- absconded owing rent, and hostel B — a different owner, a different account,
-- no partnership, no shared branch — must be able to find that report before
-- they hand over a room. That inversion is the entire point of the feature and
-- also the entire risk, so the access model below is built to be read
-- adversarially.
--
-- PRIOR STATE
-- Nothing exists. No hms_redflag* table, function, policy or index is present,
-- and no application code reads or writes any of them yet. Every object in this
-- migration is new; not one existing table, policy, trigger, function, index or
-- grant is dropped, altered or weakened. This file is purely ADDITIVE, per the
-- rule stated in 094_partner_branch_parity.sql:27-28. Blast radius on existing
-- behaviour is therefore zero — if RedFlag were reverted tomorrow, deleting
-- these objects would restore the schema exactly.
--
-- THE ARCHITECTURAL CONSTRAINT THAT SHAPES EVERYTHING BELOW
-- RedFlag is gender-segregated: a boys hostel must only ever see reports that
-- originated at boys hostels, and girls likewise. A Postgres RLS policy CANNOT
-- enforce that, because a policy cannot know which BRANCH the caller is
-- currently viewing. The active branch lives in the httpOnly cookie
-- `hms_active_hostel`, read only in Node by getAuthContext(); it is not a JWT
-- claim and not a GUC, and this repo contains zero uses of set_config /
-- current_setting / request.jwt. There is no way for a policy predicate to
-- reach it. This is not academic: at least one production owner
-- (351a6611-...) owns BOTH a boys branch and a girls branch under one
-- auth.uid(), so any policy written in terms of auth.uid() alone would hand
-- that account both genders at once.
--
-- The resolution: gender segregation lives in SECURITY DEFINER functions that
-- take the branch id as an explicit PARAMETER and re-verify, from scratch, that
-- the caller may act for that branch. The branch id becomes untrusted input
-- that the database validates, instead of ambient state the database cannot
-- see. Cross-org reads happen ONLY through those functions
-- (hms_redflag_search, hms_redflag_list). RLS on hms_redflags is deliberately
-- NARROWER than the feature: it grants an org access to its OWN reports and
-- nothing else, so that even a total failure of the function layer cannot leak
-- one org's rows to another through a direct PostgREST select.
--
-- ANTI-RECURSION (the 092 outage, documented in 093:1-13 and 094:18-25)
-- The single policy predicate here that touches another table routes through
-- hms_redflag_can_access_hostel(), a STABLE SECURITY DEFINER function. There is
-- no inline `select ... from hms_hostels` or `... from hms_partnerships` in any
-- policy below. hms_hostels' own policies do not reference hms_redflags, so no
-- cycle can form in either direction — but the function form is used anyway,
-- because 092 proved that a policy which is acyclic today becomes an outage the
-- moment someone adds a policy to the other table.
--
-- COLUMN-SHADOWING (the 078 bug)
-- 078 found that an unqualified `hostel_id` inside an EXISTS over
-- hms_owner_hostels binds to hms_owner_hostels' OWN column, silently turning
-- that predicate into a tautology. Every correlated reference below is either
-- table-qualified or a p_-prefixed function parameter, which no column can
-- shadow.
--
-- MASKING HAPPENS IN SQL, NOT IN THE FRONTEND
-- A full CNIC belonging to org A must never be transmitted to org B, not even
-- into a React prop that a component happens not to render. The masking is
-- therefore applied inside the SECURITY DEFINER functions, before the row ever
-- leaves Postgres.
--
-- The unmasked value is returned exactly when the caller could already SELECT
-- the raw row through the "Org reads own redflags" policy in section 10 — that
-- is, the predicate that decides masking and the predicate that decides raw
-- table access are THE SAME EXPRESSION, written once in each place and tested
-- together. An earlier draft masked on `reported_by_owner_id = auth.uid()`
-- while RLS granted reads to any active partner of the reporting branch, so a
-- partner who was masked through the RPC could read the very same row —
-- unmasked, plus notes — with one direct PostgREST select. A mask that a
-- one-line select defeats is not a control, it is a decoration; the two are
-- deliberately reconciled rather than left to diverge again.
--
-- ANTI-SCRAPING NOTE ON THE AUDIT LOG
-- hms_redflag_audit records that a search happened, by whom, from which branch,
-- which key TYPE was used, and how many rows came back. It never stores the
-- searched CNIC or phone. An audit table that logged raw lookup keys would
-- itself become a national-identity-number database assembled from every
-- competitor's tenant roster, readable by anyone who ever obtained a service
-- role key — a strictly worse asset to hold than the registry it audits.
--
-- THE NODE LAYER IS NOT A SECURITY BOUNDARY
-- Every RedFlag RPC below is GRANT EXECUTE ... TO authenticated, and every
-- RedFlag table is reachable over PostgREST with the anon key plus the caller's
-- own access token — both of which are sitting in the browser. A signed-in user
-- can therefore call hms_redflag_search / hms_redflag_list and INSERT/UPDATE
-- hms_redflags DIRECTLY, skipping app/actions/redflag.ts entirely. Anything the
-- server action does that MATTERS — the hourly lookup budget, the length and
-- character limits, the "you cannot file a report as somebody else" rule, the
-- audit trail — is therefore duplicated here, in SQL, and this file is the
-- authority. The checks that remain in Node are a nicer error message on the
-- happy path, nothing more.
--
-- Consequences of that rule, all implemented below:
--   * the lookup budget is counted and enforced inside hms_redflag_search and
--     hms_redflag_list (section 6), not in the action;
--   * hms_redflag_list is VOLATILE, paginated and audited, so the bulk path
--     leaves the same trail and pays the same budget as the targeted one;
--   * every audit row for a write is produced by an AFTER trigger (section 9),
--     so no write path — action, direct PostgREST call, or psql — can skip it;
--   * the write policies (section 10) route through
--     hms_redflag_can_write_hostel(), so a read-only partner cannot file a
--     report even though they can read the branch.

-- ---------------------------------------------------------------------------
-- 1. Pure helpers: normalisation and masking.
--
--    Normalisation is shared by the INSERT trigger and by the search function
--    on purpose. If the write path and the read path normalised differently —
--    say the app stored '923001234567' but a search compared against
--    '03001234567' — the registry would silently return zero hits and the
--    feature would look empty rather than broken. One implementation, called
--    from both sides, makes that class of bug impossible.
--
--    These four are IMMUTABLE and STRICT (NULL in -> NULL out) and touch no
--    table. They still pin search_path so Supabase's function_search_path_mutable
--    advisor stays clean and so no temp-schema object can shadow anything.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_normalize_cnic(p_cnic text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
  SELECT nullif(regexp_replace(p_cnic, '[^0-9]', '', 'g'), '')
$$;

-- Pakistani mobile numbers arrive as 0300-1234567, +92 300 1234567,
-- 00923001234567 and 3001234567. All four must collapse to 923001234567 or the
-- registry cannot match a report filed by one hostel against a search run by
-- another.
--
-- *** THIS IS A LINE-FOR-LINE MIRROR OF normalizePhoneDigits() IN lib/phone.ts.
-- *** The two MUST stay identical. The app normalises on the way in and this
-- *** function normalises the value being searched for; the instant they
-- *** disagree on any input shape, RedFlag stops matching and reports silently
-- *** become invisible — a failure that looks exactly like "no results" and so
-- *** would not be noticed. The rules are applied SEQUENTIALLY, not as mutually
-- *** exclusive branches, because '00' + '0300…' must have BOTH the
-- *** international trunk and the local trunk peeled, in that order.
CREATE OR REPLACE FUNCTION public.hms_redflag_normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  d text;
BEGIN
  d := regexp_replace(p_phone, '[^0-9]', '', 'g');

  -- Too short to be a real number: one explicit "unusable" answer rather than a
  -- silently bad match. Checked before any prefix rewriting, as lib/phone.ts does.
  IF length(d) < 10 THEN
    RETURN NULL;
  END IF;

  IF left(d, 2) = '00' THEN
    d := substr(d, 3);
  END IF;

  IF left(d, 1) = '0' THEN
    d := '92' || substr(d, 2);
  ELSIF left(d, 2) <> '92' AND length(d) = 10 THEN
    -- '3001234567' / '4251234567' — a PK number with both '+92' and '0' omitted.
    d := '92' || d;
  END IF;

  IF length(d) < 10 OR length(d) > 15 THEN
    RETURN NULL;
  END IF;

  RETURN d;
END;
$$;

-- '4210112345671' -> '*****-*******-1'. Only the final digit survives.
--
-- The first five digits are NOT retained, contrary to the obvious reading that
-- they are "not individuating". A Pakistani CNIC's first five digits are the
-- province, division, district and tehsil of registration. On their own they
-- place a person in one tehsil; combined with the full name that this same row
-- returns in clear, they are a re-identification key, and across the registry
-- they let anyone assemble a home-district distribution of every reported
-- defaulter on the platform. They buy nothing in exchange: the only job this
-- string has is to let an operator holding the physical card confirm "yes, this
-- report is about the person in front of me", and the last digit plus the name
-- and the amount already does that. The dashed shape is kept so the value still
-- reads as a CNIC in the UI.
--
-- The last digit is deliberately kept even though CNIC digit 13 encodes sex:
-- the registry is gender-segregated at the query level, so every row a caller
-- can see is already the same sex as their own branch. That digit discloses
-- nothing the caller does not have by construction.
CREATE OR REPLACE FUNCTION public.hms_redflag_mask_cnic(p_digits text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN length(p_digits) < 7 THEN repeat('*', length(p_digits))
    ELSE repeat('*', 5) || '-' || repeat('*', length(p_digits) - 6) || '-' || right(p_digits, 1)
  END
$$;

-- '923001234567' -> '9230******67'. Keeps the country + network prefix and the
-- last two digits, which is enough for the searching owner to confirm a match
-- they already hold and not enough to dial or to reconstruct.
CREATE OR REPLACE FUNCTION public.hms_redflag_mask_phone(p_digits text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN length(p_digits) < 7 THEN repeat('*', length(p_digits))
    ELSE substr(p_digits, 1, 4) || repeat('*', length(p_digits) - 6) || right(p_digits, 2)
  END
$$;

-- Removes the characters that let a stored string be RENDERED as something
-- other than what it is: C0 controls and DEL, the zero-width and directional
-- formatting marks (U+200B-200F), the bidi overrides (U+202A-202E) and the bidi
-- isolates (U+2066-2069). A full_name of 'Ali <U+202E>drawkcab' displays
-- reversed in every browser, every PDF and every email client, so a report can
-- be filed against one string and shown to the accused — and to a court — as
-- another. Zero-width characters additionally let two visually identical names
-- exist as different rows, defeating human review of the registry.
--
-- *** MIRRORS CONTROL_CHARS IN app/actions/redflag.ts. The app strips on the way
-- *** in; this strips again inside the write triggers, so the direct-PostgREST
-- *** path that never touches the server action is cleaned identically. The
-- *** trigger is the authority — see the header note on Node not being a
-- *** security boundary.
--
-- U+0000 is absent from the class only because Postgres text cannot hold a NUL
-- byte at all: it is rejected by the input parser long before any trigger runs,
-- so there is nothing left for this function to strip.
CREATE OR REPLACE FUNCTION public.hms_redflag_strip_control(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
    p_text,
    '[\x01-\x1F\x7F\x200B-\x200F\x202A-\x202E\x2066-\x2069]',
    '',
    'g'
  )
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_normalize_cnic(text)  FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_normalize_phone(text) FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_mask_cnic(text)       FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_mask_phone(text)      FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_strip_control(text)   FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_normalize_cnic(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_redflag_normalize_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_redflag_mask_cnic(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_redflag_mask_phone(text)      TO authenticated;
-- hms_redflag_strip_control is deliberately NOT granted to authenticated: it is
-- only ever called from the SECURITY DEFINER write triggers, which run as the
-- function owner and do not need the caller to hold EXECUTE.

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hms_redflags (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by_hostel_id UUID           NOT NULL REFERENCES hms_hostels(id) ON DELETE CASCADE,
  -- Denormalised, and pinned by the BEFORE INSERT trigger to the reporting
  -- branch's owner_id. Never trusted from the client: it is the org boundary
  -- that both the RLS policies and the "show me my own report unmasked" rule
  -- are written against, so a client-supplied value here would be a direct
  -- unmasking primitive.
  reported_by_owner_id  UUID           NOT NULL,
  -- Frozen at report time from hms_hostels.hostel_type. Snapshotted rather than
  -- joined because a branch can be re-typed in Settings; a boys report must not
  -- silently migrate into the girls registry (or vice versa) years later.
  gender                TEXT           NOT NULL CHECK (gender IN ('boys', 'girls')),
  -- The 120 ceiling is not cosmetic. A direct PostgREST insert (no server
  -- action, no MAX_NAME_LEN) filed a 3,000-character "name" during the security
  -- review, and a 5,006-character one by UPDATE: this column is displayed to
  -- other organisations, so an unbounded value is a defacement and a layout
  -- attack on every competitor's registry page at once. Matches MAX_NAME_LEN in
  -- app/actions/redflag.ts; the trigger strips control characters BEFORE this
  -- runs (CHECKs fire after BEFORE triggers), so padding a name with zero-width
  -- characters cannot buy extra length either.
  full_name             TEXT           NOT NULL
    CHECK (char_length(trim(full_name)) > 0 AND char_length(full_name) <= 120),
  cnic_digits           TEXT,
  cnic_display          TEXT,
  phone_digits          TEXT,
  phone_display         TEXT,
  -- NUMERIC(12,2) alone permits 9,999,999,999.99 — ten billion rupees, which a
  -- direct insert duly accepted. The ceiling is the app's MAX_AMOUNT: an
  -- absurd figure attached to a named person is the most damaging field in the
  -- row and the easiest to typo or to weaponise.
  amount                NUMERIC(12, 2) NOT NULL CHECK (amount >= 0 AND amount <= 9999999.99),
  months_unpaid         INTEGER        CHECK (months_unpaid IS NULL OR months_unpaid >= 0),
  notes                 TEXT           CHECK (notes IS NULL OR char_length(notes) <= 2000),
  status                TEXT           NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'resolved')),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  -- A report with no lookup key is unfindable and therefore only defamatory.
  CONSTRAINT hms_redflags_lookup_key_present
    CHECK (cnic_digits IS NOT NULL OR phone_digits IS NOT NULL),
  CONSTRAINT hms_redflags_cnic_digits_format
    CHECK (cnic_digits IS NULL OR cnic_digits ~ '^[0-9]{13}$'),
  CONSTRAINT hms_redflags_phone_digits_format
    CHECK (phone_digits IS NULL OR phone_digits ~ '^[0-9]{10,15}$')
);

ALTER TABLE hms_redflags ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hms_redflags IS
  'Cross-organisation tenant-defaulter registry. The ONLY table in this schema whose rows are readable outside the owning org, and only ever through hms_redflag_search() / hms_redflag_list(), never through RLS.';
COMMENT ON COLUMN hms_redflags.reported_by_owner_id IS
  'Owner of the reporting branch, pinned by hms_redflag_before_insert(). The org boundary for RLS and for the unmasked-own-report rule. Not client-writable.';
COMMENT ON COLUMN hms_redflags.gender IS
  'Snapshot of the reporting branch hostel_type at report time. Immutable. Drives the only cross-org visibility filter that exists.';
COMMENT ON COLUMN hms_redflags.cnic_digits IS
  '13 digits, no dashes. Lookup key. Never returned to another org — hms_redflag_search() emits hms_redflag_mask_cnic() of this instead.';
COMMENT ON COLUMN hms_redflags.cnic_display IS
  'Canonical XXXXX-XXXXXXX-X, shown only to the reporting org itself.';
COMMENT ON COLUMN hms_redflags.phone_digits IS
  'Digits only, leading 0 rewritten to 92 (e.g. 923001234567). A weaker key than CNIC: a single number is shared by dozens of tenants in real data.';

CREATE TABLE IF NOT EXISTS hms_redflag_acceptances (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version     INTEGER     NOT NULL DEFAULT 1
);

ALTER TABLE hms_redflag_acceptances ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hms_redflag_acceptances IS
  'One-time acceptance of the RedFlag legal disclaimer. No precedent elsewhere in this app: RedFlag is the only feature where a user publishes an accusation about a named third party to other companies, so consent to the terms is recorded per user, with a version so the terms can be re-presented later.';

-- Append-only. Reads/writes are service-role or SECURITY DEFINER only; see the
-- RLS block below for why it has no policies at all.
CREATE TABLE IF NOT EXISTS hms_redflag_audit (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  redflag_id UUID        REFERENCES hms_redflags(id) ON DELETE SET NULL,
  actor_id   UUID        NOT NULL,
  hostel_id  UUID,
action     TEXT        NOT NULL CHECK (action IN ('reported', 'resolved', 'edited', 'searched', 'viewed')),
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hms_redflag_audit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hms_redflag_audit IS
  'Append-only RedFlag access log. ON DELETE SET NULL on redflag_id, and no FK on actor_id/hostel_id, so the trail survives deletion of the report, the account or the branch it describes (same reasoning as hms_audit_log in 017).';
COMMENT ON COLUMN hms_redflag_audit.meta IS
  'MUST NOT contain a searched CNIC or phone. For action=searched it holds only {by_cnic, by_phone, hits, gender} — otherwise this table would accumulate into a CNIC database built from every org''s tenant roster.';

-- ---------------------------------------------------------------------------
-- 3. Indexes.
--
--    hms_tenants.cnic has no index today, which is survivable because tenant
--    lookups are always already scoped to one hostel's few hundred rows.
--    hms_redflags is scoped to nothing — a search scans every report filed by
--    every hostel on the platform — so these are load-bearing from day one.
--    The two lookup indexes are partial: roughly half the rows will carry only
--    one of the two keys.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_hms_redflags_cnic_digits
  ON hms_redflags (cnic_digits) WHERE cnic_digits IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hms_redflags_phone_digits
  ON hms_redflags (phone_digits) WHERE phone_digits IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hms_redflags_gender_status
  ON hms_redflags (gender, status);

CREATE INDEX IF NOT EXISTS idx_hms_redflags_owner
  ON hms_redflags (reported_by_owner_id);

CREATE INDEX IF NOT EXISTS idx_hms_redflags_hostel
  ON hms_redflags (reported_by_hostel_id);

-- Supports abuse review: "everything this account did, newest first".
CREATE INDEX IF NOT EXISTS idx_hms_redflag_audit_actor_created
  ON hms_redflag_audit (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hms_redflag_audit_redflag
  ON hms_redflag_audit (redflag_id);

-- Supports hms_redflag_enforce_lookup_budget() (section 6), which runs on EVERY
-- lookup and every registry page. Partial on the two countable actions and
-- ordered by time descending, so the scan is one actor's recent countable rows
-- and stops the moment it walks past the one-hour boundary.
--
-- KNOWN TRADEOFF, ACCEPTED DELIBERATELY: the budget is a COUNT over a table the
-- attacker grows at request rate — each of their calls adds a row the next call
-- must count. A counter table (one upserted row per actor per hour) would be
-- O(1) and would not feed itself. It is not used because it is a second source
-- of truth that can silently drift from the audit trail, which is the artefact
-- an abuse investigation actually reads, and because the growth is bounded by
-- the budget itself: an actor cannot push more than ~30 countable rows into the
-- window before being refused, so the COUNT sees tens of rows, not millions.
-- Revisit if the budget is ever raised into the thousands, or if a per-org
-- rather than per-user budget is introduced.
CREATE INDEX IF NOT EXISTS idx_hms_redflag_audit_budget
  ON hms_redflag_audit (actor_id, created_at DESC)
  WHERE action IN ('searched', 'viewed');

-- ---------------------------------------------------------------------------
-- 4. Access helper.
--
--    "May auth.uid() act for this branch?" — the three routes an account can
--    legitimately reach a branch by, matching the set already used everywhere
--    else in this schema: direct owner (001), owner via the hms_owner_hostels
--    junction (023), and active partner (093). hms_partner_hostel_ids() is
--    REUSED, not reimplemented, so a future change to what "active partner"
--    means propagates here automatically.
--
--    SECURITY DEFINER for the 093 reason: called from a policy on hms_redflags,
--    it must not re-trigger the RLS of hms_hostels / hms_owner_hostels /
--    hms_partnerships.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_can_access_hostel(p_hostel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_hostel_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM hms_hostels h
         WHERE h.id = p_hostel_id AND h.owner_id = auth.uid()
       )
       OR EXISTS (
         SELECT 1 FROM hms_owner_hostels oh
         WHERE oh.hostel_id = p_hostel_id AND oh.owner_id = auth.uid()
       )
       OR p_hostel_id IN (SELECT hms_partner_hostel_ids())
     )
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_can_access_hostel(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_can_access_hostel(uuid) TO authenticated;

COMMENT ON FUNCTION public.hms_redflag_can_access_hostel(uuid) IS
  'TRUE when auth.uid() may act for p_hostel_id as direct owner, junction owner, or active partner. SECURITY DEFINER to break the 092-class RLS recursion. Returns FALSE, never raises, for NULL/unknown ids and for the service role (auth.uid() IS NULL).';

-- The WRITE half of the same question, and the only difference is the partner
-- route: hms_partner_write_hostel_ids() from 094 (standard + full) instead of
-- hms_partner_hostel_ids() from 093 (any active tier, including read_only).
--
-- WHY THIS EXISTS AS A SEPARATE FUNCTION. Reading the registry and publishing
-- into it are not the same act. Filing a RedFlag report is an accusation
-- against a named third party, attributed to an organisation that the reporter
-- may not be the owner of, and it is irreversible by design (there is no DELETE
-- policy — a report is resolved, never erased). A read_only partner is someone
-- given a window onto a branch's data; the tier exists precisely to say "look,
-- do not act". Gating the write policies on hms_redflag_can_access_hostel()
-- would have handed every read_only partner on the platform the ability to
-- publish accusations under someone else's org name — verified during the
-- security review by filing a report as a read_only partner in one direct
-- PostgREST insert.
--
-- app/actions/redflag.ts already requires the 'standard' tier for filing and
-- resolving, but that check lives in Node and the table is reachable without
-- it. This is the same rule expressed where it cannot be skipped.
CREATE OR REPLACE FUNCTION public.hms_redflag_can_write_hostel(p_hostel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_hostel_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM hms_hostels h
         WHERE h.id = p_hostel_id AND h.owner_id = auth.uid()
       )
       OR EXISTS (
         SELECT 1 FROM hms_owner_hostels oh
         WHERE oh.hostel_id = p_hostel_id AND oh.owner_id = auth.uid()
       )
       OR p_hostel_id IN (SELECT hms_partner_write_hostel_ids())
     )
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_can_write_hostel(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_can_write_hostel(uuid) TO authenticated;

COMMENT ON FUNCTION public.hms_redflag_can_write_hostel(uuid) IS
  'TRUE when auth.uid() may FILE OR EDIT RedFlag reports for p_hostel_id: direct owner, junction owner, or standard/full partner. Read-only partners are excluded — they can read the branch but must not publish accusations under its name.';

-- ---------------------------------------------------------------------------
-- 5. Branch gender gate.
--
--    The single chokepoint for cross-org visibility. It answers "which registry
--    is this caller allowed to look at right now" and refuses in three distinct
--    ways, each with a message the UI can surface verbatim:
--      * no session at all (the RPC was called with the service role key, which
--        has no auth.uid() and therefore no org — a caller-side mistake that
--        would otherwise degrade into a confusing "no access" error);
--      * the caller cannot act for this branch (the branch id is untrusted
--        input, so this is where a forged p_hostel_id dies);
--      * the branch is mixed/family/NULL-typed and has no place in a
--        gender-segregated registry. That last one is intended behaviour, not a
--        bug: there is no correct answer to "which gender's reports should a
--        family hostel see", so the feature is simply closed for them until
--        they pick one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_branch_gender(p_hostel_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'RedFlag requires a signed-in user. Call this function with the user session client, not the service role.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT hms_redflag_can_access_hostel(p_hostel_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch.'
      USING ERRCODE = '42501';
  END IF;

  SELECT h.hostel_type INTO v_type FROM hms_hostels h WHERE h.id = p_hostel_id;

  IF v_type IS NULL OR v_type NOT IN ('boys', 'girls') THEN
    RAISE EXCEPTION 'This branch has no gender set. Set it to Boys or Girls in Settings to use RedFlag.'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_type;
END;
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_branch_gender(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_branch_gender(uuid) TO authenticated;

COMMENT ON FUNCTION public.hms_redflag_branch_gender(uuid) IS
  'Returns ''boys'' or ''girls'' for a branch the caller may act for; raises otherwise. The sole gate for cross-org RedFlag visibility — RLS cannot do this job because it cannot see the hms_active_hostel cookie.';

-- ---------------------------------------------------------------------------
-- 6. The lookup budget.
--
--    RedFlag's search is an ORACLE over other companies' tenant rosters: feed
--    it a CNIC and it answers yes/no, with a name and an amount attached. The
--    risk is not one wrong answer, it is bulk enumeration — and the browsable
--    registry is the same disclosure without even needing a key. So both are
--    metered, against ONE budget.
--
--    THIS LIVES IN SQL BECAUSE IT DID NOT WORK ANYWHERE ELSE. The budget was
--    originally enforced only in checkTenantRedflagAction(), while
--    hms_redflag_search was GRANT EXECUTE ... TO authenticated. A signed-in
--    user holds both the anon key and their own access token in the browser, so
--    they can call the RPC directly and never reach the Node check: 60
--    consecutive direct calls were made during the security review and not one
--    was refused. Any limit that a `supabase.rpc(...)` from the console can walk
--    around is not a limit.
--
--    WHY 'searched' AND 'viewed' SHARE ONE BUDGET. They are the same
--    disclosure by different routes. A budget that counted only searches would
--    be sidestepped by paging hms_redflag_list, which returns the whole
--    same-gender registry rather than one person. Charging both to one counter
--    means there is no cheaper door.
--
--    The number is defined ONCE, here, so that the SQL enforcement and the
--    app's LOOKUPS_PER_HOUR cannot drift into disagreeing about what the limit
--    is — a drift whose failure mode is a limit that silently stops applying.
--    app/actions/redflag.ts should read it from this function rather than
--    declaring its own copy.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_lookup_budget()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- 30/hour: far above any believable front-desk workload (a busy branch admits
  -- a handful of tenants a day) and far below a useful scraping rate.
  SELECT 30
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_lookup_budget() FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_lookup_budget() TO authenticated;

-- Counted from the audit table rather than from a server-side counter, so the
-- budget survives a deploy, cannot be reset by the client, and is reconstructable
-- after the fact from the same rows an abuse investigation reads. See the
-- comment on idx_hms_redflag_audit_budget in section 3 for the cost tradeoff.
--
-- Raises rather than returning false: every caller is a user-facing RPC and the
-- refusal message is meant to be surfaced verbatim.
CREATE OR REPLACE FUNCTION public.hms_redflag_enforce_lookup_budget()
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_budget integer := hms_redflag_lookup_budget();
  v_used   integer;
BEGIN
  SELECT count(*) INTO v_used
    FROM hms_redflag_audit a
   WHERE a.actor_id = auth.uid()
     AND a.action IN ('searched', 'viewed')
     AND a.created_at > now() - interval '1 hour';

  IF v_used >= v_budget THEN
    RAISE EXCEPTION 'You have reached the limit of % RedFlag lookups per hour. Please try again later.', v_budget
      USING ERRCODE = '53400';
  END IF;
END;
$$;

-- Not granted to authenticated: it is called only from the SECURITY DEFINER
-- RPCs below, which run as the function owner. Leaving it callable would let a
-- client probe its own remaining budget, which is of no use to an honest user
-- and tells a scraper exactly when to pause.
REVOKE ALL ON FUNCTION public.hms_redflag_enforce_lookup_budget() FROM public;

COMMENT ON FUNCTION public.hms_redflag_enforce_lookup_budget() IS
  'Raises 53400 when auth.uid() has already spent hms_redflag_lookup_budget() searched+viewed audit rows in the trailing hour. Called by hms_redflag_search() and hms_redflag_list() before any registry data is read.';

-- ---------------------------------------------------------------------------
-- 7. Cross-org search.
--
--    Exact-match only, on a fully normalised key. No prefix, no LIKE, no
--    trigram, no "return everything when the argument is blank": each of those
--    would turn this function into a bulk export of every defaulter on the
--    platform. The caller must already know the CNIC or phone of the specific
--    person standing in front of them.
--
--    VOLATILE because it writes its own audit row. That row is written after
--    the result set is materialised, so `hits` is the true number of rows
--    handed over, and it deliberately records only WHICH KIND of key was used,
--    never the key itself.
--
--    The hourly budget (section 6) is charged BEFORE the branch's registry is
--    touched, so a refused call discloses nothing and — because the exception
--    aborts the statement — writes no audit row of its own to inflate the
--    counter further.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_search(
  p_hostel_id    uuid,
  p_cnic_digits  text,
  p_phone_digits text
)
RETURNS TABLE (
  id               uuid,
  full_name        text,
  cnic_masked      text,
  phone_masked     text,
  amount           numeric,
  months_unpaid    integer,
  status           text,
  reported_at      timestamptz,
  match_kind       text,
  reported_by_self boolean
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gender text;
  v_cnic   text;
  v_phone  text;
  v_actor  uuid := auth.uid();
  v_hits   integer := 0;
BEGIN
  -- Access + gender first: nothing below this line runs for a caller who has
  -- no business reading this branch's registry.
  v_gender := hms_redflag_branch_gender(p_hostel_id);

  v_cnic  := hms_redflag_normalize_cnic(p_cnic_digits);
  v_phone := hms_redflag_normalize_phone(p_phone_digits);

  IF v_cnic IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'Enter a CNIC or a phone number to search RedFlag.'
      USING ERRCODE = '22023';
  END IF;

  -- Reject partial keys outright rather than matching on them. A 3-digit "CNIC"
  -- that matched by prefix would enumerate the registry in a few thousand calls.
  IF v_cnic IS NOT NULL AND v_cnic !~ '^[0-9]{13}$' THEN
    RAISE EXCEPTION 'Enter the full 13-digit CNIC.'
      USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'Enter a complete phone number.'
      USING ERRCODE = '22023';
  END IF;

  -- Charged here, after the input is known to be well-formed (so a typo never
  -- costs a slot) and before any registry row is read.
  PERFORM hms_redflag_enforce_lookup_budget();

  RETURN QUERY
  -- `own` is computed once per candidate row in the CTE rather than three times
  -- inline; it is the SAME predicate as the "Org reads own redflags" policy in
  -- section 10, so the RPC never masks a row that a plain select would hand over
  -- unmasked. The cheap column comparison is written first so that for the
  -- caller's own rows the SECURITY DEFINER call is usually skipped.
  WITH hits AS (
    SELECT r.*,
           (r.reported_by_owner_id = v_actor
            OR hms_redflag_can_access_hostel(r.reported_by_hostel_id)) AS own
      FROM hms_redflags r
     WHERE r.gender = v_gender
       AND (
         (v_cnic  IS NOT NULL AND r.cnic_digits  = v_cnic)
         OR
         (v_phone IS NOT NULL AND r.phone_digits = v_phone)
       )
  )
  SELECT
    h.id,
    h.full_name,
    CASE WHEN h.own
         THEN coalesce(h.cnic_display, h.cnic_digits)
         ELSE hms_redflag_mask_cnic(h.cnic_digits)
    END,
    CASE WHEN h.own
         THEN coalesce(h.phone_display, h.phone_digits)
         ELSE hms_redflag_mask_phone(h.phone_digits)
    END,
    h.amount,
    h.months_unpaid,
    h.status,
    h.created_at,
    -- CNIC is authoritative; phone is circumstantial (one number is shared by
    -- up to 28 different tenants in the live tenant data). The UI renders the
    -- two very differently, so this must never be guessed.
    CASE WHEN v_cnic IS NOT NULL AND h.cnic_digits = v_cnic THEN 'cnic' ELSE 'phone' END,
    h.own
  FROM hits h
  ORDER BY h.created_at DESC;

  GET DIAGNOSTICS v_hits = ROW_COUNT;

  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NULL,
    v_actor,
    p_hostel_id,
    'searched',
    jsonb_build_object(
      'by_cnic', v_cnic IS NOT NULL,
      'by_phone', v_phone IS NOT NULL,
      'hits', v_hits,
      'gender', v_gender
    )
  );

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_search(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_search(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.hms_redflag_search(uuid, text, text) IS
  'Exact-match cross-org RedFlag lookup, filtered to the caller branch''s gender, CNIC/phone masked in SQL for every row the caller''s org did not file. Writes one action=searched audit row that never contains the searched key.';

-- ---------------------------------------------------------------------------
-- 8. Cross-org list.
--
--    Same gate, same masking, no lookup key: the browsable registry for the
--    caller's gender.
--
--    THIS IS THE BULK PATH AND IT IS TREATED AS ONE. An earlier draft made it
--    STABLE and unpaginated, with the audit row written by the Node action, on
--    the reasoning that the app calls it on every render. Every part of that was
--    wrong: STABLE made it reachable as a plain PostgREST GET, unpaginated made
--    one call a copy of the entire same-gender registry, and an audit row
--    written in Node is an audit row that the direct RPC route simply does not
--    produce. Searching for one person left a trail; downloading everyone left
--    none. So:
--
--      * VOLATILE, and it writes its OWN action='viewed' row — row COUNT only,
--        never contents — so both routes are logged identically;
--      * paginated, with a server-side ceiling the caller cannot raise;
--      * charged to the same hourly budget as hms_redflag_search (section 6),
--        because paging the registry and querying it one person at a time are
--        the same disclosure.
--
--    p_limit and p_offset carry DEFAULTs so the existing one-argument call
--    `hms_redflag_list(p_hostel_id)` still resolves.
--
--    The DROP below removes only the earlier one-argument version of THIS
--    function, an object created by this same migration: adding parameters
--    changes the signature, so CREATE OR REPLACE would leave two overloads
--    behind and make the one-argument call ambiguous. Nothing pre-existing is
--    dropped anywhere in this file.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.hms_redflag_list(uuid);

CREATE OR REPLACE FUNCTION public.hms_redflag_list(
  p_hostel_id uuid,
  p_limit     integer DEFAULT 100,
  p_offset    integer DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  full_name        text,
  cnic_masked      text,
  phone_masked     text,
  amount           numeric,
  months_unpaid    integer,
  status           text,
  reported_at      timestamptz,
  resolved_at      timestamptz,
  reported_by_self boolean
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gender text;
  v_actor  uuid := auth.uid();
  -- Clamped, not validated: a caller who asks for 100000 rows gets 200, not an
  -- error. LEAST() is the ceiling and cannot be argued with from the client
  -- side; GREATEST() stops a negative or zero limit from erroring out mid-page.
  v_limit  integer := LEAST(GREATEST(coalesce(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(coalesce(p_offset, 0), 0);
  v_rows   integer := 0;
BEGIN
  v_gender := hms_redflag_branch_gender(p_hostel_id);

  PERFORM hms_redflag_enforce_lookup_budget();

  RETURN QUERY
  -- MATERIALIZED so the page boundary is applied BEFORE the per-row
  -- hms_redflag_can_access_hostel() call, capping that call at v_limit +
  -- v_offset evaluations rather than one per row in the registry.
  WITH page AS MATERIALIZED (
    SELECT r.*
      FROM hms_redflags r
     WHERE r.gender = v_gender
     ORDER BY r.created_at DESC
     LIMIT v_limit OFFSET v_offset
  ),
  tagged AS (
    SELECT p.*,
           (p.reported_by_owner_id = v_actor
            OR hms_redflag_can_access_hostel(p.reported_by_hostel_id)) AS own
      FROM page p
  )
  SELECT
    t.id,
    t.full_name,
    CASE WHEN t.own
         THEN coalesce(t.cnic_display, t.cnic_digits)
         ELSE hms_redflag_mask_cnic(t.cnic_digits)
    END,
    CASE WHEN t.own
         THEN coalesce(t.phone_display, t.phone_digits)
         ELSE hms_redflag_mask_phone(t.phone_digits)
    END,
    t.amount,
    t.months_unpaid,
    t.status,
    t.created_at,
    t.resolved_at,
    t.own
  FROM tagged t
  ORDER BY t.created_at DESC;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Row count and page coordinates only. Recording WHICH reports were listed
  -- would rebuild, inside the audit table, the cross-org exposure this function
  -- exists to meter.
  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NULL,
    v_actor,
    p_hostel_id,
    'viewed',
    jsonb_build_object(
      'rows', v_rows,
      'limit', v_limit,
      'offset', v_offset,
      'gender', v_gender
    )
  );

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_list(uuid, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_list(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.hms_redflag_list(uuid, integer, integer) IS
  'One page of the RedFlag registry for the caller branch''s gender, newest first, masked in SQL for every row the caller cannot already read directly. Hard ceiling of 200 rows per call. Charges the hourly lookup budget and writes its own action=viewed audit row, so the bulk path is metered and logged exactly like hms_redflag_search().';

-- ---------------------------------------------------------------------------
-- 9. Write-path triggers.
--
--    THE WHOLE WRITE CONTRACT LIVES HERE, not in app/actions/redflag.ts. The
--    table is reachable over PostgREST with a browser-held token, and during
--    the security review every one of the app's validations was walked around
--    with a single direct insert or update: a 3,000-character name, an amount
--    of 9,999,999,999.99, status='resolved' at birth, a created_at backdated by
--    years, and an update that rewrote a name to 5,006 characters containing a
--    U+202E right-to-left override. None of it wrote an audit row, because the
--    audit rows were written by the action that was never called.
--
--    So: normalise and strip in a BEFORE trigger, pin everything the client has
--    no business choosing, let the CHECK constraints (section 2) enforce the
--    sizes, and write the audit trail from AFTER triggers where no caller can
--    decline to run it.
-- ---------------------------------------------------------------------------

-- Derives the fields a client must never be allowed to choose. gender decides
-- which competitors can read the row; reported_by_owner_id decides whose CNICs
-- come back unmasked; created_at is the date the accusation is anchored to;
-- status/resolved_at decide whether it reads as live or settled. All are set
-- here from the branch or from the clock, so it makes no difference whether the
-- insert arrives via PostgREST under RLS or via createAdminClient() with the
-- service role — neither can supply them.
CREATE OR REPLACE FUNCTION public.hms_redflag_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type  text;
  v_owner uuid;
BEGIN
  SELECT h.hostel_type, h.owner_id
    INTO v_type, v_owner
    FROM hms_hostels h
   WHERE h.id = NEW.reported_by_hostel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RedFlag: reporting branch % does not exist.', NEW.reported_by_hostel_id
      USING ERRCODE = '23503';
  END IF;

  IF v_type IS NULL OR v_type NOT IN ('boys', 'girls') THEN
    RAISE EXCEPTION 'This branch has no gender set. Set it to Boys or Girls in Settings to use RedFlag.'
      USING ERRCODE = '22023';
  END IF;

  NEW.gender               := v_type;
  NEW.reported_by_owner_id := v_owner;
  NEW.cnic_digits          := hms_redflag_normalize_cnic(NEW.cnic_digits);
  NEW.phone_digits         := hms_redflag_normalize_phone(NEW.phone_digits);

  -- Rendering safety. Applied before the char_length CHECKs fire (a BEFORE
  -- trigger runs first), so stripped characters do not count toward the limit
  -- and a name made entirely of them collapses to '' and is rejected by the
  -- existing NOT-EMPTY check rather than stored as invisible.
  NEW.full_name := trim(hms_redflag_strip_control(NEW.full_name));
  NEW.notes     := nullif(trim(hms_redflag_strip_control(NEW.notes)), '');

  -- A report cannot be born resolved, and cannot be born in the past. Both were
  -- accepted from a direct insert before this: 'resolved' at birth produces a
  -- row that never appears as an active accusation yet still occupies the
  -- registry, and a backdated created_at manufactures evidence that a tenant
  -- was flagged before they were — the one field in this table most likely to
  -- be read out in a dispute. Supplied values are overwritten silently rather
  -- than rejected: there is no legitimate caller to warn.
  NEW.status      := 'reported';
  NEW.resolved_at := NULL;
  NEW.created_at  := NOW();
  NEW.updated_at  := NOW();

  RETURN NEW;
END;
$$;

-- RLS has no column-level granularity — a policy either permits the UPDATE or
-- it does not (the lesson of 097). The editable surface is therefore fixed by a
-- trigger: status, resolved_at, notes, amount, months_unpaid, full_name (plus
-- updated_at). Everything else is frozen at report time.
--
-- Deliberate divergence from 097_pin_hostel_owner_id.sql, which exempts the
-- service role via `auth.uid() IS NOT NULL`: this trigger has NO exemption.
-- Every RedFlag write in the app goes through createAdminClient() inside a
-- server action, so an auth.uid()-gated guard would be inert on exactly the
-- path that matters. Rewriting a report's identity fields is never a legitimate
-- operation for anyone; the correct move is to resolve the wrong report and
-- file a new one, so that the audit trail shows both.
CREATE OR REPLACE FUNCTION public.hms_redflag_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Pinned, not policed. created_at is restored from the row and updated_at is
  -- taken from the clock BEFORE the frozen-field test below, so a client that
  -- ships either one is ignored rather than told it was noticed. (updated_at is
  -- set again by hms_redflags_updated_at, which fires after this trigger; it is
  -- set here too so the value is correct even if that trigger is ever removed.)
  NEW.created_at := OLD.created_at;
  NEW.updated_at := NOW();

  IF NEW.id                    IS DISTINCT FROM OLD.id
  OR NEW.reported_by_hostel_id IS DISTINCT FROM OLD.reported_by_hostel_id
  OR NEW.reported_by_owner_id  IS DISTINCT FROM OLD.reported_by_owner_id
  OR NEW.gender                IS DISTINCT FROM OLD.gender
  OR NEW.cnic_digits           IS DISTINCT FROM OLD.cnic_digits
  OR NEW.cnic_display          IS DISTINCT FROM OLD.cnic_display
  OR NEW.phone_digits          IS DISTINCT FROM OLD.phone_digits
  OR NEW.phone_display         IS DISTINCT FROM OLD.phone_display
  THEN
    RAISE EXCEPTION 'RedFlag: identity fields (branch, reporter, gender, CNIC, phone) are frozen at report time. Resolve this report and file a new one instead.'
      USING ERRCODE = '42501';
  END IF;

  -- Same cleaning as the insert path. An UPDATE that rewrote full_name to 5,006
  -- characters containing a right-to-left override was accepted before this
  -- line existed; the length is then re-checked by the column CHECK, which
  -- fires after this trigger.
  NEW.full_name := trim(hms_redflag_strip_control(NEW.full_name));
  NEW.notes     := nullif(trim(hms_redflag_strip_control(NEW.notes)), '');

  IF NEW.status = 'resolved' AND OLD.status <> 'resolved' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := NOW();
  ELSIF NEW.status = 'reported' AND OLD.status = 'resolved' THEN
    NEW.resolved_at := NULL;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    -- resolved_at is a consequence of the status transition, never a field in
    -- its own right: without this, a client could move the settlement date
    -- around freely as long as it left status alone.
    NEW.resolved_at := OLD.resolved_at;
  END IF;

  RETURN NEW;
END;
$$;

-- The audit trail for writes, moved OUT of app/actions/redflag.ts and into
-- AFTER triggers.
--
-- *** THE APP'S OWN `insert into hms_redflag_audit` AFTER A REPORT OR A RESOLVE
-- *** IS NOW REDUNDANT AND MUST BE DELETED, or every report will be logged
-- *** twice. These triggers fire for every write path — server action, direct
-- *** PostgREST call, psql, service role — which is exactly why the app's copy
-- *** is the wrong place for it: it was skipped by every one of those paths
-- *** except the first.
--
-- SECURITY DEFINER because hms_redflag_audit has RLS enabled and no policies.
-- actor_id falls back to the reporting owner when auth.uid() is NULL (a
-- service-role write), because the column is NOT NULL and "the org this was
-- filed under" is a truer answer than a lost row.
CREATE OR REPLACE FUNCTION public.hms_redflag_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NEW.id,
    coalesce(auth.uid(), NEW.reported_by_owner_id),
    NEW.reported_by_hostel_id,
    'reported',
    jsonb_build_object(
      'by_cnic',  NEW.cnic_digits  IS NOT NULL,
      'by_phone', NEW.phone_digits IS NOT NULL
    )
  );
  RETURN NULL;
END;
$$;

-- 'resolved' for the reported -> resolved transition, 'edited' for everything
-- else. meta records WHICH FIELDS changed and never their values: an audit log
-- that stored the old and new full_name would accumulate exactly the personal
-- data the rest of this file works to keep out of it.
CREATE OR REPLACE FUNCTION public.hms_redflag_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fields text[] := ARRAY[]::text[];
  v_action text;
BEGIN
  IF NEW.full_name     IS DISTINCT FROM OLD.full_name     THEN v_fields := array_append(v_fields, 'full_name');     END IF;
  IF NEW.amount        IS DISTINCT FROM OLD.amount        THEN v_fields := array_append(v_fields, 'amount');        END IF;
  IF NEW.months_unpaid IS DISTINCT FROM OLD.months_unpaid THEN v_fields := array_append(v_fields, 'months_unpaid'); END IF;
  IF NEW.notes         IS DISTINCT FROM OLD.notes         THEN v_fields := array_append(v_fields, 'notes');         END IF;
  IF NEW.status        IS DISTINCT FROM OLD.status        THEN v_fields := array_append(v_fields, 'status');        END IF;

  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    v_action := 'resolved';
  ELSIF cardinality(v_fields) = 0 THEN
    -- A no-op touch (updated_at only). Logging it would drown the real entries.
    RETURN NULL;
  ELSE
    v_action := 'edited';
  END IF;

  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NEW.id,
    coalesce(auth.uid(), NEW.reported_by_owner_id),
    NEW.reported_by_hostel_id,
    v_action,
    jsonb_build_object('fields', to_jsonb(v_fields))
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.hms_redflag_before_insert() FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_before_update() FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_after_insert()  FROM public;
REVOKE ALL ON FUNCTION public.hms_redflag_after_update()  FROM public;

DROP TRIGGER IF EXISTS hms_redflags_before_insert ON hms_redflags;
CREATE TRIGGER hms_redflags_before_insert
  BEFORE INSERT ON hms_redflags
  FOR EACH ROW EXECUTE FUNCTION hms_redflag_before_insert();

DROP TRIGGER IF EXISTS hms_redflags_before_update ON hms_redflags;
CREATE TRIGGER hms_redflags_before_update
  BEFORE UPDATE ON hms_redflags
  FOR EACH ROW EXECUTE FUNCTION hms_redflag_before_update();

-- Reuses the existing hms_set_updated_at() from 001_hms_schema.sql:299 rather
-- than defining another one. updated_at is inside the editable allow-list, so
-- trigger firing order against hms_redflags_before_update is irrelevant.
DROP TRIGGER IF EXISTS hms_redflags_updated_at ON hms_redflags;
CREATE TRIGGER hms_redflags_updated_at
  BEFORE UPDATE ON hms_redflags
  FOR EACH ROW EXECUTE FUNCTION hms_set_updated_at();

DROP TRIGGER IF EXISTS hms_redflags_after_insert ON hms_redflags;
CREATE TRIGGER hms_redflags_after_insert
  AFTER INSERT ON hms_redflags
  FOR EACH ROW EXECUTE FUNCTION hms_redflag_after_insert();

DROP TRIGGER IF EXISTS hms_redflags_after_update ON hms_redflags;
CREATE TRIGGER hms_redflags_after_update
  AFTER UPDATE ON hms_redflags
  FOR EACH ROW EXECUTE FUNCTION hms_redflag_after_update();

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 9b. (removed) hostel_type lock.
--
--     An earlier revision put a BEFORE UPDATE trigger on hms_hostels to stop an
--     owner flipping their branch's hostel_type, reading the other gender's
--     registry, and flipping back. It was removed for two reasons:
--
--     1. It did not work. The trigger fires on UPDATE only, so a brand-new
--        branch — or an account that simply flips once and stays — reads the
--        other registry untouched. createBranch has no quota. Gender
--        segregation cannot be enforced from here, because hostel_type is
--        self-declared and the database has no independent way to verify what
--        gender a hostel actually serves.
--
--     2. It broke a pre-existing feature. The activity test counted ANY audit
--        row for the branch, and a 'searched' row is written by the automatic
--        check on every tenant add — so admitting one member permanently froze
--        that branch's Boys/Girls setting, and because Settings sends
--        hostel_type in the same UPDATE as description and amenities, the whole
--        Listing save then failed. A read_only partner could trigger the same
--        freeze with a single registry view.
--
--     Consequence, stated plainly: gender segregation is a POLICY control with
--     technical support, not a hard boundary. Every lookup is audited, so abuse
--     is detectable after the fact — it is not prevented. Do not describe it as
--     enforced in any user-facing copy.
--
--     With this gone, migration 143 attaches nothing to any pre-existing table.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 10. RLS.
--
--    *** THERE IS DELIBERATELY NO POLICY ON hms_redflags THAT LETS ANY ACCOUNT
--    *** READ ANOTHER ORGANISATION'S ROWS. Cross-org reads happen ONLY through
--    *** hms_redflag_search() and hms_redflag_list(), which are SECURITY
--    *** DEFINER, which enforce the gender filter, and which mask CNIC and
--    *** phone before the row leaves Postgres. If a future migration adds a
--    *** cross-org SELECT policy here, it hands every competitor a full,
--    *** UNMASKED dump of every defaulter report on the platform via a single
--    *** PostgREST call. Do not add one.
--
--    What the policies below grant is the ordinary single-org access the "My
--    Reports" page needs, using the same predicate set as every other table in
--    this schema, routed through hms_redflag_can_access_hostel() so a partner
--    or junction owner of the reporting branch is treated the same as the
--    direct owner (094's branch-parity rule).
--
--    No DELETE policy, on purpose. A defaulter report is evidence that another
--    business acted on; it is resolved, never erased. The only deletion path is
--    the ON DELETE CASCADE from hms_hostels, i.e. the whole branch going away.
--
--    READ AND WRITE ARE DELIBERATELY DIFFERENT PREDICATES. SELECT keeps
--    hms_redflag_can_access_hostel() — any active partner, read_only included —
--    because a partner working a branch needs to see what that branch has filed.
--    INSERT and UPDATE route through hms_redflag_can_write_hostel(), which
--    excludes read_only. The SELECT predicate is also, character for character,
--    the predicate the two RPCs use to decide whether to mask; see the header
--    note. If one is ever changed, the other must change with it.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org reads own redflags" ON hms_redflags;
CREATE POLICY "Org reads own redflags"
  ON hms_redflags FOR SELECT
  USING (
    hms_redflags.reported_by_owner_id = auth.uid()
    OR hms_redflag_can_access_hostel(hms_redflags.reported_by_hostel_id)
  );

-- The acceptance requirement is LOW-severity and structurally important. The
-- disclaimer is the only place the user is told that a RedFlag report is an
-- accusation about a named third party, published to other companies, and that
-- they are responsible for its accuracy. Enforced only in Node, it was a modal
-- that a direct insert never saw — and "the reporter had accepted the terms"
-- is precisely the fact this product would need to prove if a report were ever
-- disputed. The subquery reads the caller's own acceptance row, which the
-- "User reads own redflag acceptance" policy below already permits; it is
-- table-qualified against the 078 column-shadowing bug.
DROP POLICY IF EXISTS "Org files own redflags" ON hms_redflags;
CREATE POLICY "Org files own redflags"
  ON hms_redflags FOR INSERT
  WITH CHECK (
    hms_redflag_can_write_hostel(hms_redflags.reported_by_hostel_id)
    AND EXISTS (
      SELECT 1 FROM hms_redflag_acceptances acc
      WHERE acc.user_id = auth.uid()
    )
  );

-- reported_by_owner_id = auth.uid() is NOT part of the write predicates. It
-- looks like a harmless extra route but it is not one: the column is pinned by
-- the BEFORE INSERT trigger to the reporting BRANCH's owner, so for anyone who
-- legitimately matches it, hms_redflag_can_write_hostel() is already true. All
-- it could ever add is a path that skips the tier check.
DROP POLICY IF EXISTS "Org edits own redflags" ON hms_redflags;
CREATE POLICY "Org edits own redflags"
  ON hms_redflags FOR UPDATE
  USING      (hms_redflag_can_write_hostel(hms_redflags.reported_by_hostel_id))
  WITH CHECK (hms_redflag_can_write_hostel(hms_redflags.reported_by_hostel_id));

DROP POLICY IF EXISTS "User reads own redflag acceptance" ON hms_redflag_acceptances;
CREATE POLICY "User reads own redflag acceptance"
  ON hms_redflag_acceptances FOR SELECT
  USING (hms_redflag_acceptances.user_id = auth.uid());

DROP POLICY IF EXISTS "User records own redflag acceptance" ON hms_redflag_acceptances;
CREATE POLICY "User records own redflag acceptance"
  ON hms_redflag_acceptances FOR INSERT
  WITH CHECK (hms_redflag_acceptances.user_id = auth.uid());

-- hms_redflag_audit intentionally has RLS ENABLED and ZERO policies: RLS with
-- no policy is default-deny, so no anon or authenticated client can read, write
-- or amend the trail. Every write now comes from a SECURITY DEFINER function or
-- trigger in this file — hms_redflag_search(), hms_redflag_list(),
-- hms_redflag_after_insert(), hms_redflag_after_update() — all of which run
-- as the function owner and
-- bypass RLS. No application code needs to write here any more, which is the
-- point: the trail is produced by the database on the way past, not by a caller
-- that has to remember. This
-- is the same deliberate "enable RLS, add no policies" pattern used for
-- hms_managers in 051_manager_roles.sql:26-27, and it matters more here: the
-- audit log is what makes scraping detectable, so the accounts being audited
-- must not be able to see or edit it.
