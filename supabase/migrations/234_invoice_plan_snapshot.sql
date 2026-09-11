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
  'Package snapshot (basic|standard) at generation time — drives the "Package" line on the invoice PDF. Historical: never rewritten on a later plan change.';

-- Backfill existing invoices from the owner's CURRENT plan (the historical plan
-- was not recorded, so this is the best available). New invoices snapshot the
-- plan at generation. A client who has since changed plans may need a specific
-- past invoice corrected by hand.
UPDATE public.hms_platform_invoices i
SET plan = p.plan
FROM public.hms_profiles p
WHERE p.id = i.owner_id AND p.plan IS NOT NULL AND i.plan IS NULL;
