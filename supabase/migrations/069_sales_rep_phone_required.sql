-- Mobile number is required for sales reps, not optional — it's needed to
-- share login credentials over WhatsApp and to actually reach the rep.
-- Verified no existing hms_sales_reps row has a NULL phone before this runs.
ALTER TABLE hms_sales_reps ALTER COLUMN phone SET NOT NULL;
