-- Branch transfer: move a tenant from a room in one branch to a room in another
-- branch of the SAME owner. Per the agreed model the member's core terms carry
-- over — monthly_rent and security_deposit are unchanged, and the whole bill
-- history and ledger follow them — with only hostel_id + room_id changing on the
-- tenant, so no new tenant columns are needed. (Unpaid bills are re-priced to the
-- destination branch's food/AC-maintenance rates by the existing pricing trigger
-- when they are re-homed; already-collected bills stay frozen.) This migration
-- only widens the audit event type so the move is recorded distinctly from a
-- within-branch room change.
--
-- Nothing else in the schema needs to change. In particular the composite
-- foreign keys that pin (tenant_id, hostel_id) on hms_tenant_feedback and
-- hms_feedback_tokens are LEFT EXACTLY AS migration 161 designed them (a
-- deliberate security control: a hostel_id edit must not silently redirect a
-- feedback write-credential to another branch). Those rows only ever exist for
-- a CHECKED-OUT tenant — mintFeedbackToken runs at checkout, and a checked-out
-- tenant is never reactivated — whereas a branch transfer only ever moves an
-- ACTIVE tenant, so the pinned keys are never in the way. branchTransferTenantAction
-- refuses defensively if a feedback row or token is somehow present.

alter table public.hms_tenant_events drop constraint if exists hms_tenant_events_event_type_check;
alter table public.hms_tenant_events add constraint hms_tenant_events_event_type_check
  check (event_type = any (array[
    'room_changed', 'plan_changed', 'deposit_collected', 'deposit_returned',
    'deposit_forfeited', 'deposit_applied', 'notice_given', 'notice_cancelled',
    'branch_changed'
  ]));
