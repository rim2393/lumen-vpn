import { createServer } from "node:net";

export const LIVE_LISTENER_MODEL_VERSION = "lumen.node-agent.live-listener.v1";
export const TCP_DIAGNOSTIC_LISTENER_KIND = "tcp-diagnostic.v1";

const activeListeners = new Map();
const activeTimers = new Map();

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requirePort(value, path, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer port between 1 and 65535`);
  }
}

function validateTcpDiagnosticListenerPlan(plan = {}) {
  const errors = [];
  if (plan.kind !== TCP_DIAGNOSTIC_LISTENER_KIND) {
    errors.push(`kind must be ${TCP_DIAGNOSTIC_LISTENER_KIND}`);
  }
  requireString(plan.id, "id", errors);
  requirePort(plan.port, "port", errors);
  if (!Number.isInteger(plan.ttlMs) || plan.ttlMs < 1_000 || plan.ttlMs > 3_600_000) {
    errors.push("ttlMs must be an integer between 1000 and 3600000");
  }
  if (plan.address !== undefined) {
    requireString(plan.address, "address", errors);
  }
  if (plan.banner !== undefined) {
    requireString(plan.banner, "banner", errors);
  }
  return { ok: errors.length === 0, errors };
}

export function createTcpDiagnosticListenerPlan(input = {}) {
  const plan = Object.freeze({
    modelVersion: LIVE_LISTENER_MODEL_VERSION,
    kind: TCP_DIAGNOSTIC_LISTENER_KIND,
    id: input.id,
    address: input.address ?? "0.0.0.0",
    port: input.port,
    banner: input.banner ?? "lumen-diagnostic\n",
    ttlMs: input.ttlMs ?? 300_000
  });
  const result = validateTcpDiagnosticListenerPlan(plan);
  if (!result.ok) {
    throw new Error(`Invalid live listener plan: ${result.errors.join("; ")}`);
  }
  return plan;
}

export async function startTcpDiagnosticListener(plan) {
  const normalized = createTcpDiagnosticListenerPlan(plan);
  await stopLiveListener(normalized.id);

  const server = createServer((socket) => {
    socket.write(normalized.banner);
    socket.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(normalized.port, normalized.address, () => {
      server.off("error", reject);
      resolve();
    });
  });

  activeListeners.set(normalized.id, server);
  const timer = setTimeout(() => {
    void stopLiveListener(normalized.id);
  }, normalized.ttlMs);
  timer.unref?.();
  activeTimers.set(normalized.id, timer);
  return Object.freeze({
    modelVersion: LIVE_LISTENER_MODEL_VERSION,
    kind: normalized.kind,
    id: normalized.id,
    address: normalized.address,
    port: normalized.port,
    ttlMs: normalized.ttlMs,
    status: "listening"
  });
}

export async function stopLiveListener(listenerId) {
  const timer = activeTimers.get(listenerId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(listenerId);
  }
  const server = activeListeners.get(listenerId);
  if (!server) {
    return Object.freeze({ id: listenerId, status: "not-found" });
  }
  activeListeners.delete(listenerId);
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  return Object.freeze({ id: listenerId, status: "stopped" });
}

export function listLiveListeners() {
  return Object.freeze([...activeListeners.keys()]);
}
