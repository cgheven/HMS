-- Track whether the one-time onboarding fee has been COLLECTED, so it is charged
-- exactly once across both billing rails. "Owes onboarding" = NOT waive_onboarding
-- AND NOT onboarding_paid:
--   - waive_onboarding = true  → self-onboarded / waived, never charged.
--   - onboarding_paid  = true  → already settled (bank first-invoice paid, or the
--     card checkout's one-time onboarding line item paid).
-- hms_client_billing is service-role-write only (owners have a read-only RLS
-- policy, no write policy), so no guard trigger is needed.
ALTER TABLE public.hms_client_billing
  ADD COLUMN IF NOT EXISTS onboarding_paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hms_client_billing.onboarding_paid IS
  'Service-role only. true = the one-time onboarding fee has been collected (bank first-invoice paid, or card onboarding line item paid). With waive_onboarding, gates whether the card checkout adds the onboarding line item.';

-- Backfill: a client who has already PAID an invoice carrying the onboarding fee
-- has settled onboarding — don't re-charge them if they move to card.
UPDATE public.hms_client_billing b
SET onboarding_paid = true
WHERE EXISTS (
  SELECT 1 FROM public.hms_platform_invoices i
  WHERE i.owner_id = b.owner_id
    AND i.status = 'paid'
    AND i.onboarding_fee_charged > 0
);
