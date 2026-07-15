-- Public, unguessable token per invoice so a PDF can be opened via a WhatsApp
-- link with no login required — same model as hms_invoice_links for tenants,
-- but 1:1 with the invoice row since there's no installment/expiry concept here.
alter table hms_platform_invoices
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists idx_hms_platform_invoices_share_token
  on hms_platform_invoices(share_token);
