-- 080: Per-installment payment records + snapshot receipts.
-- hms_payments.amount_paid is a running CUMULATIVE total — recording a second
-- partial payment overwrites all trace of the first one (its own date/method/
-- amount). A receipt link generated for "the first Rs 10,000" would, if opened
-- later, silently show the CURRENT cumulative state instead of what was true
-- when it was generated. This table keeps one immutable row per actual
-- transaction, so the Member Ledger can show each installment individually and
-- a receipt generated for one installment stays accurate forever.

create table if not exists hms_payment_installments (
  id             uuid default gen_random_uuid() primary key,
  hostel_id      uuid references hms_hostels(id) on delete cascade not null,
  tenant_id      uuid references hms_tenants(id) on delete cascade not null,
  payment_id     uuid references hms_payments(id) on delete cascade not null,
  for_month      text not null,
  amount         numeric(10,2) not null check (amount > 0),
  amount_before  numeric(10,2) not null default 0,
  amount_after   numeric(10,2) not null default 0,
  total_due      numeric(10,2) not null default 0,
  payment_method text,
  payment_date   date,
  notes          text,
  receipt_number text,
  created_at     timestamptz default now() not null
);

alter table hms_payment_installments enable row level security;

create policy "Owner manages own payment installments"
  on hms_payment_installments for all
  using (
    exists (select 1 from hms_hostels h where h.id = hostel_id and h.owner_id = auth.uid())
    or exists (select 1 from hms_owner_hostels oh where oh.hostel_id = hms_payment_installments.hostel_id and oh.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from hms_hostels h where h.id = hostel_id and h.owner_id = auth.uid())
    or exists (select 1 from hms_owner_hostels oh where oh.hostel_id = hms_payment_installments.hostel_id and oh.owner_id = auth.uid())
  );

create index if not exists idx_hms_payment_installments_payment on hms_payment_installments(payment_id, created_at);
create index if not exists idx_hms_payment_installments_tenant on hms_payment_installments(tenant_id, created_at);

-- Let a receipt link point at a specific installment snapshot instead of (or
-- in addition to) the live, mutable payment row.
alter table hms_invoice_links
  add column if not exists installment_id uuid references hms_payment_installments(id) on delete cascade;

-- Also fix a pre-existing bug found while touching this table's policy: the
-- unqualified `hostel_id` inside the junction-owner EXISTS subquery resolves to
-- hms_owner_hostels' OWN column (shadowing), making that OR-branch a tautology
-- (oh.hostel_id = oh.hostel_id is always true). Not currently exploitable —
-- all app writes go through the service-role admin client, bypassing RLS
-- entirely — but it's a broken policy and this migration is already touching
-- this table.
drop policy if exists "Owner can create invoice links for own hostel" on hms_invoice_links;
create policy "Owner can create invoice links for own hostel"
  on hms_invoice_links for insert
  with check (
    exists (select 1 from hms_hostels h where h.id = hostel_id and h.owner_id = auth.uid())
    or exists (select 1 from hms_owner_hostels oh where oh.hostel_id = hms_invoice_links.hostel_id and oh.owner_id = auth.uid())
  );
