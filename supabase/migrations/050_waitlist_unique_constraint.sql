-- Add unique constraint required by joinWaitlist upsert (onConflict: "hostel_id,phone")
alter table hms_waitlist
  add constraint hms_waitlist_hostel_phone_unique unique (hostel_id, phone);
