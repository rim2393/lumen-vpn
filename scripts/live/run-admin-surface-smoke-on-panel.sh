#!/usr/bin/env bash
set -euo pipefail

# Runs the protected admin/backend/node smoke on the production panel host.
# The script must be executed on the panel host from the product checkout or
# from a directory that contains scripts/live/admin-surface-smoke.py.
# It copies the smoke into the API container, runs it against the public panel
# URL, then removes every /tmp/lumen-* artifact from the host and API container.

API_CONTAINER="${LUMEN_API_CONTAINER:-lumen-api-1}"
PANEL_PUBLIC_URL="${PANEL_PUBLIC_URL:-${LUMEN_PANEL_PUBLIC_URL:-https://panel.lumentech.tel}}"
SMOKE_SOURCE="${LUMEN_ADMIN_SURFACE_SMOKE_SOURCE:-$(dirname "$0")/admin-surface-smoke.py}"
HOST_TMP="${LUMEN_ADMIN_SURFACE_HOST_TMP:-/tmp/lumen-admin-surface-smoke.py}"
CONTAINER_TMP="${LUMEN_ADMIN_SURFACE_CONTAINER_TMP:-/tmp/lumen-admin-surface-smoke.py}"

log() {
  printf '[lumen-admin-surface-smoke] %s\n' "$*" >&2
}

die() {
  printf '[lumen-admin-surface-smoke][error] %s\n' "$*" >&2
  exit 1
}

cleanup() {
  set +e
  if docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
    docker exec -u 0 "$API_CONTAINER" sh -lc 'find /tmp -maxdepth 1 -name "lumen-*" -exec rm -rf {} +' >/dev/null 2>&1 || true
  fi
  find /tmp -maxdepth 1 -name 'lumen-*' -exec rm -rf {} + >/dev/null 2>&1 || true
}

require_clean_tmp() {
  local host_count api_count
  host_count="$(find /tmp -maxdepth 1 -name 'lumen-*' | wc -l | tr -d ' ')"
  api_count="$(docker exec -u 0 "$API_CONTAINER" sh -lc 'find /tmp -maxdepth 1 -name "lumen-*" | wc -l' | tr -d ' ')"
  [ "$host_count" = "0" ] || die "panel host still has /tmp/lumen-* artifacts: $host_count"
  [ "$api_count" = "0" ] || die "API container still has /tmp/lumen-* artifacts: $api_count"
  printf 'panel_tmp_lumen_count=0\n'
  printf 'api_tmp_lumen_count=0\n'
}

trap cleanup EXIT

[ -r "$SMOKE_SOURCE" ] || die "admin surface smoke source is not readable: $SMOKE_SOURCE"
docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER" || die "API container is not running: $API_CONTAINER"

log "copying smoke into $API_CONTAINER"
if [ "$SMOKE_SOURCE" != "$HOST_TMP" ]; then
  install -m 0600 "$SMOKE_SOURCE" "$HOST_TMP"
fi
docker cp "$HOST_TMP" "$API_CONTAINER:$CONTAINER_TMP"
rm -f "$HOST_TMP"

log "running smoke against $PANEL_PUBLIC_URL"
docker exec -e PANEL_PUBLIC_URL="$PANEL_PUBLIC_URL" "$API_CONTAINER" python "$CONTAINER_TMP"

log "cleaning smoke artifacts"
cleanup
require_clean_tmp
