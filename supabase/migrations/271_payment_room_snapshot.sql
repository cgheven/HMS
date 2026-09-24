-- Migration 271: snapshot the room a bill belongs to on hms_payments.
--
-- room_id previously lived only on hms_tenants (the CURRENT room), so the member
-- ledger stamped today's room on every past bill — a tenant who moved from
-- Room 101 (Jan–Jun) to Room 102 (Jun–Aug) showed as all-102. This column records
-- the room at bill-creation time so the ledger can segment by room accurately.
--
-- Nullable + ON DELETE SET NULL: a deleted room never blocks or corrupts a bill.
--
-- DELIBERATELY NO BACKFILL. hms_payments carries a BEFORE-UPDATE re-pricing trigger
-- that recomputes `amount` from today's rent/discount on any UPDATE to a pending
-- row (this is the "collected status freezes the price" behaviour). A room_id
-- backfill is an UPDATE, so it would silently re-price historical pending bills —
-- a rolled-back prod dry-run showed it moving ~Rs 137k of bill totals. And the
-- backfill added nothing: the member ledger already falls back to the member's
-- current room for a NULL room_id, which is exactly what a backfill would have set.
-- So existing bills stay NULL (→ show current room, unchanged from before this
-- feature) and only NEW bills get the room snapshotted at creation. This keeps the
-- migration a pure additive ADD COLUMN with zero data change.

alter table public.hms_payments
  add column if not exists room_id uuid references public.hms_rooms(id) on delete set null;

-- Refresh PostgREST's schema cache so the new column is writable immediately.
notify pgrst, 'reload schema';
