-- 081: hms_payment_installments needs its own late_fee snapshot.
-- total_due already includes the late fee (fullAmountDue = amount + lateFee),
-- but the timeline/receipt need the fee broken out on its own so a partial
-- receipt can show "Rent+Food+AC" vs. "Late Fee" separately, same as a normal
-- payment receipt does.

alter table hms_payment_installments
  add column if not exists late_fee numeric(10,2) not null default 0;
