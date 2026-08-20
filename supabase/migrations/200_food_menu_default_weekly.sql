-- ─────────────────────────────────────────────────────────────────────────────
-- A new branch starts on the 7-day menu, not the 30-day one
-- ─────────────────────────────────────────────────────────────────────────────
--
-- food_menu_type is NOT NULL and has always defaulted to 'monthly', so the
-- `?? "monthly"` fallback in app/(dashboard)/food/page.tsx has never once fired
-- — every row carries an explicit value. Changing the default here is therefore
-- the only thing that actually moves the needle for a new branch.
--
-- A 30-day grid is a lot of empty cells to hand somebody on their first visit,
-- and most hostels repeat a weekly cycle anyway. Seven days is the smaller
-- promise, and the owner can switch to monthly on the page itself in one click.
--
-- DELIBERATELY NO DATA STATEMENT. The 8 branches currently on 'monthly' keep it.
-- The toggle is visible to owners on the Food List page and writes straight to
-- this column, so a monthly row may be a real choice — and there is no audit
-- trail to tell an active choice apart from an inherited default, because that
-- update is a direct client-side write with no logActivity call. Rewriting them
-- would silently replace a setting they can see, to no benefit they asked for.
-- If they should be moved, that is a separate, deliberate UPDATE.

alter table public.hms_hostels
  alter column food_menu_type set default 'weekly';

comment on column public.hms_hostels.food_menu_type is
  'Which grid the Food List opens: ''weekly'' (7 days, the default for new branches) or ''monthly'' (30). Owner-switchable from the Food List page.';
