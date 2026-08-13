#!/usr/bin/env bash
#
# Nightly logical backup of the HMS production database.
#
# Runs from a server we control rather than CI: this repository is PUBLIC, and
# the fewer places a production database URL exists, the better. Nothing secret
# lives in this file — configuration comes from an env file outside the repo.
#
# SETUP
#   1. Postgres 17 client. The server is 17.6 and pg_dump refuses to dump a
#      server newer than itself, so distro defaults (Ubuntu 24.04 ships 16) are
#      not enough:
#        sudo install -d /usr/share/postgresql-common/pgdg
#        sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
#             https://www.postgresql.org/media/keys/ACCC4CF8.asc
#        echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
#             https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
#             | sudo tee /etc/apt/sources.list.d/pgdg.list
#        sudo apt update && sudo apt install -y postgresql-client-17
#
#   2. Config file, readable only by the user that runs this:
#        sudo install -m 600 /dev/null /etc/hms-backup.env
#        sudo nano /etc/hms-backup.env
#      See REQUIRED/OPTIONAL below for its contents.
#
#   3. Cron, as a NON-root user that owns BACKUP_DIR:
#        15 2 * * *  /opt/hms/scripts/backup-supabase.sh >> /var/log/hms-backup.log 2>&1
#
# REQUIRED in /etc/hms-backup.env
#   SUPABASE_DB_URL   postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
#                     Port 5432 (session pooler), NOT 6543 — transaction pooling
#                     breaks pg_dump, which needs a stable session and locks.
#
# OPTIONAL
#   BACKUP_DIR        default /var/backups/hms
#   RETAIN_DAYS       default 90
#   GPG_RECIPIENT     key id/email; when set the dump is encrypted at rest
#   RCLONE_REMOTE     e.g. "r2:hms-backups" — offsite copy via rclone
#   HEALTHCHECK_URL   pinged on success, /fail on error (healthchecks.io etc.)

set -Eeuo pipefail

# Backups contain CNICs, phone numbers and every tenant's financial history.
# 077 means the files are unreadable by anyone but the owning user from the
# moment they are created, not after a later chmod.
umask 077

CONFIG_FILE="${CONFIG_FILE:-/etc/hms-backup.env}"
# shellcheck source=/dev/null
[ -r "$CONFIG_FILE" ] && . "$CONFIG_FILE"

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set — check $CONFIG_FILE}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hms}"
RETAIN_DAYS="${RETAIN_DAYS:-90}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${BACKUP_DIR}/hms-${STAMP}.dump"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# A backup job that fails silently is worse than no backup job, because you
# stop worrying about it. Every exit path that is not a clean success reports.
fail() {
  local line=$1
  log "FAILED at line ${line}"
  [ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 20 --retry 3 "${HEALTHCHECK_URL}/fail" >/dev/null || true
  exit 1
}
trap 'fail $LINENO' ERR

mkdir -p "$BACKUP_DIR"
log "starting backup -> ${DUMP}"

# --format=custom, not plain SQL: compressed, and pg_restore can pull a single
# table out of it. Restoring one accidentally-truncated table from a plain dump
# means hand-editing a multi-megabyte file.
#
# --no-owner/--no-acl: Supabase manages roles itself, and replaying ownership
# into a fresh project fails on roles that do not exist there yet.
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --schema=public \
  --schema=storage \
  --file="$DUMP"

# Existence and size prove nothing — a truncated archive has both. Asking
# pg_restore to read the table of contents is the cheapest check that the file
# is actually restorable.
pg_restore --list "$DUMP" > /dev/null
TABLES=$(pg_restore --list "$DUMP" | grep -c ' TABLE DATA ' || true)
BYTES=$(wc -c < "$DUMP")
log "archive ok — ${BYTES} bytes, ${TABLES} tables with data"

# The public schema has ~49 tables. A dump that suddenly contains a handful
# means the connection died mid-run or someone pointed this at the wrong
# database, and it must not silently replace a good backup.
if [ "$TABLES" -lt 20 ]; then
  log "only ${TABLES} tables with data — refusing to treat this as a valid backup"
  rm -f "$DUMP"
  exit 1
fi

if [ -n "$GPG_RECIPIENT" ]; then
  gpg --batch --yes --trust-model always -r "$GPG_RECIPIENT" -o "${DUMP}.gpg" -e "$DUMP"
  shred -u "$DUMP" 2>/dev/null || rm -f "$DUMP"
  DUMP="${DUMP}.gpg"
  log "encrypted -> ${DUMP}"
fi

if [ -n "$RCLONE_REMOTE" ]; then
  # Offsite matters more than it looks: a backup that only exists on the server
  # taking the backup does not survive that server dying.
  rclone copy "$DUMP" "$RCLONE_REMOTE" --no-traverse
  log "uploaded to ${RCLONE_REMOTE}"
fi

# Prune AFTER a verified success, never before — a failed run must not be able
# to delete the last good backup on its way out.
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name 'hms-*.dump*' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
log "pruned ${DELETED} archive(s) older than ${RETAIN_DAYS} days"

[ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 20 --retry 3 "$HEALTHCHECK_URL" >/dev/null || true
log "done"
