import test from "node:test";
import assert from "node:assert/strict";
import {
  completeNodeCommand,
  createCommandResultRequestBody,
  createHeartbeatRequestBody,
  createInstallTokenExchangeRequest,
  createNodeMetricRequestBody,
  exchangeInstallToken,
  fetchNextNodeCommand,
  recordNodeMetric,
  redactInstallTokenExchangeResponse,
  redactNodeResponse,
  sendHeartbeat
} from "../src/index.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

test("builds install token exchange body but redacts exchange output", async () => {
  const request = createInstallTokenExchangeRequest({ installToken: "install-secret" });

  assert.deepEqual(request, { install_token: "install-secret" });

  const response = redactInstallTokenExchangeResponse({
    provisioning_job_id: "job-1",
    node_id: "node-1",
    node_token_prefix: "lumen_node_prefix",
    node_token: "node-secret",
    heartbeat_path: "/api/v1/nodes/node-1/heartbeat"
  });

  assert.equal(response.nodeId, "node-1");
  assert.equal(response.nodeTokenPrefix, "lumen_node_prefix");
  assert.equal(JSON.stringify(response).includes("node-secret"), false);
});

test("exchanges install token against control plane endpoint", async () => {
  const calls = [];
  const response = await exchangeInstallToken({
    controlPlaneBaseUrl: "https://panel.example/",
    installToken: "install-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        provisioning_job_id: "job-1",
        node_id: "node-1",
        node_token_prefix: "prefix",
        node_token: "node-secret",
        heartbeat_path: "/api/v1/nodes/node-1/heartbeat"
      });
    }
  });

  assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/install-token/exchange");
  assert.equal(JSON.parse(calls[0].options.body).install_token, "install-secret");
  assert.equal(response.node_token, "node-secret");
});

test("builds heartbeat request body with string capabilities for backend schema", () => {
  const body = createHeartbeatRequestBody({
    capabilities: {
      "runtime.xray_core": true,
      "agent.version": "0.1.0",
      ignored: null
    }
  });

  assert.deepEqual(body, {
    status: "active",
    capabilities: {
      "runtime.xray_core": "true",
      "agent.version": "0.1.0"
    }
  });
});

test("sends heartbeat with node token header and redacts node response", async () => {
  const calls = [];
  const response = await sendHeartbeat({
    controlPlaneBaseUrl: "https://panel.example",
    nodeId: "node-1",
    nodeToken: "node-secret",
    capabilities: {
      "runtime.xray_core": true
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        id: "node-1",
        name: "ams-1",
        status: "active",
        last_seen_at: "2026-05-27T00:00:00Z",
        capabilities: { "runtime.xray_core": "true" }
      });
    }
  });

  assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/node-1/heartbeat");
  assert.equal(calls[0].options.headers["x-lumen-node-token"], "node-secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: "active",
    capabilities: { "runtime.xray_core": "true" }
  });

  const redacted = redactNodeResponse(response);
  assert.equal(redacted.nodeId, "node-1");
  assert.equal(JSON.stringify(redacted).includes("node-secret"), false);
});

test("polls next command and handles empty queue", async () => {
  const calls = [];
  const command = await fetchNextNodeCommand({
    controlPlaneBaseUrl: "https://panel.example",
    nodeId: "node-1",
    nodeToken: "node-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        id: "cmd-1",
        node_id: "node-1",
        command_type: "node.pause",
        status: "claimed",
        payload_json: { reason: "maintenance" }
      });
    }
  });

  assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/node-1/commands/next");
  assert.equal(calls[0].options.headers["x-lumen-node-token"], "node-secret");
  assert.equal(command.command_type, "node.pause");

  const empty = await fetchNextNodeCommand({
    controlPlaneBaseUrl: "https://panel.example",
    nodeId: "node-1",
    nodeToken: "node-secret",
    fetchImpl: async () => new Response(null, { status: 204 })
  });
  assert.equal(empty, null);
});

test("completes command result with backend schema", async () => {
  const body = createCommandResultRequestBody({
    status: "skipped",
    resultJson: { reason: "paused" },
    errorCode: "command_not_allowed",
    errorMessage: "node is paused"
  });

  assert.deepEqual(body, {
    status: "skipped",
    result_json: { reason: "paused" },
    error_code: "command_not_allowed",
    error_message: "node is paused"
  });

  const calls = [];
  const response = await completeNodeCommand({
    controlPlaneBaseUrl: "https://panel.example",
    nodeId: "node-1",
    commandId: "cmd-1",
    nodeToken: "node-secret",
    status: "succeeded",
    resultJson: { applied: true },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        id: "cmd-1",
        node_id: "node-1",
        command_type: "node.resume",
        status: "succeeded",
        payload_json: {},
        result_json: { applied: true }
      });
    }
  });

  assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/node-1/commands/cmd-1/result");
  assert.equal(calls[0].options.headers["x-lumen-node-token"], "node-secret");
  assert.equal(JSON.parse(calls[0].options.body).result_json.applied, true);
  assert.equal(response.status, "succeeded");
});

test("records numeric node metrics", async () => {
  const body = createNodeMetricRequestBody({
    metricKind: "runtime",
    valuesJson: { state_revision: 2, command_polled: 1 },
    observedAt: "2026-05-27T00:00:00.000Z"
  });

  assert.deepEqual(body, {
    metric_kind: "runtime",
    values_json: { state_revision: 2, command_polled: 1 },
    observed_at: "2026-05-27T00:00:00.000Z"
  });
  assert.throws(
    () => createNodeMetricRequestBody({ metricKind: "runtime", valuesJson: { bad: Number.NaN } }),
    /metric value bad/
  );

  const calls = [];
  const response = await recordNodeMetric({
    controlPlaneBaseUrl: "https://panel.example",
    nodeId: "node-1",
    nodeToken: "node-secret",
    metricKind: "runtime",
    valuesJson: { command_polled: 0 },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        id: "metric-1",
        node_id: "node-1",
        metric_kind: "runtime",
        values_json: { command_polled: 0 }
      });
    }
  });

  assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/node-1/metrics");
  assert.equal(JSON.parse(calls[0].options.body).metric_kind, "runtime");
  assert.equal(response.metric_kind, "runtime");
});
