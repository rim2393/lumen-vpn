import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  applyXrayConfig,
  createXrayApplyPlan,
  ensureManagedXrayProcess
} from "../src/xray-runtime.js";

test("xray process reload mode writes config and starts managed xray", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lumen-xray-runtime-"));
  const configPath = join(tmp, "config.json");
  const logPath = join(tmp, "xray.log");
  const calls = [];
  const spawned = [];
  const config = {
    inbounds: [
      {
        tag: "vless",
        listen: "0.0.0.0",
        port: 18444,
        protocol: "vless",
        settings: { decryption: "none", clients: [{ id: "client-id" }] },
        streamSettings: { network: "tcp", security: "none" }
      }
    ]
  };

  const result = await applyXrayConfig(createXrayApplyPlan({ xrayConfig: config }), {
    env: {
      LUMEN_XRAY_BINARY: "xray-test-bin",
      LUMEN_XRAY_CONFIG_FILE: configPath,
      LUMEN_XRAY_LOG_FILE: logPath,
      LUMEN_XRAY_RELOAD_MODE: "process"
    },
    dryRun: false,
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      if (command === "pkill") {
        const error = new Error("no process");
        error.code = 1;
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
    spawnImpl: (command, args, options) => {
      spawned.push({ command, args, options });
      return { pid: 12345, unref() {} };
    }
  });

  assert.equal(result.implementationStatus, "xray-managed-process-started");
  assert.equal(result.pid, 12345);
  assert.deepEqual(calls, [
    { command: "xray-test-bin", args: ["-test", "-config", configPath] },
    { command: "pkill", args: ["-TERM", "-x", "xray"] }
  ]);
  assert.equal(spawned[0].command, "xray-test-bin");
  assert.deepEqual(spawned[0].args, ["run", "-config", configPath]);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).inbounds[0].port, 18444);

  rmSync(tmp, { recursive: true, force: true });
});

test("managed xray process is restored from existing config", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lumen-xray-restore-"));
  const configPath = join(tmp, "config.json");
  const logPath = join(tmp, "xray.log");
  const config = {
    inbounds: [
      {
        listen: "0.0.0.0",
        port: 18444,
        protocol: "vless",
        settings: { decryption: "none", clients: [{ id: "client-id" }] },
        streamSettings: { network: "tcp", security: "none" }
      }
    ]
  };
  const calls = [];
  const spawned = [];
  await import("node:fs").then(({ writeFileSync }) => {
    writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  });

  const result = await ensureManagedXrayProcess({
    env: {
      LUMEN_XRAY_BINARY: "xray-test-bin",
      LUMEN_XRAY_CONFIG_FILE: configPath,
      LUMEN_XRAY_LOG_FILE: logPath,
      LUMEN_XRAY_RELOAD_MODE: "process"
    },
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      if (command === "pgrep") {
        const error = new Error("not running");
        error.code = 1;
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
    spawnImpl: (command, args) => {
      spawned.push({ command, args });
      return { pid: 12346, unref() {} };
    }
  });

  assert.equal(result.implementationStatus, "xray-managed-process-restored");
  assert.equal(result.pid, 12346);
  assert.deepEqual(calls, [
    { command: "xray-test-bin", args: ["-test", "-config", configPath] },
    { command: "pgrep", args: ["-x", "xray"] }
  ]);
  assert.equal(spawned[0].command, "xray-test-bin");

  rmSync(tmp, { recursive: true, force: true });
});

test("xray config validation accepts edge transports with required settings", () => {
  const baseInbound = {
    tag: "edge",
    listen: "0.0.0.0",
    port: 18445,
    protocol: "vless",
    settings: { decryption: "none", clients: [{ id: "client-id" }] }
  };
  const cases = [
    { network: "ws", security: "none", wsSettings: { path: "/ws" } },
    { network: "grpc", security: "none", grpcSettings: { serviceName: "lumenGrpc" } },
    { network: "httpupgrade", security: "none", httpupgradeSettings: { path: "/upgrade" } },
    { network: "xhttp", security: "none", xhttpSettings: { path: "/xhttp", mode: "stream-up" } },
    {
      network: "tcp",
      security: "tls",
      tlsSettings: {
        certificates: [{ certificateFile: "/runtime/tls.crt", keyFile: "/runtime/tls.key" }]
      }
    },
    {
      network: "tcp",
      security: "reality",
      realitySettings: {
        privateKey: "server-private-key",
        serverNames: ["www.example.test"],
        shortIds: ["abcd"]
      }
    }
  ];

  for (const streamSettings of cases) {
    assert.equal(
      createXrayApplyPlan({
        xrayConfig: { inbounds: [{ ...baseInbound, streamSettings }] }
      }).config.inbounds[0].streamSettings.network,
      streamSettings.network
    );
  }
});

test("xray config validation rejects incomplete edge transport settings", () => {
  const baseInbound = {
    tag: "edge",
    listen: "0.0.0.0",
    port: 18445,
    protocol: "vless",
    settings: { decryption: "none", clients: [{ id: "client-id" }] }
  };
  const cases = [
    [{}, /streamSettings\.network/],
    [{ network: "ws", security: "none" }, /wsSettings/],
    [{ network: "grpc", security: "none", grpcSettings: {} }, /grpcSettings\.serviceName/],
    [{ network: "httpupgrade", security: "none", httpupgradeSettings: {} }, /httpupgradeSettings\.path/],
    [{ network: "xhttp", security: "none", xhttpSettings: { path: "/x" } }, /xhttpSettings\.mode/],
    [{ network: "tcp", security: "tls", tlsSettings: {} }, /tlsSettings\.certificates/],
    [{ network: "tcp", security: "reality", realitySettings: { serverNames: ["a"], shortIds: [] } }, /realitySettings\.privateKey/]
  ];

  for (const [streamSettings, pattern] of cases) {
    assert.throws(
      () => createXrayApplyPlan({ xrayConfig: { inbounds: [{ ...baseInbound, streamSettings }] } }),
      pattern
    );
  }
});
