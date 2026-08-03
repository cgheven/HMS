-- ---------------------------------------------------------------------------
-- 145. RedFlag: WHY the money is owed.
--
-- WHY THIS EXISTS
--
-- 143 modelled a defaulter as one thing: "a person who owes N months of rent".
-- The row carries `amount` and `months_unpaid`, and the UI built on top of it
-- can express nothing else. The owner who uses this feature every day pointed
-- out that this is simply not what a hostel debt is. Real ones are:
--
--   * unpaid rent,
--   * unpaid utility / AC electricity bills (this product meters AC per room
--     and bills it separately — see 133 and 139 — so an AC bill is its own
--     debt, not a component of rent),
--   * damage to property (a broken bed, a door, a geyser),
--   * theft (a mattress, a fan, another tenant's belongings),
--   * anything else.
--
-- For three of those five, "months unpaid" is not merely blank, it is
-- MEANINGLESS — nobody steals a fan for four months. A registry that reports
-- "owes 25,000" without saying why is also materially misleading to the hostel
-- reading it: "25,000 in rent arrears" and "25,000 for theft" are different
-- facts about a person, and the second is the one that changes an admission
-- decision. Since the whole point of RedFlag is that a STRANGER'S
-- organisation reads this row and acts on it, the row has to say what it means.
--
-- PRIOR STATE
--
-- 143 created the table, the triggers, the RLS model and the two read RPCs.
-- 144 replaced hms_redflag_list with the single-page filtering version and
-- raised the lookup budget. Both are ALREADY APPLIED to production; this file
-- is written to go on top of that exact state and to be re-runnable against
-- itself.
--
-- BLAST RADIUS / ADDITIVITY
--
-- This migration adds one column, one named CHECK, one index, one trigger and
-- one trigger function, and it REPLACES exactly three functions — all three
-- created by 143/144 and all three RedFlag-only:
--
--     hms_redflag_after_update()   (so a reason change is audited at all)
--     hms_redflag_list(...)        (so the page can show and filter by reason)
--     hms_redflag_search(...)      (so the tenant-add warning can show reason)
--
-- Nothing pre-existing outside RedFlag is dropped, altered or weakened. This
-- is the same relationship 144 has to 143, and it honours the additivity rule
-- stated in 094_partner_branch_parity.sql:27-28.
--
-- NOTE ON WHAT IS *NOT* REPLACED. hms_redflag_before_insert() and
-- hms_redflag_before_update() are deliberately left BYTE-IDENTICAL. The reason
-- normalisation they would otherwise have to carry lives in a separate
-- BEFORE INSERT OR UPDATE trigger below instead. Copying ~110 lines of
-- security-critical body (the owner pinning, the gender snapshot, the frozen
-- identity-field test) into this file just to append two lines would mean that
-- a future reviewer has to diff two long functions to convince themselves 145
-- did not quietly weaken the write contract, and it would mean any fix to
-- those bodies has to be made in two migrations. A second, tiny, single-purpose
-- trigger is auditable at a glance.
--
-- Trigger firing order is alphabetical per event in Postgres, so the new
-- trigger runs after hms_redflags_before_insert / hms_redflags_before_update
-- and before hms_redflags_updated_at. Order is IMMATERIAL here and that is by
-- construction: the new trigger reads and writes only `reason` and
-- `months_unpaid`, neither of which any 143 trigger reads, writes or freezes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The column.
--
--    NOT NULL DEFAULT 'unpaid_rent'. Backfilling every existing row to
--    'unpaid_rent' is not a guess and not a "least-bad" default: every report
--    in the table was filed through a UI whose only expressible debt was
--    unpaid rent, with an `amount` and a `months_unpaid` and no other option
--    on the screen. The historical rows ARE unpaid-rent reports; the default
--    records what they already are.
--
--    A NOT NULL DEFAULT on ADD COLUMN does not rewrite the table on
--    PostgreSQL 11+ — the default is stored in the catalogue and materialised
--    on read — so this is a fast metadata-only change even if the registry
--    grows large.
-- ---------------------------------------------------------------------------

ALTER TABLE public.hms_redflags
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'unpaid_rent';

-- Named rather than inlined in ADD COLUMN so it can be found, described and
-- (if the vocabulary ever grows) replaced by name instead of by whatever
-- system-generated identifier Postgres would have picked. Wrapped in a DO
-- block because ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form and
-- this file must be re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hms_redflags_reason_valid'
       AND conrelid = 'public.hms_redflags'::regclass
  ) THEN
    ALTER TABLE public.hms_redflags
      ADD CONSTRAINT hms_redflags_reason_valid
      CHECK (reason IN ('unpaid_rent', 'unpaid_utilities', 'damage', 'theft', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN public.hms_redflags.reason IS
  'Why the money is owed. One of: unpaid_rent (rent arrears — the only kind of report that existed before migration 145, and what every pre-145 row was backfilled to); unpaid_utilities (metered AC / electricity / utility bills, which this product bills separately from rent); damage (property destroyed or broken — bed, door, geyser); theft (property taken — mattress, fan, another tenant''s belongings); other. Editable after filing, unlike the identity fields. months_unpaid is forced to NULL by hms_redflag_normalize_reason() for every value except unpaid_rent, because a count of months has no meaning for a stolen fan.';

-- ---------------------------------------------------------------------------
-- 2. DECISION: months_unpaid is NORMALISED, NOT POLICED.
--
--    months_unpaid is only meaningful for reason='unpaid_rent'. The obvious
--    move is a cross-column CHECK —
--        CHECK (reason = 'unpaid_rent' OR months_unpaid IS NULL)
--    — and it would in fact validate cleanly against the existing table, since
--    every existing row is being backfilled to 'unpaid_rent'. It is still the
--    wrong tool, for two reasons.
--
--    1. FAILURE MODE. A CHECK turns "you sent a field that does not apply" into
--       a rejected write with a constraint-violation message, on a form whose
--       React state may well still be holding a months value the user typed
--       before switching the reason dropdown to Theft. The correct product
--       behaviour there is to ignore the stale field, not to refuse the report
--       — a defaulter report that fails to save because of a vestigial number
--       is worse for everyone than one that saves with that number discarded.
--
--    2. COUPLING. The BEFORE trigger below runs before CHECKs are evaluated,
--       so with both in place the CHECK could never actually fire on a normal
--       write — it would be pure decoration, but decoration with teeth. The
--       moment anything disarms the trigger (a later migration refactoring the
--       RedFlag write path, restoring an older trigger body, or dropping this
--       trigger while consolidating it into hms_redflag_before_insert), the
--       CHECK stops being decoration and starts refusing writes. Without the
--       CHECK the worst case there is that months_unpaid stops being cleaned —
--       cosmetic, invisible, fixable at leisure. With the CHECK, four of the
--       five reasons stop saving platform-wide. A constraint whose entire
--       enforcement depends on a trigger that somebody else can remove
--       without noticing is a latent outage, so the trigger does the whole job
--       alone and owns it.
--
--    So: no cross-column CHECK. months_unpaid is coerced to NULL whenever the
--    reason is not 'unpaid_rent', on INSERT and on UPDATE, silently — exactly
--    the same "pin it, do not police it" style 143 already uses for status,
--    resolved_at and created_at on the insert path.
--
--    The reason value itself is also normalised (trim + lowercase) before the
--    CHECK sees it, so 'Theft' or ' theft ' from a hand-rolled PostgREST call
--    stores as 'theft' rather than being rejected. This mirrors how
--    hms_redflag_list already normalises its p_status argument. An explicit
--    NULL — which the NOT NULL would otherwise reject, since a column DEFAULT
--    does not apply to an explicitly supplied NULL — falls back to
--    'unpaid_rent' on insert and to the previous value on update.
--
--    NOT SECURITY DEFINER, unlike the 143 write triggers: this function reads
--    no table and calls nothing, so it needs no elevated rights. search_path is
--    still pinned (pg_temp last) so nothing in a temp schema can shadow a
--    builtin and so Supabase's function_search_path_mutable advisor stays
--    clean.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_normalize_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.reason := coalesce(nullif(btrim(lower(NEW.reason)), ''), 'unpaid_rent');
  ELSE
    NEW.reason := coalesce(nullif(btrim(lower(NEW.reason)), ''), OLD.reason);
  END IF;

  -- The whole point of the column: for four of the five reasons a month count
  -- is not "unknown", it is nonsense. Dropped rather than refused; see the
  -- decision note above.
  IF NEW.reason <> 'unpaid_rent' THEN
    NEW.months_unpaid := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Same posture as 143's trigger functions: revoked from public and NOT granted
-- to authenticated. A trigger function returns type `trigger` and cannot be
-- invoked as an ordinary function or over PostgREST, so an EXECUTE grant here
-- would confer nothing except a larger surface to reason about.
REVOKE ALL ON FUNCTION public.hms_redflag_normalize_reason() FROM public;

COMMENT ON FUNCTION public.hms_redflag_normalize_reason() IS
  'BEFORE INSERT OR UPDATE on hms_redflags: lowercases/trims reason, defaults a missing one (to ''unpaid_rent'' on insert, to the previous value on update), and forces months_unpaid to NULL for every reason except unpaid_rent. Deliberately silent — a stale month count left in a form does not justify refusing a defaulter report. Kept separate from hms_redflag_before_insert/update so 145 does not have to restate their security-critical bodies.';

DROP TRIGGER IF EXISTS hms_redflags_before_write_reason ON public.hms_redflags;
CREATE TRIGGER hms_redflags_before_write_reason
  BEFORE INSERT OR UPDATE ON public.hms_redflags
  FOR EACH ROW EXECUTE FUNCTION public.hms_redflag_normalize_reason();

-- Mirrors idx_hms_redflags_gender_status from 143 section 3. Every read path is
-- already gender-scoped, so the useful index for the new filter is the compound
-- one; a bare (reason) index would be a low-cardinality index the planner would
-- ignore.
CREATE INDEX IF NOT EXISTS idx_hms_redflags_gender_reason
  ON public.hms_redflags (gender, reason);

-- ---------------------------------------------------------------------------
-- 3. DECISION: reason is EDITABLE, not frozen.
--
--    143's BEFORE UPDATE trigger splits the row in two. Frozen at report time:
--    id, reporting branch, reporting owner, gender, CNIC, phone — the fields
--    that answer "WHO is this about and WHO said so". Editable: status,
--    resolved_at, notes, amount, months_unpaid, full_name — the fields that
--    answer "what is the current state of this debt".
--
--    THE CASE FOR FREEZING IT. reason is part of the accusation, not part of
--    the identity, and an accusation is precisely the thing you do not want
--    quietly rewritten. A report filed as 'unpaid_rent' and later edited to
--    'theft' is a materially more serious allegation against a named person,
--    published to other companies, with no visible history of the change on
--    the row itself. The 143 comment on the frozen list makes exactly this
--    argument for the identity fields: "the correct move is to resolve the
--    wrong report and file a new one, so that the audit trail shows both."
--
--    THE CASE FOR EDITING IT, WHICH WINS. The frozen fields are frozen because
--    changing them changes WHO the row is about — a different person, a
--    different gender registry, a different accusing organisation. Nothing in
--    the resolve-and-refile remedy is lost when the subject stays the same.
--    Whereas forcing a refile for a miscategorisation has a concrete cost: it
--    leaves TWO rows about one human being in a cross-organisation registry,
--    one of them marked 'resolved' — and 'resolved' on this feature reads as
--    "this debt was settled", which is a false statement about a person that
--    the registry would now be publishing to strangers forever, purely because
--    somebody picked Damage when they meant Theft. Duplicate rows also break
--    the search: the tenant-add warning would show one person twice with
--    contradictory information and no way to tell which is current.
--
--    A miscategorisation is a data-entry error about a debt, and the editable
--    half of this table is exactly where data-entry errors about the debt
--    already live: amount is editable, and amount is the single most damaging
--    number in the row. It would be incoherent to allow "25,000 -> 250,000"
--    and forbid "damage -> theft".
--
--    THE CONDITION ON THAT DECISION, IMPLEMENTED BELOW: editable ONLY because
--    the change is recorded. 143's AFTER UPDATE trigger names the changed
--    fields in the audit meta, and it returns early with NO audit row when its
--    known-field list shows nothing changed. So without the one line added
--    below, a reason-only edit — the exact edit this decision permits — would
--    be the single mutation on this table that leaves no trace at all. Field
--    NAMES only, never values, exactly as 143 does: the audit table must not
--    accumulate the personal data the rest of the feature works to keep out of
--    it.
--
--    Body is otherwise character-for-character 143's.
-- ---------------------------------------------------------------------------

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
  IF NEW.reason        IS DISTINCT FROM OLD.reason        THEN v_fields := array_append(v_fields, 'reason');        END IF;
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

REVOKE ALL ON FUNCTION public.hms_redflag_after_update() FROM public;

-- ---------------------------------------------------------------------------
-- 4. hms_redflag_list — expose reason, and let the page filter by it.
--
--    Two changes and nothing else:
--      * `reason` added to RETURNS TABLE, positioned next to months_unpaid
--        because the two are read together (one qualifies the other);
--      * `p_reason text DEFAULT NULL` added as the LAST parameter, validated
--        the same way p_status is.
--
--    p_reason is last on purpose. supabase-js sends named arguments, so the
--    app's existing six-named-argument call still resolves against the seven-
--    parameter function; putting the new parameter anywhere else would be
--    equally fine for named callers and would gratuitously break any
--    positional one.
--
--    A DROP is unavoidable: CREATE OR REPLACE cannot change a function's
--    return type, and adding a column to RETURNS TABLE is a return-type change
--    ("cannot change return type of existing function"). The dropped object is
--    the six-parameter version created by 144 — an object this migration's own
--    lineage created, not anything pre-existing. On a re-run of 145 the DROP
--    is a no-op (the six-parameter version is gone) and the CREATE OR REPLACE
--    updates the seven-parameter version in place, so the file is idempotent.
--
--    EVERYTHING ELSE IS UNTOUCHED, deliberately and literally: the
--    hms_redflag_branch_gender() gate, the budget charge before any row is
--    read, the filter-then-page ordering (144's central correctness property —
--    a filter applied after paging would answer "no match" for someone
--    reported on a later page, which on a defaulter registry reads as a clean
--    bill of health), the MATERIALIZED page boundary that caps the per-row
--    access check, the (created_at, id) tiebreak, the masking predicate that
--    is character-for-character the "Org reads own redflags" RLS policy, and
--    the action='viewed' audit row.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.hms_redflag_list(uuid, integer, integer, text, text, boolean);

CREATE OR REPLACE FUNCTION public.hms_redflag_list(
  p_hostel_id uuid,
  p_limit     integer DEFAULT 100,
  p_offset    integer DEFAULT 0,
  p_search    text    DEFAULT NULL,
  p_status    text    DEFAULT NULL,
  p_only_mine boolean DEFAULT false,
  p_reason    text    DEFAULT NULL
)
RETURNS TABLE (
  id               uuid,
  full_name        text,
  cnic_masked      text,
  phone_masked     text,
  amount           numeric,
  months_unpaid    integer,
  reason           text,
  status           text,
  reported_at      timestamptz,
  resolved_at      timestamptz,
  reported_by_self boolean,
  total_count      bigint
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gender text;
  v_actor  uuid := auth.uid();
  v_limit  integer := LEAST(GREATEST(coalesce(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(coalesce(p_offset, 0), 0);
  v_rows   integer := 0;
  -- Trimmed once here so every branch below agrees on what "empty" means.
  v_q      text    := nullif(btrim(coalesce(p_search, '')), '');
  -- A search of 10+ digits is an identifier, not a name. Matched exactly
  -- against the indexed digit columns rather than by LIKE, so a CNIC lookup
  -- stays an index probe and cannot partially match a longer number.
  v_digits text;
  v_status text    := nullif(btrim(lower(coalesce(p_status, ''))), '');
  -- Normalised identically to v_status, so 'Theft' and ' theft ' from a
  -- hand-rolled call filter rather than raise.
  v_reason text    := nullif(btrim(lower(coalesce(p_reason, ''))), '');
BEGIN
  v_gender := hms_redflag_branch_gender(p_hostel_id);
  PERFORM hms_redflag_enforce_lookup_budget();

  IF v_status IS NOT NULL AND v_status NOT IN ('reported', 'resolved') THEN
    RAISE EXCEPTION 'Unknown status filter: %', v_status USING ERRCODE = '22023';
  END IF;

  -- Rejected rather than ignored, matching p_status. An unrecognised filter
  -- that silently returned the UNFILTERED registry would be the dangerous
  -- direction to be wrong here: the caller believes they are looking at one
  -- category and is shown all of them.
  IF v_reason IS NOT NULL
     AND v_reason NOT IN ('unpaid_rent', 'unpaid_utilities', 'damage', 'theft', 'other') THEN
    RAISE EXCEPTION 'Unknown reason filter: %', v_reason USING ERRCODE = '22023';
  END IF;

  v_digits := nullif(regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND char_length(v_digits) < 6 THEN
    -- Too short to be an identifier; fall back to matching it as a name.
    v_digits := NULL;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT r.*
      FROM hms_redflags r
     WHERE r.gender = v_gender
       AND (v_status IS NULL OR r.status = v_status)
       AND (v_reason IS NULL OR r.reason = v_reason)
       AND (NOT coalesce(p_only_mine, false) OR r.reported_by_owner_id = v_actor)
       AND (
             v_q IS NULL
             -- Digit searches probe both identifier columns; a name search is a
             -- case-insensitive contains. The registry is small by nature (one
             -- row per defaulter, not per tenant), so the name scan is cheap;
             -- revisit with pg_trgm only if it stops being small.
             OR (v_digits IS NOT NULL AND (r.cnic_digits = v_digits OR r.phone_digits = v_digits))
             OR r.full_name ILIKE '%' || v_q || '%'
           )
  ),
  counted AS (
    SELECT count(*) AS n FROM filtered
  ),
  -- MATERIALIZED so the page boundary is applied BEFORE the per-row
  -- hms_redflag_can_access_hostel() call, capping it at v_limit evaluations
  -- rather than one per matching row.
  page AS MATERIALIZED (
    SELECT f.*
      FROM filtered f
     ORDER BY f.created_at DESC, f.id DESC   -- id breaks ties so paging cannot skip or repeat
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
    CASE WHEN t.own THEN coalesce(t.cnic_display, t.cnic_digits)
         ELSE hms_redflag_mask_cnic(t.cnic_digits) END,
    CASE WHEN t.own THEN coalesce(t.phone_display, t.phone_digits)
         ELSE hms_redflag_mask_phone(t.phone_digits) END,
    t.amount,
    t.months_unpaid,
    -- Never masked. It is a category with five possible values chosen from a
    -- dropdown, not a fact about a person that the reporting org holds and
    -- others do not — and withholding it would defeat the entire purpose of
    -- adding it, which is to tell the READING org what they are looking at.
    t.reason,
    t.status,
    t.created_at,
    t.resolved_at,
    t.own,
    (SELECT c.n FROM counted c)
  FROM tagged t
  ORDER BY t.created_at DESC, t.id DESC;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Row count and coordinates only. Recording WHICH reports were listed, or the
  -- text searched for, would rebuild inside the audit table exactly the exposure
  -- this function exists to attribute.
  --
  -- 'reason' joins 'status' here for the same reason 'status' is here: it is
  -- the CATEGORY the caller filtered on, a value they typed themselves, not a
  -- value read out of anybody's row. It carries no name, no CNIC, no phone and
  -- no note, so the anti-scraping rule in the 143 header ("meta MUST NOT
  -- contain a searched CNIC or phone") is preserved exactly.
  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NULL, v_actor, p_hostel_id, 'viewed',
    jsonb_build_object(
      'rows', v_rows, 'limit', v_limit, 'offset', v_offset, 'gender', v_gender,
      'searched', v_q IS NOT NULL, 'by_digits', v_digits IS NOT NULL,
      'status', v_status, 'only_mine', coalesce(p_only_mine, false),
      'reason', v_reason
    )
  );
END;
$$;

COMMENT ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) IS
  'The single read path for the RedFlag page. Filters by text, status, ownership and reason IN SQL across the whole registry, then pages — so a search can never miss a match that sits beyond the loaded page. Returns total_count for the result summary, and reason so the page can say what the debt is. Masks CNIC/phone for any row the caller cannot already read directly.';

REVOKE ALL ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. hms_redflag_search — expose reason.
--
--    This is the function behind the automatic warning that fires while a
--    tenant is being ADMITTED, and it is the highest-stakes place the new
--    column appears. "Ali Raza — owes 25,000" and "Ali Raza — owes 25,000 for
--    theft" are different pieces of information to put in front of somebody
--    who is about to hand over a room key and a locker. The whole point of
--    143's search is to change that decision; reason is what makes the answer
--    actionable rather than merely alarming.
--
--    No parameter change — the signature is identical to 143's, so the app's
--    three-named-argument call is untouched. The DROP is required only because
--    the return type gains a column, and it drops the 143 object, nothing
--    pre-existing. Re-running 145 drops 145's own version and recreates it.
--
--    Body is 143's, verbatim, plus one output column. In particular: the
--    branch gender gate first, the full-key-only validation (no prefix
--    matching — a partial key would enumerate the registry), the budget
--    charged only after the input is known well-formed so a typo never costs a
--    slot, the own/masked predicate identical to the RLS policy, the
--    cnic-beats-phone match_kind, and an audit row that is byte-identical to
--    143's — deliberately NOT extended with reason, because unlike the list
--    filter there is no caller-supplied reason here, and the only reason
--    values available to log would be ones read out of the matched rows, i.e.
--    content rather than coordinates.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.hms_redflag_search(uuid, text, text);

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
  reason           text,
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
  -- section 10 of 143, so the RPC never masks a row that a plain select would
  -- hand over unmasked. The cheap column comparison is written first so that for
  -- the caller's own rows the SECURITY DEFINER call is usually skipped.
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
    h.reason,
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
  'Exact-match cross-org RedFlag lookup, filtered to the caller branch''s gender, CNIC/phone masked in SQL for every row the caller''s org did not file. Returns reason so the tenant-add warning can say what the debt IS, not just its size. Writes one action=searched audit row that never contains the searched key.';
