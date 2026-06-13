#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/opt/lumen/.env"
OUTPUT_DIR=""
PASSPHRASE_FILE=""
ALLOW_PLAINTEXT=0

usage() {
  cat <<'USAGE'
Usage: scripts/backup.sh [options]

Options:
  --config PATH             Config file path
  --output-dir PATH         Backup output directory
  --passphrase-file PATH    Encrypt backup with openssl using this file
  --allow-plaintext         Allow unencrypted tar.gz backup
  --dry-run                 Print actions without changing the host
  -h, --help                Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --passphrase-file) PASSPHRASE_FILE="$2"; shift 2 ;;
    --allow-plaintext) ALLOW_PLAINTEXT=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

create_backup() {
  local ts work archive encrypted
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  OUTPUT_DIR="${OUTPUT_DIR:-$LUMEN_BACKUP_DIR}"
  archive="$OUTPUT_DIR/lumen-backup-$ts.tar.gz"
  encrypted="$archive.enc"

  if [ -z "$PASSPHRASE_FILE" ] && [ "$ALLOW_PLAINTEXT" != "1" ]; then
    die "Backups contain secrets; pass --passphrase-file or explicit --allow-plaintext"
  fi
  if [ -n "$PASSPHRASE_FILE" ] && [ ! -r "$PASSPHRASE_FILE" ]; then
    die "Passphrase file is not readable: $PASSPHRASE_FILE"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "would create backup under $OUTPUT_DIR"
    return 0
  fi

  mkdir -p "$OUTPUT_DIR"
  chmod 0700 "$OUTPUT_DIR"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN

  mkdir -p "$work/db" "$work/config" "$work/secrets" "$work/data" "$work/nginx" "$work/meta"
  compose exec -T postgres pg_dump -U lumen -d lumen --format=custom >"$work/db/postgres.dump"
  install -m 0600 "$CONFIG_FILE" "$work/config/lumen.env"
  safe_copy_if_exists "$LUMEN_SECRETS_DIR/." "$work/secrets/"
  safe_copy_if_exists "$LUMEN_DATA_DIR/runtime/." "$work/data/runtime/"
  safe_copy_if_exists "$LUMEN_DATA_DIR/uploads/." "$work/data/uploads/"
  safe_copy_if_exists /etc/nginx/sites-available/lumen-http-acme.conf "$work/nginx/"
  safe_copy_if_exists /etc/nginx/sites-available/lumen-panel.conf "$work/nginx/"
  safe_copy_if_exists /etc/nginx/sites-available/lumen-subscription.conf "$work/nginx/"
  {
    printf 'created_at=%s\n' "$ts"
    printf 'version=%s\n' "${LUMEN_VERSION:-unknown}"
    printf 'host=%s\n' "$(hostname -f 2>/dev/null || hostname)"
    printf 'free_node_limit=%s\n' "${FREE_NODE_LIMIT:-3}"
  } >"$work/meta/backup.properties"

  tar -C "$work" -czf "$archive" .
  chmod 0600 "$archive"

  if [ -n "$PASSPHRASE_FILE" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -salt -in "$archive" -out "$encrypted" -pass "file:$PASSPHRASE_FILE"
    chmod 0600 "$encrypted"
    rm -f "$archive"
    log "encrypted backup created: $encrypted"
  else
    warn "plaintext backup created: $archive"
  fi
}

main() {
  require_root_or_dry_run
  load_env
  acquire_lock backup
  create_backup
}

main "$@"

