-- Platform billing: Pulse invoicing hostel-owner clients (distinct from
-- hms_payments/hms_invoice_links, which are the hostel's own tenants paying rent).
-- Billing is tracked per CLIENT (owner_id), not per branch, since pricing is
-- quoted for the whole account (see hms_platform_leads.quoted_annual_price).

create table if not exists hms_client_billing (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  billing_cycle text not null default 'annual' check (billing_cycle in ('monthly', 'annual')),
  custom_price numeric(12, 2),
  pricing_notes text,
  next_invoice_date date,
  updated_at timestamptz not null default now()
);

create table if not exists hms_platform_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  period_label text not null,
  period_start date not null,
  period_end date not null,
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'cancelled')),
  paid_at timestamptz,
  marked_paid_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hms_platform_invoices_owner on hms_platform_invoices(owner_id);
create index if not exists idx_hms_platform_invoices_owner_period on hms_platform_invoices(owner_id, period_start);

alter table hms_client_billing enable row level security;
alter table hms_platform_invoices enable row level security;

-- Owners can read their own billing config/invoices (used by the owner-facing
-- /billing page, which reads via the session-scoped client like the rest of
-- lib/data.ts). All writes go through server actions using the service role,
-- so no insert/update/delete policies are needed here.
create policy "Owners view own billing config"
  on hms_client_billing for select
  using (auth.uid() = owner_id);

create policy "Owners view own invoices"
  on hms_platform_invoices for select
  using (auth.uid() = owner_id);
