-- Receipt/invoice PDF links are a permanent share/reprint link for a tenant's
-- payment, not a time-boxed access grant — they should never expire.
-- NULL expires_at now means "permanent" (checked in app/r/[token]/route.ts and
-- the RLS policy below), rather than every link carrying a fixed 7-day TTL.
ALTER TABLE hms_invoice_links ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE hms_invoice_links ALTER COLUMN expires_at DROP DEFAULT;

DROP POLICY IF EXISTS "Anyone can read unexpired invoice links" ON hms_invoice_links;
CREATE POLICY "Anyone can read unexpired invoice links"
  ON hms_invoice_links FOR SELECT
  USING (expires_at IS NULL OR expires_at > now());

-- Extend still-valid links to permanent too, not just newly created ones.
-- Already-expired links are left as-is — regenerate via the UI if still needed.
UPDATE hms_invoice_links SET expires_at = NULL WHERE expires_at > now();
