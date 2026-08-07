-- Tenant checkout feedback.
--
-- A tenant who checks out gets a WhatsApp link carrying a per-tenant token.
-- That link opens a six-question form. Five questions are one-tap and
-- constrained to a fixed vocabulary; the sixth is free text.
--
-- PRIVATE BY DECREE. This data is for the hostel owner only. It must never
-- reach /find, a branded subdomain, a JSON-LD block, or any other public
-- surface. That is not a UI preference, it is the reason the anon role gets
-- zero read policies below: a public page cannot render what it cannot query.
--
-- THREAT MODEL. This is the only PUBLIC, UNAUTHENTICATED, WRITE endpoint in
-- the product that accepts FREE TEXT, and that text is then rendered in the
-- owner's dashboard and emailed to the owner. Two schema-level consequences:
--
--   1. Exactly ONE column in this schema accepts free text (`comment`).
--      Every other answer is a CHECK-constrained enum, so five sixths of the
--      payload cannot carry an injection string at all, regardless of what
--      the application layer does or forgets to do.
--   2. Nothing here sanitises, strips or rewrites `comment`. It is stored
--      verbatim and escaped at RENDER, per context. Input-time sanitising is
--      lossy (a tenant writing "food was < average" deserves to keep their
--      sentence), it cannot know whether the destination is HTML, an email
--      body or a CSV cell, and it makes one forgotten write path poison every
--      read path forever. See the comment on the column.

-- ---------------------------------------------------------------------------
-- Prerequisite: a composite key on hms_tenants so tenant -> hostel binding can
-- be enforced by the database rather than by application discipline.
--
-- Both tables below carry hostel_id alongside tenant_id. Without this unique
-- constraint those two columns are free to disagree, and a token minted for a
-- tenant at branch A could be made to write feedback against branch B. With
-- it, the composite FKs below make that state unrepresentable.
--
-- Additive and free: (id) is already the primary key, so (id, hostel_id) is
-- unique by construction and the index build cannot fail on existing data.
-- ---------------------------------------------------------------------------

ALTER TABLE public.hms_tenants
  DROP CONSTRAINT IF EXISTS hms_tenants_id_hostel_uniq;
ALTER TABLE public.hms_tenants
  ADD CONSTRAINT hms_tenants_id_hostel_uniq UNIQUE (id, hostel_id);

-- ---------------------------------------------------------------------------
-- 1. hms_feedback_tokens — the credential
-- ---------------------------------------------------------------------------
-- Kept in its own table, not as columns on the feedback row, for one reason:
-- the feedback row is read by three dashboard surfaces (the Feedback page, the
-- dashboard tile, the tenant's own record). Three read paths is three chances
-- for someone to write select("*") and ship a live credential into a client
-- bundle. A token that lives in a table no dashboard query ever touches cannot
-- be leaked that way.
--
-- ONLY THE HASH IS STORED. The raw token exists in exactly two places: the
-- WhatsApp message and the tenant's URL bar. It is generated in the server
-- action with crypto.randomBytes(32) (256 bits, base64url, 43 chars) and only
-- its SHA-256 hex digest is ever sent to the database.
--
-- Why hashed, when hms_invoice_links and hms_onboarding_submissions store raw:
-- those tokens grant READ of a document the holder already owns. This one
-- grants a WRITE that is attributed to a named real tenant and that emails the
-- owner. If the raw value were stored, then a leaked backup, a Postgres log
-- line, an over-broad select, or a partner-tier read would hand an attacker
-- every outstanding token in a usable state. Hashed, a full table dump is
-- worth nothing.
--
-- The cost is that a token cannot be re-derived to resend the same link. That
-- is the correct trade: a resend should ROTATE (revoke the old, mint a new),
-- which is what the partial unique index below already forces.

CREATE TABLE IF NOT EXISTS public.hms_feedback_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256 hex digest of the raw token. Deliberately NO DEFAULT: a default
  -- would let someone mint a token in SQL and reach for the returned value as
  -- the URL, which would put the raw secret into a query result set and from
  -- there into the pooler's and Supabase's query logs. There is exactly one
  -- legal way to create a row here, and it is from the server action holding
  -- a value the database never sees.
  --
  -- The CHECK is not cosmetic. The raw token is base64url (43 chars, contains
  -- '-' and '_'); the digest is 64 lowercase hex. Making the two shapes
  -- mutually exclusive means a future mistake that writes the raw token into
  -- this column is rejected by the database instead of silently persisting a
  -- plaintext credential that still "works".
  token_hash  text NOT NULL UNIQUE
              CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  tenant_id   uuid NOT NULL,
  hostel_id   uuid NOT NULL REFERENCES public.hms_hostels(id) ON DELETE CASCADE,

  -- Pins the tenant->hostel pair at mint time. Editing hms_tenants.hostel_id
  -- afterwards cannot redirect an outstanding token at another branch, because
  -- this FK would no longer resolve.
  CONSTRAINT hms_feedback_tokens_tenant_fk
    FOREIGN KEY (tenant_id, hostel_id)
    REFERENCES public.hms_tenants (id, hostel_id) ON DELETE CASCADE,

  -- A write credential sitting in a WhatsApp thread that gets forwarded is a
  -- forgery window, and a window with no end is a permanent one. 30 days is
  -- generous for a tenant who moved out mid-term and comes back to it late,
  -- and bounded enough that a link forwarded a year later is inert.
  --
  -- Deliberately NOT NULL with no "permanent" escape hatch, unlike
  -- hms_invoice_links where NULL means forever. A receipt is a document the
  -- tenant may need for years; this is a one-time write.
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  -- Set by the single conditional UPDATE in hms_submit_tenant_feedback().
  -- This column IS the single-use enforcement; see that function.
  consumed_at timestamptz,

  -- Set when a link is rotated (resend) or the owner kills it.
  revoked_at  timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one LIVE link per tenant, enforced by the database rather than by
-- the mint code remembering to check. Minting a replacement therefore requires
-- revoking the outstanding one, so "resend the feedback link" can never leave
-- two usable credentials in circulation for the same person.
--
-- expires_at is deliberately absent from the predicate: now() is not immutable
-- and cannot appear in an index. Expiry is enforced in the claim query instead.
CREATE UNIQUE INDEX IF NOT EXISTS hms_feedback_tokens_one_live_per_tenant
  ON public.hms_feedback_tokens (tenant_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- Housekeeping only. Lets a future prune job find dead rows without a seq scan.
CREATE INDEX IF NOT EXISTS hms_feedback_tokens_expiry_idx
  ON public.hms_feedback_tokens (expires_at)
  WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. hms_tenant_feedback — the response
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hms_tenant_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  hostel_id  uuid NOT NULL REFERENCES public.hms_hostels(id) ON DELETE CASCADE,

  -- UNIQUE is the belt to the token's braces. One response per tenant is the
  -- product rule; the single-use token already delivers it, and this constraint
  -- means that even a bug that somehow issued two live tokens still cannot
  -- produce two responses.
  --
  -- Safe against a returning tenant: checkout sets is_active = false and never
  -- reactivates a row (there is no is_active -> true write path anywhere in
  -- app/actions/tenants.ts), so a second stay is a new hms_tenants row with a
  -- new id and its own entitlement to leave feedback.
  tenant_id  uuid NOT NULL UNIQUE,

  CONSTRAINT hms_tenant_feedback_tenant_fk
    FOREIGN KEY (tenant_id, hostel_id)
    REFERENCES public.hms_tenants (id, hostel_id) ON DELETE CASCADE,

  -- NO ACTION (the default), deliberately not CASCADE and deliberately not
  -- RESTRICT. Not CASCADE, because pruning spent tokens must never be able to
  -- delete the feedback they authorised. Not RESTRICT, because RESTRICT is
  -- checked immediately: deleting a hostel cascades to hms_feedback_tokens,
  -- and RESTRICT would abort on the still-present feedback row a fraction of a
  -- second before that same cascade removed it, making hostel deletion fail.
  -- NO ACTION defers the check to end of statement, so a prune still errors
  -- while a legitimate whole-hostel cascade completes.
  --
  -- UNIQUE so one token can only ever have produced one row — the backstop
  -- that makes claim-then-insert safe even against a retry that somehow
  -- presented an already-claimed token.
  token_id   uuid NOT NULL UNIQUE
             REFERENCES public.hms_feedback_tokens(id) ON DELETE NO ACTION,

  -- Poor/Fair/Good/Excellent, not Bad/Good/Better/Best: an unhappy tenant needs
  -- an honest place to land, and a scale whose worst option is "Good" does not
  -- have one.
  --
  -- The opt-outs are not politeness. A room-only package has no meals and a
  -- private room has no roommate; without these the form forces a false answer,
  -- and a false "Poor" would page the owner over a service the tenant never
  -- bought.
  food        text NOT NULL CHECK (food        IN ('poor','fair','good','excellent','no_meals')),
  cleanliness text NOT NULL CHECK (cleanliness IN ('poor','fair','good','excellent')),
  staff       text NOT NULL CHECK (staff       IN ('poor','fair','good','excellent')),
  roommate    text NOT NULL CHECK (roommate    IN ('poor','fair','good','excellent','no_roommate')),
  recommend   text NOT NULL CHECK (recommend   IN ('yes','maybe','no')),

  -- THE ONLY UNTRUSTED FREE TEXT IN THIS SCHEMA.
  --
  -- Stored EXACTLY as the tenant typed it. No tag stripping, no entity
  -- encoding, no rewriting — on purpose:
  --   * Escaping is context-dependent. This value is rendered as a React text
  --     child (React escapes it), interpolated into an HTML email (needs esc()
  --     from lib/email.ts), and may one day land in a CSV cell (needs formula
  --     -injection quoting). A single input-time transformation is correct for
  --     none of those three and gives false confidence in all of them.
  --   * Storing pre-escaped text means the day someone adds a plain-text
  --     surface, tenants see "&lt;3" instead of "<3".
  --   * A sanitiser is one line of code between the attacker and every reader,
  --     forever. An escape at render is one line between each reader and the
  --     data, and a missing one breaks that surface only.
  --
  -- Application-layer validation is limited to: trim, collapse to NULL when
  -- empty, strip C0 control characters other than \n and \t, and the length
  -- cap below. None of those change the tenant's words.
  --
  -- The 2000 cap matches hms_complaints' DESCRIPTION_MAX_LENGTH and is
  -- restated here so the DATABASE is the floor — an unbounded text column on a
  -- public write endpoint is a storage-exhaustion primitive regardless of what
  -- the server action checks.
  comment    text CHECK (comment IS NULL OR char_length(comment) <= 2000),

  -- Drives BOTH the dashboard tile's "1 needs attention" count AND the
  -- immediate owner email. Generated, not written by application code, because
  -- those are two consumers of one rule: the moment the tile computes it in SQL
  -- and the mailer computes it in TypeScript, they drift, and the drift is
  -- silent in the direction that matters (a tile saying 0 while a tenant sits
  -- unhappy). One definition, indexable, impossible to disagree with itself.
  needs_attention boolean
    GENERATED ALWAYS AS (
      food = 'poor' OR cleanliness = 'poor' OR staff = 'poor'
      OR roommate = 'poor' OR recommend = 'no'
    ) STORED,

  -- Owner has read and dealt with it. The ONLY column an owner may change.
  acknowledged_at timestamptz,

  -- Forensics for the abuse case, never displayed. Best-effort: behind a proxy
  -- chain this is only as good as the header the platform sets, which is why
  -- it is evidence and not a control.
  submitted_ip   text,
  submitted_agent text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The Feedback page: newest first, scoped to the active branch.
CREATE INDEX IF NOT EXISTS hms_tenant_feedback_hostel_recent_idx
  ON public.hms_tenant_feedback (hostel_id, created_at DESC);

-- The dashboard tile counts exactly this set, so the index IS the query.
-- Partial, because the rows that need attention are the minority and the tile
-- runs on every dashboard load.
CREATE INDEX IF NOT EXISTS hms_tenant_feedback_attention_idx
  ON public.hms_tenant_feedback (hostel_id, created_at DESC)
  WHERE needs_attention AND acknowledged_at IS NULL;

-- No index for the rating filter on the Feedback page. A branch produces a few
-- dozen checkouts a year, so filtering the branch's own rows in memory is
-- cheaper than five more indexes to maintain on every insert.

-- ---------------------------------------------------------------------------
-- 3. Answers are append-only
-- ---------------------------------------------------------------------------
-- The entire value of this feature is that it is the tenant's own testimony.
-- An owner who can edit it has a review system that reports whatever the owner
-- wants it to report. RLS cannot restrict columns, so the immutability lives
-- here, in a trigger, where it binds every client including the service role.
--
-- acknowledged_at is the sole exception: that is the owner's own annotation,
-- not the tenant's words.

CREATE OR REPLACE FUNCTION public.hms_tenant_feedback_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.food            IS DISTINCT FROM OLD.food
  OR NEW.cleanliness     IS DISTINCT FROM OLD.cleanliness
  OR NEW.staff           IS DISTINCT FROM OLD.staff
  OR NEW.roommate        IS DISTINCT FROM OLD.roommate
  OR NEW.recommend       IS DISTINCT FROM OLD.recommend
  OR NEW.comment         IS DISTINCT FROM OLD.comment
  OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
  OR NEW.hostel_id       IS DISTINCT FROM OLD.hostel_id
  OR NEW.token_id        IS DISTINCT FROM OLD.token_id
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  -- The forensic columns are guarded too. They exist for the case where
  -- somebody other than the tenant authored a row, and the party most likely
  -- to be that somebody is on the inside — so leaving them writable would have
  -- meant the evidence could be edited by the person it is evidence about.
  OR NEW.submitted_ip    IS DISTINCT FROM OLD.submitted_ip
  OR NEW.submitted_agent IS DISTINCT FROM OLD.submitted_agent
  THEN
    RAISE EXCEPTION 'Tenant feedback is append-only; only acknowledged_at may change.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS hms_tenant_feedback_no_edit ON public.hms_tenant_feedback;
CREATE TRIGGER hms_tenant_feedback_no_edit
  BEFORE UPDATE ON public.hms_tenant_feedback
  FOR EACH ROW EXECUTE FUNCTION public.hms_tenant_feedback_immutable();

-- ---------------------------------------------------------------------------
-- 4. No per-IP probe budget
-- ---------------------------------------------------------------------------
-- An earlier draft of this migration kept a per-IP log of failed token
-- lookups and refused further requests from an address that burned its hourly
-- budget. It is removed, and the DROPs below exist so a database that ran that
-- draft ends up in the same state as one that did not.
--
-- It had to go because the gate was consulted BEFORE the token was looked up,
-- on both the GET and the submit. An IP is not a person: Pakistani carriers
-- CGNAT thousands of subscribers behind one address, and a hostel's own WiFi
-- is one address for every tenant in the building. Twenty stale or mistyped
-- links in an hour — no attacker required — and every genuine tenant sharing
-- that address was shown the dead-link page while their token sat unspent.
-- The screen even told them their feedback was already recorded, so they had
-- no reason to retry. A control that silently destroys the thing it protects
-- is worse than no control.
--
-- Moving the gate after the lookup would have made it inert (a miss already
-- returns nothing), so there was no version of it worth keeping. What remains
-- is what the entropy argument always said was doing the real work: 256 bits
-- per token, single use, one live credential per tenant, and a single indexed
-- hash lookup per guess. Enumeration is hopeless and there is no
-- amplification — one successful submitter gets exactly one write, ever.

DROP FUNCTION IF EXISTS public.hms_feedback_probe_allowed(text);
DROP TABLE IF EXISTS public.hms_feedback_probe_log;

-- ---------------------------------------------------------------------------
-- 5. Resolving a token for the GET (rendering the form)
-- ---------------------------------------------------------------------------
-- Returns the hostel name and NOTHING ELSE when the token is live, and zero
-- rows in every other case — unknown, expired, revoked, or already consumed.
--
-- The single return shape is the point. The page must not tell a caller WHY a
-- token failed, because "this one was real and has been used" versus "this one
-- never existed" is an oracle. Collapsing it in the DATABASE means the server
-- action has no reason code available to branch on even if someone later tries
-- to be helpful — the leak-free behaviour is the only behaviour on offer.
--
-- The caller renders one identical HTTP 200 page for the empty result: "This
-- feedback link is no longer active. If you've already sent your feedback,
-- thank you — it's been recorded." True for the consumed case, honest for the
-- expired case, and uninformative to a stranger. Not 404 and not 410: a
-- differing status code is the easiest oracle of all to script.
--
-- Returns the hostel NAME, never its id, and never one field of the tenant.
-- The spec asks for the hostel in the header; it does not ask to greet the
-- tenant by name, and it must not — a forwarded WhatsApp link that renders
-- "Hi Ahmed" has disclosed who moved out of where to whoever it was forwarded
-- to. The tenant already knows who they are.
CREATE OR REPLACE FUNCTION public.hms_feedback_token_hostel(p_token_hash text)
RETURNS TABLE (hostel_name text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT h.name
  FROM public.hms_feedback_tokens t
  JOIN public.hms_hostels h ON h.id = t.hostel_id
  WHERE t.token_hash  = p_token_hash
    AND t.consumed_at IS NULL
    AND t.revoked_at  IS NULL
    AND t.expires_at  > now();
$$;

-- ---------------------------------------------------------------------------
-- 6. Submitting — claim and insert, atomically
-- ---------------------------------------------------------------------------
-- RACE SAFETY. The obvious implementation (SELECT the token, check it is
-- unconsumed, INSERT the feedback, UPDATE the token) is a TOCTOU bug: two
-- concurrent submits both read consumed_at IS NULL and both proceed. A tenant
-- double-tapping Submit on a flaky mobile connection is enough to hit it.
--
-- Instead the claim is a single conditional UPDATE. Under READ COMMITTED, when
-- two transactions target the same row the second blocks on the row lock, then
-- re-evaluates its WHERE clause against the committed updated row, sees
-- consumed_at IS NOT NULL, and matches nothing. Exactly one caller gets a
-- RETURNING row. This is a property of the statement, not of application
-- sequencing, so it holds across processes, regions and retries.
--
-- ATOMICITY. Claim and insert live in one function body, therefore one
-- transaction. If the insert fails for any reason the claim rolls back with it
-- and the tenant's one chance is not silently burnt — which is exactly what
-- would happen if the app issued the UPDATE and the INSERT as two round trips.
--
-- The function is NOT granted to anon. Its only caller is the server action
-- holding the service-role key. Exposing it to the anon role would let anyone
-- POST straight at PostgREST with the public key, bypassing the action's
-- IP budget, its input normalisation, and any future bot check.
CREATE OR REPLACE FUNCTION public.hms_submit_tenant_feedback(
  p_token_hash  text,
  p_food        text,
  p_cleanliness text,
  p_staff       text,
  p_roommate    text,
  p_recommend   text,
  p_comment     text,
  p_ip          text DEFAULT NULL,
  p_agent       text DEFAULT NULL
)
RETURNS TABLE (
  feedback_id     uuid,
  tenant_id       uuid,
  hostel_id       uuid,
  needs_attention boolean
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token_id  uuid;
  v_tenant_id uuid;
  v_hostel_id uuid;
BEGIN
  UPDATE public.hms_feedback_tokens t
     SET consumed_at = now()
   WHERE t.token_hash  = p_token_hash
     AND t.consumed_at IS NULL
     AND t.revoked_at  IS NULL
     AND t.expires_at  > now()
  RETURNING t.id, t.tenant_id, t.hostel_id
       INTO v_token_id, v_tenant_id, v_hostel_id;

  -- Not live, for whatever reason. Returns zero rows, the same as
  -- hms_feedback_token_hostel, so the caller cannot distinguish "used",
  -- "expired", "revoked" and "never existed" and cannot accidentally build a
  -- message that does.
  IF v_token_id IS NULL THEN
    RETURN;
  END IF;

  -- hostel_id comes from the CLAIMED TOKEN, never from the request. There is
  -- no hostel or tenant parameter on this function at all, so a submitter has
  -- no field through which to aim their answer at another branch or attach it
  -- to another person. The composite FK on the table re-checks the pairing.
  RETURN QUERY
  INSERT INTO public.hms_tenant_feedback (
    hostel_id, tenant_id, token_id,
    food, cleanliness, staff, roommate, recommend,
    comment, submitted_ip, submitted_agent
  ) VALUES (
    v_hostel_id, v_tenant_id, v_token_id,
    p_food, p_cleanliness, p_staff, p_roommate, p_recommend,
    -- Stored verbatim. Escaped at render, per context. See the column comment.
    nullif(btrim(coalesce(p_comment, '')), ''),
    left(p_ip, 64), left(p_agent, 400)
  )
  RETURNING
    hms_tenant_feedback.id,
    hms_tenant_feedback.tenant_id,
    hms_tenant_feedback.hostel_id,
    hms_tenant_feedback.needs_attention;
END; $$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.hms_feedback_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hms_tenant_feedback   ENABLE ROW LEVEL SECURITY;

-- RLS on with ZERO policies = deny-all for every end user, including the anon
-- role the public form runs as, and including the owner. Same posture as
-- hms_onboarding_submissions. Nobody has a legitimate reason to read a token
-- table: the owner's dashboard shows feedback, not credentials, and a hash in
-- a dashboard query is a hash one select("*") away from a log file.
--
-- Explicit REVOKE as well as RLS: Supabase's default privileges grant table
-- access to anon and authenticated, and RLS is what holds it back. Removing
-- the grant too means a future policy added in haste cannot open the table by
-- itself. Defence in depth, and it costs nothing.
REVOKE ALL ON public.hms_feedback_tokens FROM anon, authenticated;

-- ── hms_tenant_feedback ────────────────────────────────────────────────────
-- What the anon role must NOT be able to read is the whole point, so it is
-- worth stating: no policy below mentions anon. An unauthenticated caller can
-- therefore read NOTHING from this table — not another tenant's ratings, not a
-- comment, not an aggregate score, not the fact that a given tenant left
-- feedback at all. The only data an anonymous caller ever receives from this
-- feature is one hostel's name, returned by hms_feedback_token_hostel() to
-- somebody who already proved possession of a live token.
--
-- Owner and partner policies mirror hms_complaints exactly (migrations 004 and
-- 094), so a branch's feedback is visible to precisely the people who can
-- already see that branch's complaints. Partners are read-only: feedback is a
-- tenant's testimony and there is no role that should be able to author it.
-- The owner's FOR ALL is house style and matches every other table. It confers
-- nothing beyond SELECT here: the append-only trigger blocks any rewrite, and
-- the GRANT below leaves authenticated with no INSERT, UPDATE or DELETE
-- privilege for a policy to permit in the first place.

DROP POLICY IF EXISTS "Owner manages own tenant feedback" ON public.hms_tenant_feedback;
CREATE POLICY "Owner manages own tenant feedback" ON public.hms_tenant_feedback
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.hms_hostels h
      WHERE h.id = hms_tenant_feedback.hostel_id
        AND h.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hms_hostels h
      WHERE h.id = hms_tenant_feedback.hostel_id
        AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members_read_tenant_feedback" ON public.hms_tenant_feedback;
CREATE POLICY "members_read_tenant_feedback" ON public.hms_tenant_feedback
  FOR SELECT USING (hostel_id IN (SELECT hms_partner_hostel_ids()));

-- RLS alone was not enough here, for two reasons that only a GRANT can fix.
--
-- 1. RLS cannot restrict COLUMNS. With Supabase's default table grant standing,
--    an owner holding their own session JWT could run select('*') straight at
--    PostgREST from the browser console and read submitted_ip and
--    submitted_agent — the tenant's network address and device fingerprint,
--    under a form headed "Private feedback". The app never selects them and
--    never displays them; a column-level GRANT is what makes that true of the
--    data rather than merely true of our own queries.
--
-- 2. The owner's FOR ALL policy plus the default grant meant UPDATE and DELETE
--    were reachable outside the application entirely. The append-only trigger
--    still refused to let the answers change, but a direct PATCH could rewrite
--    the forensic columns (they are trigger-guarded now) and a direct DELETE
--    could remove an inconvenient row with nothing in any server log to show
--    for it.
--
-- Reads stay under RLS as before — the grant narrows which columns, the policy
-- decides which rows. Writes are service-role only: the sole write the product
-- performs is the acknowledged_at marker, which already goes through the admin
-- client in getTenantFeedback.
REVOKE ALL ON public.hms_tenant_feedback FROM anon, authenticated;
GRANT SELECT (
  id, hostel_id, tenant_id,
  food, cleanliness, staff, roommate, recommend, comment,
  needs_attention, acknowledged_at, created_at
) ON public.hms_tenant_feedback TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Function grants
-- ---------------------------------------------------------------------------
-- Both functions are reachable ONLY through the service-role client
-- inside a server action. anon and authenticated are revoked explicitly: the
-- public form must go through the server action so that the length
-- normalisation and the response shaping cannot be skipped by posting directly
-- at PostgREST with the publishable anon key.

REVOKE ALL ON FUNCTION public.hms_feedback_token_hostel(text)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hms_submit_tenant_feedback(text, text, text, text, text, text, text, text, text)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hms_feedback_token_hostel(text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.hms_submit_tenant_feedback(text, text, text, text, text, text, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Documentation carried in the database
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.hms_feedback_tokens IS
  'Single-use checkout feedback credentials. Stores only the SHA-256 hex digest of the token; the raw 256-bit base64url value exists solely in the WhatsApp message and the tenant URL and is never sent to the database. Single use is enforced by the conditional UPDATE in hms_submit_tenant_feedback(), which is race-safe under READ COMMITTED. RLS on with no policies: service role only.';

COMMENT ON COLUMN public.hms_feedback_tokens.token_hash IS
  'SHA-256 hex of the raw token. No DEFAULT on purpose — minting in SQL would put the raw secret into a result set and therefore into query logs. The hex CHECK rejects a raw base64url token written here by mistake.';

COMMENT ON COLUMN public.hms_feedback_tokens.consumed_at IS
  'Set by a single conditional UPDATE ... WHERE consumed_at IS NULL. That statement, not any application check, is what makes concurrent submits produce exactly one response.';

COMMENT ON TABLE public.hms_tenant_feedback IS
  'Private checkout feedback, one row per tenant. Owner-visible only: never surfaced on /find, a branded subdomain, or any JSON-LD block. Answers are append-only (see hms_tenant_feedback_immutable); only acknowledged_at may change.';

COMMENT ON COLUMN public.hms_tenant_feedback.comment IS
  'Untrusted free text from an unauthenticated submitter. Stored VERBATIM — never sanitised on input. Escape at RENDER, per context: React text child in the dashboard (never dangerouslySetInnerHTML; use whitespace-pre-wrap for line breaks), esc() from lib/email.ts BEFORE any newline-to-<br> replacement in the owner email, and formula-injection quoting if it ever reaches a CSV export. Never interpolate into an attribute, a URL, or an email subject header.';

COMMENT ON COLUMN public.hms_tenant_feedback.needs_attention IS
  'Generated, never written. Single definition shared by the dashboard tile count and the immediate owner email, so the two cannot drift.';

COMMENT ON COLUMN public.hms_tenant_feedback.submitted_ip IS
  'Forensics for the abuse case. Service-role only: excluded from the column-level SELECT grant to authenticated, so neither an owner nor a partner can read it from PostgREST, and trigger-guarded so nobody can rewrite it. Never displayed.';
