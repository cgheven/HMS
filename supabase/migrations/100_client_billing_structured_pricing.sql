-- Replace hms_client_billing's single opaque custom_price with structured
-- fields (monthly rate, annual discount %, onboarding waiver) so an invoice
-- can show the full list price, what's actually charged, and the total
-- discount/waiver between them — not just one flat number.

alter table hms_client_billing
  add column monthly_rate numeric(12,2),
  add column annual_discount_pct numeric(5,2) not null default 20,
  add column waive_onboarding boolean not null default false;

-- Backfill from the existing flat custom_price, preserving today's actual
-- charge exactly: derive an equivalent monthly rate, and start every existing
-- client at 0% discount / onboarding waived so nothing changes for them
-- until an admin deliberately opts them into the new default scheme.
update hms_client_billing
set
  monthly_rate = case
    when billing_cycle = 'annual' then round(custom_price / 12, 2)
    else custom_price
  end,
  annual_discount_pct = 0,
  waive_onboarding = true
where custom_price is not null;

alter table hms_client_billing drop column custom_price;

-- hms_platform_invoices: replace the standard_annual_price list-price snapshot
-- (compared against a global per-branch rate that was never actually charged)
-- with a snapshot of the structured fields that produced this specific
-- invoice's amount, so historical invoices stay accurate even if the client's
-- rate/discount/onboarding-waiver changes later.
alter table hms_platform_invoices
  add column monthly_rate numeric(12,2) not null default 0,
  add column discount_pct numeric(5,2) not null default 0,
  add column onboarding_fee_charged numeric(12,2) not null default 0,
  add column is_first_invoice boolean not null default false;

-- Backfill existing invoices: reconstruct monthly_rate from the pre-existing
-- amount/cycle so history stays internally consistent. No onboarding fee
-- concept existed before this migration, so it's left at 0/false for all of them.
update hms_platform_invoices
set monthly_rate = case
  when billing_cycle = 'annual' then round(amount / 12, 2)
  else amount
end;

alter table hms_platform_invoices drop column standard_annual_price;
alter table hms_platform_invoices alter column monthly_rate drop default;
alter table hms_platform_invoices alter column discount_pct drop default;
alter table hms_platform_invoices alter column onboarding_fee_charged drop default;
