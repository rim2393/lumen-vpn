import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyOpenVpnConfig,
  createOpenVpnApplyPlan,
  renderOpenVpnServerConfig
} from "../src/openvpn-runtime.js";

const pki = Object.freeze({
  ca_cert: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
  server_cert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
  server_key: "-----BEGIN PRIVATE KEY-----\nserver\n-----END PRIVATE KEY-----"
});

function config(overrides = {}) {
  return {
    listen_port: 1194,
    proto: "udp",
    network: "10.88.0.0/24",
    pki,
    users: [{ username: "lumen_sub_test", password: "pass-123" }],
    ...overrides
  };
}

test("renderOpenVpnServerConfig renders auth and routing directives", () => {
  const rendered = renderOpenVpnServerConfig(config(), {
    caCertPath: "/runtime/ca.crt",
    serverCertPath: "/runtime/server.crt",
    serverKeyPath: "/runtime/server.key",
    authScriptPath: "/runtime/auth.sh",
    statusPath: "/runtime/status.log"
  });

  assert.match(rendered, /port 1194/);
  assert.match(rendered, /proto udp/);
  assert.match(rendered, /server 10\.88\.0\.0 255\.255\.255\.0/);
  assert.match(rendered, /verify-client-cert none/);
  assert.match(rendered, /auth-user-pass-verify \/runtime\/auth\.sh via-env/);
});

test("applyOpenVpnConfig writes runtime files and starts managed process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-openvpn-"));
  const calls = [];
  try {
    const configPath = join(dir, "server.conf");
    const plan = createOpenVpnApplyPlan({ openvpnConfig: config(), configPath });
    const result = await applyOpenVpnConfig(plan, {
      dryRun: false,
      env: {
        LUMEN_OPENVPN_AUTH_SCRIPT: join(dir, "auth.sh"),
        LUMEN_OPENVPN_USERS_FILE: join(dir, "users.txt")
      },
      execFileImpl: async (command, args) => {
        calls.push([command, args]);
        return { stdout: "", stderr: "" };
      },
      isPidRunningImpl: () => true,
      processStartCheckMs: 0,
      spawnImpl: () => ({
        pid: 4242,
        unref() {}
      })
    });

    assert.equal(result.implementationStatus, "openvpn-managed-process-started");
    assert.equal(result.listenPort, 1194);
    assert.match(readFileSync(configPath, "utf8"), /auth-user-pass-verify/);
    assert.match(readFileSync(join(dir, "users.txt"), "utf8"), /lumen_sub_test:pass-123/);
    assert.deepEqual(calls[0], ["openvpn", ["--version"]]);
    assert.equal(calls[1][0], "sh");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createOpenVpnApplyPlan rejects unresolved and unsafe credentials", () => {
  assert.throws(
    () => createOpenVpnApplyPlan({ openvpnConfig: { ...config(), clientsRef: "vault://x" } }),
    /unresolved refs/i
  );
  assert.throws(
    () => createOpenVpnApplyPlan({
      openvpnConfig: config({ users: [{ username: "bad:name", password: "pass" }] })
    }),
    /colon/
  );
});
