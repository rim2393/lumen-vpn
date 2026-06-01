import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyOpenVpnShadowsocksConfig,
  createOpenVpnShadowsocksApplyPlan
} from "../src/openvpn-shadowsocks-runtime.js";

const pki = Object.freeze({
  ca_cert: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
  server_cert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
  server_key: "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----"
});

function bridgeConfig(overrides = {}) {
  return {
    openvpn: {
      listen_port: 24194,
      proto: "tcp-server",
      local_address: "127.0.0.1",
      network: "10.89.0.0/24",
      pki,
      users: [{ username: "lumen_sub_live", password: "openvpn-pass" }]
    },
    shadowsocks: {
      listen: "0.0.0.0",
      listen_port: 28443,
      method: "aes-256-gcm",
      password: "ss-pass"
    },
    ...overrides
  };
}

test("applyOpenVpnShadowsocksConfig starts OpenVPN bridge and ssserver", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-openvpn-ss-"));
  const calls = [];
  const spawns = [];
  try {
    const configPath = join(dir, "config.json");
    const plan = createOpenVpnShadowsocksApplyPlan({
      openvpnShadowsocksConfig: bridgeConfig(),
      configPath
    });
    const result = await applyOpenVpnShadowsocksConfig(plan, {
      dryRun: false,
      env: {
        LUMEN_OPENVPN_AUTH_SCRIPT: join(dir, "auth.sh"),
        LUMEN_OPENVPN_USERS_FILE: join(dir, "users.txt"),
        LUMEN_OPENVPN_LOG_FILE: join(dir, "openvpn.log"),
        LUMEN_OPENVPN_PID_FILE: join(dir, "openvpn.pid"),
        LUMEN_OPENVPN_SHADOWSOCKS_LOG_FILE: join(dir, "ss.log"),
        LUMEN_OPENVPN_SHADOWSOCKS_PID_FILE: join(dir, "ss.pid")
      },
      execFileImpl: async (command, args) => {
        calls.push([command, args]);
        return { stdout: "", stderr: "" };
      },
      isPidRunningImpl: () => true,
      processStartCheckMs: 0,
      spawnImpl: (command, args) => {
        spawns.push([command, args]);
        return {
          pid: 4545 + spawns.length,
          unref() {}
        };
      }
    });

    assert.equal(result.implementationStatus, "openvpn-shadowsocks-managed-process-started");
    assert.equal(result.listenPort, 28443);
    assert.match(readFileSync(join(dir, "openvpn", "server.conf"), "utf8"), /proto tcp-server/);
    assert.match(readFileSync(join(dir, "openvpn", "server.conf"), "utf8"), /local 127\.0\.0\.1/);
    const shadowsocks = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(shadowsocks.server_port, 28443);
    assert.equal(shadowsocks.method, "aes-256-gcm");
    assert.equal(shadowsocks.mode, "tcp_only");
    assert.equal(spawns[0][0], "openvpn");
    assert.equal(spawns[1][0], "ssserver");
    assert.deepEqual(calls[0], ["openvpn", ["--version"]]);
    assert.deepEqual(calls.at(-1), ["ssserver", ["--version"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createOpenVpnShadowsocksApplyPlan rejects unresolved refs", () => {
  assert.throws(
    () => createOpenVpnShadowsocksApplyPlan({
      openvpnShadowsocksConfig: bridgeConfig({ clientsRef: "vault://x" })
    }),
    /unresolved refs/i
  );
});
