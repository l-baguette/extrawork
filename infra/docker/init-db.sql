-- Runs once when the Postgres container's data directory is created.
--
-- The extensions are created here rather than in a migration because creating
-- an extension needs superuser, which the application role will not have in a
-- managed environment (report §9.6: the runtime role is deliberately limited).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- A separate database for the integration and security suites, so a test run
-- can truncate freely without touching development data.
CREATE DATABASE extrawork_test;
\connect extrawork_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
