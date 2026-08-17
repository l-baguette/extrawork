-- A change order raised over WhatsApp has no creating user.
--
-- Migration 0005 built the WhatsApp intake channel on the premise that an
-- employee has no login: their phone number is their entire identity, which is
-- why `employees` has no user reference and why `change_order_versions` gained
-- `raised_by_employee_id` to record who actually raised a request.
--
-- It left one column behind. `change_orders.created_by_user_id` is NOT NULL,
-- so the parent row still demands a user id that, for this channel, does not
-- exist. The sibling column on `change_order_versions` is already nullable, as
-- are `audit_events.actor_id` and `baseline_versions.recorded_by_user_id`, so
-- this is the last place the old "every write has a signed-in user" assumption
-- survives.
--
-- The alternative — naming the owner, or any other real person, as the creator
-- of a request they did not raise — would put a false name on a record that
-- feeds an append-only evidence chain and an exported audit trail. Report §3.3
-- and §12.4 are explicit that the record must not claim more than it knows.
-- A null here is honest: nobody signed in, and `raised_by_employee_id` on the
-- version says who did raise it.
--
-- Nothing existing changes. Every row written before this migration has a real
-- user id, and the web composer continues to set one on every request.

ALTER TABLE change_orders
  ALTER COLUMN created_by_user_id DROP NOT NULL;

COMMENT ON COLUMN change_orders.created_by_user_id IS
  'The signed-in user who created this request. NULL for requests raised over '
  'WhatsApp, where the originator has no user account and is recorded as '
  'change_order_versions.raised_by_employee_id instead.';
