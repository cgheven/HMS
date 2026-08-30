-- Receipt tokens were world-readable.
--
-- Migration 073 created "Anyone can read unexpired invoice links" as a SELECT
-- policy on the `public` role, and nulled every expires_at in the same breath —
-- so the condition (expires_at is null or expires_at > now()) was true for every
-- row. With the anon key that ships in every browser bundle, one request returned
-- all 515 live receipt tokens on the platform, each opening /r/<token> with a
-- tenant name, room, amount, method and hostel details. Verified against
-- production before writing this.
--
-- The policy was never needed. app/r/[token]/route.ts:55 reads the table with
-- createAdminClient() — service role, which bypasses RLS — and so do the other
-- three call sites (app/actions/tenants.ts createInvoiceLink, lib/bill-link.ts,
-- lib/whatsapp-payment-confirmation.ts). Nothing reads this table through a user
-- session: rehearsed rolled-back on production, `authenticated` returns 0 rows
-- with the policy in place, and service_role still returns all 534.
--
-- Tokens stay permanent and unrevocable, which is a separate problem. This only
-- stops them being enumerable.

drop policy if exists "Anyone can read unexpired invoice links"
  on public.hms_invoice_links;

revoke all on public.hms_invoice_links from anon;
