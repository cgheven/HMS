-- ---------------------------------------------------------------------------
-- 147. RedFlag: a branch can always see the reports it filed itself.
--
-- THE BUG
--
-- gender is stamped on a report at file time from the reporting branch's
-- hostel_type, and then frozen forever by hms_redflag_before_update() — nobody
-- may move an accusation from one gender's registry to the other after the
-- fact. That freeze is correct and stays.
--
-- But hostel_type is editable in Settings, and every read filtered on
-- `r.gender = v_gender` with no exception for the reporter. So the moment an
-- owner corrects a mis-set branch type, every report that branch had already
-- filed is stranded:
--
--   * the branch that filed it can no longer see it, so it cannot even use
--     "Mark Resolved" — the only lifecycle action the schema offers;
--   * there is no DELETE path anywhere in 143 by design;
--   * the row stays fully visible to the OTHER gender's hostels.
--
-- Observed in production: "Ahsan Khan" was filed by Rajput Hostel while that
-- branch was typed girls. After it was corrected to boys, the row became
-- invisible to Rajput and to every boys branch, while remaining visible to
-- Al Rasheed Girls Hostel — a male defaulter, reported by a boys hostel,
-- published to girls hostels and unresolvable by its author.
--
-- THE FIX
--
-- Gender segregation exists so one hostel cannot read the OTHER gender's
-- reports. It was never meant to hide a branch's own data from itself. So the
-- predicate gains exactly one exception: a row is visible if it matches the
-- caller branch's gender OR the caller branch filed it.
--
-- This weakens nothing. reported_by_hostel_id is frozen by the same trigger as
-- gender, and p_hostel_id has already been through
-- hms_redflag_branch_gender() -> hms_redflag_can_access_hostel() before this
-- predicate runs, so the exception can only ever admit rows the caller's own
-- branch wrote. No row belonging to another organisation is exposed by it.
--
-- It also makes the stranded case self-healing: the filing branch sees its own
-- report again and can resolve it, whatever its branch type is today.
--
-- ADDITIVITY: replaces two functions (last written by 146 and 145). Same
-- signatures, same RETURNS TABLE, so CREATE OR REPLACE applies and no GRANT is
-- lost. No table, policy, trigger or index is touched.
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
  v_q      text    := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text;
  -- The same digits put through the WRITE path's normaliser, so a phone search
  -- can match the E.164 form phone_digits actually holds. See 146.
  v_phone  text;
  v_status text    := nullif(btrim(lower(coalesce(p_status, ''))), '');
  v_reason text    := nullif(btrim(lower(coalesce(p_reason, ''))), '');
  v_like   text;
BEGIN
  v_gender := hms_redflag_branch_gender(p_hostel_id);
  PERFORM hms_redflag_enforce_lookup_budget();

  IF v_status IS NOT NULL AND v_status NOT IN ('reported', 'resolved') THEN
    RAISE EXCEPTION 'Unknown status filter: %', v_status USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NOT NULL
     AND v_reason NOT IN ('unpaid_rent', 'unpaid_utilities', 'damage', 'theft', 'other') THEN
    RAISE EXCEPTION 'Unknown reason filter: %', v_reason USING ERRCODE = '22023';
  END IF;

  v_digits := nullif(regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND char_length(v_digits) < 6 THEN
    v_digits := NULL;
  END IF;

  v_phone := CASE
               WHEN v_digits IS NULL THEN NULL
               ELSE hms_redflag_normalize_phone(v_digits)
             END;

  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');

  RETURN QUERY
  WITH filtered AS (
    SELECT r.*
      FROM hms_redflags r
     -- The one change in this migration. Segregation still hides the other
     -- gender's registry; it no longer hides a branch's own reports from the
     -- branch that wrote them.
     WHERE (r.gender = v_gender OR r.reported_by_hostel_id = p_hostel_id)
       AND (v_status IS NULL OR r.status = v_status)
       AND (v_reason IS NULL OR r.reason = v_reason)
       AND (NOT coalesce(p_only_mine, false) OR r.reported_by_owner_id = v_actor)
       AND (
             v_q IS NULL
             OR (v_digits IS NOT NULL AND r.cnic_digits = v_digits)
             OR (v_phone  IS NOT NULL AND r.phone_digits = v_phone)
             OR r.full_name ILIKE '%' || v_like || '%' ESCAPE '\'
           )
  ),
  counted AS (
    SELECT count(*) AS n FROM filtered
  ),
  page AS MATERIALIZED (
    SELECT f.*
      FROM filtered f
     ORDER BY f.created_at DESC, f.id DESC
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
    t.reason,
    t.status,
    t.created_at,
    t.resolved_at,
    t.own,
    (SELECT c.n FROM counted c)
  FROM tagged t
  ORDER BY t.created_at DESC, t.id DESC;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

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
  'The single read path for the RedFlag page. Filters by text, status, ownership and reason IN SQL across the whole registry, then pages. Shows the caller branch''s gender registry PLUS any report the caller branch filed itself, so correcting a branch''s gender in Settings cannot strand its own past reports. Phone searches are normalised through hms_redflag_normalize_phone(). Masks CNIC/phone for any row the caller cannot already read directly.';

REVOKE ALL ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.hms_redflag_list(uuid, integer, integer, text, text, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Same exception on the tenant-add / application-approve check, so the page and
-- the warning can never disagree about which reports exist.
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
  v_gender := hms_redflag_branch_gender(p_hostel_id);

  v_cnic  := hms_redflag_normalize_cnic(p_cnic_digits);
  v_phone := hms_redflag_normalize_phone(p_phone_digits);

  IF v_cnic IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'Enter a CNIC or a phone number to search RedFlag.'
      USING ERRCODE = '22023';
  END IF;

  IF v_cnic IS NOT NULL AND v_cnic !~ '^[0-9]{13}$' THEN
    RAISE EXCEPTION 'Enter the full 13-digit CNIC.'
      USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'Enter a complete phone number.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM hms_redflag_enforce_lookup_budget();

  RETURN QUERY
  WITH hits AS (
    SELECT r.*,
           (r.reported_by_owner_id = v_actor
            OR hms_redflag_can_access_hostel(r.reported_by_hostel_id)) AS own
      FROM hms_redflags r
     WHERE (r.gender = v_gender OR r.reported_by_hostel_id = p_hostel_id)
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
  'Exact-match cross-org RedFlag lookup. Covers the caller branch''s gender registry plus any report that branch filed itself, so a corrected branch gender cannot hide a branch''s own report from its own tenant-add check. CNIC/phone masked in SQL for every row the caller''s org did not file. Writes one action=searched audit row that never contains the searched key.';
