#!/usr/bin/env bash
# Daily backup health check — report §11.6 and the §13.5 "backup freshness" SLI.
#
# A backup that has never been read is a hypothesis. This asserts the artifact
# decrypts, is a real pg_dump archive, and contains the tables that carry
# evidence — not merely that a file exists.
set -euo pipefail

archive="${1:?usage: verify-backup.sh <path-to-.dump.gpg>}"
required_tables=(organizations projects change_order_versions decisions audit_events)

tmp="$(mktemp -t extrawork-backup-XXXXXX)"
trap 'rm -f "$tmp"' EXIT

gpg --quiet --decrypt "$archive" > "$tmp"

listing="$(pg_restore --list "$tmp")"
for table in "${required_tables[@]}"; do
  echo "$listing" | grep -q "TABLE DATA public $table " || {
    echo "FAIL: $table is missing from $archive" >&2
    exit 1
  }
done

age_hours=$(( ( $(date +%s) - $(stat -f %m "$archive" 2>/dev/null || stat -c %Y "$archive") ) / 3600 ))
if (( age_hours > 26 )); then
  echo "FAIL: newest backup is ${age_hours}h old (expected under 26h)" >&2
  exit 1
fi

echo "OK: $archive decrypts, contains all evidence tables, ${age_hours}h old"
