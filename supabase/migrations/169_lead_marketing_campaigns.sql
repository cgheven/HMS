-- Marketing campaigns to CRM leads.
--
-- Three additions, each with exactly one job:
--
--   hms_platform_leads.marketing_opt_out
--     The permanent "never message this person again" flag. Separate from
--     status='rejected' on purpose: rejected is a sales outcome an admin may
--     want to re-approach later, opt-out is a request we must honour forever.
--
--   hms_whatsapp_messages.lead_id
--     Lets the delivery webhook's delivered/read status be attributed back to
--     a lead. Without it a campaign send is indistinguishable from every other
--     row in the log, and "did they read it?" is unanswerable.
--
--   hms_lead_campaign_sends
--     The send-once ledger. The unique index is the real guarantee; the
--     "already sent" badge in the UI is only a courtesy. Claimed BEFORE the
--     Meta call — same technique sendAnnouncementToWhatsAppAction uses — so a
--     double-click, a second tab or a retried request cannot blast the same
--     lead twice. Marketing is the one message type where a duplicate is
--     actively harmful: it is what gets a number reported and blocked.

alter table public.hms_platform_leads
  add column if not exists marketing_opt_out boolean not null default false;

alter table public.hms_whatsapp_messages
  add column if not exists lead_id uuid references public.hms_platform_leads(id) on delete set null;

create index if not exists hms_whatsapp_messages_lead_idx
  on public.hms_whatsapp_messages (lead_id, created_at desc)
  where lead_id is not null;

create table if not exists public.hms_lead_campaign_sends (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.hms_platform_leads(id) on delete cascade,
  campaign_key text not null,
  phone        text not null,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  wamid        text,
  error        text,
  sent_by      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A failed attempt must stay retryable, so failures are excluded from the
-- constraint. Anything that reached Meta ('pending' or 'sent') locks the pair
-- permanently.
create unique index if not exists hms_lead_campaign_sends_once
  on public.hms_lead_campaign_sends (lead_id, campaign_key)
  where status <> 'failed';

create index if not exists hms_lead_campaign_sends_campaign_idx
  on public.hms_lead_campaign_sends (campaign_key, created_at desc);

-- Mirrors hms_lead_activities: RLS on, no policies, so only the service role
-- reaches it. Every write already goes through a super-admin server action.
alter table public.hms_lead_campaign_sends enable row level security;

drop trigger if exists hms_lead_campaign_sends_updated_at on public.hms_lead_campaign_sends;
create trigger hms_lead_campaign_sends_updated_at
  before update on public.hms_lead_campaign_sends
  for each row execute function public.hms_set_updated_at();
