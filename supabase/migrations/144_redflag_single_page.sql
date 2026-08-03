-- ---------------------------------------------------------------------------
-- 144. RedFlag: one browsable page, server-side filtering, realistic budget.
--
-- WHY THIS EXISTS
--
-- 143 shipped RedFlag as three screens — Check Tenant, Red Flags, My Reports —
-- split by where the data came from rather than by what an owner is trying to
-- do. In use that is three places to learn and three places to look. The
-- product is one question: "has anyone reported this person?" So the registry
-- becomes a single searchable list, and searching it IS the check.
--
-- That collapse forces a decision this file exists to make correctly.
--
-- If the search box filtered only the rows already fetched, it would answer
-- "no match" for someone who IS reported but sits on a later page. On a
-- defaulter registry that is the dangerous direction to be wrong: it reads as
-- a clean bill of health. Every filter — text, status, ownership — therefore
-- runs in SQL against the whole registry, and the page boundary is applied
-- after the filter, never before.
--
-- BUDGET RAISED 30 -> 300/hour
--
-- 143 metered lookups at 30/hour on the theory that the search was an oracle
-- over other organisations' data. With the registry deliberately browsable in
-- full, that reasoning no longer holds: anyone who wants the list can page
-- through it, so throttling the search protects nothing it did not already
-- give away. The real controls are who holds an account and the audit trail
-- that attributes every read. What remains worth stopping is a runaway client,
-- so the ceiling stays — just high enough that a real user never meets it.
--
-- ADDITIVITY: this migration only replaces objects 143 created. It touches no
-- pre-existing table, policy, trigger or function.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Budget.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_lookup_budget()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 300 $$;

COMMENT ON FUNCTION public.hms_redflag_lookup_budget() IS
  'Registry reads permitted per user per rolling hour. A runaway-client guard, not a confidentiality control: the registry is browsable by design, so a limit here cannot withhold anything paging would not reveal. Attribution comes from hms_redflag_audit.';

REVOKE ALL ON FUNCTION public.hms_redflag_lookup_budget() FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_lookup_budget() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. hms_redflag_list — now the only read path the page needs.
--
--    Adds p_search, p_status and p_only_mine. Signature change, so the 3-arg
--    version is dropped first; CREATE OR REPLACE cannot alter a parameter list
--    and would leave two overloads with an ambiguous 1-arg call between them.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.hms_redflag_list(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.hms_redflag_list(
  p_hostel_id uuid,
  p_limit     integer DEFAULT 100,
  p_offset    integer DEFAULT 0,
  p_search    text    DEFAULT NULL,
  p_status    text    DEFAULT NULL,
  p_only_mine boolean DEFAULT false
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
BEGIN
  v_gender := hms_redflag_branch_gender(p_hostel_id);
  PERFORM hms_redflag_enforce_lookup_budget();

  IF v_status IS NOT NULL AND v_status NOT IN ('reported', 'resolved') THEN
    RAISE EXCEPTION 'Unknown status filter: %', v_status USING ERRCODE = '22023';
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
  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NULL, v_actor, p_hostel_id, 'viewed',
    jsonb_build_object(
      'rows', v_rows, 'limit', v_limit, 'offset', v_offset, 'gender', v_gender,
      'searched', v_q IS NOT NULL, 'by_digits', v_digits IS NOT NULL,
      'status', v_status, 'only_mine', coalesce(p_only_mine, false)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean) IS
  'The single read path for the RedFlag page. Filters by text, status and ownership IN SQL across the whole registry, then pages — so a search can never miss a match that sits beyond the loaded page. Returns total_count for the result summary. Masks CNIC/phone for any row the caller cannot already read directly.';

REVOKE ALL ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean) TO authenticated;

-- Supports the name search and the ordering the page uses.
CREATE INDEX IF NOT EXISTS idx_hms_redflags_gender_created
  ON hms_redflags (gender, created_at DESC, id DESC);
