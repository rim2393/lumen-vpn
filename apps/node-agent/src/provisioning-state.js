import { COMMAND_TYPES } from "./command-envelope.js";

export const PROVISIONING_STATE_VERSION = "lumen.node-agent.provisioning-state.v1";

export const NODE_PROVISIONING_MODES = Object.freeze({
  ACTIVE: "active",
  LICENSE_PAUSED: "license_paused",
  PAUSED: "paused",
  QUARANTINED: "quarantined"
});

export const PROVISIONING_PHASES = Object.freeze({
  IDLE: "idle",
  VALIDATING: "validating",
  APPLYING: "applying",
  REMOVING: "removing",
  REPORTING: "reporting",
  FAILED: "failed"
});

export const PROVISIONING_EVENTS = Object.freeze({
  VALIDATE_STARTED: "validate.started",
  VALIDATE_SUCCEEDED: "validate.succeeded",
  APPLY_STARTED: "apply.started",
  APPLY_SUCCEEDED: "apply.succeeded",
  APPLY_FAILED: "apply.failed",
  REMOVE_STARTED: "remove.started",
  REMOVE_SUCCEEDED: "remove.succeeded",
  REPORT_STARTED: "report.started",
  REPORT_SUCCEEDED: "report.succeeded",
  PAUSE_REQUESTED: "pause.requested",
  RESUME_REQUESTED: "resume.requested",
  QUARANTINE_REQUESTED: "quarantine.requested"
});

const ACTIVE_MUTATING_COMMANDS = new Set([
  COMMAND_TYPES.DESIRED_STATE_APPLY,
  COMMAND_TYPES.FIREWALL_PLAN_APPLY,
  COMMAND_TYPES.NODE_CONNECTIONS_DROP,
  COMMAND_TYPES.NODE_RESTART,
  COMMAND_TYPES.NODE_TRAFFIC_RESET,
  COMMAND_TYPES.OUTBOUND_APPLY,
  COMMAND_TYPES.OUTBOUND_REMOVE
]);

const DIAGNOSTIC_COMMANDS = new Set([
  COMMAND_TYPES.DESIRED_STATE_VALIDATE,
  COMMAND_TYPES.CAPABILITIES_REPORT,
  COMMAND_TYPES.CONFLICT_SCAN
]);

function isKnownMode(mode) {
  return Object.values(NODE_PROVISIONING_MODES).includes(mode);
}

function isKnownPhase(phase) {
  return Object.values(PROVISIONING_PHASES).includes(phase);
}

function nowIso(input) {
  return input.at ?? new Date().toISOString();
}

function requireIdle(state, event) {
  if (state.phase !== PROVISIONING_PHASES.IDLE) {
    throw new Error(`Cannot apply ${event} while provisioning phase is ${state.phase}`);
  }
}

function requireActive(state, event) {
  if (state.mode !== NODE_PROVISIONING_MODES.ACTIVE) {
    throw new Error(`Cannot apply ${event} while node mode is ${state.mode}`);
  }
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    quarantine: state.quarantine ? Object.freeze({ ...state.quarantine }) : null,
    lastError: state.lastError ? Object.freeze({ ...state.lastError }) : null
  });
}

export function createProvisioningState(input = {}) {
  if (typeof input.nodeId !== "string" || input.nodeId.trim().length === 0) {
    throw new Error("nodeId is required for provisioning state");
  }

  const mode = input.mode ?? NODE_PROVISIONING_MODES.ACTIVE;
  const phase = input.phase ?? PROVISIONING_PHASES.IDLE;

  if (!isKnownMode(mode)) {
    throw new Error(`mode must be one of ${Object.values(NODE_PROVISIONING_MODES).join(", ")}`);
  }
  if (!isKnownPhase(phase)) {
    throw new Error(`phase must be one of ${Object.values(PROVISIONING_PHASES).join(", ")}`);
  }

  return freezeState({
    modelVersion: PROVISIONING_STATE_VERSION,
    nodeId: input.nodeId,
    mode,
    phase,
    revision: input.revision ?? 0,
    desiredRevision: input.desiredRevision ?? null,
    appliedRevision: input.appliedRevision ?? null,
    pausedAt: input.pausedAt ?? null,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    quarantine: input.quarantine ?? null,
    lastError: input.lastError ?? null
  });
}

export function commandAllowanceForState(command, state) {
  const current = createProvisioningState(state);
  const commandType = typeof command === "string" ? command : command?.command;

  if (current.mode === NODE_PROVISIONING_MODES.ACTIVE) {
    return Object.freeze({ allowed: true, reason: null });
  }

  if (
    current.mode === NODE_PROVISIONING_MODES.PAUSED ||
    current.mode === NODE_PROVISIONING_MODES.LICENSE_PAUSED
  ) {
    const allowed = commandType === COMMAND_TYPES.NODE_RESUME ||
      commandType === COMMAND_TYPES.NODE_QUARANTINE ||
      DIAGNOSTIC_COMMANDS.has(commandType);
    const reason = current.mode === NODE_PROVISIONING_MODES.LICENSE_PAUSED
      ? "node is license-paused; mutating commands are blocked until license renewal"
      : "node is paused; mutating commands are deferred until resume";
    return Object.freeze({
      allowed,
      reason: allowed ? null : reason
    });
  }

  if (current.mode === NODE_PROVISIONING_MODES.QUARANTINED) {
    const allowed = commandType === COMMAND_TYPES.NODE_RESUME || DIAGNOSTIC_COMMANDS.has(commandType);
    return Object.freeze({
      allowed,
      reason: allowed ? null : "node is quarantined; mutating commands are blocked"
    });
  }

  return Object.freeze({ allowed: false, reason: `unsupported node mode: ${current.mode}` });
}

export function transitionProvisioningState(currentState, event, input = {}) {
  const state = createProvisioningState(currentState);
  const at = nowIso(input);

  switch (event) {
    case PROVISIONING_EVENTS.VALIDATE_STARTED:
      requireIdle(state, event);
      return freezeState({ ...state, phase: PROVISIONING_PHASES.VALIDATING, updatedAt: at });
    case PROVISIONING_EVENTS.VALIDATE_SUCCEEDED:
      if (state.phase !== PROVISIONING_PHASES.VALIDATING) {
        throw new Error("Validation can only succeed from validating phase");
      }
      return freezeState({
        ...state,
        phase: PROVISIONING_PHASES.IDLE,
        desiredRevision: input.desiredRevision ?? state.desiredRevision,
        revision: state.revision + 1,
        updatedAt: at
      });
    case PROVISIONING_EVENTS.APPLY_STARTED:
      requireActive(state, event);
      requireIdle(state, event);
      return freezeState({
        ...state,
        phase: PROVISIONING_PHASES.APPLYING,
        desiredRevision: input.desiredRevision ?? state.desiredRevision,
        updatedAt: at
      });
    case PROVISIONING_EVENTS.APPLY_SUCCEEDED:
      if (state.phase !== PROVISIONING_PHASES.APPLYING) {
        throw new Error("Apply can only succeed from applying phase");
      }
      return freezeState({
        ...state,
        phase: PROVISIONING_PHASES.IDLE,
        appliedRevision: input.appliedRevision ?? state.desiredRevision,
        revision: state.revision + 1,
        lastError: null,
        updatedAt: at
      });
    case PROVISIONING_EVENTS.APPLY_FAILED:
      if (state.phase !== PROVISIONING_PHASES.APPLYING) {
        throw new Error("Apply can only fail from applying phase");
      }
      return freezeState({
        ...state,
        phase: PROVISIONING_PHASES.FAILED,
        lastError: Object.freeze({
          code: input.code ?? "apply_failed",
          message: input.message ?? "Provisioning apply failed",
          at
        }),
        updatedAt: at
      });
    case PROVISIONING_EVENTS.REMOVE_STARTED:
      requireActive(state, event);
      requireIdle(state, event);
      return freezeState({ ...state, phase: PROVISIONING_PHASES.REMOVING, updatedAt: at });
    case PROVISIONING_EVENTS.REMOVE_SUCCEEDED:
      if (state.phase !== PROVISIONING_PHASES.REMOVING) {
        throw new Error("Remove can only succeed from removing phase");
      }
      return freezeState({
        ...state,
        phase: PROVISIONING_PHASES.IDLE,
        appliedRevision: null,
        revision: state.revision + 1,
        lastError: null,
        updatedAt: at
      });
    case PROVISIONING_EVENTS.REPORT_STARTED:
      requireIdle(state, event);
      return freezeState({ ...state, phase: PROVISIONING_PHASES.REPORTING, updatedAt: at });
    case PROVISIONING_EVENTS.REPORT_SUCCEEDED:
      if (state.phase !== PROVISIONING_PHASES.REPORTING) {
        throw new Error("Report can only succeed from reporting phase");
      }
      return freezeState({ ...state, phase: PROVISIONING_PHASES.IDLE, updatedAt: at });
    case PROVISIONING_EVENTS.PAUSE_REQUESTED:
      if (state.mode === NODE_PROVISIONING_MODES.QUARANTINED) {
        throw new Error("Cannot pause a quarantined node");
      }
      requireIdle(state, event);
      if (
        input.mode !== undefined &&
        input.mode !== NODE_PROVISIONING_MODES.PAUSED &&
        input.mode !== NODE_PROVISIONING_MODES.LICENSE_PAUSED
      ) {
        throw new Error("Pause mode must be paused or license_paused");
      }
      return freezeState({
        ...state,
        mode: input.mode ?? NODE_PROVISIONING_MODES.PAUSED,
        pausedAt: at,
        revision: state.revision + 1,
        updatedAt: at
      });
    case PROVISIONING_EVENTS.RESUME_REQUESTED:
      if (state.mode === NODE_PROVISIONING_MODES.QUARANTINED && input.clearQuarantine !== true) {
        throw new Error("Resuming a quarantined node requires clearQuarantine=true");
      }
      requireIdle(state, event);
      return freezeState({
        ...state,
        mode: NODE_PROVISIONING_MODES.ACTIVE,
        pausedAt: null,
        quarantine: null,
        revision: state.revision + 1,
        updatedAt: at
      });
    case PROVISIONING_EVENTS.QUARANTINE_REQUESTED:
      return freezeState({
        ...state,
        mode: NODE_PROVISIONING_MODES.QUARANTINED,
        phase: PROVISIONING_PHASES.IDLE,
        pausedAt: null,
        quarantine: Object.freeze({
          reason: input.reason ?? "manual",
          commandId: input.commandId ?? null,
          at
        }),
        revision: state.revision + 1,
        updatedAt: at
      });
    default:
      throw new Error(`Unsupported provisioning event: ${event}`);
  }
}

export function isMutatingCommand(command) {
  const commandType = typeof command === "string" ? command : command?.command;
  return ACTIVE_MUTATING_COMMANDS.has(commandType);
}
