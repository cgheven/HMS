-- Migration 022: Security fixes for billing integrity and schema constraints
-- Addresses findings F-001, F-002, F-003, F-005, F-007

-- =============================================================
-- F-007: Add CHECK (amount >= 0) on hms_payments.amount
-- =============================================================
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_payments_amount_non_negative'
  ) then
    alter table hms_payments
      add constraint hms_payments_amount_non_negative check (amount >= 0);
  end if;
end $$;

-- =============================================================
-- F-005: Add CHECK (late_fee >= 0) on hms_payments.late_fee
-- =============================================================
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_payments_late_fee_non_negative'
  ) then
    alter table hms_payments
      add constraint hms_payments_late_fee_non_negative check (late_fee >= 0);
  end if;
end $$;

-- =============================================================
-- F-002: Add CHECK constraint on payment_package_tier
-- (mirrors the existing constraint on hms_tenants.package_tier)
-- =============================================================
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_payments_tier_check'
  ) then
    alter table hms_payments
      add constraint hms_payments_tier_check
        check (payment_package_tier in ('space_only', 'space_food', 'space_food_ac'));
  end if;
end $$;

-- =============================================================
-- F-003: Cap ac_charge and ac_units_consumed to prevent NUMERIC overflow
-- ac_units_consumed max 10000 units; ac_charge cap at 9,999,999.99
-- =============================================================
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_payments_ac_units_max'
  ) then
    alter table hms_payments
      add constraint hms_payments_ac_units_max check (ac_units_consumed <= 10000);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_payments_ac_charge_max'
  ) then
    alter table hms_payments
      add constraint hms_payments_ac_charge_max check (ac_charge <= 9999999.99);
  end if;
end $$;

-- =============================================================
-- F-001: PostgreSQL trigger to recalculate amount server-side
-- amount = food_charge + ac_charge + (amount - food_charge - ac_charge)
-- The base rent is whatever was stored; we enforce:
--   stored amount >= food_charge + ac_charge  (add-on charges can't exceed total)
-- AND we recalculate amount from the tenant's monthly_rent when available.
--
-- The trigger reads the canonical monthly_rent from hms_tenants so that
-- direct API calls cannot set amount to an arbitrary value — the DB will
-- always enforce: amount = base_rent + food_charge + ac_charge
-- where base_rent comes from hms_tenants.monthly_rent (for monthly billing)
-- or is kept as-is for daily billing (where pro-ration happens server-side).
-- =============================================================

create or replace function hms_recalculate_payment_amount()
returns trigger
language plpgsql
security definer
as $$
declare
  v_monthly_rent   numeric(10,2);
  v_billing_type   text;
  v_food_charge    numeric(10,2);
  v_ac_charge      numeric(10,2);
  v_base_rent      numeric(10,2);
  v_total          numeric(10,2);
  v_hostel_id      uuid;
  v_food_rate      numeric(10,2) := 0;
begin
  -- Normalise NULLs on the add-on columns
  new.food_charge         := coalesce(new.food_charge, 0);
  new.ac_charge           := coalesce(new.ac_charge, 0);
  new.late_fee            := coalesce(new.late_fee, 0);
  new.ac_units_consumed   := coalesce(new.ac_units_consumed, 0);

  -- Enforce non-negative invariants (belt-and-suspenders over CHECK constraints)
  if new.food_charge < 0 then
    raise exception 'food_charge must be >= 0';
  end if;
  if new.ac_charge < 0 then
    raise exception 'ac_charge must be >= 0';
  end if;
  if new.late_fee < 0 then
    raise exception 'late_fee must be >= 0';
  end if;
  if new.ac_units_consumed < 0 then
    raise exception 'ac_units_consumed must be >= 0';
  end if;

  -- Validate payment_package_tier when supplied
  if new.payment_package_tier is not null
     and new.payment_package_tier not in ('space_only', 'space_food', 'space_food_ac') then
    raise exception 'invalid payment_package_tier: %', new.payment_package_tier;
  end if;

  -- Look up the canonical billing type and monthly_rent from hms_tenants
  select monthly_rent, billing_type, hostel_id
    into v_monthly_rent, v_billing_type, v_hostel_id
    from hms_tenants
   where id = new.tenant_id;

  -- Re-derive food_charge from the canonical package config rate so that a
  -- direct API PATCH cannot under-record or zero-out the food component.
  select coalesce(food_monthly_rate, 0)
    into v_food_rate
    from hms_package_configs
   where hostel_id = v_hostel_id;

  if new.payment_package_tier in ('space_food', 'space_food_ac') then
    new.food_charge := coalesce(v_food_rate, 0);
  else
    new.food_charge := 0;
  end if;

  v_food_charge := new.food_charge;
  v_ac_charge   := new.ac_charge;

  if v_billing_type = 'monthly' then
    -- For monthly tenants: always derive base_rent from the stored monthly_rent
    v_base_rent := coalesce(v_monthly_rent, 0);
    v_total     := v_base_rent + v_food_charge + v_ac_charge;
    new.amount  := v_total;
  else
    -- For daily tenants: pro-ration is computed in the server action / app layer
    -- because it depends on check_in/check_out dates and the selected month.
    -- We still enforce that amount >= food_charge + ac_charge so the base can't
    -- be made negative through direct API manipulation.
    v_base_rent := new.amount - v_food_charge - v_ac_charge;
    if v_base_rent < 0 then
      raise exception
        'payment amount (%) is less than the sum of add-on charges food_charge (%) + ac_charge (%)',
        new.amount, v_food_charge, v_ac_charge;
    end if;
    -- Recalculate to ensure consistency
    new.amount := v_base_rent + v_food_charge + v_ac_charge;
  end if;

  -- Final sanity: amount must be non-negative
  if new.amount < 0 then
    raise exception 'computed payment amount must be >= 0, got %', new.amount;
  end if;

  return new;
end;
$$;

-- Attach the trigger to hms_payments for both INSERT and UPDATE
drop trigger if exists hms_payments_recalculate_amount on hms_payments;
create trigger hms_payments_recalculate_amount
  before insert or update on hms_payments
  for each row execute procedure hms_recalculate_payment_amount();
