-- ─────────────────────────────────────────────────────────────────────────────
-- Imported marketing lists, kept out of the sales pipeline
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A scraped list of 300+ hostels across Punjab is not a sales pipeline. Dropped
-- into hms_platform_leads as-is it would bury the 106 real leads the sales team
-- works — every one of them status 'new', unassigned, cluttering the board and
-- the pipeline counts.
--
-- But it cannot live in its own table either. Every safety rail on the campaign
-- page is keyed to hms_platform_leads.id: the send-once ledger
-- (hms_lead_campaign_sends.lead_id), delivery attribution
-- (hms_whatsapp_messages.lead_id), the 24h cooldown, the 131026 dead-number
-- memory, marketing_opt_out, the duplicate-number collapse and existing-client
-- detection. A parallel table means building all of it twice, and the first
-- thing the second copy gets wrong is the cross-list duplicate: a hostel that
-- sits in both the scrape and the CRM gets two messages minutes apart from the
-- same WABA number every tenant's rent reminder goes out on. That is what got
-- v1/v4 throttled (131049).
--
-- So: one table, one discriminator.
--
--   list_id IS NULL      → the CRM pipeline. All 106 rows today, untouched.
--   list_id IS NOT NULL  → an imported marketing contact. Never on the leads
--                          board, never assigned to a rep, never in the
--                          follow-up cron (it has no next_follow_up_date).

create table if not exists public.hms_lead_lists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirrors hms_lead_campaign_sends: RLS on, no policies, so only the service
-- role reaches it. Every write goes through a super-admin server action.
alter table public.hms_lead_lists enable row level security;

drop trigger if exists hms_lead_lists_updated_at on public.hms_lead_lists;
create trigger hms_lead_lists_updated_at
  before update on public.hms_lead_lists
  for each row execute function public.hms_set_updated_at();

alter table public.hms_platform_leads
  add column if not exists list_id uuid references public.hms_lead_lists(id) on delete cascade,
  -- What came back from the campaign, entered by a human. Deliberately NOT the
  -- `status` pipeline column (new/contacted/demo_done/...) — that is a sales
  -- process an imported cold contact is not in, and NOT the delivery status
  -- from Meta either, which says the phone received it, not that anyone
  -- answered. NULL means no reply yet, which is the honest default for a
  -- contact nobody has heard from.
  add column if not exists campaign_response text,
  -- Soft delete. A contact that has already been messaged cannot be hard
  -- deleted: hms_lead_campaign_sends cascades away with it and the permanent
  -- "already sent this campaign" guard goes with it, so the same number
  -- becomes blastable again. Rows never messaged are deleted outright.
  add column if not exists archived_at timestamptz;

alter table public.hms_platform_leads
  drop constraint if exists hms_platform_leads_campaign_response_check;
alter table public.hms_platform_leads
  add constraint hms_platform_leads_campaign_response_check
  check (campaign_response is null or campaign_response in
    ('replied', 'interested', 'not_interested', 'wrong_number', 'converted'));

create index if not exists hms_platform_leads_list_idx
  on public.hms_platform_leads (list_id, business_name)
  where list_id is not null;

-- The leads board and every pipeline count now filter on `list_id is null`;
-- this keeps that the cheap path however large the imported lists get.
create index if not exists hms_platform_leads_crm_idx
  on public.hms_platform_leads (created_at desc)
  where list_id is null;

comment on column public.hms_platform_leads.list_id is
  'NULL = a CRM sales lead. Set = an imported marketing contact, excluded from the leads board and pipeline stats.';
comment on column public.hms_platform_leads.campaign_response is
  'Human-entered outcome of a marketing campaign. NULL = no reply. Not the Meta delivery status.';
