-- Defense in depth for the Paddle tables. Client access is already denied by RLS
-- (SELECT-only policy scoped to auth.uid() = owner_id; webhook_events has no
-- policy at all). All writes happen through the service-role client inside the
-- webhook, which bypasses both grants and RLS. So no client role ever needs
-- write access here — remove the default table grants outright, leaving RLS as a
-- second gate rather than the only one.

revoke insert, update, delete on public.hms_paddle_subscriptions  from anon, authenticated;
revoke insert, update, delete on public.hms_paddle_transactions   from anon, authenticated;
revoke insert, update, delete, select on public.hms_paddle_webhook_events from anon, authenticated;
