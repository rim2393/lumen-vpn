import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMAND_TYPES,
  NODE_PROVISIONING_MODES,
  applyNodeCommand,
  createProvisioningState,
  runNodeAgentOnce,
  stopLiveListener
} from "../src/index.js";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function freeTcpPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function readTcpBanner(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let data = "";
    socket.setTimeout(1_000);
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(data));
    socket.on("timeout", () => {
      socket.destroy(new Error("tcp banner timeout"));
    });
    socket.on("error", reject);
  });
}

test("run once exchanges install token, persists node token, and sends heartbeat", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const secretDir = mkdtempSync(join(tmpdir(), "lumen-agent-secrets-"));
  try {
    const installTokenFile = join(secretDir, "install-token");
    writeFileSync(installTokenFile, "install-secret\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_INSTALL_TOKEN_FILE: installTokenFile,
        LUMEN_NODE_NAME: "diagnostic-node-01",
        LUMEN_STATE_DIR: stateDir
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/install-token/exchange")) {
          return jsonResponse({
            provisioning_job_id: "job-1",
            node_id: "node-1",
            node_token: "node-secret",
            node_token_prefix: "lumen_node_abc",
            heartbeat_path: "/api/v1/nodes/node-1/heartbeat"
          });
        }
        if (url.endsWith("/heartbeat")) {
          return jsonResponse({
            id: "node-1",
            name: "node-1",
            status: "active",
            last_seen_at: "2026-05-27T00:00:00Z",
            capabilities: {}
          });
        }
        if (url.endsWith("/commands/next")) {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          id: "metric-1",
          node_id: "node-1",
          metric_kind: "runtime",
          values_json: { command_polled: 0 }
        });
      }
    });

    assert.equal(calls.length, 4);
    assert.equal(JSON.parse(calls[0].options.body).install_token, "install-secret");
    assert.equal(calls[1].options.headers["x-lumen-node-token"], "node-secret");
    assert.equal(calls[2].url, "https://panel.example/api/v1/nodes/node-1/commands/next");
    assert.equal(calls[3].url, "https://panel.example/api/v1/nodes/node-1/metrics");
    assert.equal(readFileSync(join(stateDir, "node-id"), "utf8").trim(), "node-1");
    assert.equal(result.exchange.nodeTokenPrefix, "lumen_node_abc");
    assert.equal(result.command, null);
    assert.equal(result.metric.metricKind, "runtime");
    assert.equal(JSON.stringify(result).includes("node-secret"), false);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(secretDir, { recursive: true, force: true });
  }
});

test("run once reuses persisted node token without exchanging install token again", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-2/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "diagnostic-node-01",
        LUMEN_STATE_DIR: stateDir
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/heartbeat")) {
          return jsonResponse({
            id: "node-2",
            name: "node-2",
            status: "active",
            last_seen_at: "2026-05-27T00:00:00Z",
            capabilities: {}
          });
        }
        if (url.endsWith("/commands/next")) {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          id: "metric-1",
          node_id: "node-2",
          metric_kind: "runtime",
          values_json: { command_polled: 0 }
        });
      }
    });

    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://panel.example/api/v1/nodes/node-2/heartbeat");
    assert.equal(calls[1].url, "https://panel.example/api/v1/nodes/node-2/commands/next");
    assert.equal(calls[2].url, "https://panel.example/api/v1/nodes/node-2/metrics");
    assert.equal(calls[0].options.headers["x-lumen-node-token"], "persisted-node-token");
    assert.equal(readFileSync(join(stateDir, "node-id"), "utf8").trim(), "node-2");
    assert.equal(result.reusedExistingToken, true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("apply command pauses node and skips mutating command while paused", () => {
  const active = createProvisioningState({
    nodeId: "node-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });
  const pausedResult = applyNodeCommand(
    {
      id: "cmd-pause-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.NODE_PAUSE,
      created_at: "2026-05-27T00:01:00.000Z",
      payload_json: { reason: "license expired" }
    },
    active,
    {
      startedAt: "2026-05-27T00:01:01.000Z",
      finishedAt: "2026-05-27T00:01:02.000Z"
    }
  );

  assert.equal(pausedResult.status, "succeeded");
  assert.equal(pausedResult.state.mode, NODE_PROVISIONING_MODES.PAUSED);
  assert.equal(pausedResult.resultJson.outputs.reason, "license expired");

  const skippedResult = applyNodeCommand(
    {
      id: "cmd-outbound-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.OUTBOUND_APPLY,
      created_at: "2026-05-27T00:02:00.000Z",
      payload_json: { outboundId: "outbound-1", credentialsRef: "vault://nodes/node-1/outbound-1" }
    },
    pausedResult.state,
    {
      startedAt: "2026-05-27T00:02:01.000Z",
      finishedAt: "2026-05-27T00:02:02.000Z"
    }
  );

  assert.equal(skippedResult.status, "skipped");
  assert.equal(skippedResult.state.mode, NODE_PROVISIONING_MODES.PAUSED);
  assert.match(skippedResult.errorMessage, /paused/);
});

test("apply command persists license pause mode and reports it in heartbeat", async () => {
  const active = createProvisioningState({
    nodeId: "node-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });
  const pausedResult = applyNodeCommand(
    {
      id: "cmd-pause-license-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.NODE_PAUSE,
      created_at: "2026-05-27T00:01:00.000Z",
      payload_json: {
        license_enforced: true,
        reason: "license expired",
        status: "license_paused"
      }
    },
    active,
    {
      startedAt: "2026-05-27T00:01:01.000Z",
      finishedAt: "2026-05-27T00:01:02.000Z"
    }
  );

  assert.equal(pausedResult.status, "succeeded");
  assert.equal(pausedResult.state.mode, NODE_PROVISIONING_MODES.LICENSE_PAUSED);

  const skippedResult = applyNodeCommand(
    {
      id: "cmd-outbound-license-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.OUTBOUND_APPLY,
      created_at: "2026-05-27T00:02:00.000Z",
      payload_json: { outboundId: "outbound-1", credentialsRef: "vault://nodes/node-1/outbound-1" }
    },
    pausedResult.state,
    {
      startedAt: "2026-05-27T00:02:01.000Z",
      finishedAt: "2026-05-27T00:02:02.000Z"
    }
  );

  assert.equal(skippedResult.status, "skipped");
  assert.match(skippedResult.errorMessage, /license-paused/);

  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    writeFileSync(
      join(stateDir, "provisioning-state.json"),
      `${JSON.stringify(pausedResult.state, null, 2)}\n`,
      { mode: 0o600 }
    );
    const calls = [];

    await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/heartbeat")) {
          return jsonResponse({
            id: "node-1",
            name: "node-1",
            status: "license_paused",
            last_seen_at: "2026-05-27T00:00:00Z",
            capabilities: {}
          });
        }
        if (url.endsWith("/commands/next")) {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          id: "metric-1",
          node_id: "node-1",
          metric_kind: "runtime",
          values_json: JSON.parse(options.body).values_json
        });
      }
    });

    assert.equal(JSON.parse(calls[0].options.body).status, "license_paused");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("run once polls command, completes it, persists state, and records metric", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/heartbeat")) {
          return jsonResponse({
            id: "node-1",
            name: "node-1",
            status: "active",
            last_seen_at: "2026-05-27T00:00:00Z",
            capabilities: {}
          });
        }
        if (url.endsWith("/commands/next")) {
          return jsonResponse({
            id: "cmd-pause-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.NODE_PAUSE,
            status: "claimed",
            payload_json: { reason: "license expired" },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-pause-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.NODE_PAUSE,
            status: JSON.parse(options.body).status,
            payload_json: { reason: "license expired" },
            result_json: JSON.parse(options.body).result_json
          });
        }
        return jsonResponse({
          id: "metric-1",
          node_id: "node-1",
          metric_kind: "runtime",
          values_json: JSON.parse(options.body).values_json
        });
      }
    });

    assert.equal(calls.length, 4);
    assert.equal(calls[1].url, "https://panel.example/api/v1/nodes/node-1/commands/next");
    assert.equal(calls[2].url, "https://panel.example/api/v1/nodes/node-1/commands/cmd-pause-1/result");
    assert.equal(JSON.parse(calls[2].options.body).status, "succeeded");
    assert.equal(JSON.parse(calls[3].options.body).values_json.command_completed, 1);
    assert.equal(result.command.status, "succeeded");

    const persisted = JSON.parse(readFileSync(join(stateDir, "provisioning-state.json"), "utf8"));
    assert.equal(persisted.mode, NODE_PROVISIONING_MODES.PAUSED);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("run once can start a gated live tcp diagnostic listener from outbound apply", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const port = await freeTcpPort();
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "diagnostic-node-01",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_ENABLE_LIVE_DIAGNOSTIC: "true"
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/heartbeat")) {
          return jsonResponse({
            id: "node-1",
            name: "node-1",
            status: "active",
            last_seen_at: "2026-05-27T00:00:00Z",
            capabilities: {}
          });
        }
        if (url.endsWith("/commands/next")) {
          return jsonResponse({
            id: "cmd-outbound-live-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              outboundId: "live-diagnostic-1",
              adapter: "tcp-diagnostic-listener",
              bind: { address: "127.0.0.1", port, protocol: "tcp" },
              liveListener: {
                id: "live-diagnostic-1",
                address: "127.0.0.1",
                port,
                banner: "lumen-live-ok\n",
                ttlMs: 60_000
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-outbound-live-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: JSON.parse(options.body).status,
            payload_json: {},
            result_json: JSON.parse(options.body).result_json
          });
        }
        return jsonResponse({
          id: "metric-1",
          node_id: "node-1",
          metric_kind: "runtime",
          values_json: JSON.parse(options.body).values_json
        });
      }
    });

    assert.equal(result.command.status, "succeeded");
    assert.equal(JSON.parse(calls[2].options.body).result_json.outputs.implementationStatus, "live-listener-active");
    assert.equal(await readTcpBanner(port), "lumen-live-ok\n");
  } finally {
    await stopLiveListener("live-diagnostic-1");
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("outbound apply fails when no live runtime backend exists", () => {
  const active = createProvisioningState({
    nodeId: "node-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });

  const result = applyNodeCommand(
    {
      id: "cmd-outbound-non-live-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.OUTBOUND_APPLY,
      created_at: "2026-05-27T00:02:00.000Z",
      payload_json: { outboundId: "outbound-1", adapter: "vless-reality" }
    },
    active,
    {
      startedAt: "2026-05-27T00:02:01.000Z",
      finishedAt: "2026-05-27T00:02:02.000Z"
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "command_apply_failed");
  assert.match(result.errorMessage, /no live runtime backend/);
});
