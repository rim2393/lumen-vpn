import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMAND_TYPES,
  NODE_PROVISIONING_MODES,
  applyNodeCommand,
  createConnectionDropPlan,
  createProvisioningState,
  dropConnections,
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

test("apply command plans real connection drop by client IP", () => {
  const active = createProvisioningState({
    nodeId: "node-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });
  const result = applyNodeCommand(
    {
      id: "cmd-drop-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.NODE_CONNECTIONS_DROP,
      created_at: "2026-05-27T00:01:00.000Z",
      payload_json: {
        ip: "203.0.113.44",
        reason: "operator requested",
        subscription_id: "sub-1",
        user_id: "user-1"
      }
    },
    active,
    {
      startedAt: "2026-05-27T00:01:01.000Z",
      finishedAt: "2026-05-27T00:01:02.000Z"
    }
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.resultJson.outputs.implementationStatus, "connection-drop-pending");
  assert.equal(result.resultJson.outputs.ip, "203.0.113.44");
  assert.equal(result.runtimeAction.type, "node-connections.drop");
  assert.equal(result.runtimeAction.plan.commands.includes("ss -K dst 203.0.113.44"), true);
});

test("connection drop runtime executes available Linux drop tools", async () => {
  const calls = [];
  const result = await dropConnections(createConnectionDropPlan({ ip: "203.0.113.44" }), {
    dryRun: false,
    execFileImpl: async (command, args) => {
      calls.push([command, ...args].join(" "));
      if (command === "conntrack") {
        return { stdout: "0 flow entries have been deleted", stderr: "" };
      }
      const error = new Error("ss unavailable");
      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(result.implementationStatus, "connection-drop-attempted");
  assert.equal(result.dryRun, false);
  assert.equal(calls.includes("conntrack -D -s 203.0.113.44"), true);
  assert.equal(calls.includes("ss -K dst 203.0.113.44"), true);
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

test("run once applies managed sing-box Shadowsocks config from outbound apply", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const configPath = join(stateDir, "runtime", "shadowsocks", "config.json");
  const logPath = join(stateDir, "runtime", "shadowsocks", "sing-box.log");
  const pidFile = join(stateDir, "runtime", "shadowsocks", "sing-box.pid");
  const execCalls = [];
  const spawned = [];
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_SHADOWSOCKS_CONFIG_FILE: configPath,
        LUMEN_SHADOWSOCKS_LOG_FILE: logPath,
        LUMEN_SHADOWSOCKS_PID_FILE: pidFile,
        LUMEN_SHADOWSOCKS_RELOAD_MODE: "process"
      },
      execFileImpl: async (command, args) => {
        execCalls.push([command, args]);
        if (command === "obfs-server") {
          const error = new Error("obfs-server help exits with status 1");
          error.stdout = "\nsimple-obfs 0.0.5\n";
          error.stderr = "";
          throw error;
        }
        return { stdout: "", stderr: "" };
      },
      spawnImpl: (command, args) => {
        spawned.push([command, args]);
        return {
          pid: 4242,
          unref() {}
        };
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
            id: "cmd-ss-2022",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              adapter: "shadowsocks-2022",
              profileId: "profile-ss-2022",
              singBoxShadowsocksConfig: {
                listen: "::",
                listen_port: 18473,
                network: "tcp",
                method: "2022-blake3-aes-128-gcm",
                password: "2022-base64-key"
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-ss-2022",
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
    assert.deepEqual(execCalls[0], ["sing-box", ["check", "-c", configPath]]);
    assert.deepEqual(spawned[0], ["sing-box", ["run", "-c", configPath]]);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.inbounds[0].type, "shadowsocks");
    assert.equal(config.inbounds[0].listen_port, 18473);
    assert.equal(config.inbounds[0].method, "2022-blake3-aes-128-gcm");
    assert.equal(config.inbounds[0].password, "2022-base64-key");
    const resultBody = JSON.parse(calls.find((call) => call.url.endsWith("/result")).options.body);
    assert.equal(resultBody.result_json.outputs.implementationStatus, "shadowsocks-managed-process-started");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("run once applies managed Shadowsocks v2ray-plugin config from outbound apply", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const configPath = join(stateDir, "runtime", "shadowsocks-plugin", "config.json");
  const logPath = join(stateDir, "runtime", "shadowsocks-plugin", "ssserver.log");
  const pidFile = join(stateDir, "runtime", "shadowsocks-plugin", "ssserver.pid");
  const execCalls = [];
  const spawned = [];
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_SHADOWSOCKS_PLUGIN_CONFIG_FILE: configPath,
        LUMEN_SHADOWSOCKS_PLUGIN_LOG_FILE: logPath,
        LUMEN_SHADOWSOCKS_PLUGIN_PID_FILE: pidFile,
        LUMEN_SHADOWSOCKS_PLUGIN_RELOAD_MODE: "process"
      },
      execFileImpl: async (command, args) => {
        execCalls.push([command, args]);
        return { stdout: "ssserver 1.24.0", stderr: "" };
      },
      spawnImpl: (command, args) => {
        spawned.push([command, args]);
        return {
          pid: 4343,
          unref() {}
        };
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
            id: "cmd-ss-plugin",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              adapter: "shadowsocks-v2ray-plugin",
              profileId: "profile-ss-plugin",
              shadowsocksPluginConfig: {
                listen: "::",
                listen_port: 18474,
                network: "tcp",
                method: "aes-256-gcm",
                password: "ss-plugin-password",
                plugin: "v2ray-plugin",
                plugin_opts: "server;path=/ss;host=cdn.example"
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-ss-plugin",
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
    assert.deepEqual(execCalls, [
      ["ssserver", ["--version"]],
      ["v2ray-plugin", ["--version"]]
    ]);
    assert.deepEqual(spawned[0], ["ssserver", ["-c", configPath]]);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.server_port, 18474);
    assert.equal(config.method, "aes-256-gcm");
    assert.equal(config.password, "ss-plugin-password");
    assert.equal(config.plugin, "v2ray-plugin");
    assert.equal(config.plugin_opts, "server;path=/ss;host=cdn.example");
    const resultBody = JSON.parse(calls.find((call) => call.url.endsWith("/result")).options.body);
    assert.equal(resultBody.result_json.outputs.implementationStatus, "shadowsocks-plugin-managed-process-started");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("run once applies managed OpenVPN-over-Shadowsocks config from outbound apply", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const configPath = join(stateDir, "runtime", "openvpn-shadowsocks", "config.json");
  const logPath = join(stateDir, "runtime", "openvpn-shadowsocks", "ssserver.log");
  const pidFile = join(stateDir, "runtime", "openvpn-shadowsocks", "ssserver.pid");
  const execCalls = [];
  const spawned = [];
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_OPENVPN_SHADOWSOCKS_CONFIG_FILE: configPath,
        LUMEN_OPENVPN_SHADOWSOCKS_LOG_FILE: logPath,
        LUMEN_OPENVPN_SHADOWSOCKS_PID_FILE: pidFile
      },
      execFileImpl: async (command, args) => {
        execCalls.push([command, args]);
        return { stdout: "", stderr: "" };
      },
      spawnImpl: (command, args) => {
        spawned.push([command, args]);
        return {
          pid: 5242 + spawned.length,
          unref() {}
        };
      },
      isPidRunningImpl: () => true,
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
            id: "cmd-openvpn-ss",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              adapter: "openvpn-shadowsocks",
              profileId: "profile-openvpn-ss",
              openvpnShadowsocksConfig: {
                openvpn: {
                  listen_port: 24194,
                  proto: "tcp-server",
                  local_address: "127.0.0.1",
                  network: "10.89.0.0/24",
                  pki: {
                    ca_cert: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
                    server_cert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
                    server_key: "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----"
                  },
                  users: [{ username: "lumen_sub_live", password: "openvpn-pass" }]
                },
                shadowsocks: {
                  listen: "0.0.0.0",
                  listen_port: 28443,
                  method: "aes-256-gcm",
                  password: "ss-pass"
                }
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-openvpn-ss",
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
    assert.deepEqual(spawned.map(([command]) => command), ["openvpn", "ssserver"]);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.server_port, 28443);
    assert.equal(config.method, "aes-256-gcm");
    const resultBody = JSON.parse(calls.find((call) => call.url.endsWith("/result")).options.body);
    assert.equal(
      resultBody.result_json.outputs.implementationStatus,
      "openvpn-shadowsocks-managed-process-started"
    );
    assert.equal(execCalls[0][0], "openvpn");
    assert.equal(execCalls.at(-1)[0], "ssserver");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("run once applies managed Shadowsocks simple-obfs config from outbound apply", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const configPath = join(stateDir, "runtime", "shadowsocks-obfs", "config.json");
  const logPath = join(stateDir, "runtime", "shadowsocks-obfs", "ssserver.log");
  const pidFile = join(stateDir, "runtime", "shadowsocks-obfs", "ssserver.pid");
  const execCalls = [];
  const spawned = [];
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_SHADOWSOCKS_PLUGIN_CONFIG_FILE: configPath,
        LUMEN_SHADOWSOCKS_PLUGIN_LOG_FILE: logPath,
        LUMEN_SHADOWSOCKS_PLUGIN_PID_FILE: pidFile,
        LUMEN_SHADOWSOCKS_PLUGIN_RELOAD_MODE: "process"
      },
      execFileImpl: async (command, args) => {
        execCalls.push([command, args]);
        return { stdout: "", stderr: "" };
      },
      spawnImpl: (command, args) => {
        spawned.push([command, args]);
        return {
          pid: 4444,
          unref() {}
        };
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
            id: "cmd-ss-obfs",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              adapter: "shadowsocks-obfs",
              profileId: "profile-ss-obfs",
              shadowsocksPluginConfig: {
                listen: "::",
                listen_port: 18475,
                network: "tcp",
                method: "aes-256-gcm",
                password: "ss-obfs-password",
                plugin: "obfs-server",
                plugin_opts: "obfs=http;obfs-host=cdn.example"
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-ss-obfs",
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
    assert.deepEqual(execCalls, [
      ["ssserver", ["--version"]],
      ["obfs-server", ["-h"]]
    ]);
    assert.deepEqual(spawned[0], ["ssserver", ["-c", configPath]]);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.server_port, 18475);
    assert.equal(config.method, "aes-256-gcm");
    assert.equal(config.password, "ss-obfs-password");
    assert.equal(config.plugin, "obfs-server");
    assert.equal(config.plugin_opts, "obfs=http;obfs-host=cdn.example");
    const resultBody = JSON.parse(calls.find((call) => call.url.endsWith("/result")).options.body);
    assert.equal(resultBody.result_json.outputs.implementationStatus, "shadowsocks-plugin-managed-process-started");
  } finally {
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

test("run once applies Xray config only after writing, testing, and reload", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const xrayDir = mkdtempSync(join(tmpdir(), "lumen-xray-"));
  const xrayConfigPath = join(xrayDir, "config.json");
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];
    const execCalls = [];

    const xrayConfig = {
      log: { loglevel: "warning" },
      inbounds: [
        {
          tag: "VLESS_REALITY",
          listen: "0.0.0.0",
          port: 18443,
          protocol: "vless",
          settings: { clients: [{ id: "7f3d9e04-3e76-46a6-9f63-ef45a3129c20" }] },
          streamSettings: {
            network: "tcp",
            security: "reality",
            realitySettings: {
              privateKey: "server-private-key",
              serverNames: ["reality.example.test"],
              shortIds: ["abcd"]
            }
          }
        }
      ],
      outbounds: [{ protocol: "freedom", tag: "direct" }]
    };

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_XRAY_CONFIG_FILE: xrayConfigPath,
        LUMEN_XRAY_BINARY: "xray-test-bin",
        LUMEN_XRAY_RELOAD_ARGV: JSON.stringify(["systemctl", "reload", "xray"])
      },
      execFileImpl: async (command, args) => {
        execCalls.push({ command, args });
        return { stdout: "", stderr: "" };
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
            id: "cmd-xray-apply-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              profileId: "profile-1",
              adapter: "vless-reality",
              xrayConfig
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-xray-apply-1",
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
    assert.deepEqual(execCalls, [
      { command: "xray-test-bin", args: ["-test", "-config", xrayConfigPath] },
      { command: "systemctl", args: ["reload", "xray"] }
    ]);
    const written = JSON.parse(readFileSync(xrayConfigPath, "utf8"));
    assert.equal(written.inbounds[0].tag, "VLESS_REALITY");
    const resultBody = JSON.parse(calls[2].options.body);
    assert.equal(resultBody.result_json.outputs.implementationStatus, "xray-applied");
    assert.equal(resultBody.result_json.outputs.configPath, xrayConfigPath);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(xrayDir, { recursive: true, force: true });
  }
});

test("xray apply fails when config still contains unresolved refs", () => {
  const active = createProvisioningState({
    nodeId: "node-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });

  const result = applyNodeCommand(
    {
      id: "cmd-xray-invalid-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.OUTBOUND_APPLY,
      created_at: "2026-05-27T00:02:00.000Z",
      payload_json: {
        adapter: "vless-reality",
        xrayConfig: {
          inbounds: [
            {
              tag: "BROKEN",
              port: 18443,
              protocol: "vless",
              settings: { clientsRef: "vault://protocols/unresolved" }
            }
          ]
        }
      }
    },
    active,
    {
      startedAt: "2026-05-27T00:02:01.000Z",
      finishedAt: "2026-05-27T00:02:02.000Z"
    }
  );

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage, /unresolved refs/);
});

test("outbound apply dispatches NaiveProxy config to managed sing-box runtime", () => {
  const active = createProvisioningState({
    nodeId: "node-1",
    updatedAt: "2026-05-27T00:00:00.000Z"
  });

  const result = applyNodeCommand(
    {
      id: "cmd-naive-apply-1",
      node_id: "node-1",
      command_type: COMMAND_TYPES.OUTBOUND_APPLY,
      created_at: "2026-05-27T00:02:00.000Z",
      payload_json: {
        adapter: "naiveproxy",
        naiveConfig: {
          listen: ":18476",
          users: [{ username: "lumen_sub_live", password: "naive-live-password" }],
          tls: {
            cert: "/var/lib/lumen-node/runtime/tls/live.crt",
            key: "/var/lib/lumen-node/runtime/tls/live.key"
          }
        }
      }
    },
    active,
    {
      startedAt: "2026-05-27T00:02:01.000Z",
      finishedAt: "2026-05-27T00:02:02.000Z"
    }
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.runtimeAction.type, "naive.apply");
  assert.equal(result.resultJson.outputs.implementationStatus, "naive-apply-pending");
});

test("run once applies node policy artifact from outbound apply", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-state-"));
  const xrayDir = mkdtempSync(join(tmpdir(), "lumen-xray-"));
  const policyDir = mkdtempSync(join(tmpdir(), "lumen-policy-"));
  const xrayConfigPath = join(xrayDir, "config.json");
  const policyPath = join(policyDir, "profile-1.json");
  const execCalls = [];
  const calls = [];
  const xrayConfig = {
    inbounds: [
      {
        tag: "VLESS_REALITY",
        port: 18443,
        protocol: "vless",
        settings: { clients: [{ id: "client-1" }] },
        streamSettings: { network: "tcp", security: "none" }
      }
    ],
    outbounds: [{ tag: "direct", protocol: "freedom" }]
  };

  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_XRAY_CONFIG_FILE: xrayConfigPath,
        LUMEN_XRAY_BINARY: "xray-test-bin",
        LUMEN_XRAY_RELOAD_ARGV: JSON.stringify(["systemctl", "reload", "xray"])
      },
      execFileImpl: async (command, args) => {
        execCalls.push({ command, args });
        return { stdout: "", stderr: "" };
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
            id: "cmd-policy-apply-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              profileId: "profile-1",
              adapter: "vless-reality",
              xrayConfig,
              nodePolicyPath: policyPath,
              nodePolicy: {
                modelVersion: "lumen.node-policy.v1",
                ipControl: {
                  ruleId: "rule-1",
                  scope: "global",
                  targetId: null,
                  maxActiveIps: 2,
                  action: "block"
                },
                plugins: [
                  {
                    id: "plugin-1",
                    nodeId: null,
                    kind: "torrent-blocker",
                    name: "Fleet torrent blocker",
                    config: { mode: "block" },
                    enabled: true
                  }
                ]
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-policy-apply-1",
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
    assert.deepEqual(execCalls, [
      { command: "xray-test-bin", args: ["-test", "-config", xrayConfigPath] },
      { command: "systemctl", args: ["reload", "xray"] }
    ]);
    const writtenPolicy = JSON.parse(readFileSync(policyPath, "utf8"));
    assert.equal(writtenPolicy.plugins[0].kind, "torrent-blocker");
    assert.equal(writtenPolicy.ipControl.maxActiveIps, 2);
    const resultBody = JSON.parse(calls[2].options.body);
    assert.equal(
      resultBody.result_json.outputs.nodePolicy.implementationStatus,
      "node-policy-applied"
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(xrayDir, { recursive: true, force: true });
    rmSync(policyDir, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "wireguard-native",
    adapter: "wireguard-native",
    reloadMode: undefined,
    configPatch: {},
    expectedCalls(configPath) {
      return [
        ["wg-quick", ["down", configPath]],
        ["wg-quick", ["up", configPath]],
        ["wg", ["show", "lumen-wg"]]
      ];
    }
  },
  {
    name: "wireguard-amneziawg",
    adapter: "wireguard-amneziawg",
    reloadMode: "awg-quick",
    configPatch: { Jc: 4, S1: 60 },
    expectedCalls(configPath) {
      return [
        ["awg-quick", ["down", configPath]],
        ["awg-quick", ["up", configPath]],
        ["awg", ["show", "lumen-wg"]]
      ];
    }
  }
]) {
  test(`run once applies ${scenario.name} outbound.apply via wireguard runtime`, async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
    const wgDir = mkdtempSync(join(tmpdir(), "lumen-wg-"));
    const configPath = join(wgDir, "lumen-wg.conf");
    const execCalls = [];
    const calls = [];
    const wireguardConfig = {
      interface: {
        private_key: "server-private-key",
        address: "10.66.0.1/24",
        listen_port: 51820,
        ...scenario.configPatch
      },
      peers: [
        {
          public_key: "client-public-key",
          allowed_ips: "10.66.0.2/32",
          persistent_keepalive: 25
        }
      ]
    };

    try {
      writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
      writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
      const result = await runNodeAgentOnce({
        env: {
          LUMEN_CONTROL_PLANE_URL: "https://panel.example",
          LUMEN_NODE_NAME: "node-1",
          LUMEN_STATE_DIR: stateDir,
          LUMEN_DRY_RUN: "false"
        },
        execFileImpl: async (command, args) => {
          execCalls.push([command, args]);
          return { stdout: "", stderr: "" };
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
              id: `cmd-${scenario.name}-apply-1`,
              node_id: "node-1",
              command_type: COMMAND_TYPES.OUTBOUND_APPLY,
              status: "claimed",
              payload_json: {
                profileId: "profile-1",
                adapter: scenario.adapter,
                wireguardConfig,
                wireguardConfigPath: configPath,
                ...(scenario.reloadMode ? { wireguardReloadMode: scenario.reloadMode } : {})
              },
              created_at: "2026-05-27T00:01:00.000Z"
            });
          }
          if (url.endsWith("/result")) {
            return jsonResponse({
              id: `cmd-${scenario.name}-apply-1`,
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
      assert.deepEqual(execCalls, scenario.expectedCalls(configPath));
      const written = readFileSync(configPath, "utf8");
      assert.match(written, /\[Interface]/);
      assert.match(written, /PrivateKey = server-private-key/);
      assert.match(written, /\[Peer]/);
      const resultBody = JSON.parse(calls[2].options.body);
      assert.equal(resultBody.result_json.outputs.implementationStatus, "wireguard-applied");
      assert.equal(
        resultBody.result_json.outputs.reloadMode,
        scenario.reloadMode ?? "wg-quick"
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(wgDir, { recursive: true, force: true });
    }
  });
}

test("run once applies ikev2-eap outbound.apply via strongSwan runtime", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const swanctlDir = mkdtempSync(join(tmpdir(), "lumen-swanctl-"));
  const viciSocket = join(stateDir, "charon.vici");
  const execCalls = [];
  const calls = [];
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "node-1",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_IKEV2_VICI_SOCKET: viciSocket,
        LUMEN_IKEV2_VICI_WAIT_MS: "500"
      },
      execFileImpl: async (command, args) => {
        execCalls.push([command, args]);
        if (command === "ipsec" && args[0] === "start") {
          mkdirSync(stateDir, { recursive: true });
          writeFileSync(viciSocket, "");
        }
        return { stdout: "", stderr: "" };
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
            id: "cmd-ikev2-apply-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.OUTBOUND_APPLY,
            status: "claimed",
            payload_json: {
              profileId: "profile-ikev2",
              adapter: "ikev2-eap",
              ikev2ConfigDir: swanctlDir,
              ikev2RuntimeDir: join(stateDir, "runtime", "ikev2"),
              ikev2Config: {
                ike_port: 500,
                nat_port: 4500,
                server_id: "vpn.example.test",
                pool: "10.92.0.0/24",
                pki: {
                  ca_cert: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
                  server_cert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
                  server_key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----"
                },
                users: [{ username: "lumen_sub_live", password: "ikev2-password" }]
              }
            },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-ikev2-apply-1",
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
    assert.deepEqual(execCalls.map(([command, args]) => [command, args[0]]), [
      ["sh", "-c"],
      ["ipsec", "stop"],
      ["ipsec", "start"],
      ["swanctl", "--load-all"],
      ["swanctl", "--list-conns"]
    ]);
    const written = readFileSync(join(swanctlDir, "swanctl.conf"), "utf8");
    assert.match(written, /auth = eap-mschapv2/);
    assert.match(written, /lumen_sub_live/);
    const resultBody = JSON.parse(calls[2].options.body);
    assert.equal(resultBody.result_json.outputs.implementationStatus, "ikev2-applied");
    assert.equal(resultBody.result_json.outputs.userCount, 1);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(swanctlDir, { recursive: true, force: true });
  }
});

test("run once executes node restart as a deferred container restart", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const scheduled = [];
  const exitCalls = [];
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "restart-node-01",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false"
      },
      setTimeoutImpl: (callback, delayMs) => {
        scheduled.push({ callback, delayMs, unrefCalled: false });
        return {
          unref() {
            scheduled[scheduled.length - 1].unrefCalled = true;
          }
        };
      },
      processExitImpl: (code) => {
        exitCalls.push(code);
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
            id: "cmd-restart-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.NODE_RESTART,
            status: "claimed",
            payload_json: { reason: "operator requested restart" },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-restart-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.NODE_RESTART,
            status: JSON.parse(options.body).status,
            payload_json: { reason: "operator requested restart" },
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
    assert.equal(scheduled[0].delayMs, 3000);
    assert.equal(scheduled[0].unrefCalled, true);
    scheduled[0].callback();
    assert.deepEqual(exitCalls, [0]);
    const completed = JSON.parse(calls[2].options.body);
    assert.equal(completed.result_json.outputs.implementationStatus, "node-agent-restart-scheduled");
    assert.equal(completed.result_json.outputs.command, "process.exit(0)");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("run once executes node traffic reset against runtime telemetry state", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "lumen-agent-state-"));
  const telemetryStateFile = join(stateDir, "runtime", "telemetry-state.json");
  try {
    writeFileSync(join(stateDir, "node-token"), "persisted-node-token\n", { mode: 0o600 });
    writeFileSync(join(stateDir, "heartbeat-path"), "/api/v1/nodes/node-1/heartbeat\n", { mode: 0o600 });
    const calls = [];

    const result = await runNodeAgentOnce({
      env: {
        LUMEN_CONTROL_PLANE_URL: "https://panel.example",
        LUMEN_NODE_NAME: "reset-node-01",
        LUMEN_STATE_DIR: stateDir,
        LUMEN_DRY_RUN: "false",
        LUMEN_RUNTIME_TELEMETRY_STATE_FILE: telemetryStateFile
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
            id: "cmd-reset-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.NODE_TRAFFIC_RESET,
            status: "claimed",
            payload_json: { reason: "operator reset traffic" },
            created_at: "2026-05-27T00:01:00.000Z"
          });
        }
        if (url.endsWith("/result")) {
          return jsonResponse({
            id: "cmd-reset-1",
            node_id: "node-1",
            command_type: COMMAND_TYPES.NODE_TRAFFIC_RESET,
            status: JSON.parse(options.body).status,
            payload_json: { reason: "operator reset traffic" },
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
    const telemetryState = JSON.parse(readFileSync(telemetryStateFile, "utf8"));
    assert.deepEqual(telemetryState.offsets, {});
    const completed = JSON.parse(calls[2].options.body);
    assert.equal(completed.result_json.outputs.implementationStatus, "node-traffic-reset");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
