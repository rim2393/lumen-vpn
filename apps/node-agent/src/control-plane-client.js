export const CONTROL_PLANE_CLIENT_VERSION = "lumen.node-agent.control-plane-client.v1";
export const NODE_API_STATUS = Object.freeze({
  ACTIVE: "active",
  INSTALLING: "installing",
  OFFLINE: "offline",
  FAILED: "failed",
  PAUSED: "paused",
  LICENSE_PAUSED: "license_paused",
  QUARANTINED: "quarantined"
});

function requireString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function normalizeBaseUrl(value) {
  requireString(value, "controlPlaneBaseUrl");
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error("controlPlaneBaseUrl must be a valid URL");
  }
}

function buildUrl(baseUrl, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

function ensureFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }
  return fetchImpl;
}

function asCapabilityStrings(capabilities = {}) {
  const result = {};
  for (const [key, value] of Object.entries(capabilities)) {
    requireString(key, "capability key");
    if (value === undefined || value === null) {
      continue;
    }
    result[key] = String(value);
  }
  return Object.freeze(result);
}

async function readJsonResponse(response, context) {
  const bodyText = await response.text();
  let body = null;
  if (bodyText.trim().length > 0) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`${context} returned invalid JSON`);
    }
  }

  if (!response.ok) {
    const code = body?.error?.code ?? body?.code ?? `http_${response.status}`;
    const message = body?.error?.message ?? body?.message ?? `${context} failed`;
    throw new Error(`${code}: ${message}`);
  }

  return body ?? {};
}

export function createInstallTokenExchangeRequest(input = {}) {
  requireString(input.installToken, "installToken");
  return Object.freeze({
    install_token: input.installToken
  });
}

export function redactInstallTokenExchangeResponse(response = {}) {
  return Object.freeze({
    clientVersion: CONTROL_PLANE_CLIENT_VERSION,
    provisioningJobId: response.provisioning_job_id,
    nodeId: response.node_id,
    nodeTokenPrefix: response.node_token_prefix,
    heartbeatPath: response.heartbeat_path,
    enrolled: Boolean(response.node_id && response.heartbeat_path)
  });
}

export async function exchangeInstallToken(input = {}) {
  const fetchImpl = ensureFetch(input.fetchImpl ?? globalThis.fetch);
  const url = buildUrl(input.controlPlaneBaseUrl, "/api/v1/nodes/install-token/exchange");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(createInstallTokenExchangeRequest(input))
  });
  return readJsonResponse(response, "install token exchange");
}

export function createHeartbeatRequestBody(input = {}) {
  return Object.freeze({
    status: input.status ?? NODE_API_STATUS.ACTIVE,
    capabilities: asCapabilityStrings(input.capabilities)
  });
}

export function createCommandResultRequestBody(input = {}) {
  requireString(input.status, "status");
  return Object.freeze({
    status: input.status,
    result_json: Object.freeze({ ...(input.resultJson ?? {}) }),
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null
  });
}

export function createNodeMetricRequestBody(input = {}) {
  requireString(input.metricKind, "metricKind");
  const valuesJson = {};
  for (const [key, value] of Object.entries(input.valuesJson ?? {})) {
    requireString(key, "metric key");
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`metric value ${key} must be a finite number`);
    }
    valuesJson[key] = value;
  }

  return Object.freeze({
    metric_kind: input.metricKind,
    values_json: Object.freeze(valuesJson),
    observed_at: input.observedAt ?? null
  });
}

export function redactNodeResponse(response = {}) {
  return Object.freeze({
    clientVersion: CONTROL_PLANE_CLIENT_VERSION,
    nodeId: response.id,
    name: response.name,
    status: response.status,
    lastSeenAt: response.last_seen_at ?? null,
    capabilities: Object.freeze({ ...(response.capabilities ?? {}) })
  });
}

export async function sendHeartbeat(input = {}) {
  requireString(input.nodeToken, "nodeToken");
  const nodeId = input.nodeId ?? input.config?.nodeId;
  requireString(nodeId, "nodeId");
  const fetchImpl = ensureFetch(input.fetchImpl ?? globalThis.fetch);
  const path = input.heartbeatPath ?? `/api/v1/nodes/${nodeId}/heartbeat`;
  const url = buildUrl(input.controlPlaneBaseUrl ?? input.config?.controlPlaneBaseUrl, path);
  const capabilities = input.capabilities ?? input.config?.capabilities ?? {};
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lumen-node-token": input.nodeToken
    },
    body: JSON.stringify(createHeartbeatRequestBody({
      status: input.status,
      capabilities
    }))
  });
  return readJsonResponse(response, "node heartbeat");
}

export async function fetchNextNodeCommand(input = {}) {
  requireString(input.nodeToken, "nodeToken");
  const nodeId = input.nodeId ?? input.config?.nodeId;
  requireString(nodeId, "nodeId");
  const fetchImpl = ensureFetch(input.fetchImpl ?? globalThis.fetch);
  const url = buildUrl(
    input.controlPlaneBaseUrl ?? input.config?.controlPlaneBaseUrl,
    `/api/v1/nodes/${nodeId}/commands/next`
  );
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      "x-lumen-node-token": input.nodeToken
    }
  });
  if (response.status === 204) {
    return null;
  }
  return readJsonResponse(response, "node command poll");
}

export async function completeNodeCommand(input = {}) {
  requireString(input.nodeToken, "nodeToken");
  requireString(input.commandId, "commandId");
  const nodeId = input.nodeId ?? input.config?.nodeId;
  requireString(nodeId, "nodeId");
  const fetchImpl = ensureFetch(input.fetchImpl ?? globalThis.fetch);
  const url = buildUrl(
    input.controlPlaneBaseUrl ?? input.config?.controlPlaneBaseUrl,
    `/api/v1/nodes/${nodeId}/commands/${input.commandId}/result`
  );
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lumen-node-token": input.nodeToken
    },
    body: JSON.stringify(createCommandResultRequestBody(input))
  });
  return readJsonResponse(response, "node command result");
}

export async function recordNodeMetric(input = {}) {
  requireString(input.nodeToken, "nodeToken");
  const nodeId = input.nodeId ?? input.config?.nodeId;
  requireString(nodeId, "nodeId");
  const fetchImpl = ensureFetch(input.fetchImpl ?? globalThis.fetch);
  const url = buildUrl(
    input.controlPlaneBaseUrl ?? input.config?.controlPlaneBaseUrl,
    `/api/v1/nodes/${nodeId}/metrics`
  );
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lumen-node-token": input.nodeToken
    },
    body: JSON.stringify(createNodeMetricRequestBody(input))
  });
  return readJsonResponse(response, "node metric record");
}
