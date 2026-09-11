-- Snapshot the package (plan) on each platform invoice, so the invoice PDF can
-- show "Basic Package" / "Standard Package". Like the rate/discount/branch_count
-- snapshot already on the row, this is a historical record — it must not change if
-- the owner later switches plans (e.g. a 6K Basic → 8K Standard upgrade). Nullable;
-- the CHECK allows NULL (an invoice whose owner had no explicit plan). Table is
-- service-role-write only, so no guard trigger.
ALTER TABLE public.hms_platform_invoices
  ADD COLUMN IF NOT EXISTS plan text
  CHECK (plan IS NULL OR plan IN ('basic','standard'));

COMMENT ON COLUMN public.hms_platform_invoices.plan IS
  'Package snapshot (basic|standard) at generation time — drives the "Package" line + the package-relative discount on the invoice PDF. Historical: never rewritten on a later plan change.';

-- Deliberately NO backfill. Existing invoices keep plan = NULL, so they render on
-- the OLD path (list back-derived from their own snapshotted discount_pct) exactly
-- as they were issued — stamping the current plan onto an old discount snapshot
-- would show an inconsistent discount (e.g. "Basic Price 6,000 · Discount 38% ·
-- −1,000", where −1,000 is really 16.7%). Only NEW / regenerated invoices carry a
-- plan and use the two-package model. A specific past invoice can be opted in by
-- hand (safe only when its rate equals its package list, i.e. 0 discount).
