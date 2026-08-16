-- Let a branch rename the metered AC line on its receipt.
--
-- One client bills a single electricity charge that covers everything in the
-- room, the air conditioner included. The system already models and computes
-- that correctly as the metered AC charge — per-unit rate, meter readings,
-- checkout reconciliation, all of it. The only thing wrong for them is the word
-- on the receipt, which says "AC Charges" when the money is for electricity.
--
-- So this is a LABEL, not a charge. Nothing about billing changes: no new
-- amount, no new column on hms_payments, no arithmetic anywhere. Deliberately
-- so — the alternative, a separate "electricity" charge type, would duplicate
-- the metered-billing machinery in lib/tenant-checkout.ts and the Payments AC
-- Units tab to render one different string.
--
-- NULL, with no default, means every existing row keeps printing the current
-- literal "AC Charges". Receipts for the other 14 branches are byte-for-byte
-- unchanged, which is the property that matters here — a receipt is a document
-- clients have already filed, and a label that shifts under them is worse than
-- one that is merely imprecise.
--
-- Text rather than a boolean or an enum: the next client to ask will want a
-- third word ("Utilities", "Bijli"), and a boolean would have to be replaced
-- rather than extended. Length is capped because this renders into a 250pt
-- thermal receipt line — anything longer collides with the amount column.
alter table public.hms_package_configs
  add column if not exists ac_charge_label text;

alter table public.hms_package_configs
  drop constraint if exists hms_package_configs_ac_charge_label_len;

alter table public.hms_package_configs
  add constraint hms_package_configs_ac_charge_label_len
  check (ac_charge_label is null or char_length(btrim(ac_charge_label)) between 1 and 24);
