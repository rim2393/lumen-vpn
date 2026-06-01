import { createProvisioningState } from "./provisioning-state.js";
import { createSystemCapabilityReport } from "./system-capabilities.js";

export const NODE_AGENT_RUNTIME_CONFIG_VERSION = "lumen.node-agent.runtime-config.v1";
export const HEARTBEAT_PAYLOAD_VERSION = "lumen.node-agent.heartbeat.v1";
export const NODE_AGENT_DRY_RUN_REPORT_VERSION = "lumen.node-agent.dry-run-report.v1";

const DEFAULT_CONTROL_PLANE_BASE_URL = "https://control-plane.invalid";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const LIVE_COMMANDS = Object.freeze(new Set(["--run", "--run-once"]));

function freezeArray(value) {
  return Object.freeze([...(value ?? [])]);
}

function freezeObject(value) {
  return Object.freeze({ ...(value ?? {}) });
}

function nowIso(input = {}) {
  return input.at ?? input.observedAt ?? input.generatedAt ?? new Date().toISOString();
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function parsePositiveInteger(value, fallback, path) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }

  return parsed;
}

function parseCsv(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCapabilityFlags(value) {
  const flags = {};
  for (const capability of parseCsv(value)) {
    flags[capability] = true;
  }
  return freezeObject(flags);
}

function parseDryRun(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error("LUMEN_DRY_RUN must be true or false when set");
}

function isLiveCommand(argv = []) {
  return argv.some((arg) => LIVE_COMMANDS.has(arg));
}

function normalizeBaseUrl(value) {
  const baseUrl = value ?? DEFAULT_CONTROL_PLANE_BASE_URL;
  try {
    return new URL(baseUrl).toString().replace(/\/$/, "");
  } catch {
    throw new Error("controlPlaneBaseUrl must be a valid URL");
  }
}

export function createNodeAgentRuntimeConfig(input = {}) {
  const errors = [];
  const nodeId = input.nodeId ?? "local-node";

  requireString(nodeId, "nodeId", errors);

  if (errors.length > 0) {
    throw new Error(`Invalid node agent runtime config: ${errors.join("; ")}`);
  }

  return Object.freeze({
    configVersion: NODE_AGENT_RUNTIME_CONFIG_VERSION,
    nodeId,
    controlPlaneBaseUrl: normalizeBaseUrl(input.controlPlaneBaseUrl),
    agentVersion: input.agentVersion ?? "0.0.0",
    heartbeatIntervalMs: parsePositiveInteger(
      input.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      "heartbeatIntervalMs"
    ),
    pollIntervalMs: parsePositiveInteger(
      input.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs"
    ),
    capabilities: freezeObject(input.capabilities),
    tags: freezeArray(input.tags),
    dryRun: input.dryRun ?? false
  });
}

export function loadNodeAgentConfigFromEnv(env = {}) {
  return createNodeAgentRuntimeConfig({
    nodeId: env.LUMEN_NODE_ID ?? env.LUMEN_NODE_NAME,
    controlPlaneBaseUrl: env.LUMEN_CONTROL_PLANE_URL ?? env.LUMEN_PANEL_URL,
    agentVersion: env.LUMEN_AGENT_VERSION ?? env.npm_package_version,
    heartbeatIntervalMs: env.LUMEN_HEARTBEAT_INTERVAL_MS,
    pollIntervalMs: env.LUMEN_POLL_INTERVAL_MS,
    capabilities: parseCapabilityFlags(env.LUMEN_CAPABILITIES),
    tags: parseCsv(env.LUMEN_NODE_TAGS),
    dryRun: parseDryRun(env.LUMEN_DRY_RUN, false)
  });
}

export function assertLiveRuntimeMode(config, argv = []) {
  if (isLiveCommand(argv) && config.dryRun !== false) {
    throw new Error("Refusing to run live node-agent loop with LUMEN_DRY_RUN enabled.");
  }
}

export function createHeartbeatPayload(input = {}) {
  const config = createNodeAgentRuntimeConfig(input.config ?? input);
  const observedAt = nowIso(input);
  const state = createProvisioningState(input.state ?? {
    nodeId: config.nodeId,
    updatedAt: observedAt
  });
  const capabilityReport = input.capabilityReport ?? createSystemCapabilityReport({
    nodeId: config.nodeId,
    observedAt,
    capabilities: config.capabilities
  });

  return Object.freeze({
    payloadVersion: HEARTBEAT_PAYLOAD_VERSION,
    nodeId: config.nodeId,
    observedAt,
    agentVersion: config.agentVersion,
    controlPlaneBaseUrl: config.controlPlaneBaseUrl,
    intervals: Object.freeze({
      heartbeatMs: config.heartbeatIntervalMs,
      pollMs: config.pollIntervalMs
    }),
    state: Object.freeze({
      mode: state.mode,
      phase: state.phase,
      revision: state.revision,
      desiredRevision: state.desiredRevision,
      appliedRevision: state.appliedRevision,
      updatedAt: state.updatedAt,
      quarantine: state.quarantine
    }),
    capabilityReport,
    dryRun: config.dryRun
  });
}

export function buildNodeAgentDryRun(input = {}) {
  const generatedAt = nowIso(input);
  const config = input.config ?? loadNodeAgentConfigFromEnv(input.env);
  const heartbeat = createHeartbeatPayload({
    config,
    observedAt: generatedAt
  });

  return Object.freeze({
    reportVersion: NODE_AGENT_DRY_RUN_REPORT_VERSION,
    dryRun: true,
    generatedAt,
    config,
    heartbeat
  });
}
