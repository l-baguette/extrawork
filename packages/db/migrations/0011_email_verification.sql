-- Proof that the person registering controls the address they registered with.
--
-- Registration previously created a usable account the moment the form was
-- submitted, which meant anyone could sign up as anyone else's email. That
-- matters more here than in most products: the address is how an owner recovers
-- their account, and this account holds a customer-facing approval ledger.
--
-- Nullable rather than a boolean with a default, so the column records *when*
-- control was proved and not merely that it was. Existing rows stay null and
-- are backfilled below rather than being silently trusted.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Accounts that predate verification.
--
-- Every one of them was created through the local magic-link flow or through
-- Google. Both prove control of the address as a side effect — a magic link is
-- only usable by whoever receives it, and google-oauth.ts already refuses a
-- profile whose `email_verified` claim is false. So these are marked verified
-- at their creation time, which is the moment that proof actually happened,
-- rather than at migration time.
--
-- Password accounts are the exception this migration exists for, but none can
-- exist yet: registration with a password shipped without any verification
-- step, so trusting them would be trusting the gap being closed here. They are
-- left null and must verify on next sign-in.
UPDATE users
   SET email_verified_at = created_at
 WHERE auth_provider <> 'local'
    OR id IN (SELECT user_id FROM user_identities WHERE provider = 'google');

CREATE INDEX IF NOT EXISTS users_unverified_idx ON users (created_at)
  WHERE email_verified_at IS NULL;

COMMENT ON COLUMN users.email_verified_at IS
  'When control of the email address was proved. Null means unproved; password sign-in is refused.';

-- `auth_challenges.purpose` is a CHECK, not an enum, so a new kind of challenge
-- needs the constraint widened or every insert fails at the database. The
-- application's own union type would have compiled happily without this — the
-- check is what actually holds the line, which is why it is authoritative.
ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_purpose_check;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check
  CHECK (purpose IN ('SIGN_IN', 'INVITATION', 'VERIFY_EMAIL'));
