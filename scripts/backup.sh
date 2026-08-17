#!/usr/bin/env bash
# Encrypted logical backup — report §11.6.
#
# Managed PITR is the first line of defence; this dump exists for the case PITR
# cannot cover: losing the provider account itself. It refuses to produce an
# unencrypted artifact, because a database dump of this system contains contract
# values, customer contact details and decision records.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:=./.data/backups}"
: "${BACKUP_GPG_RECIPIENT:?BACKUP_GPG_RECIPIENT is required (a GPG key id or email)}"

command -v pg_dump >/dev/null || { echo "pg_dump not found" >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg not found; refusing to write an unencrypted dump" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y-%m-%d)"
target="$BACKUP_DIR/extrawork-$stamp.dump.gpg"

if [[ -e "$target" ]]; then
  echo "Refusing to overwrite an existing backup for today: $target" >&2
  exit 1
fi

echo "Dumping to $target ..."
# -Fc: custom format, so pg_restore can list and selectively restore.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | gpg --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$target"

size=$(wc -c < "$target" | tr -d ' ')
if [[ "$size" -lt 4096 ]]; then
  echo "Backup is suspiciously small ($size bytes); treating as a failure" >&2
  rm -f "$target"
  exit 1
fi

echo "Wrote $target ($size bytes)"
echo "Now verify it:  ./scripts/verify-backup.sh $target"
