#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${1:-.}"
FAIL=0

scan_regex() {
  local name="$1"
  local pattern="$2"
  local output=""

  if command -v rg >/dev/null 2>&1; then
    output="$(rg -n --hidden --glob '!.git/**' --glob '!support-bundles/**' --glob '!backups/**' "$pattern" "$ROOT" || true)"
  else
    output="$(grep -RInE --exclude-dir=.git --exclude-dir=support-bundles --exclude-dir=backups "$pattern" "$ROOT" || true)"
  fi

  if [ -n "$output" ]; then
    printf '[secret-scan] %s\n%s\n' "$name" "$output" >&2
    FAIL=1
  fi
}

scan_tracked_sensitive_files() {
  if ! command -v git >/dev/null 2>&1 || ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  local files
  files="$(git -C "$ROOT" ls-files | grep -E '(^|/)(\.env|id_rsa|id_ed25519|.*\.(pem|p12|pfx|key))$' || true)"
  if [ -n "$files" ]; then
    printf '[secret-scan] sensitive file path tracked by git\n%s\n' "$files" >&2
    FAIL=1
  fi
}

scan_regex "GitHub token" 'gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}'
scan_regex "AWS access key" 'AKIA[0-9A-Z]{16}'
scan_regex "Slack token" 'xox[baprs]-[A-Za-z0-9-]{20,}'
scan_regex "private key block" '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----'
scan_regex "subscription URL token" 'https?://[^ ]+/api/sub/[A-Za-z0-9._~-]{20,}'
scan_tracked_sensitive_files

if [ "$FAIL" -ne 0 ]; then
  printf '[secret-scan] possible secret material found\n' >&2
  exit 1
fi

printf '[secret-scan] ok\n'

