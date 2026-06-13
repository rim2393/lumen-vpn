#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/opt/lumen-node/.env"
PANEL_URL=""
NODE_NAME="manual-node"
TOKEN_FILE=""
TOKEN_STDIN=0
ALLOW_INSECURE_PANEL=0
NODE_AGENT_IMAGE=""

usage() {
  cat <<'USAGE'
Usage: scripts/install-node.sh [options]

Options:
  --panel-url URL             Lumen panel URL
  --node-name NAME            Node display name (default: manual-node)
  --install-token-file PATH   Read one-time install token from root-only file
  --install-token-stdin       Read one-time install token from stdin
  --image REF                 Pinned node-agent image reference
  --config PATH               Node env file path (default: /opt/lumen-node/.env)
  --allow-insecure-panel      Allow http:// panel URL for local tests
  --dry-run                   Print actions without changing the host
  -h, --help                  Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --panel-url) PANEL_URL="$2"; shift 2 ;;
    --node-name) NODE_NAME="$2"; shift 2 ;;
    --install-token-file) TOKEN_FILE="$2"; shift 2 ;;
    --install-token-stdin) TOKEN_STDIN=1; shift ;;
    --image) NODE_AGENT_IMAGE="$2"; shift 2 ;;
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --allow-insecure-panel) ALLOW_INSECURE_PANEL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

validate_node_input() {
  [ -n "$PANEL_URL" ] || die "--panel-url is required"
  if [ "$ALLOW_INSECURE_PANEL" != "1" ] && ! printf '%s' "$PANEL_URL" | grep -Eq '^https://'; then
    die "Panel URL must use https:// unless --allow-insecure-panel is passed"
  fi
  if [ "$TOKEN_STDIN" != "1" ] && [ -z "$TOKEN_FILE" ]; then
    die "Use --install-token-stdin or --install-token-file"
  fi
}

install_node_packages() {
  if have_cmd apt-get; then
    run apt-get update
    run apt-get install -y --no-install-recommends ca-certificates curl gnupg docker.io docker-compose-plugin
    run systemctl enable --now docker
  else
    warn "apt-get not found; install Docker Engine and Compose v2 manually"
  fi
}

write_node_env() {
  if [ "$DRY_RUN" = "1" ]; then
    log "would write $CONFIG_FILE"
    return 0
  fi

  mkdir -p "$(dirname "$CONFIG_FILE")" /opt/lumen-node/secrets /opt/lumen-node/state
  chmod 0700 /opt/lumen-node/secrets
  cat >"$CONFIG_FILE" <<EOF
TZ=${TZ:-UTC}
LUMEN_PANEL_URL=$PANEL_URL
LUMEN_NODE_NAME=$NODE_NAME
LUMEN_NODE_AGENT_IMAGE=${NODE_AGENT_IMAGE:-${LUMEN_NODE_AGENT_IMAGE:-ghcr.io/rim2393/lumen-node-agent:v0.1.0@sha256:0000000000000000000000000000000000000000000000000000000000000000}}
EOF
  chmod 0600 "$CONFIG_FILE"
}

validate_node_image() {
  local image="${NODE_AGENT_IMAGE:-${LUMEN_NODE_AGENT_IMAGE:-ghcr.io/rim2393/lumen-node-agent:v0.1.0@sha256:0000000000000000000000000000000000000000000000000000000000000000}}"
  if ! printf '%s' "$image" | grep -Eq '@sha256:[0-9a-f]{64}$'; then
    [ "$DRY_RUN" = "1" ] && warn "LUMEN_NODE_AGENT_IMAGE is not pinned" && return 0
    die "LUMEN_NODE_AGENT_IMAGE must be pinned with @sha256:<64 hex chars>"
  fi
  if is_zero_digest "$image" || printf '%s' "$image" | grep -q 'CHANGE_ME'; then
    [ "$DRY_RUN" = "1" ] && warn "LUMEN_NODE_AGENT_IMAGE has a placeholder digest" && return 0
    die "LUMEN_NODE_AGENT_IMAGE still has a placeholder digest"
  fi
}

write_install_token() {
  local dst="/opt/lumen-node/secrets/install-token"

  if [ "$DRY_RUN" = "1" ]; then
    log "would write one-time install token to $dst"
    return 0
  fi

  if [ "$TOKEN_STDIN" = "1" ]; then
    umask 077
    IFS= read -r token
    printf '%s\n' "$token" >"$dst"
  else
    [ -r "$TOKEN_FILE" ] || die "Token file is not readable: $TOKEN_FILE"
    install -m 0600 "$TOKEN_FILE" "$dst"
  fi
}

start_node_agent() {
  COMPOSE_FILE="$REPO_ROOT/deploy/compose/lumen-node.yml"
  compose_run config >/dev/null
  compose_run pull
  compose_run up -d
}

wait_node_agent_health() {
  if [ "$DRY_RUN" = "1" ]; then
    log "would wait for node-agent healthcheck"
    return 0
  fi

  local attempt
  for attempt in $(seq 1 30); do
    if compose_run exec -T node-agent lumen-node-agent healthcheck >/dev/null 2>&1; then
      log "node-agent healthcheck passed"
      return 0
    fi
    sleep 2
  done
  die "node-agent did not pass healthcheck after 60 seconds"
}

main() {
  require_root_or_dry_run
  validate_node_input
  install_node_packages
  if [ -f "$CONFIG_FILE" ]; then
    load_env
  fi
  validate_node_image
  write_node_env
  write_install_token
  if [ "$DRY_RUN" != "1" ]; then
    load_env
  fi
  start_node_agent
  wait_node_agent_health
  log "node-agent install started; verify heartbeat and registration in the Lumen panel"
}

main "$@"
