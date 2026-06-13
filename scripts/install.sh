#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/opt/lumen/.env"
NON_INTERACTIVE=0
ACCEPT_LICENSE=0

usage() {
  cat <<'USAGE'
Usage: scripts/install.sh [options]

Options:
  --config PATH        Config file path (default: /opt/lumen/.env)
  --dry-run            Print actions without changing the host
  --non-interactive    Do not prompt
  --accept-license     Confirm production install intent
  -h, --help           Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --accept-license) ACCEPT_LICENSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

preflight_host() {
  log "running host preflight"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    case "${ID:-}:${VERSION_ID:-}" in
      debian:12*|ubuntu:22.04*|ubuntu:24.04*) ;;
      *) warn "Supported targets are Debian 12 and Ubuntu 22.04/24.04; detected ${PRETTY_NAME:-unknown}" ;;
    esac
  else
    warn "/etc/os-release is not readable"
  fi

  local mem_kb cpu_count disk_kb
  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
  disk_kb="$(df -Pk / 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)"

  [ "${mem_kb:-0}" -ge 3900000 ] || warn "Less than 4 GiB RAM detected"
  [ "${cpu_count:-0}" -ge 2 ] || warn "Less than 2 CPU cores detected"
  [ "${disk_kb:-0}" -ge 20971520 ] || warn "Less than 20 GiB free disk on /"

  if have_cmd ss; then
    if ss -ltn "( sport = :80 or sport = :443 )" | awk 'NR>1 {found=1} END {exit found ? 0 : 1}'; then
      warn "Ports 80/443 already have listeners; installer will validate Nginx ownership later"
    fi
  fi
}

install_packages() {
  if have_cmd apt-get; then
    run apt-get update
    run apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg openssl gettext-base nginx socat tar gzip coreutils jq
    if ! have_cmd docker; then
      run apt-get install -y --no-install-recommends docker.io docker-compose-plugin
    elif ! docker compose version >/dev/null 2>&1; then
      run apt-get install -y --no-install-recommends docker-compose-plugin
    fi
    run systemctl enable --now docker
    run systemctl enable --now nginx
    return 0
  fi

  warn "apt-get not found; install Docker Compose, Nginx, curl, openssl, envsubst, and jq manually"
}

generate_runtime_secrets() {
  ensure_secret POSTGRES_PASSWORD
  ensure_secret REDIS_PASSWORD
  ensure_secret JWT_SECRET
  ensure_secret REFRESH_SECRET
  ensure_secret API_TOKEN_PEPPER
  ensure_secret ENCRYPTION_KEY
  ensure_secret WEBHOOK_SIGNING_SECRET
  ensure_secret NODE_CA_SEED
  ensure_secret MANIFEST_SIGNING_SEED
  ensure_secret RECOVERY_KEY
}

registry_login() {
  if [ -z "${REGISTRY_USERNAME:-}" ]; then
    log "registry username is empty; skipping registry login"
    return 0
  fi
  if [ ! -r "${REGISTRY_TOKEN_FILE:-}" ]; then
    die "REGISTRY_TOKEN_FILE is not readable: ${REGISTRY_TOKEN_FILE:-unset}"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "would docker login ${REGISTRY_HOST:-ghcr.io} as $REGISTRY_USERNAME using token file"
    return 0
  fi

  docker login "${REGISTRY_HOST:-ghcr.io}" -u "$REGISTRY_USERNAME" --password-stdin <"$REGISTRY_TOKEN_FILE"
}

render_nginx_acme() {
  local available="/etc/nginx/sites-available"
  local enabled="/etc/nginx/sites-enabled"

  run mkdir -p /var/www/lumen-acme "$TLS_CERT_DIR" "$available" "$enabled"
  render_template "$REPO_ROOT/deploy/nginx/lumen-http-acme.conf.template" "$available/lumen-http-acme.conf"

  run ln -sfn "$available/lumen-http-acme.conf" "$enabled/lumen-http-acme.conf"
  run nginx -t
  run systemctl reload nginx
}

render_nginx_tls() {
  local available="/etc/nginx/sites-available"
  local enabled="/etc/nginx/sites-enabled"

  render_template "$REPO_ROOT/deploy/nginx/lumen-panel.conf.template" "$available/lumen-panel.conf"
  render_template "$REPO_ROOT/deploy/nginx/lumen-subscription.conf.template" "$available/lumen-subscription.conf"

  run ln -sfn "$available/lumen-panel.conf" "$enabled/lumen-panel.conf"
  run ln -sfn "$available/lumen-subscription.conf" "$enabled/lumen-subscription.conf"
  run nginx -t
  run systemctl reload nginx
}

ensure_acme_sh() {
  if [ -x "$HOME/.acme.sh/acme.sh" ] || [ -x "/root/.acme.sh/acme.sh" ]; then
    return 0
  fi
  local installer acme_sha acme_sha_file
  installer="/tmp/acme.sh-install.sh"
  acme_sha="${ACME_SH_INSTALL_SHA256:-}"
  if [ -z "$acme_sha" ] || [ "$acme_sha" = "CHANGE_ME" ]; then
    die "ACME_SH_INSTALL_SHA256 is required to install acme.sh safely"
  fi
  acme_sha_file="${ACME_SH_INSTALL_URL:-https://get.acme.sh}"
  run curl -fsSL "$acme_sha_file" -o "$installer"
  printf '%s  %s\n' "$acme_sha" "$installer" | run sha256sum -c -
  run sh "$installer" email="${ACME_EMAIL}"
}

issue_cert() {
  local domain="$1"
  local acme="/root/.acme.sh/acme.sh"
  [ -n "$domain" ] || return 0

  run "$acme" --issue --webroot /var/www/lumen-acme -d "$domain" --keylength ec-256
  run mkdir -p "$TLS_CERT_DIR/$domain"
  run "$acme" --install-cert -d "$domain" --ecc \
    --fullchain-file "$TLS_CERT_DIR/$domain/fullchain.pem" \
    --key-file "$TLS_CERT_DIR/$domain/privkey.pem" \
    --reloadcmd "systemctl reload nginx"
}

issue_certificates() {
  ensure_acme_sh
  issue_cert "$PANEL_DOMAIN"
  if [ "$SUBSCRIPTION_DOMAIN" != "$PANEL_DOMAIN" ]; then
    issue_cert "$SUBSCRIPTION_DOMAIN"
  fi
}

start_stack() {
  compose_run config >/dev/null
  validate_image_pinning strict
  registry_login
  compose_run pull
  compose_run up -d postgres redis
  compose_run run --rm api lumen-api migrate

  if [ "${FIRST_ADMIN_PASSWORD:-GENERATE}" = "GENERATE" ]; then
    compose_run run --rm api lumen-api bootstrap-admin \
      --email "$FIRST_ADMIN_EMAIL" \
      --username "$FIRST_ADMIN_USERNAME" \
      --generate-password
  else
    export FIRST_ADMIN_PASSWORD
    compose_run run --rm -e FIRST_ADMIN_PASSWORD api lumen-api bootstrap-admin \
      --email "$FIRST_ADMIN_EMAIL" \
      --username "$FIRST_ADMIN_USERNAME" \
      --password-env FIRST_ADMIN_PASSWORD
  fi

  compose_run up -d
}

health_check() {
  if [ "$DRY_RUN" = "1" ]; then
    log "would check https://$PANEL_DOMAIN/api/healthz and https://$SUBSCRIPTION_DOMAIN/healthz"
    return 0
  fi

  local attempt
  for attempt in $(seq 1 40); do
    if curl -fsS "https://$PANEL_DOMAIN/api/healthz" >/dev/null; then
      log "panel health check passed"
      return 0
    fi
    sleep 3
  done

  die "Panel health check failed"
}

main() {
  if [ "$ACCEPT_LICENSE" != "1" ] && [ "$NON_INTERACTIVE" = "1" ] && [ "$DRY_RUN" != "1" ]; then
    die "--accept-license is required for non-interactive production install"
  fi

  require_root_or_dry_run
  ensure_env_file
  load_env
  acquire_lock install
  ensure_runtime_dirs
  generate_runtime_secrets
  load_env
  sync_secret_files
  validate_required_config
  validate_image_pinning warn
  preflight_host
  install_packages
  render_nginx_acme
  issue_certificates
  render_nginx_tls
  start_stack
  health_check

  log "install complete"
  log "panel: https://$PANEL_DOMAIN"
  log "subscription: https://$SUBSCRIPTION_DOMAIN"
}

main "$@"
