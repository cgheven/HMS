-- ─────────────────────────────────────────────────────────────────────────────
-- Referral link tracking: opens and shares
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Turns the Tenant links tab from a list of codes into a funnel:
--   sent -> shared -> opened -> submitted -> joined -> paid
--
-- Only the first two are new. The rest already exist.
--
-- WHY COUNTERS AND NOT AN EVENTS TABLE
-- An events table grows without bound on an anonymous, unauthenticated path and
-- needs its own RLS surface. Three columns on the row the page already reads
-- cost one UPDATE and no extra query. The trade is that counters are all-time
-- and cannot be scoped to the month picker, which the UI states outright rather
-- than quietly mixing an all-time figure into a month view.
--
-- WHY TWO COUNTERS AND NOT ONE
-- Pasting a link into WhatsApp makes Meta fetch the URL to build the preview
-- card. That arrives here as a real request with a bot user-agent. Counting it
-- as an open would inflate every conversion rate on the page — the number would
-- climb without a single human looking at anything. Split out, the same request
-- becomes the only share signal that exists, since forwarding is invisible to
-- us. So the split is not a nicety: one of the two counters has to exist for
-- the other to mean anything.

alter table public.hms_referral_codes
  add column if not exists view_count integer not null default 0,
  add column if not exists share_count integer not null default 0,
  add column if not exists last_viewed_at timestamptz;

-- Atomic increment. Read-modify-write from the app would lose counts whenever
-- two people open the same link at once, and this runs on a public page where
-- that is the normal case, not the rare one.
--
-- SECURITY DEFINER because hms_referral_codes has RLS and the caller here is
-- anonymous. The function can only ever add 1 to one of two counters on one
-- row, so definer rights buy no reach beyond that.
create or replace function public.hms_referral_link_hit(
  p_code_id uuid,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
BEGIN
  IF p_kind = 'share' THEN
    UPDATE public.hms_referral_codes
       SET share_count = share_count + 1
     WHERE id = p_code_id;
  ELSIF p_kind = 'view' THEN
    -- last_viewed_at tracks humans only. A preview crawler refreshing a card
    -- is not the link "being looked at", and an owner reading that column to
    -- decide whether a tenant is active would be misled by it.
    UPDATE public.hms_referral_codes
       SET view_count = view_count + 1,
           last_viewed_at = now()
     WHERE id = p_code_id;
  END IF;
END;
$$;

revoke all on function public.hms_referral_link_hit(uuid, text) from public, anon, authenticated;
grant execute on function public.hms_referral_link_hit(uuid, text) to service_role;

comment on column public.hms_referral_codes.view_count is
  'All-time human opens of /ref/<code>. Bot and link-preview fetches are excluded.';
comment on column public.hms_referral_codes.share_count is
  'All-time link-preview fetches — the closest observable proxy for the link being pasted into a chat.';
