import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMAND_RESULT_VERSION,
  COMMAND_TYPES,
  createCommandEnvelope,
  createCommandResult
} from "./command-envelope.js";
import {
  completeNodeCommand,
  exchangeInstallToken,
  fetchNextNodeCommand,
  recordNodeMetric,
  redactInstallTokenExchangeResponse,
  redactNodeResponse,
  sendHeartbeat
} from "./control-plane-client.js";
import {
  NODE_PROVISIONING_MODES,
  PROVISIONING_EVENTS,
  commandAllowanceForState,
  createProvisioningState,
  transitionProvisioningState
} from "./provisioning-state.js";
import { createNodeAgentRuntimeConfig, loadNodeAgentConfigFromEnv } from "./runtime-loop.js";
import { readSecretFromEnv } from "./secret-input.js";

const DEFAULT_STATE_DIR = "/var/lib/lumen-node";
const NODE_TOKEN_FILE = "node-token";
const NODE_ID_FILE = "node-id";
const HEARTBEAT_PATH_FILE = "heartbeat-path";
const PROVISIONING_STATE_FILE = "provisioning-state.json";

function readOptionalTrimmed(path) {
  try {
    const value = readFileSync(path, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function writeSecret(path, value) {
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
}

function readJsonFile(path) {
  const value = readOptionalTrimmed(path);
  if (!value) {
    return null;
  }
  return JSON.parse(value);
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function statePaths(env = {}) {
  const stateDir = env.LUMEN_STATE_DIR ?? DEFAULT_STATE_DIR;
  return Object.freeze({
    stateDir,
    nodeTokenFile: env.LUMEN_NODE_TOKEN_FILE ?? join(stateDir, NODE_TOKEN_FILE),
    nodeIdFile: env.LUMEN_NODE_ID_FILE ?? join(stateDir, NODE_ID_FILE),
    heartbeatPathFile: env.LUMEN_HEARTBEAT_PATH_FILE ?? join(stateDir, HEARTBEAT_PATH_FILE),
    provisioningStateFile: env.LUMEN_PROVISIONING_STATE_FILE ??
      join(stateDir, PROVISIONING_STATE_FILE)
  });
}

function nodeIdFromHeartbeatPath(path) {
  if (!path) {
    return null;
  }
  const match = path.match(/^\/api\/v1\/nodes\/([^/]+)\/heartbeat$/);
  return match?.[1] ?? null;
}

function runtimeConfigWithNodeId(config, nodeId) {
  if (!nodeId || nodeId === config.nodeId) {
    return config;
  }
  return createNodeAgentRuntimeConfig({
    ...config,
    nodeId
  });
}

function loadProvisioningState(paths, config) {
  const savedState = readJsonFile(paths.provisioningStateFile);
  return createProvisioningState(savedState ?? {
    nodeId: config.nodeId,
    updatedAt: new Date().toISOString()
  });
}

function persistProvisioningState(paths, state) {
  writeJsonFile(paths.provisioningStateFile, state);
}

function nodeStatusFromProvisioningState(state) {
  if (state.mode === NODE_PROVISIONING_MODES.PAUSED) {
    return "paused";
  }
  if (state.mode === NODE_PROVISIONING_MODES.LICENSE_PAUSED) {
    return "license_paused";
  }
  if (state.mode === NODE_PROVISIONING_MODES.QUARANTINED) {
    return "quarantined";
  }
  return "active";
}

function commandResponseToEnvelope(command) {
  return createCommandEnvelope({
    id: command.id,
    nodeId: command.node_id ?? command.nodeId,
    command: command.command_type ?? command.command,
    idempotencyKey: command.idempotency_key ?? `${command.id}:${command.node_id ?? command.nodeId}`,
    sequence: command.sequence ?? 0,
    issuedAt: command.created_at ?? command.issuedAt ?? new Date().toISOString(),
    expiresAt: command.expires_at ?? command.expiresAt ?? null,
    payload: command.payload_json ?? command.payload ?? {},
    source: command.source ?? {
      actor: "control-plane",
      reason: command.command_type ?? command.command
    }
  });
}

function commandResultEnvelope(envelope, input = {}) {
  return createCommandResult(envelope, {
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    outputs: input.outputs,
    conflicts: input.conflicts,
    error: input.error
  });
}

function failedCommandResult(command, error, code = "command_apply_failed") {
  return Object.freeze({
    status: "failed",
    state: null,
    resultJson: Object.freeze({
      modelVersion: COMMAND_RESULT_VERSION,
      commandId: command?.id ?? null,
      nodeId: command?.node_id ?? command?.nodeId ?? null,
      command: command?.command_type ?? command?.command ?? null,
      status: "failed",
      finishedAt: new Date().toISOString(),
      outputs: Object.freeze({}),
      conflicts: Object.freeze([]),
      error: Object.freeze({
        code,
        message: error.message
      })
    }),
    errorCode: code,
    errorMessage: error.message
  });
}

function transitionApplyScaffold(state, envelope, input = {}) {
  const applyStarted = transitionProvisioningState(
    state,
    PROVISIONING_EVENTS.APPLY_STARTED,
    {
      at: input.startedAt,
      desiredRevision: envelope.payload.desiredRevision ?? state.desiredRevision
    }
  );
  return transitionProvisioningState(applyStarted, PROVISIONING_EVENTS.APPLY_SUCCEEDED, {
    at: input.finishedAt,
    appliedRevision: envelope.payload.desiredRevision ?? applyStarted.desiredRevision
  });
}

function transitionValidateScaffold(state, envelope, input = {}) {
  const validateStarted = transitionProvisioningState(
    state,
    PROVISIONING_EVENTS.VALIDATE_STARTED,
    { at: input.startedAt }
  );
  return transitionProvisioningState(validateStarted, PROVISIONING_EVENTS.VALIDATE_SUCCEEDED, {
    at: input.finishedAt,
    desiredRevision: envelope.payload.desiredRevision ?? state.desiredRevision
  });
}

function transitionReportScaffold(state, input = {}) {
  const reportStarted = transitionProvisioningState(state, PROVISIONING_EVENTS.REPORT_STARTED, {
    at: input.startedAt
  });
  return transitionProvisioningState(reportStarted, PROVISIONING_EVENTS.REPORT_SUCCEEDED, {
    at: input.finishedAt
  });
}

export function applyNodeCommand(command, currentState, input = {}) {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const finishedAt = input.finishedAt ?? startedAt;
  let envelope;
  try {
    envelope = commandResponseToEnvelope(command);
  } catch (error) {
    return failedCommandResult(command, error, "invalid_command_envelope");
  }

  const state = createProvisioningState(currentState);
  const allowance = commandAllowanceForState(envelope, state);
  if (!allowance.allowed) {
    const result = commandResultEnvelope(envelope, {
      status: "skipped",
      startedAt,
      finishedAt,
      outputs: {
        reason: allowance.reason,
        mode: state.mode
      }
    });
    return Object.freeze({
      status: "skipped",
      state,
      resultJson: result,
      errorCode: "command_not_allowed",
      errorMessage: allowance.reason
    });
  }

  try {
    let nextState = state;
    let outputs = {
      mode: state.mode,
      implementationStatus: "scaffold"
    };

    switch (envelope.command) {
      case COMMAND_TYPES.NODE_PAUSE:
        nextState = transitionProvisioningState(state, PROVISIONING_EVENTS.PAUSE_REQUESTED, {
          at: finishedAt,
          mode: envelope.payload.status
        });
        outputs = { mode: nextState.mode, reason: envelope.payload.reason ?? null };
        break;
      case COMMAND_TYPES.NODE_RESUME:
        nextState = transitionProvisioningState(state, PROVISIONING_EVENTS.RESUME_REQUESTED, {
          at: finishedAt,
          clearQuarantine: envelope.payload.clearQuarantine
        });
        outputs = { mode: nextState.mode, clearQuarantine: envelope.payload.clearQuarantine ?? false };
        break;
      case COMMAND_TYPES.NODE_QUARANTINE:
        nextState = transitionProvisioningState(state, PROVISIONING_EVENTS.QUARANTINE_REQUESTED, {
          at: finishedAt,
          commandId: envelope.id,
          reason: envelope.payload.reason
        });
        outputs = { mode: nextState.mode, reason: envelope.payload.reason };
        break;
      case COMMAND_TYPES.DESIRED_STATE_VALIDATE:
        nextState = transitionValidateScaffold(state, envelope, { startedAt, finishedAt });
        outputs = { desiredRevision: nextState.desiredRevision, implementationStatus: "scaffold" };
        break;
      case COMMAND_TYPES.DESIRED_STATE_APPLY:
      case COMMAND_TYPES.FIREWALL_PLAN_APPLY:
      case COMMAND_TYPES.OUTBOUND_APPLY:
        nextState = transitionApplyScaffold(state, envelope, { startedAt, finishedAt });
        outputs = {
          appliedRevision: nextState.appliedRevision,
          command: envelope.command,
          dryRun: input.dryRun ?? true,
          implementationStatus: "scaffold"
        };
        break;
      case COMMAND_TYPES.OUTBOUND_REMOVE:
        nextState = transitionProvisioningState(state, PROVISIONING_EVENTS.REMOVE_STARTED, {
          at: startedAt
        });
        nextState = transitionProvisioningState(nextState, PROVISIONING_EVENTS.REMOVE_SUCCEEDED, {
          at: finishedAt
        });
        outputs = {
          command: envelope.command,
          dryRun: input.dryRun ?? true,
          implementationStatus: "scaffold"
        };
        break;
      case COMMAND_TYPES.CAPABILITIES_REPORT:
        nextState = transitionReportScaffold(state, { startedAt, finishedAt });
        outputs = {
          capabilities: Object.freeze({ ...(input.capabilities ?? {}) }),
          implementationStatus: "scaffold"
        };
        break;
      case COMMAND_TYPES.CONFLICT_SCAN:
        outputs = {
          conflictsFound: 0,
          implementationStatus: "scaffold"
        };
        break;
      default:
        throw new Error(`Unsupported command: ${envelope.command}`);
    }

    const result = commandResultEnvelope(envelope, {
      status: "succeeded",
      startedAt,
      finishedAt,
      outputs: {
        ...outputs,
        stateRevision: nextState.revision
      }
    });
    return Object.freeze({
      status: "succeeded",
      state: nextState,
      resultJson: result,
      errorCode: null,
      errorMessage: null
    });
  } catch (error) {
    return failedCommandResult(command, error);
  }
}

export async function enrollNodeAgent(input = {}) {
  const env = input.env ?? {};
  const config = input.config ?? loadNodeAgentConfigFromEnv(env);
  const paths = statePaths(env);
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });

  const existingNodeToken = readOptionalTrimmed(paths.nodeTokenFile);
  const existingHeartbeatPath = readOptionalTrimmed(paths.heartbeatPathFile);
  const existingNodeId = readOptionalTrimmed(paths.nodeIdFile) ??
    nodeIdFromHeartbeatPath(existingHeartbeatPath);
  if (existingNodeToken) {
    if (existingNodeId) {
      writeSecret(paths.nodeIdFile, existingNodeId);
    }
    return Object.freeze({
      config: runtimeConfigWithNodeId(config, existingNodeId),
      heartbeatPath: existingHeartbeatPath,
      nodeToken: existingNodeToken,
      redactedExchange: null,
      reusedExistingToken: true
    });
  }

  const response = await exchangeInstallToken({
    controlPlaneBaseUrl: config.controlPlaneBaseUrl,
    fetchImpl: input.fetchImpl,
    installToken: readSecretFromEnv(env, "LUMEN_INSTALL_TOKEN")
  });

  writeSecret(paths.nodeTokenFile, response.node_token);
  writeSecret(paths.nodeIdFile, response.node_id);
  writeFileSync(paths.heartbeatPathFile, `${response.heartbeat_path}\n`, { mode: 0o600 });

  return Object.freeze({
    config: runtimeConfigWithNodeId(config, response.node_id),
    heartbeatPath: response.heartbeat_path,
    nodeToken: response.node_token,
    redactedExchange: redactInstallTokenExchangeResponse(response),
    reusedExistingToken: false
  });
}

export async function runNodeAgentOnce(input = {}) {
  const enrollment = await enrollNodeAgent(input);
  const paths = statePaths(input.env ?? {});
  const currentState = loadProvisioningState(paths, enrollment.config);
  const response = await sendHeartbeat({
    config: enrollment.config,
    fetchImpl: input.fetchImpl,
    heartbeatPath: enrollment.heartbeatPath ?? undefined,
    nodeToken: enrollment.nodeToken,
    status: nodeStatusFromProvisioningState(currentState)
  });
  const command = await fetchNextNodeCommand({
    config: enrollment.config,
    fetchImpl: input.fetchImpl,
    nodeToken: enrollment.nodeToken
  });

  let commandResult = null;
  let completedCommand = null;
  let latestState = currentState;

  if (command) {
    commandResult = applyNodeCommand(command, currentState, {
      capabilities: enrollment.config.capabilities,
      dryRun: enrollment.config.dryRun
    });
    if (commandResult.state) {
      latestState = commandResult.state;
      persistProvisioningState(paths, latestState);
    }
    completedCommand = await completeNodeCommand({
      config: enrollment.config,
      commandId: command.id,
      errorCode: commandResult.errorCode,
      errorMessage: commandResult.errorMessage,
      fetchImpl: input.fetchImpl,
      nodeToken: enrollment.nodeToken,
      resultJson: commandResult.resultJson,
      status: commandResult.status
    });
  }

  const metric = await recordNodeMetric({
    config: enrollment.config,
    fetchImpl: input.fetchImpl,
    metricKind: "runtime",
    nodeToken: enrollment.nodeToken,
    valuesJson: {
      command_polled: command ? 1 : 0,
      command_completed: completedCommand ? 1 : 0,
      state_revision: latestState.revision
    }
  });

  return Object.freeze({
    exchange: enrollment.redactedExchange,
    heartbeat: redactNodeResponse(response),
    command: command
      ? Object.freeze({
        id: command.id,
        commandType: command.command_type,
        status: commandResult?.status ?? null
      })
      : null,
    metric: Object.freeze({
      id: metric.id ?? null,
      metricKind: metric.metric_kind ?? "runtime"
    }),
    reusedExistingToken: enrollment.reusedExistingToken
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runNodeAgentLoop(input = {}) {
  const env = input.env ?? {};
  const config = input.config ?? loadNodeAgentConfigFromEnv(env);
  const once = input.once ?? false;
  let latest = null;

  do {
    latest = await runNodeAgentOnce({ ...input, config, env });
    if (once) {
      return latest;
    }
    await wait(config.heartbeatIntervalMs);
  } while (true);
}
