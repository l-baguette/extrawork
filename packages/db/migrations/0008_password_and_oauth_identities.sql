-- Email/password sign-in and third-party identities.
--
-- Report §6.5 prefers managed authentication and says the product should not
-- build password, MFA and recovery flows itself. That guidance still stands for
-- a production deployment, and `AUTH_DRIVER=supabase|clerk` remains the
-- supported path. This migration adds a first-party option alongside it,
-- because the product needs a public sign-up that works before any managed
-- provider is configured.
--
-- What that costs, stated plainly: password reset, lockout policy, breach
-- notification and MFA are now this system's problem for local accounts. None
-- of those are built here. `AUTH_DRIVER=local` is therefore refused in
-- production by `packages/config`, exactly as it was before.
--
-- The hash is scrypt (RFC 7914) from Node's standard library, stored with its
-- own salt and parameters so the cost can be raised later without invalidating
-- existing hashes. Plaintext is never stored, never logged, and never leaves
-- the request that carries it.

ALTER TABLE users
  ADD COLUMN password_hash text,
  -- Set when a password is chosen or changed, so a future policy can expire
  -- credentials that predate a parameter change.
  ADD COLUMN password_set_at timestamptz;

COMMENT ON COLUMN users.password_hash IS
  'scrypt hash in the form scrypt$N$r$p$salt$hash, all base64. NULL for users '
  'who only sign in through a magic link or a third-party provider.';

-- ---------------------------------------------------------------------------
-- Third-party identities (Google today, others later)
-- ---------------------------------------------------------------------------
--
-- Kept in its own table rather than as more columns on `users`, because one
-- person may legitimately hold several: an account created with a password and
-- later linked to Google is one user with two ways in, not two users.

CREATE TABLE user_identities (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('google')),
  -- The provider's own stable id for this person. Never their email: an email
  -- can be reassigned by a workspace admin, a subject cannot.
  provider_subject text NOT NULL,
  email_normalized text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  UNIQUE (provider, provider_subject)
);

CREATE INDEX user_identities_user_idx ON user_identities (user_id);
