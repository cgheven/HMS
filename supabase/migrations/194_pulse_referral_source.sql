-- ─────────────────────────────────────────────────────────────────────────────
-- Pulse as a referral SOURCE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Until now every referral link belonged to a tenant. Pulse — the platform
-- itself — now gets one link per BRANCH, so it can market a hostel directly.
-- The person who joins through it gets the branch's referral_referred_percent
-- discount exactly as a tenant referral gives; there is no referrer, so there
-- is no referrer-side reward. Pulse still earns its ordinary commission.
--
-- WHY NOT A SYNTHETIC "PULSE TENANT"
-- hms_tenants is the billing spine, not a lookup table. To be resolvable at all
-- a synthetic row would need is_active = true and a monthly_rent — which is the
-- exact predicate every occupancy count, rent roll, dues report, bill generator
-- and per-branch tenant count uses. Pulse would appear as a resident who owes
-- rent, and ~91 query sites would each need a "not the Pulse row" filter. An
-- invariant with 91 enforcement points is one that gets broken.
--
-- So a Pulse code is an ordinary hms_referral_codes row with tenant_id NULL and
-- source = 'pulse', and the shape CHECKs below make "referrer_tenant_id IS NULL"
-- and "source = 'pulse'" provably the same fact. That equivalence is what lets
-- the reward engine discriminate on a bare NULL test — no join, no code lookup
-- inside the money path — while the UI reads the explicit column.

-- ── 1. Columns and nullability ───────────────────────────────────────────────

alter table public.hms_referral_codes
  alter column tenant_id drop not null,
  add column if not exists source text not null default 'tenant';

alter table public.hms_referral_codes
  drop constraint if exists hms_referral_codes_source_valid;
alter table public.hms_referral_codes
  add constraint hms_referral_codes_source_valid
  check (source in ('tenant', 'pulse'));

alter table public.hms_referral_codes
  drop constraint if exists hms_referral_codes_source_shape;
alter table public.hms_referral_codes
  add constraint hms_referral_codes_source_shape
  check ((source = 'pulse') = (tenant_id is null));

alter table public.hms_referrals
  alter column referrer_tenant_id drop not null,
  add column if not exists source text not null default 'tenant';

alter table public.hms_referrals
  drop constraint if exists hms_referrals_source_valid;
alter table public.hms_referrals
  add constraint hms_referrals_source_valid
  check (source in ('tenant', 'pulse'));

-- hms_referrals_referrer_tenant_id_fkey must STAY ON DELETE CASCADE. Under this
-- check a NULL referrer IS a Pulse referral, so switching the FK to SET NULL
-- would silently rewrite historical tenant referrals into Pulse ones the moment
-- a referrer is deleted.
alter table public.hms_referrals
  drop constraint if exists hms_referrals_source_shape;
alter table public.hms_referrals
  add constraint hms_referrals_source_shape
  check ((source = 'pulse') = (referrer_tenant_id is null));

-- Blocking, not cosmetic: hms_submit_referral's EXCEPTION handler inserts here
-- on a repeat submission. Left NOT NULL, the first duplicate through a Pulse
-- link raises, the RPC errors, and the caller returns GENERIC_ERROR instead of
-- the deliberate silent success — turning the public link into a live
-- "is this number already referred?" oracle.
alter table public.hms_referral_duplicate_claims
  alter column referrer_tenant_id drop not null,
  add column if not exists source text not null default 'tenant';

alter table public.hms_referral_duplicate_claims
  drop constraint if exists hms_referral_duplicate_claims_source_valid;
alter table public.hms_referral_duplicate_claims
  add constraint hms_referral_duplicate_claims_source_valid
  check (source in ('tenant', 'pulse'));

alter table public.hms_referral_duplicate_claims
  drop constraint if exists hms_referral_duplicate_claims_source_shape;
alter table public.hms_referral_duplicate_claims
  add constraint hms_referral_duplicate_claims_source_shape
  check ((source = 'pulse') = (referrer_tenant_id is null));

comment on column public.hms_referral_codes.source is
  'Who owns this link: ''tenant'' (tenant_id set) or ''pulse'' (tenant_id NULL). NEVER DELETE a Pulse code row — hms_referrals_code_id_fkey is ON DELETE CASCADE, so deleting it destroys every referral submitted through it along with Pulse''s commission records. Retire with is_active = false; rotate with that UPDATE plus hms_ensure_pulse_code(hostel_id) in one transaction.';
comment on column public.hms_referrals.source is
  'Snapshot of the link''s source at submission time. Immutable — retiring or rotating the code does not change how an existing referral pays out.';
comment on column public.hms_referral_duplicate_claims.source is
  'Snapshot of the link''s source at submission time.';

-- The 90-day per-referrer abuse cap in hms_attribute_referral does NOT apply to
-- Pulse, and that is deliberate rather than an oversight: the cap exists to stop
-- a tenant farming bounties for themselves, and Pulse earns no bounty. Discount
-- volume stays bounded by the per-hostel hourly rate limit, the manual owner
-- admission step, and hms_referral_rewards_one_per_bill.

-- ── 2. One active Pulse code per branch ──────────────────────────────────────
--
-- hms_referral_codes_one_active_per_tenant is UNIQUE (tenant_id) WHERE is_active
-- and NULLs are DISTINCT in a Postgres unique index, so it permits unbounded
-- active Pulse codes per branch. This index keys on hostel_id, which is never
-- NULL, so the trigger, the backfill and any manual insert all collide on 23505
-- instead of quietly producing a second live link. Partial on is_active, so
-- retired codes accumulate freely — that is what makes rotation possible.
create unique index if not exists hms_referral_codes_one_active_pulse_per_hostel
  on public.hms_referral_codes (hostel_id)
  where is_active and source = 'pulse';

-- ── 3. Code generation in SQL ────────────────────────────────────────────────
--
-- Mirrors lib/referrals.ts byte for byte. Change one, change both.
--   * alphabet: 31 symbols, no 0/O and no 1/I/L, so a code survives being read
--     aloud down a phone line and typed back in;
--   * rejection sampling: 31 does not divide 256, so bytes at or above
--     256 - (256 % 31) = 248 are discarded rather than folded, which would
--     over-represent the first eight letters;
--   * gen_random_bytes, never random() — the code is a public credential.
--
-- extensions.gen_random_bytes is FULLY QUALIFIED on purpose: pgcrypto is
-- installed in the extensions schema on this project and this function's
-- search_path is 'public'. Unqualified, it fails at runtime and aborts the
-- Super Admin's referral_enabled toggle.
create or replace function public.hms_new_referral_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  k_alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  k_length   CONSTANT int  := 8;
  k_ceiling  CONSTANT int  := 256 - (256 % 31);
  v_code  text := '';
  v_bytes bytea;
  v_byte  int;
BEGIN
  WHILE length(v_code) < k_length LOOP
    v_bytes := extensions.gen_random_bytes(16);
    FOR i IN 0..15 LOOP
      v_byte := get_byte(v_bytes, i);
      CONTINUE WHEN v_byte >= k_ceiling;
      v_code := v_code || substr(k_alphabet, (v_byte % length(k_alphabet)) + 1, 1);
      EXIT WHEN length(v_code) = k_length;
    END LOOP;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ── 4. Idempotent ensure ─────────────────────────────────────────────────────
--
-- Returns the branch's active Pulse code, minting one only if there is none.
-- Tolerates both unique violations the table can raise, exactly as mintCode()
-- in app/actions/referrals.ts does: the global one on lower(code) (two random
-- draws collided, so redraw) and the partial one on hostel_id (another session
-- won the race, so the answer is already in the table). Only the second has a
-- row to read, which is why the retry re-reads before drawing again.
create or replace function public.hms_ensure_pulse_code(p_hostel_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_code text;
BEGIN
  SELECT code INTO v_code
    FROM hms_referral_codes
   WHERE hostel_id = p_hostel_id AND source = 'pulse' AND is_active
   LIMIT 1;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  FOR i IN 1..5 LOOP
    v_code := hms_new_referral_code();
    BEGIN
      INSERT INTO hms_referral_codes (tenant_id, hostel_id, code, source)
      VALUES (NULL, p_hostel_id, v_code, 'pulse');
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      SELECT code INTO v_code
        FROM hms_referral_codes
       WHERE hostel_id = p_hostel_id AND source = 'pulse' AND is_active
       LIMIT 1;
      IF v_code IS NOT NULL THEN
        RETURN v_code;
      END IF;
    END;
  END LOOP;

  RAISE EXCEPTION 'Could not mint a Pulse referral code for hostel %', p_hostel_id;
END;
$$;

-- ── 5. Auto-create on enable ─────────────────────────────────────────────────
--
-- referral_enabled is flipped from more than one place: the Super Admin UI
-- today, direct psql on production, and whatever admin tooling comes next. Mint
-- the code in app code and every other path silently produces an enabled branch
-- with no Pulse link — a failure with no error, just a blank cell on Growth.
-- The trigger makes "referral_enabled ⇒ an active Pulse code exists" a database
-- invariant with one enforcement point.
--
-- AFTER, not BEFORE: the hostel row must exist for the FK. The false→true edge
-- test plus an idempotent ensure means a disable/enable cycle returns the code
-- Pulse already published rather than minting a second one. Independent of the
-- BEFORE trigger hms_block_referral_self_grant, which only authorises the flip.
create or replace function public.hms_pulse_code_on_enable()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
BEGIN
  IF NEW.referral_enabled AND (TG_OP = 'INSERT' OR NOT coalesce(OLD.referral_enabled, false)) THEN
    PERFORM hms_ensure_pulse_code(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

drop trigger if exists hms_hostels_pulse_code on public.hms_hostels;
create trigger hms_hostels_pulse_code
  after insert or update of referral_enabled on public.hms_hostels
  for each row execute function public.hms_pulse_code_on_enable();

-- ── 6. Grants ────────────────────────────────────────────────────────────────
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and these are
-- SECURITY DEFINER. Left as-is, any browser session could POST
-- /rpc/hms_ensure_pulse_code with someone else's hostel id and mint a live
-- Pulse link on a branch it does not own. Same posture as every other referral
-- object: service role only, which is all the trigger needs (a trigger function
-- runs as the statement's executor and is exempt from EXECUTE checks).
revoke all on function public.hms_new_referral_code()
  from public, anon, authenticated;
revoke all on function public.hms_ensure_pulse_code(uuid)
  from public, anon, authenticated;
revoke all on function public.hms_pulse_code_on_enable()
  from public, anon, authenticated;

grant execute on function public.hms_ensure_pulse_code(uuid) to service_role;

-- ── 7. Backfill ──────────────────────────────────────────────────────────────
--
-- The trigger's own function is the backfill; there is no separate script.
select public.hms_ensure_pulse_code(id)
  from public.hms_hostels
 where referral_enabled;
