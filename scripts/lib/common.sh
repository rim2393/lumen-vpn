#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DRY_RUN="${DRY_RUN:-${LUMEN_DRY_RUN:-0}}"
CONFIG_FILE="${CONFIG_FILE:-/opt/lumen/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/deploy/compose/lumen.yml}"
LOCK_DIR=""

log() {
  printf '[lumen] %s\n' "$*" >&2
}

warn() {
  printf '[lumen][warn] %s\n' "$*" >&2
}

die() {
  printf '[lumen][error] %s\n' "$*" >&2
  exit 1
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

require_root_or_dry_run() {
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  is_root || die "Run as root or pass --dry-run."
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

need_cmd() {
  have_cmd "$1" || die "Missing required command: $1"
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[lumen][dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

run_shell() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[lumen][dry-run] bash -c %q\n' "$1"
    return 0
  fi
  bash -Eeuo pipefail -c "$1"
}

load_env() {
  [ -f "$CONFIG_FILE" ] || die "Config file not found: $CONFIG_FILE"
  # shellcheck disable=SC1090
  set -a && source "$CONFIG_FILE" && set +a

  LUMEN_HOME="${LUMEN_HOME:-/opt/lumen}"
  LUMEN_DATA_DIR="${LUMEN_DATA_DIR:-$LUMEN_HOME/data}"
  LUMEN_BACKUP_DIR="${LUMEN_BACKUP_DIR:-$LUMEN_HOME/backups}"
  LUMEN_SUPPORT_DIR="${LUMEN_SUPPORT_DIR:-$LUMEN_HOME/support-bundles}"
  LUMEN_SECRETS_DIR="${LUMEN_SECRETS_DIR:-$LUMEN_HOME/secrets}"
  TLS_CERT_DIR="${TLS_CERT_DIR:-/etc/nginx/lumen/certs}"
}

ensure_env_file() {
  if [ -f "$CONFIG_FILE" ]; then
    return 0
  fi

  if [ ! -f "$REPO_ROOT/.env.example" ]; then
    die ".env.example is missing"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "would create $CONFIG_FILE from .env.example; using template for dry-run"
    CONFIG_FILE="$REPO_ROOT/.env.example"
    return 0
  fi

  mkdir -p "$(dirname "$CONFIG_FILE")"
  install -m 0600 "$REPO_ROOT/.env.example" "$CONFIG_FILE"
}

env_get() {
  local key="$1"
  grep -E "^${key}=" "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true
}

env_set() {
  local key="$1"
  local value="$2"
  local tmp

  if [ "$DRY_RUN" = "1" ]; then
    log "would set $key in $CONFIG_FILE"
    return 0
  fi

  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      done = 1
      next
    }
    { print }
    END {
      if (done == 0) {
        print key "=" value
      }
    }
  ' "$CONFIG_FILE" >"$tmp"
  install -m 0600 "$tmp" "$CONFIG_FILE"
  rm -f "$tmp"
}

random_secret() {
  if have_cmd openssl; then
    openssl rand -base64 48 | tr -d '\n'
    return 0
  fi
  dd if=/dev/urandom bs=48 count=1 2>/dev/null | base64 | tr -d '\n'
}

ensure_secret() {
  local key="$1"
  local current
  current="$(env_get "$key")"
  case "$current" in
    ""|GENERATED_AT_INSTALL|GENERATE|CHANGE_ME)
      env_set "$key" "$(random_secret)"
      log "generated $key"
      ;;
  esac
}

ensure_runtime_dirs() {
  local dirs=(
    "$LUMEN_HOME"
    "$LUMEN_DATA_DIR"
    "$LUMEN_DATA_DIR/uploads"
    "$LUMEN_DATA_DIR/runtime"
    "$LUMEN_BACKUP_DIR"
    "$LUMEN_SUPPORT_DIR"
    "$LUMEN_SECRETS_DIR"
  )

  for dir in "${dirs[@]}"; do
    run mkdir -p "$dir"
  done
  run chmod 0700 "$LUMEN_SECRETS_DIR"
}

sync_secret_file() {
  local key="$1"
  local path="$2"
  local value

  value="${!key:-}"
  if [ -z "$value" ]; then
    return 0
  fi
  value="${value%$'\r'}"
  run mkdir -p "$(dirname "$path")"
  if [ "$DRY_RUN" = "1" ]; then
    log "would write secret file $path for $key"
    return 0
  fi
  printf '%s' "$value" >"$path"
  chmod 0600 "$path"
}

sync_secret_files() {
  sync_secret_file POSTGRES_PASSWORD "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/postgres-password"
  sync_secret_file REDIS_PASSWORD "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/redis-password"
  sync_secret_file JWT_SECRET "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/jwt-secret"
  sync_secret_file REFRESH_SECRET "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/refresh-secret"
  sync_secret_file API_TOKEN_PEPPER "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/api-token-pepper"
  sync_secret_file ENCRYPTION_KEY "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/encryption-key"
  sync_secret_file WEBHOOK_SIGNING_SECRET "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/webhook-signing-secret"
  sync_secret_file DATABASE_URL "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/database-url"
  sync_secret_file REDIS_URL "${LUMEN_SECRETS_DIR:-/opt/lumen/secrets}/redis-url"
}

compose() {
  if have_cmd docker && docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$CONFIG_FILE" -f "$COMPOSE_FILE" "$@"
    return $?
  fi
  if have_cmd docker-compose; then
    docker-compose --env-file "$CONFIG_FILE" -f "$COMPOSE_FILE" "$@"
    return $?
  fi
  die "Docker Compose v2 is required"
}

compose_run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[lumen][dry-run] docker compose --env-file %q -f %q' "$CONFIG_FILE" "$COMPOSE_FILE"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  compose "$@"
}

validate_domain_value() {
  local name="$1"
  local value="$2"
  [ -n "$value" ] || die "$name is required"
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'; then
    die "$name is not a valid DNS name: $value"
  fi
}

validate_required_config() {
  validate_domain_value PANEL_DOMAIN "${PANEL_DOMAIN:-}"
  validate_domain_value SUBSCRIPTION_DOMAIN "${SUBSCRIPTION_DOMAIN:-}"
  [ -n "${ACME_EMAIL:-}" ] || die "ACME_EMAIL is required"
}

is_zero_digest() {
  printf '%s' "$1" | grep -Eq '@sha256:0{64}$'
}

validate_image_pinning() {
  local strict="${1:-strict}"
  local key value missing=0 placeholder=0
  local keys=(
    POSTGRES_IMAGE
    REDIS_IMAGE
    LUMEN_API_IMAGE
    LUMEN_WEB_IMAGE
    LUMEN_NODE_AGENT_IMAGE
    LUMEN_SUBSCRIPTION_IMAGE
  )
  local optional_keys=(
    LUMEN_DOCKER_SOCKET_PROXY_IMAGE
  )

  for key in "${keys[@]}"; do
    value="${!key:-}"
    if ! printf '%s' "$value" | grep -Eq '@sha256:[0-9a-f]{64}$'; then
      warn "$key must be pinned with @sha256:<64 hex chars>"
      missing=1
      continue
    fi
    if is_zero_digest "$value" || printf '%s' "$value" | grep -q 'CHANGE_ME'; then
      warn "$key still contains a placeholder digest"
      placeholder=1
    fi
  done

  for key in "${optional_keys[@]}"; do
    value="${!key:-}"
    [ -z "$value" ] && continue
    if ! printf '%s' "$value" | grep -Eq '@sha256:[0-9a-f]{64}$'; then
      warn "$key must be pinned with @sha256:<64 hex chars> when set"
      missing=1
    fi
    if is_zero_digest "$value" || printf '%s' "$value" | grep -q 'CHANGE_ME'; then
      warn "$key still contains a placeholder digest"
      placeholder=1
    fi
  done

  if [ "$strict" = "strict" ] && [ "$DRY_RUN" != "1" ]; then
    [ "$missing" -eq 0 ] || die "Refusing install with unpinned images"
    [ "$placeholder" -eq 0 ] || die "Refusing install with placeholder image digests"
  fi
}

render_template() {
  local src="$1"
  local dst="$2"
  local tmp
  need_cmd envsubst

  if [ "$DRY_RUN" = "1" ]; then
    log "would render $src to $dst"
    return 0
  fi

  tmp="$(mktemp)"
  envsubst '${PANEL_DOMAIN} ${SUBSCRIPTION_DOMAIN} ${AUTH_PORTAL_DOMAIN} ${TLS_CERT_DIR} ${LUMEN_API_PORT} ${LUMEN_WEB_PORT} ${LUMEN_SUBSCRIPTION_PORT}' <"$src" >"$tmp"
  install -m 0644 "$tmp" "$dst"
  rm -f "$tmp"
}

acquire_lock() {
  local name="$1"
  LOCK_DIR="${LUMEN_HOME:-/opt/lumen}/.${name}.lock"
  if [ "$DRY_RUN" = "1" ]; then
    log "would acquire lock $LOCK_DIR"
    return 0
  fi
  mkdir -p "${LUMEN_HOME:-/opt/lumen}"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "Another Lumen ${name} operation is running: $LOCK_DIR"
  fi
  trap 'release_lock' EXIT
}

release_lock() {
  if [ -n "$LOCK_DIR" ] && [ -d "$LOCK_DIR" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

redact_stream() {
  sed -E \
    -e 's#(PASSWORD|SECRET|TOKEN|PEPPER|KEY|SEED)=.*#\1=<redacted>#g' \
    -e 's#(password|secret|token|private_key)([" ]*[:=][" ]*)[^" ,]+#\1\2<redacted>#gi'
}

redact_ips_stream() {
  sed -E \
    -e 's#([0-9]{1,3}\.){3}[0-9]{1,3}#<ipv4>#g' \
    -e 's#([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}#<ipv6>#g'
}

safe_copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -e "$src" ]; then
    run cp -a "$src" "$dst"
  fi
}
