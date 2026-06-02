import { assertNoInlineSecrets } from "./outbound-model.js";

export const COMMAND_ENVELOPE_VERSION = "lumen.node-agent.command-envelope.v1";
export const COMMAND_ACK_VERSION = "lumen.node-agent.command-ack.v1";
export const COMMAND_RESULT_VERSION = "lumen.node-agent.command-result.v1";

export const COMMAND_TYPES = Object.freeze({
  DESIRED_STATE_VALIDATE: "desired-state.validate",
  DESIRED_STATE_APPLY: "desired-state.apply",
  FIREWALL_PLAN_APPLY: "firewall.plan.apply",
  OUTBOUND_APPLY: "outbound.apply",
  OUTBOUND_REMOVE: "outbound.remove",
  NODE_PAUSE: "node.pause",
  NODE_RESUME: "node.resume",
  NODE_QUARANTINE: "node.quarantine",
  NODE_RESTART: "node.restart",
  NODE_CONNECTIONS_DROP: "node.connections.drop",
  NODE_TRAFFIC_RESET: "node.traffic.reset",
  CAPABILITIES_REPORT: "capabilities.report",
  CONFLICT_SCAN: "conflict.scan"
});

export const COMMAND_ACK_STATUSES = Object.freeze(["accepted", "rejected", "deferred"]);
export const COMMAND_RESULT_STATUSES = Object.freeze(["succeeded", "failed", "cancelled", "skipped"]);

const KNOWN_COMMAND_TYPES = Object.freeze(Object.values(COMMAND_TYPES));

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freezeArray(value) {
  return Object.freeze([...(value ?? [])]);
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function assertKnown(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function assertIsoDate(value, path, errors) {
  requireString(value, path, errors);
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO-compatible timestamp`);
  }
}

function assertLifecyclePayload(command, payload, errors) {
  if (command === COMMAND_TYPES.NODE_QUARANTINE) {
    requireString(payload.reason, "payload.reason", errors);
  }

  if (command === COMMAND_TYPES.NODE_RESUME &&
      payload.clearQuarantine !== undefined &&
      typeof payload.clearQuarantine !== "boolean") {
    errors.push("payload.clearQuarantine must be a boolean when provided");
  }
}

function immutablePayload(payload) {
  return Object.freeze({ ...(payload ?? {}) });
}

function inlineSecretOptions(command) {
  return Object.freeze({
    allowRuntimeCredentialPayloads: command === COMMAND_TYPES.OUTBOUND_APPLY
  });
}

export function validateCommandEnvelope(envelope) {
  const errors = [];

  if (!isPlainObject(envelope)) {
    return { ok: false, errors: ["command envelope must be an object"] };
  }

  if (envelope.modelVersion !== COMMAND_ENVELOPE_VERSION) {
    errors.push(`modelVersion must be ${COMMAND_ENVELOPE_VERSION}`);
  }

  requireString(envelope.id, "id", errors);
  requireString(envelope.nodeId, "nodeId", errors);
  requireString(envelope.idempotencyKey, "idempotencyKey", errors);
  assertKnown(envelope.command, KNOWN_COMMAND_TYPES, "command", errors);
  assertIsoDate(envelope.issuedAt, "issuedAt", errors);

  if (envelope.expiresAt !== null && envelope.expiresAt !== undefined) {
    assertIsoDate(envelope.expiresAt, "expiresAt", errors);
  }

  if (!Number.isInteger(envelope.sequence) || envelope.sequence < 0) {
    errors.push("sequence must be a non-negative integer");
  }

  if (!isPlainObject(envelope.payload)) {
    errors.push("payload must be an object");
  } else {
    assertLifecyclePayload(envelope.command, envelope.payload, errors);
  }

  try {
    assertNoInlineSecrets(envelope, inlineSecretOptions(envelope.command));
  } catch (error) {
    errors.push(error.message);
  }

  return Object.freeze({ ok: errors.length === 0, errors: freezeArray(errors) });
}

export function createCommandEnvelope(input = {}) {
  assertNoInlineSecrets(input, inlineSecretOptions(input.command));

  const envelope = Object.freeze({
    modelVersion: COMMAND_ENVELOPE_VERSION,
    id: input.id,
    nodeId: input.nodeId,
    command: input.command,
    idempotencyKey: input.idempotencyKey,
    sequence: input.sequence ?? 0,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt ?? null,
    payload: immutablePayload(input.payload),
    source: Object.freeze({
      actor: input.source?.actor ?? "control-plane",
      reason: input.source?.reason ?? null
    })
  });

  const result = validateCommandEnvelope(envelope);
  if (!result.ok) {
    throw new Error(`Invalid command envelope: ${result.errors.join("; ")}`);
  }

  return envelope;
}

export function createCommandAck(envelope, input = {}) {
  const envelopeResult = validateCommandEnvelope(envelope);
  if (!envelopeResult.ok) {
    throw new Error(`Invalid command envelope for ACK: ${envelopeResult.errors.join("; ")}`);
  }

  const errors = [];
  const status = input.status ?? "accepted";
  assertKnown(status, COMMAND_ACK_STATUSES, "status", errors);

  if (status !== "accepted") {
    requireString(input.reason, "reason", errors);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid command ACK: ${errors.join("; ")}`);
  }

  return Object.freeze({
    modelVersion: COMMAND_ACK_VERSION,
    commandId: envelope.id,
    nodeId: envelope.nodeId,
    command: envelope.command,
    status,
    accepted: status === "accepted",
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    reason: input.reason ?? null,
    currentMode: input.currentMode ?? null,
    retryAfter: input.retryAfter ?? null
  });
}

export function createCommandResult(envelope, input = {}) {
  const envelopeResult = validateCommandEnvelope(envelope);
  if (!envelopeResult.ok) {
    throw new Error(`Invalid command envelope for result: ${envelopeResult.errors.join("; ")}`);
  }

  const errors = [];
  assertKnown(input.status, COMMAND_RESULT_STATUSES, "status", errors);

  try {
    assertNoInlineSecrets(input.outputs ?? {});
  } catch (error) {
    errors.push(error.message);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid command result: ${errors.join("; ")}`);
  }

  return Object.freeze({
    modelVersion: COMMAND_RESULT_VERSION,
    commandId: envelope.id,
    nodeId: envelope.nodeId,
    command: envelope.command,
    status: input.status,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? new Date().toISOString(),
    outputs: Object.freeze({ ...(input.outputs ?? {}) }),
    conflicts: freezeArray(input.conflicts),
    error: input.error ?? null
  });
}
