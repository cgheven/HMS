-- Persist generated receipt PDFs instead of rebuilding them on every view.
--
-- Before this, GET /r/<token> ran ~6 queries and a full jsPDF build every
-- single time, and rendered from the LIVE hms_payments row — so a receipt
-- saved by a tenant in January could show different numbers in August if the
-- payment was ever re-touched. Caching the rendered bytes fixes both.
--
-- The cache bookkeeping lives on hms_invoice_links, NOT hms_payments, and that
-- placement is load-bearing: hms_payments carries a BEFORE UPDATE trigger
-- (hms_payments_updated_at) that bumps updated_at on every write. Storing the
-- stamp on the payment row would mean the very UPDATE that saves the stamp
-- also moves updated_at past it, so the cache would miss on every request.
-- hms_invoice_links has no such trigger.
--
-- pdf_stamp holds the payment's updated_at at generation time. Any later write
-- to the payment moves updated_at and invalidates the cache. It can
-- over-invalidate (an unrelated column change also busts it) but can never
-- under-invalidate, which is the safe direction for a financial document.
-- Installment-scoped links point at an immutable snapshot row, so they are
-- stamped 'immutable' and never expire.

-- pdf_filename is stored rather than derived so the cache hit stays a single
-- query — the tenant name and billing month that make up the download name are
-- otherwise only available from the very joins the fast path exists to skip.
ALTER TABLE hms_invoice_links ADD COLUMN IF NOT EXISTS pdf_path     text;
ALTER TABLE hms_invoice_links ADD COLUMN IF NOT EXISTS pdf_stamp    text;
ALTER TABLE hms_invoice_links ADD COLUMN IF NOT EXISTS pdf_filename text;

-- Supports both the cache fan-out (one payment can have several links, all
-- sharing one storage object) and the existing-link reuse lookup that replaced
-- minting a fresh permanent token on every Receipt click.
CREATE INDEX IF NOT EXISTS idx_hms_invoice_links_payment_id
  ON hms_invoice_links(payment_id);
CREATE INDEX IF NOT EXISTS idx_hms_invoice_links_installment_id
  ON hms_invoice_links(installment_id);

-- Private bucket. Receipts are financial documents for a named tenant and must
-- never be publicly listable. Deliberately NO storage.objects policies are
-- created: only the service-role client (app/r/[token]/route.ts) touches this
-- bucket, and service_role bypasses RLS. Anon and authenticated therefore fall
-- through to default-deny.
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;
