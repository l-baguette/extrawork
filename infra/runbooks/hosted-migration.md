# Moving off this machine: Supabase + Cloudflare R2

ExtraWork runs on two stores, and both have to move:

| Store      | Today                      | Target                              | Why                                                                                 |
| ---------- | -------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| PostgreSQL | Homebrew, `localhost:5432` | **Supabase**, Mumbai (`ap-south-1`) | India data residency and latency; the codebase already has a `supabase` auth driver |
| Objects    | `./.data/storage`          | **Cloudflare R2**                   | Zero egress fees, and evidence PDFs are downloaded repeatedly                       |

`packages/config` refuses to boot in production with `STORAGE_DRIVER=local`, so
this migration is not optional before a pilot.

---

## Before you start

The database side has been checked against this schema:

- **Extensions required:** `pgcrypto`, `pg_trgm`, `unaccent`. All three are
  available on Supabase and must be enabled before the first migration runs.
- **No superuser operations** appear in any migration — no `ALTER SYSTEM`, no
  `CREATE TABLESPACE`, no ownership changes. The 38 functions and triggers are
  all ordinary DDL.
- **No collation assumptions.** The schema never names a collation, so
  Supabase's default locale is fine. (`docker-compose.yml` pins C collation only
  to keep local index behaviour identical across developer machines.)
- **`CREATE ROLE` is needed once**, by `pnpm db:harden`, which creates the
  restricted runtime role that cannot UPDATE or DELETE the append-only evidence
  tables. Supabase's `postgres` role can do this.

---

## 1. Supabase

1. Create the project. **Region must be `ap-south-1` (Mumbai)** — it cannot be
   changed later without recreating the project.
2. Choose a database password and keep it in your own password manager. It
   appears in `DATABASE_URL` and nowhere else.
3. **Database → Extensions**, enable: `pgcrypto`, `pg_trgm`, `unaccent`.
4. **Project Settings → Database → Connection string → URI.**

### Use the direct connection, not the transaction pooler

Supabase offers three connection strings. This matters more than it looks:

|                    | Port | Use it?                                    |
| ------------------ | ---- | ------------------------------------------ |
| Direct connection  | 5432 | **Yes**                                    |
| Session pooler     | 5432 | Yes, if direct is unavailable on your plan |
| Transaction pooler | 6543 | **No**                                     |

The worker's job queue leases rows with `FOR UPDATE SKIP LOCKED` inside
transactions, and `packages/db` manages its own connection pool. Transaction-mode
pooling hands a different backend to each statement, which breaks session state
and advisory locks. It will _appear_ to work and then fail intermittently under
load, which is the worst failure mode to debug.

---

## 2. Cloudflare R2

1. **R2 → Create bucket.** Keep it **private** — evidence packs are served
   through signed URLs minted by the app, never by public bucket access.
2. **Manage R2 API Tokens → Create token**, with Object Read & Write on that
   bucket. You get an Access Key ID and a Secret Access Key; the secret is shown
   once.
3. Note your S3 endpoint: `https://<account-id>.r2.cloudflarestorage.com`.

R2's region is always the literal string `auto`.

---

## 3. Put the values in `.env` yourself

Do not paste credentials into a chat window, a commit, or an issue. `.env` is
gitignored and is the only place these belong.

```dotenv
# --- Supabase -----------------------------------------------------------
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
DATABASE_SSL=true

# --- Cloudflare R2 ------------------------------------------------------
STORAGE_DRIVER=s3
STORAGE_BUCKET=<bucket-name>
STORAGE_REGION=auto
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY_ID=<access-key-id>
STORAGE_SECRET_ACCESS_KEY=<secret-access-key>
STORAGE_FORCE_PATH_STYLE=true
```

Keep a copy of the old localhost `DATABASE_URL` commented out. Going back is
then one edit, and you will want that while both environments exist.

---

## 4. Run the migration

```bash
pnpm preflight:hosted   # checks connectivity, extensions, and the bucket
pnpm db:migrate         # applies all 7 migrations to Supabase
pnpm db:seed            # demo data; skip for a real pilot
```

`db:migrate` is safe to re-run: every migration is checksummed and applied once.

Then harden, which needs the password you chose for the runtime role:

```bash
RUNTIME_DB_PASSWORD='<a new strong password>' pnpm db:harden --role extrawork_runtime
```

That creates a role without UPDATE or DELETE on `audit_events`, `decisions` and
`repair_events`. Point `DATABASE_URL` at that role afterwards and keep the
`postgres` superuser string as `DATABASE_MAINTENANCE_URL`, used only by the
documented repair commands.

---

## 5. Verify

```bash
pnpm preflight:hosted   # should now report every check green
pnpm test:all           # runs against TEST_DATABASE_URL, still local
pnpm dev
```

Then walk one request end to end and confirm the evidence PDF opens — that is
the only check that proves Postgres _and_ R2 are both working, because the pack
is written to object storage and read back through a signed URL.

---

## Rolling back

Nothing is destroyed by this migration; the local database is untouched.
Restore the commented-out `DATABASE_URL`, set `STORAGE_DRIVER=local`, and
restart. Data written while hosted stays in Supabase.

## Gotchas found doing this for real

**Supabase installs extensions into `extensions`, not `public`.** Migration
0002 hardcoded `public.unaccent` and failed outright. It now resolves the
extension's schema at migration time, so it works on both a plain local
Postgres and a managed host.

**Supabase signs its certificate with its own CA.** Node rejects it by default
with "self-signed certificate in certificate chain". The fix is
`DATABASE_CA_CERT` pointing at the certificate from Project Settings → Database
→ SSL Configuration — not `rejectUnauthorized: false`, which would leave the
connection encrypted but unauthenticated.

**The test suite must never see `DATABASE_URL`.** `TEST_DATABASE_URL` used to
fall back to it, which was harmless against localhost and a live hazard once it
pointed at a hosted database — the suite truncates every table between tests.
`packages/testkit` now refuses any target that is not a local database named
`*_test`. Set `TEST_DATABASE_URL` explicitly.

**`pnpm db:reset` now targets the hosted database.** It refuses in production,
but `APP_ENV=local` against a hosted `DATABASE_URL` is exactly the shape of an
accident. Reset the local test database directly instead.

## What this does not cover

Deploying the three processes somewhere public. Supabase and R2 hold the data;
the api, worker and web processes still run on your machine. Meta's webhooks
need a public URL for the api, which is the next problem after this one.
