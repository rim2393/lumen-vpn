import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  HEARTBEAT_PAYLOAD_VERSION,
  NODE_AGENT_RUNTIME_CONFIG_VERSION,
  buildNodeAgentDryRun,
  createHeartbeatPayload,
  loadNodeAgentConfigFromEnv,
  assertLiveRuntimeMode
} from "../src/index.js";

test("loads runtime config from env without exposing secret env values", () => {
  const config = loadNodeAgentConfigFromEnv({
    LUMEN_NODE_ID: "ams-1",
    LUMEN_CONTROL_PLANE_URL: "https://control.example/",
    LUMEN_AGENT_VERSION: "1.2.3",
    LUMEN_HEARTBEAT_INTERVAL_MS: "1000",
    LUMEN_POLL_INTERVAL_MS: "2000",
    LUMEN_CAPABILITIES: "runtime.xray_core, bind.privileged_ports",
    LUMEN_NODE_TAGS: "edge, ams",
    LUMEN_INSTALL_TOKEN: "very-secret-value"
  });

  assert.equal(config.configVersion, NODE_AGENT_RUNTIME_CONFIG_VERSION);
  assert.equal(config.nodeId, "ams-1");
  assert.equal(config.controlPlaneBaseUrl, "https://control.example");
  assert.equal(config.heartbeatIntervalMs, 1000);
  assert.equal(config.pollIntervalMs, 2000);
  assert.equal(config.capabilities["runtime.xray_core"], true);
  assert.deepEqual(config.tags, ["edge", "ams"]);
  assert.equal(config.dryRun, false);
  assert.equal(JSON.stringify(config).includes("very-secret-value"), false);
});

test("live loop defaults to real runtime mode and refuses explicit dry-run", () => {
  const liveConfig = loadNodeAgentConfigFromEnv({
    LUMEN_NODE_ID: "ams-1",
    LUMEN_CONTROL_PLANE_URL: "https://control.example/"
  });
  assert.equal(liveConfig.dryRun, false);
  assert.doesNotThrow(() => assertLiveRuntimeMode(liveConfig, ["--run"]));

  const dryConfig = loadNodeAgentConfigFromEnv({
    LUMEN_NODE_ID: "ams-1",
    LUMEN_CONTROL_PLANE_URL: "https://control.example/",
    LUMEN_DRY_RUN: "true"
  });
  assert.equal(dryConfig.dryRun, true);
  assert.throws(
    () => assertLiveRuntimeMode(dryConfig, ["--run-once"]),
    /Refusing to run live node-agent loop/
  );
});

test("loads runtime config from installer-compatible env aliases", () => {
  const config = loadNodeAgentConfigFromEnv({
    LUMEN_NODE_NAME: "manual-node",
    LUMEN_PANEL_URL: "https://panel.example/"
  });

  assert.equal(config.nodeId, "manual-node");
  assert.equal(config.controlPlaneBaseUrl, "https://panel.example");
});

test("builds heartbeat payload from config and provisioning state", () => {
  const config = loadNodeAgentConfigFromEnv({
    LUMEN_NODE_ID: "ams-1",
    LUMEN_CAPABILITIES: "runtime.xray_core"
  });
  const heartbeat = createHeartbeatPayload({
    config,
    observedAt: "2026-05-27T00:00:00.000Z"
  });

  assert.equal(heartbeat.payloadVersion, HEARTBEAT_PAYLOAD_VERSION);
  assert.equal(heartbeat.nodeId, "ams-1");
  assert.equal(heartbeat.observedAt, "2026-05-27T00:00:00.000Z");
  assert.equal(heartbeat.state.mode, "active");
  assert.equal(heartbeat.capabilityReport.capabilities["runtime.xray_core"], true);
  assert.equal(Object.isFrozen(heartbeat), true);
});

test("builds dry-run report with config and heartbeat only", () => {
  const report = buildNodeAgentDryRun({
    generatedAt: "2026-05-27T00:00:00.000Z",
    env: {
      LUMEN_NODE_ID: "ams-1",
      LUMEN_CONTROL_PLANE_URL: "https://control.example",
      LUMEN_INSTALL_TOKEN: "very-secret-value"
    }
  });

  assert.equal(report.dryRun, true);
  assert.equal(report.config.nodeId, "ams-1");
  assert.equal(report.heartbeat.nodeId, "ams-1");
  assert.deepEqual(Object.keys(report).sort(), [
    "config",
    "dryRun",
    "generatedAt",
    "heartbeat",
    "reportVersion"
  ]);
  assert.equal(JSON.stringify(report).includes("very-secret-value"), false);
});

test("CLI prints dry-run JSON without secret env values", () => {
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cliPath, "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      LUMEN_NODE_ID: "ams-1",
      LUMEN_CONTROL_PLANE_URL: "https://control.example",
      LUMEN_DRY_RUN: "true",
      LUMEN_INSTALL_TOKEN: "very-secret-value"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.config.nodeId, "ams-1");
  assert.equal(report.heartbeat.nodeId, "ams-1");
  assert.equal(result.stdout.includes("very-secret-value"), false);
});
