-- hms_payment_installments (migration 080, an immutable per-transaction ledger)
-- predates migrations 092-094's partner "members_read_*" policies and was never
-- included in them. It's needed now for the per-partner "Today's Income"
-- figure (migration 121's daily-expenses feature): summing individual
-- installments by payment_date, since hms_payments.amount_paid is a
-- cumulative running total and would double-count prior partial payments as
-- if they all arrived today. Purely additive SELECT grant — mirrors the exact
-- pattern already used for every other partner-readable table.
create policy "members_read_payment_installments" on hms_payment_installments for select using (
  hostel_id in (select hms_partner_hostel_ids())
);
