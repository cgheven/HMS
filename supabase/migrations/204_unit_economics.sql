-- Unit economics: cost per person, and meal cost for shared kitchens.
--
-- DEPLOY ORDER MATTERS. app/actions/reports.ts selects hms_hostels.kitchen_group_id,
-- so this migration must land BEFORE the application code. PostgREST answers an
-- unknown column with 42703, which makes getReportData() return null and takes the
-- Reports page down for every branch, not just the shared-kitchen block.
--
-- Two additive changes, both no-ops for every hostel that ignores them.
--
-- 1. Two expense categories, `capital` and `groceries`. Widening a CHECK cannot
--    invalidate an existing row — every category legal before this migration is
--    still legal after it.
--
--    `capital`: cost-per-person divides operating spend by head count, so a month
--    that happens to contain a cement delivery or an AC installment otherwise
--    reports a per-person cost several times the real recurring one.
--
--    `groceries`: mess spend is typed into General Expenses at the branches with
--    the largest messes — Ms National's 222,350 of "Atta 5 bag" and "Chicken" sits
--    under `utilities` — so a kitchen figure read only from hms_kitchen_expenses
--    misses most of the food money. Rather than route the row to another table,
--    where it would vanish from the Expenses list and the export and need a
--    different manager permission, it stays put and carries a category the
--    unit-cost maths can move: subtracted from the expenses bucket, added to the
--    kitchen bucket, total unchanged.
--
-- 2. `hms_hostels.kitchen_group_id`. Some owners cook at one branch and feed
--    several. Nobody weighs the degs going out the door, so the split cannot be
--    measured — it is ALLOCATED by subscriber-days, and this column is the only
--    thing that records which branches share a pot. NULL, the value every
--    existing row gets, means self-catered.

alter table public.hms_expenses
  drop constraint if exists hms_expenses_category_check;

alter table public.hms_expenses
  add constraint hms_expenses_category_check
  check (category in ('furniture','repairs','cleaning','security','utilities','capital','groceries','other'));

alter table public.hms_hostels
  add column if not exists kitchen_group_id uuid
    references public.hms_hostels(id) on delete set null;

-- on delete set null, never cascade: dropping the host branch must not delete
-- the branches it was feeding. They fall back to self-catered, which is wrong
-- but visible, rather than gone.
comment on column public.hms_hostels.kitchen_group_id is
  'Branch whose kitchen cooks for this one. Set to the host branch''s own id on every member of the group, the host included. NULL = self-catered.';

create index if not exists hms_hostels_kitchen_group_idx
  on public.hms_hostels (kitchen_group_id) where kitchen_group_id is not null;
