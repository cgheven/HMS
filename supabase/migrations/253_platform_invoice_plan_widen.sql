-- Mirror of 250 for the MANUAL (PK/bank-invoice) rail: widen the plan CHECK on
-- hms_platform_invoices so a manually-invoiced owner who is ever assigned a
-- 'business'/'enterprise' plan does not fail invoice generation with a CHECK
-- violation. 234 originally allowed only NULL/basic/standard.
--
-- Purely additive: every existing invoice row (plan NULL/basic/standard) still
-- passes revalidation; no rewrite. Not reachable for today's clients (non-PK are
-- Paddle-only with no platform invoice; PK owners are basic/standard) — this closes
-- the edge where a super-admin sets a manual owner's plan to business/enterprise.
--
-- 234's CHECK was inline (auto-named hms_platform_invoices_plan_check).

ALTER TABLE public.hms_platform_invoices
  DROP CONSTRAINT IF EXISTS hms_platform_invoices_plan_check;

ALTER TABLE public.hms_platform_invoices
  ADD CONSTRAINT hms_platform_invoices_plan_check
  CHECK (plan IS NULL OR plan = ANY (ARRAY['basic'::text, 'standard'::text, 'business'::text, 'enterprise'::text]));
