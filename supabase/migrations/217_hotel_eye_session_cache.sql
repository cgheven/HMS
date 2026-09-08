-- Keep a HotelEye portal session alive between syncs.
--
-- A CAPTCHA is solved by a human to open a session; that session stays valid on
-- the portal for a while. Storing it (encrypted) lets a second sync a few
-- minutes later reuse it instead of asking for another CAPTCHA — the ordinary
-- "stay logged in" model, not a second way past the CAPTCHA.
--
-- The blob is the same AES-256-GCM ciphertext shape as the password (portal URL
-- + cookies), decrypted only server-side, never sent to a browser. Cleared when
-- the portal rejects it as expired, and when the credentials change.

alter table public.hms_hotel_eye_credentials
  add column if not exists session_blob text,
  add column if not exists session_saved_at timestamptz;

comment on column public.hms_hotel_eye_credentials.session_blob is
  'Encrypted live portal session (cookies) for reuse across syncs. Decrypted only server-side; cleared on expiry or credential change.';
