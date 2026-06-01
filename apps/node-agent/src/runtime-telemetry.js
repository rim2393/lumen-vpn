import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_NODE_POLICY_DIR } from "./policy-runtime.js";
import { recordNodeEvent } from "./control-plane-client.js";

export const RUNTIME_TELEMETRY_MODEL_VERSION = "lumen.node-agent.runtime-telemetry.v1";
export const DEFAULT_TELEMETRY_STATE_FILE = "/var/lib/lumen-node/runtime/telemetry-state.json";

const DEFAULT_TORRENT_PATTERNS = Object.freeze([
  "bittorrent protocol",
  "bittorrent",
  "btih:",
  "info_hash",
  ".torrent",
  "announce_peer",
  "get_peers"
]);

const DEFAULT_LOG_ENV_KEYS = Object.freeze([
  "LUMEN_XRAY_LOG_FILE",
  "LUMEN_HYSTERIA2_LOG_FILE",
  "LUMEN_SHADOWSOCKS_LOG_FILE",
  "LUMEN_SHADOWSOCKS_PLUGIN_LOG_FILE",
  "LUMEN_NAIVE_LOG_FILE",
  "LUMEN_TUIC_LOG_FILE"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function loadPolicyFiles(policyDir) {
  if (!existsSync(policyDir)) {
    return [];
  }
  return readdirSync(policyDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(policyDir, name));
}

function loadPolicies(policyDir) {
  return loadPolicyFiles(policyDir)
    .map((path) => {
      try {
        return readJsonFile(path, null);
      } catch {
        return null;
      }
    })
    .filter(isPlainObject);
}

function torrentPluginsFromPolicies(policies) {
  return policies.flatMap((policy) => Array.isArray(policy.plugins)
    ? policy.plugins.filter((plugin) => plugin?.kind === "torrent-blocker" && plugin.enabled !== false)
    : []);
}

function defaultLogFiles(env) {
  const files = [];
  for (const key of DEFAULT_LOG_ENV_KEYS) {
    if (typeof env[key] === "string" && env[key].trim()) {
      files.push(env[key].trim());
    }
  }
  return files;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function redactedLineSample(line) {
  return stripAnsi(line)
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, "[redacted-token]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
    .slice(0, 180);
}

function eventResourceId(line) {
  const normalized = stripAnsi(line).toLowerCase();
  const btih = normalized.match(/btih:([a-f0-9]{32,40})/);
  if (btih) {
    return `btih:${btih[1]}`;
  }
  return `torrent:${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

function matchTorrentLine(line, patterns) {
  const normalized = stripAnsi(line).toLowerCase();
  return patterns.find((pattern) => normalized.includes(pattern.toLowerCase())) ?? null;
}

function readNewLines(path, offset) {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({ lines: Object.freeze([]), nextOffset: offset, missing: true });
    }
    throw error;
  }
  const start = Number.isInteger(offset) && offset >= 0 && offset <= stats.size ? offset : 0;
  if (stats.size <= start) {
    return Object.freeze({ lines: Object.freeze([]), nextOffset: stats.size, missing: false });
  }
  const content = readFileSync(path, "utf8").slice(start);
  return Object.freeze({
    lines: Object.freeze(content.split(/\r?\n/).filter((line) => line.trim())),
    nextOffset: stats.size,
    missing: false
  });
}

export function createRuntimeTelemetryPlan(input = {}) {
  const env = input.env ?? {};
  const policyDir = input.policyDir ?? env.LUMEN_NODE_POLICY_DIR ?? DEFAULT_NODE_POLICY_DIR;
  const policies = input.policies ?? loadPolicies(policyDir);
  const torrentPlugins = torrentPluginsFromPolicies(policies);
  const logFiles = uniqueStrings([
    ...defaultLogFiles(env),
    ...torrentPlugins.flatMap((plugin) => normalizeArray(plugin.config?.logFiles))
  ]);
  const patterns = uniqueStrings([
    ...DEFAULT_TORRENT_PATTERNS,
    ...torrentPlugins.flatMap((plugin) => normalizeArray(plugin.config?.patterns))
  ]);
  return Object.freeze({
    modelVersion: RUNTIME_TELEMETRY_MODEL_VERSION,
    enabled: torrentPlugins.length > 0,
    policyDir,
    logFiles: Object.freeze(logFiles),
    patterns: Object.freeze(patterns),
    stateFile: input.stateFile ?? env.LUMEN_RUNTIME_TELEMETRY_STATE_FILE ?? DEFAULT_TELEMETRY_STATE_FILE
  });
}

export function collectRuntimeTelemetryEvents(plan, input = {}) {
  if (!plan || plan.modelVersion !== RUNTIME_TELEMETRY_MODEL_VERSION) {
    throw new Error(`telemetry plan must be ${RUNTIME_TELEMETRY_MODEL_VERSION}`);
  }
  const state = readJsonFile(plan.stateFile, { offsets: {}, emitted: {} });
  const offsets = isPlainObject(state.offsets) ? { ...state.offsets } : {};
  const emitted = isPlainObject(state.emitted) ? { ...state.emitted } : {};
  const now = input.now ?? new Date().toISOString();
  const events = [];

  if (!plan.enabled) {
    return Object.freeze({ events: Object.freeze([]), state: Object.freeze({ offsets, emitted }) });
  }

  for (const logFile of plan.logFiles) {
    const previousOffset = Number.isInteger(offsets[logFile]) ? offsets[logFile] : 0;
    const { lines, nextOffset } = readNewLines(logFile, previousOffset);
    offsets[logFile] = nextOffset;
    for (const line of lines) {
      const matchedPattern = matchTorrentLine(line, plan.patterns);
      if (!matchedPattern) {
        continue;
      }
      const resourceId = eventResourceId(line);
      const dedupeKey = `${logFile}:${resourceId}`;
      if (emitted[dedupeKey]) {
        continue;
      }
      emitted[dedupeKey] = now;
      events.push(Object.freeze({
        action: "torrent.blocked",
        resourceType: "torrent",
        resourceId,
        metadataJson: Object.freeze({
          detector: "runtime-log",
          log_file: logFile,
          pattern: matchedPattern,
          sample: redactedLineSample(line),
          observed_at: now
        })
      }));
    }
  }

  const nextState = Object.freeze({ offsets: Object.freeze(offsets), emitted: Object.freeze(emitted) });
  if (input.persist !== false) {
    writeJsonFile(plan.stateFile, nextState);
  }
  return Object.freeze({ events: Object.freeze(events), state: nextState });
}

export async function reportRuntimeTelemetry(input = {}) {
  const plan = input.plan ?? createRuntimeTelemetryPlan(input);
  const collection = collectRuntimeTelemetryEvents(plan, input);
  const reported = [];
  for (const event of collection.events) {
    const response = await recordNodeEvent({
      config: input.config,
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      fetchImpl: input.fetchImpl,
      nodeId: input.nodeId,
      nodeToken: input.nodeToken,
      ...event
    });
    reported.push(response);
  }
  return Object.freeze({
    modelVersion: RUNTIME_TELEMETRY_MODEL_VERSION,
    enabled: plan.enabled,
    scannedLogFiles: plan.logFiles.length,
    detectedEvents: collection.events.length,
    reportedEvents: reported.length
  });
}
