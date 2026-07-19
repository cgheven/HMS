-- Onboarding intake submissions.
--
-- Replaces the /onboarding lead form, which collected nine marketing fields and
-- wrote a single hms_platform_leads row. A super-admin then ran
-- createHostelForClient() and retyped every branch by hand — and that function
-- writes only hms_hostels + hms_owner_hostels, never hms_package_configs, so
-- every new hostel started life without an AC rate, deposit, notice period or
-- food pricing. The first AC bill on such a hostel throws
-- "AC per-unit rate is not configured".
--
-- This table holds the owner's own answers for the whole setup, captured before
-- provisioning: branches, type, amenities, pricing, food add-ons, seater grid,
-- partners and bank accounts. Provisioning then becomes one click with nothing
-- retyped and nothing left unconfigured.
--
-- `data` is a single JSONB document rather than columns on purpose. The shape is
-- owned by OnboardingData in types/index.ts and will change as the wizard's
-- steps change; a draft is worthless once provisioned, so there is nothing to
-- migrate when it does. Validation happens in the server action and again at
-- provision time, against the real column constraints.
--
-- `token` is the URL the owner is sent. It is the only credential — the form is
-- deliberately unauthenticated, because the whole point is that a prospect who
-- has no account yet can fill it in. 18 random bytes = 144 bits, hex-encoded,
-- so it is not guessable and not enumerable.

create table if not exists hms_onboarding_submissions (
  id           uuid        primary key default gen_random_uuid(),
  token        text        not null unique default encode(gen_random_bytes(18), 'hex'),
  status       text        not null default 'draft'
                           check (status in ('draft', 'submitted', 'provisioned', 'abandoned')),
  data         jsonb       not null default '{}'::jsonb,
  -- Set when this intake came from an existing sales lead, so provisioning can
  -- flip that lead to 'converted' the same way the manual path already does.
  lead_id      uuid        references hms_platform_leads(id) on delete set null,
  -- Set once provisioned, so a resubmitted link cannot create a second account.
  owner_id     uuid,
  ip_address   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  submitted_at timestamptz
);

create index if not exists idx_hms_onboarding_submissions_status
  on hms_onboarding_submissions(status, created_at desc);

create index if not exists idx_hms_onboarding_submissions_lead
  on hms_onboarding_submissions(lead_id);

drop trigger if exists hms_onboarding_submissions_updated_at on hms_onboarding_submissions;
create trigger hms_onboarding_submissions_updated_at
  before update on hms_onboarding_submissions
  for each row execute procedure hms_set_updated_at();

-- RLS on with ZERO policies = deny-all for every end user, including the
-- anon role the public form runs as. Every read and write goes through the
-- service-role client inside server actions, which authorise by proving
-- possession of the token (or, for the review UI, by requireSuperAdmin()).
-- Same posture as hms_managers. This matters more than usual here: a draft
-- holds the owner's email, phone and full commercial pricing, and the form is
-- unauthenticated, so anon must never be able to read the table directly.
alter table hms_onboarding_submissions enable row level security;
