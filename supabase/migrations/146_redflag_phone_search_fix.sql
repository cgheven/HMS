-- ---------------------------------------------------------------------------
-- 146. RedFlag: make phone search actually match, and stop LIKE metacharacters
--      widening a name search.
--
-- THE BUG
--
-- The registry page could never find anybody by phone number.
--
-- The write path stores phone_digits through hms_redflag_normalize_phone(),
-- which pins every number to E.164 without the '+': 0300-1234567, 03001234567,
-- 3001234567 and +923001234567 all become '923001234567'. 143 introduced that
-- function precisely so both sides of the registry would agree, and said so:
-- "the instant they disagree, reports silently become invisible".
--
-- hms_redflag_list then compared against a bare digit-strip of the search box.
-- Typing 0300-1234567 produced '03001234567', which never equals
-- '923001234567'. The digit branch missed, the query fell through to
-- full_name ILIKE '%0300-1234567%', and that missed too. Zero rows.
--
-- Verified against production before writing this file:
--     hms_redflag_normalize_phone('0300-1234567') -> 923001234567
--     regexp_replace('0300-1234567','[^0-9]','','g') -> 03001234567
--
-- CNIC was unaffected — 13 digits, stripped identically on both sides — which
-- is what made this survive review: the feature demonstrably worked whenever
-- anyone tested it with a CNIC.
--
-- WHY THIS RATES AS A BLOCKER RATHER THAN A BUG
--
-- A miss on this page is not a blank result. It is an emerald tick and the
-- sentence "No hostel has reported anyone with that name, CNIC or phone
-- number." So an owner could report a defaulter by phone, a second owner could
-- search that exact number, and the product would state that the person is
-- clean — the one outcome the whole feature exists to prevent, produced by the
-- feature working as coded. 144 called this "the dangerous direction to be
-- wrong"; this is that direction.
--
-- ADDITIVITY: replaces one function 145 created. Same 7-argument signature and
-- same RETURNS TABLE, so CREATE OR REPLACE is legal and no DROP is needed --
-- which also means no GRANT is lost. Nothing else is touched: no table, no
-- policy, no trigger, no other function.
-- ---------------------------------------------------------------------------

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
  -- A search of 6+ digits is an identifier, not a name. Matched exactly against
  -- the indexed digit columns rather than by LIKE, so a CNIC lookup stays an
  -- index probe and cannot partially match a longer number.
  v_digits text;
  -- The same digits put through the WRITE path's normaliser. This is the fix:
  -- phone_digits is E.164, so the only value that can ever match it is one
  -- produced by the same function that wrote it.
  v_phone  text;
  v_status text    := nullif(btrim(lower(coalesce(p_status, ''))), '');
  -- Normalised identically to v_status, so 'Theft' and ' theft ' from a
  -- hand-rolled call filter rather than raise.
  v_reason text    := nullif(btrim(lower(coalesce(p_reason, ''))), '');
  -- Backslash escapes itself first, then _ and % lose their wildcard meaning.
  -- Without this a search for '_' matches every row in the registry and reads
  -- as a browse; over-matching is the safe direction here, but it still spends
  -- a lookup and shows the caller a result set they did not ask for.
  v_like   text;
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

  -- Normalised from v_digits, not from v_q: the raw box may carry spaces,
  -- dashes or a leading +, and the write path stripped all of those before
  -- storing. Guarded so a 13-digit CNIC search does not also probe the phone
  -- column with a value that could never live there.
  v_phone := CASE
               WHEN v_digits IS NULL THEN NULL
               ELSE hms_redflag_normalize_phone(v_digits)
             END;

  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');

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
             -- Two separate probes, because the two columns are stored in two
             -- different shapes. Folding them into one comparison is what broke
             -- phone search in the first place.
             OR (v_digits IS NOT NULL AND r.cnic_digits = v_digits)
             OR (v_phone  IS NOT NULL AND r.phone_digits = v_phone)
             -- The registry is small by nature (one row per defaulter, not per
             -- tenant), so the name scan is cheap; revisit with pg_trgm only if
             -- it stops being small.
             OR r.full_name ILIKE '%' || v_like || '%' ESCAPE '\'
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
  -- 'by_phone' joins 'by_digits' as a BOOLEAN — whether the search was shaped
  -- like a phone number, never the number itself.
  INSERT INTO hms_redflag_audit (redflag_id, actor_id, hostel_id, action, meta)
  VALUES (
    NULL, v_actor, p_hostel_id, 'viewed',
    jsonb_build_object(
      'rows', v_rows, 'limit', v_limit, 'offset', v_offset, 'gender', v_gender,
      'searched', v_q IS NOT NULL, 'by_digits', v_digits IS NOT NULL,
      'by_phone', v_phone IS NOT NULL,
      'status', v_status, 'only_mine', coalesce(p_only_mine, false),
      'reason', v_reason
    )
  );
END;
$$;

COMMENT ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) IS
  'The single read path for the RedFlag page. Filters by text, status, ownership and reason IN SQL across the whole registry, then pages — so a search can never miss a match that sits beyond the loaded page. Phone searches are normalised through hms_redflag_normalize_phone() so they match the E.164 form the write path stores. Returns total_count for the result summary, and reason so the page can say what the debt is. Masks CNIC/phone for any row the caller cannot already read directly.';

REVOKE ALL ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Restores the SET clause 144 dropped.
--
-- CREATE OR REPLACE FUNCTION reassigns every property from the new command, so
-- the SET search_path 143 gave this function was not inherited when 144
-- rewrote it to raise the budget — it was silently discarded. The body is a
-- literal and resolves no names, so nothing is exploitable through it; it is
-- restored because it was the single RedFlag function left with a mutable
-- search_path, it trips Supabase's function_search_path_mutable advisor, and a
-- future function copied from this one would inherit the omission.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hms_redflag_lookup_budget()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$ SELECT 300 $$;

COMMENT ON FUNCTION public.hms_redflag_lookup_budget() IS
  'Registry reads permitted per user per rolling hour. A runaway-client guard, not a confidentiality control: the registry is browsable by design, so a limit here cannot withhold anything paging would not reveal. Attribution comes from hms_redflag_audit.';

REVOKE ALL ON FUNCTION public.hms_redflag_lookup_budget() FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_lookup_budget() TO authenticated;
