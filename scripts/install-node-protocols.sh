#!/usr/bin/env bash
set -Eeuo pipefail

# Installs the non-xray protocol backends the Lumen node-agent drives:
#   hysteria2  -> /usr/local/bin/hysteria   + hysteria-server.service
#   tuic       -> /usr/local/bin/tuic-server + tuic-server.service
#   wireguard  -> wg-quick (wireguard-tools) + wg-quick@lumen-wg
#
# Paths and reload commands mirror the node-agent runtimes verbatim:
#   apps/node-agent/src/hysteria2-runtime.js  (DEFAULT_HYSTERIA2_CONFIG_PATH, restart hysteria-server)
#   apps/node-agent/src/tuic-runtime.js       (DEFAULT_TUIC_CONFIG_PATH, restart tuic-server)
#   apps/node-agent/src/wireguard-runtime.js  (DEFAULT_WIREGUARD_CONFIG_PATH, restart wg-quick@lumen-wg)
#
# The agent writes the actual config files (0600) at apply time; this script only
# lays down the binaries, systemd units, and config directories.

PROTOCOLS="hysteria2,tuic,wireguard"
SKIP_VERIFY=0

# Pinned versions. Override per-host with the matching flag. Binaries are verified
# against the *_SHA256 checksum for the detected architecture unless --skip-verify
# is passed (dry-run only). Zero/placeholder checksums are rejected, mirroring the
# image-pinning posture in scripts/lib/common.sh.
HYSTERIA_VERSION="${HYSTERIA_VERSION:-v2.6.0}"
HYSTERIA_SHA256_AMD64="${HYSTERIA_SHA256_AMD64:-0000000000000000000000000000000000000000000000000000000000000000}"
HYSTERIA_SHA256_ARM64="${HYSTERIA_SHA256_ARM64:-0000000000000000000000000000000000000000000000000000000000000000}"

TUIC_VERSION="${TUIC_VERSION:-1.0.0}"
TUIC_SHA256_AMD64="${TUIC_SHA256_AMD64:-0000000000000000000000000000000000000000000000000000000000000000}"
TUIC_SHA256_ARM64="${TUIC_SHA256_ARM64:-0000000000000000000000000000000000000000000000000000000000000000}"

usage() {
  cat <<'USAGE'
Usage: scripts/install-node-protocols.sh [options]

Options:
  --protocols LIST       Comma-separated subset of: hysteria2,tuic,wireguard
                         (default: all three)
  --hysteria-version V   Hysteria 2 release tag (default: v2.6.0)
  --hysteria-sha256 HEX  Expected sha256 of the hysteria binary for this arch
  --tuic-version V       tuic-server release version (default: 1.0.0)
  --tuic-sha256 HEX      Expected sha256 of the tuic-server binary for this arch
  --skip-verify          Skip checksum verification (dry-run only)
  --dry-run              Print actions without changing the host
  -h, --help             Show help

Binaries land in /usr/local/bin; configs are written by the node-agent at
/etc/hysteria/config.json, /etc/tuic/config.json, /etc/wireguard/lumen-wg.conf.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --protocols) PROTOCOLS="$2"; shift 2 ;;
    --hysteria-version) HYSTERIA_VERSION="$2"; shift 2 ;;
    --hysteria-sha256) HYSTERIA_SHA256_OVERRIDE="$2"; shift 2 ;;
    --tuic-version) TUIC_VERSION="$2"; shift 2 ;;
    --tuic-sha256) TUIC_SHA256_OVERRIDE="$2"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

want_protocol() {
  printf '%s' ",$PROTOCOLS," | grep -q ",$1,"
}

detect_arch() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) printf 'amd64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) die "Unsupported architecture: $machine" ;;
  esac
}

verify_checksum() {
  local file="$1"
  local expected="$2"
  local label="$3"

  if [ "$SKIP_VERIFY" = "1" ]; then
    if [ "$DRY_RUN" != "1" ]; then
      die "--skip-verify is only allowed together with --dry-run"
    fi
    warn "skipping checksum verification for $label (dry-run)"
    return 0
  fi

  if printf '%s' "$expected" | grep -Eq '^0{64}$'; then
    if [ "$DRY_RUN" = "1" ]; then
      warn "$label checksum is a placeholder; pass --${label%%-*}-sha256 before a real install"
      return 0
    fi
    die "$label checksum is a placeholder; supply the real sha256 (see release assets)"
  fi
  if ! printf '%s' "$expected" | grep -Eq '^[0-9a-f]{64}$'; then
    die "$label checksum must be 64 lowercase hex chars"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "would verify $file against $label sha256 $expected"
    return 0
  fi

  local actual
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  [ "$actual" = "$expected" ] || die "$label checksum mismatch: expected $expected got $actual"
}

download_to() {
  local url="$1"
  local dst="$2"
  if [ "$DRY_RUN" = "1" ]; then
    log "would download $url -> $dst"
    return 0
  fi
  curl -fsSL --proto '=https' --tlsv1.2 -o "$dst" "$url"
}

install_binary() {
  local tmp="$1"
  local dst="$2"
  if [ "$DRY_RUN" = "1" ]; then
    log "would install $tmp -> $dst (0755)"
    return 0
  fi
  install -m 0755 "$tmp" "$dst"
}

write_unit() {
  local path="$1"
  local content="$2"
  if [ "$DRY_RUN" = "1" ]; then
    log "would write systemd unit $path"
    return 0
  fi
  printf '%s' "$content" >"$path"
  chmod 0644 "$path"
}

enable_unit() {
  local unit="$1"
  run systemctl daemon-reload
  # Enable (start on boot) but do not start: the node-agent starts/restarts the
  # service once it writes a real config via outbound.apply.
  run systemctl enable "$unit"
}

install_hysteria() {
  local arch sha url tmp
  arch="$(detect_arch)"
  if [ "$arch" = "amd64" ]; then sha="$HYSTERIA_SHA256_AMD64"; else sha="$HYSTERIA_SHA256_ARM64"; fi
  sha="${HYSTERIA_SHA256_OVERRIDE:-$sha}"
  url="https://github.com/apernet/hysteria/releases/download/app/${HYSTERIA_VERSION}/hysteria-linux-${arch}"

  log "installing hysteria2 ${HYSTERIA_VERSION} (${arch})"
  run mkdir -p /etc/hysteria
  run chmod 0700 /etc/hysteria

  tmp="$(mktemp)"
  download_to "$url" "$tmp"
  verify_checksum "$tmp" "$sha" "hysteria-${arch}"
  install_binary "$tmp" /usr/local/bin/hysteria
  rm -f "$tmp"

  write_unit /etc/systemd/system/hysteria-server.service "[Unit]
Description=Lumen Hysteria 2 server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria server --config /etc/hysteria/config.json
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ReadWritePaths=/etc/hysteria
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
"
  enable_unit hysteria-server
}

install_tuic() {
  local arch sha url tmp
  arch="$(detect_arch)"
  if [ "$arch" = "amd64" ]; then sha="$TUIC_SHA256_AMD64"; else sha="$TUIC_SHA256_ARM64"; fi
  sha="${TUIC_SHA256_OVERRIDE:-$sha}"
  local triple
  if [ "$arch" = "amd64" ]; then triple="x86_64-unknown-linux-gnu"; else triple="aarch64-unknown-linux-gnu"; fi
  url="https://github.com/Itsusinn/tuic/releases/download/v${TUIC_VERSION}/tuic-server-${triple}"

  log "installing tuic-server ${TUIC_VERSION} (${arch})"
  run mkdir -p /etc/tuic
  run chmod 0700 /etc/tuic

  tmp="$(mktemp)"
  download_to "$url" "$tmp"
  verify_checksum "$tmp" "$sha" "tuic-${arch}"
  install_binary "$tmp" /usr/local/bin/tuic-server
  rm -f "$tmp"

  write_unit /etc/systemd/system/tuic-server.service "[Unit]
Description=Lumen TUIC server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/tuic-server -c /etc/tuic/config.json
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ReadWritePaths=/etc/tuic
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
"
  enable_unit tuic-server
}

install_wireguard() {
  log "installing wireguard-tools (wg-quick@lumen-wg)"
  if have_cmd apt-get; then
    run apt-get update
    run apt-get install -y --no-install-recommends wireguard-tools
  elif have_cmd dnf; then
    run dnf install -y wireguard-tools
  else
    warn "no supported package manager found; install wireguard-tools manually"
  fi

  run mkdir -p /etc/wireguard
  run chmod 0700 /etc/wireguard
  # wg-quick@lumen-wg reads /etc/wireguard/lumen-wg.conf, written by the agent.
  enable_unit "wg-quick@lumen-wg"
}

main() {
  require_root_or_dry_run
  need_cmd uname
  if [ "$DRY_RUN" != "1" ]; then
    need_cmd curl
    need_cmd sha256sum
    need_cmd systemctl
  fi

  local did_any=0
  if want_protocol hysteria2; then install_hysteria; did_any=1; fi
  if want_protocol tuic; then install_tuic; did_any=1; fi
  if want_protocol wireguard; then install_wireguard; did_any=1; fi

  [ "$did_any" = "1" ] || die "No known protocols selected in --protocols=$PROTOCOLS"

  log "protocol backends installed; the node-agent will write configs and start services on apply-to-node"
}

main "$@"
