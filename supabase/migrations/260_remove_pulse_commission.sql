-- Migration 260: remove the Pulse referral commission — referrals are FREE.
--
-- The commission was report-only (it never hit an invoice/Paddle) and is now
-- removed for good: the single rate source always returns 0, so every charge site
-- (hms_charge_pulse_commission, called from attribution / rent-settle / reconcile)
-- computes 0 and nothing accrues. Any commission still recorded as pending
-- (charged, not reversed) is zeroed so nothing shows as owed. The owner-facing
-- "Pulse commission" display is removed in the app (components/modules/marketing).

-- 1. Rate is always 0 — no commission accrues anywhere.
CREATE OR REPLACE FUNCTION public.hms_pulse_commission_percent(p_hostel_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 0::smallint;
$function$;

-- 2. Zero any pending (charged, not-yet-reversed) commission so nothing reads as owed.
UPDATE public.hms_referrals
   SET pulse_commission_amount = 0
 WHERE pulse_commission_reversed_at IS NULL
   AND coalesce(pulse_commission_amount, 0) <> 0;

-- 3. Also drop the platform + any per-branch configured rate to 0, so nothing is
-- reintroduced from settings even if the function were ever reverted.
UPDATE public.hms_platform_settings SET referral_commission_percent = 0
 WHERE coalesce(referral_commission_percent, 0) <> 0;
UPDATE public.hms_hostels SET pulse_commission_percent = 0
 WHERE coalesce(pulse_commission_percent, 0) <> 0;
