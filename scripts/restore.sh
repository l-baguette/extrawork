#!/usr/bin/env bash
# Restore a backup into a target database — report §11.6.
#
# Deliberately restores into a NAMED target rather than the live database, so
# running this by accident cannot destroy production. Follow
# infra/runbooks/restore-database.md; in particular, verify audit chains BEFORE
# reopening writes.
set -euo pipefail

archive="${1:?usage: restore.sh <path-to-.dump.gpg> <target-database-url>}"
target_url="${2:?usage: restore.sh <path-to-.dump.gpg> <target-database-url>}"

if [[ "$target_url" == "${DATABASE_URL:-}" ]]; then
  echo "Refusing to restore over the live DATABASE_URL. Restore to a new database." >&2
  exit 1
fi

tmp="$(mktemp -t extrawork-restore-XXXXXX)"
trap 'rm -f "$tmp"' EXIT

echo "Decrypting $archive ..."
gpg --quiet --decrypt "$archive" > "$tmp"

echo "Restoring into $target_url ..."
pg_restore --no-owner --no-privileges --clean --if-exists --dbname "$target_url" "$tmp"

echo
echo "Restore complete. Before reopening writes, run:"
echo "  DATABASE_URL='$target_url' pnpm db:migrate       # expect 'No new migrations'"
echo "  DATABASE_URL='$target_url' pnpm db:verify-chain  # must exit 0"
echo "  psql '$target_url' -c 'SELECT * FROM project_integrity_mismatches();'"
