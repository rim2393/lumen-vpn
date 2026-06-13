#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/opt/lumen/.env"
MANIFEST_FILE=""
PASSPHRASE_FILE=""
AUTO_RESTORE_ON_MIGRATION_FAILURE=0
ALLOW_PLAINTEXT_BACKUP=0

usage() {
  cat <<'USAGE'
Usage: scripts/upgrade.sh [options]

Options:
  --config PATH                         Config file path
  --manifest PATH                       Release manifest JSON
  --passphrase-file PATH                Encrypt pre-upgrade backup
  --allow-plaintext                     Allow unencrypted pre-upgrade backup
  --auto-restore-on-migration-failure   Restore DB backup if migration fails
  --dry-run                             Print actions without changing host
  -h, --help                            Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --manifest) MANIFEST_FILE="$2"; shift 2 ;;
    --passphrase-file) PASSPHRASE_FILE="$2"; shift 2 ;;
    --allow-plaintext) ALLOW_PLAINTEXT_BACKUP=1; shift ;;
    --auto-restore-on-migration-failure) AUTO_RESTORE_ON_MIGRATION_FAILURE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

BACKUP_CREATED=""
ENV_SNAPSHOT=""
MIGRATION_STARTED=0

manifest_image_ref() {
  local key="$1"
  jq -r ".images.${key} | \"\\(.name):\\(.tag)@\\(.digest)\"" "$MANIFEST_FILE"
}

validate_manifest() {
  [ -n "$MANIFEST_FILE" ] || die "--manifest is required"
  [ -r "$MANIFEST_FILE" ] || die "Manifest not readable: $MANIFEST_FILE"
  need_cmd jq
  jq -e '.schema == "lumen.release.v1"' "$MANIFEST_FILE" >/dev/null || die "Unsupported release manifest schema"

  if jq -e '.signature.value == "BASE64_SIGNATURE_PLACEHOLDER"' "$MANIFEST_FILE" >/dev/null; then
    warn "Release manifest signature is a placeholder"
    [ "$DRY_RUN" = "1" ] || die "Refusing production upgrade with unsigned placeholder manifest"
  fi
}

create_preupgrade_backup() {
  local before after args
  before="$(find "${LUMEN_BACKUP_DIR:-/opt/lumen/backups}" -maxdepth 1 -type f -name 'lumen-backup-*.tar.gz*' 2>/dev/null | sort || true)"
  args=(--config "$CONFIG_FILE")
  if [ -n "$PASSPHRASE_FILE" ]; then
    args+=(--passphrase-file "$PASSPHRASE_FILE")
  elif [ "$ALLOW_PLAINTEXT_BACKUP" = "1" ]; then
    args+=(--allow-plaintext)
    warn "pre-upgrade backup will be plaintext because --passphrase-file was not provided"
  else
    die "Pre-upgrade backup contains secrets; pass --passphrase-file or --allow-plaintext"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    args+=(--dry-run)
  fi
  "$REPO_ROOT/scripts/backup.sh" "${args[@]}"

  after="$(find "${LUMEN_BACKUP_DIR:-/opt/lumen/backups}" -maxdepth 1 -type f -name 'lumen-backup-*.tar.gz*' 2>/dev/null | sort || true)"
  BACKUP_CREATED="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | tail -n 1 || true)"
}

update_env_from_manifest() {
  env_set LUMEN_VERSION "$(jq -r '.version' "$MANIFEST_FILE")"
  env_set LUMEN_API_IMAGE "$(manifest_image_ref api)"
  env_set LUMEN_WEB_IMAGE "$(manifest_image_ref web)"
  env_set LUMEN_NODE_AGENT_IMAGE "$(manifest_image_ref node_agent)"
  env_set LUMEN_SUBSCRIPTION_IMAGE "$(manifest_image_ref subscription)"
  env_set FREE_NODE_LIMIT "$(jq -r '.free_node_limit // 3' "$MANIFEST_FILE")"
}

rollback_env() {
  if [ -n "$ENV_SNAPSHOT" ] && [ -f "$ENV_SNAPSHOT" ]; then
    warn "rolling back image env references"
    run install -m 0600 "$ENV_SNAPSHOT" "$CONFIG_FILE"
    load_env
    compose_run up -d
  fi
}

restore_db_after_failed_migration() {
  if [ "$AUTO_RESTORE_ON_MIGRATION_FAILURE" != "1" ]; then
    warn "migration failed after backup; restore manually or rerun with --auto-restore-on-migration-failure"
    return 0
  fi
  [ -n "$BACKUP_CREATED" ] || die "No pre-upgrade backup path captured"

  local args=(--config "$CONFIG_FILE" --backup "$BACKUP_CREATED" --force)
  if [ -n "$PASSPHRASE_FILE" ]; then
    args+=(--passphrase-file "$PASSPHRASE_FILE")
  fi
  "$REPO_ROOT/scripts/restore.sh" "${args[@]}"
}

upgrade_failure() {
  local status=$?
  warn "upgrade failed with status $status"
  rollback_env
  if [ "$MIGRATION_STARTED" = "1" ]; then
    restore_db_after_failed_migration
  fi
  exit "$status"
}

main() {
  require_root_or_dry_run
  load_env
  acquire_lock upgrade
  sync_secret_files
  validate_manifest
  trap upgrade_failure ERR

  if [ "$DRY_RUN" != "1" ]; then
    ENV_SNAPSHOT="$(mktemp)"
    install -m 0600 "$CONFIG_FILE" "$ENV_SNAPSHOT"
  fi

  create_preupgrade_backup
  update_env_from_manifest
  load_env
  validate_image_pinning strict
  compose_run config >/dev/null
  compose_run pull
  MIGRATION_STARTED=1
  compose_run run --rm api lumen-api migrate
  MIGRATION_STARTED=0
  compose_run up -d
  "$REPO_ROOT/scripts/doctor.sh" --config "$CONFIG_FILE"
  trap - ERR
  log "upgrade complete"
}

main "$@"
