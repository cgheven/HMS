-- The manually-typed annual_discount_pct only ever applied to annual cycles,
-- so a monthly client charged below our standard rate (e.g. Rs 5,000 vs the
-- Rs 8,000 standard) showed "0% discount, full price" — invisible savings on
-- their invoice. Discount is now always auto-derived by comparing a client's
-- monthly_rate against the fixed standard rate (lib/pricing.ts,
-- DEFAULT_CLIENT_MONTHLY_RATE), for both monthly and annual clients alike —
-- there is no longer a separate manually-set annual-only discount lever.
alter table hms_client_billing drop column annual_discount_pct;
