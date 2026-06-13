#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/opt/lumen/.env"
BACKUP_FILE=""
PASSPHRASE_FILE=""
FORCE=0

usage() {
  cat <<'USAGE'
Usage: scripts/restore.sh [options]

Options:
  --config PATH             Config file path
  --backup PATH             Backup tar.gz or tar.gz.enc
  --passphrase-file PATH    Passphrase file for encrypted backup
  --force                   Required for restore
  --dry-run                 List actions without changing the host
  -h, --help                Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --backup) BACKUP_FILE="$2"; shift 2 ;;
    --passphrase-file) PASSPHRASE_FILE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

prepare_backup() {
  local work="$1"
  local archive="$work/backup.tar.gz"
  local member

  [ -n "$BACKUP_FILE" ] || die "--backup is required"
  [ -r "$BACKUP_FILE" ] || die "Backup is not readable: $BACKUP_FILE"
  case "$BACKUP_FILE" in
    *.tar.gz|*.tar.gz.enc)
      ;;
    *)
      die "Backup path must end with .tar.gz or .tar.gz.enc"
      ;;
  esac

  case "$BACKUP_FILE" in
    *.enc)
      [ -r "$PASSPHRASE_FILE" ] || die "--passphrase-file is required for encrypted backups"
      run openssl enc -d -aes-256-cbc -pbkdf2 -in "$BACKUP_FILE" -out "$archive" -pass "file:$PASSPHRASE_FILE"
      ;;
    *)
      archive="$BACKUP_FILE"
      ;;
  esac

  if [ "$DRY_RUN" = "1" ]; then
    run tar -tzf "$archive"
    return 0
  fi

  while IFS= read -r member; do
    case "$member" in
      /*|../*|*/../*|*"/../"*|*"/.."|*"/../"*)
        die "Unsafe path in backup archive: $member"
        ;;
      *)
        ;;
    esac
  done < <(tar -tzf "$archive")

  tar --no-same-owner --no-same-permissions --no-overwrite-dir -xzf "$archive" -C "$work/extract"
}

restore_files() {
  local extract="$1"
  install -m 0600 "$extract/config/lumen.env" "$CONFIG_FILE"
  load_env
  ensure_runtime_dirs
  safe_copy_if_exists "$extract/secrets/." "$LUMEN_SECRETS_DIR/"
  safe_copy_if_exists "$extract/data/runtime/." "$LUMEN_DATA_DIR/runtime/"
  safe_copy_if_exists "$extract/data/uploads/." "$LUMEN_DATA_DIR/uploads/"
  safe_copy_if_exists "$extract/nginx/lumen-http-acme.conf" /etc/nginx/sites-available/
  safe_copy_if_exists "$extract/nginx/lumen-panel.conf" /etc/nginx/sites-available/
  safe_copy_if_exists "$extract/nginx/lumen-subscription.conf" /etc/nginx/sites-available/
}

restore_database() {
  local extract="$1"
  compose_run up -d postgres redis
  compose exec -T postgres pg_restore --clean --if-exists -U lumen -d lumen <"$extract/db/postgres.dump"
}

main() {
  require_root_or_dry_run
  [ "$FORCE" = "1" ] || die "Restore is destructive; pass --force"
  load_env
  acquire_lock restore

  local work
  work="$(mktemp -d)"
  mkdir -p "$work/extract"
  trap 'rm -rf "$work"' EXIT
  prepare_backup "$work"

  if [ "$DRY_RUN" = "1" ]; then
    log "dry run complete; no restore performed"
    return 0
  fi

  compose_run down
  restore_files "$work/extract"
  restore_database "$work/extract"
  compose_run up -d
  run nginx -t
  run systemctl reload nginx
  log "restore complete"
}

main "$@"
