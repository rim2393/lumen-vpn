#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/opt/lumen/.env"
JSON=0
FAILURES=0
RESULTS=""

usage() {
  cat <<'USAGE'
Usage: scripts/doctor.sh [options]

Options:
  --config PATH   Config file path
  --json          Print machine-readable JSON
  --dry-run       Do not perform network or service mutations
  -h, --help      Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

record() {
  local name="$1"
  local status="$2"
  local detail="$3"

  if [ "$status" != "ok" ]; then
    FAILURES=$((FAILURES + 1))
  fi

  if [ "$JSON" = "1" ]; then
    RESULTS="${RESULTS}{\"name\":\"$(json_escape "$name")\",\"status\":\"$status\",\"detail\":\"$(json_escape "$detail")\"},"
  else
    printf '%-28s %-6s %s\n' "$name" "$status" "$detail"
  fi
}

check_cmd() {
  local cmd="$1"
  if have_cmd "$cmd"; then
    record "command:$cmd" ok "found"
  else
    record "command:$cmd" fail "missing"
  fi
}

check_compose_config() {
  if ! have_cmd docker && ! have_cmd docker-compose; then
    record compose fail "Docker Compose command missing"
    return 0
  fi
  if compose config >/dev/null 2>&1; then
    record compose ok "deploy/compose/lumen.yml renders"
  else
    record compose fail "docker compose config failed"
  fi
}

check_images() {
  if validate_image_pinning warn >/tmp/lumen-doctor-images.log 2>&1; then
    record images ok "image refs are syntactically pinned"
  else
    record images fail "image pinning validation failed"
  fi
}

check_ports() {
  if have_cmd ss; then
    if ss -ltn "( sport = :80 or sport = :443 )" | awk 'NR>1 {found=1} END {exit found ? 0 : 1}'; then
      record ports ok "80/443 have listeners"
    else
      record ports fail "80/443 are not listening"
    fi
  else
    record ports fail "ss command missing"
  fi
}

check_nginx() {
  if have_cmd nginx && nginx -t >/tmp/lumen-nginx-test.log 2>&1; then
    record nginx ok "nginx -t passed"
  else
    record nginx fail "nginx -t failed or nginx missing"
  fi
}

check_certs() {
  local missing=0
  for domain in "$PANEL_DOMAIN" "$SUBSCRIPTION_DOMAIN"; do
    [ -n "$domain" ] || continue
    if [ ! -s "$TLS_CERT_DIR/$domain/fullchain.pem" ] || [ ! -s "$TLS_CERT_DIR/$domain/privkey.pem" ]; then
      missing=1
    fi
  done

  if [ "$missing" -eq 0 ]; then
    record certs ok "certificate files exist"
  else
    record certs fail "one or more certificate files are missing"
  fi
}

check_health() {
  if [ "$DRY_RUN" = "1" ]; then
    record health ok "skipped in dry-run"
    return 0
  fi
  if have_cmd curl && curl -fsS "https://$PANEL_DOMAIN/api/healthz" >/dev/null 2>&1; then
    record health ok "panel health endpoint passed"
  else
    record health fail "panel health endpoint failed"
  fi
}

main() {
  load_env
  check_cmd docker
  check_cmd curl
  check_cmd openssl
  check_cmd envsubst
  check_compose_config
  check_images
  if [ "${FREE_NODE_LIMIT:-}" = "3" ]; then
    record license ok "free node limit is 3"
  else
    record license fail "FREE_NODE_LIMIT is ${FREE_NODE_LIMIT:-unset}"
  fi
  check_ports
  check_nginx
  check_certs
  check_health

  if [ "$JSON" = "1" ]; then
    RESULTS="${RESULTS%,}"
    printf '{"failures":%s,"checks":[%s]}\n' "$FAILURES" "$RESULTS"
  fi

  [ "$FAILURES" -eq 0 ] || exit 1
}

main "$@"
