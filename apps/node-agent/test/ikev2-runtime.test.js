import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyIkev2Config,
  createIkev2ApplyPlan,
  renderSwanctlConfig
} from "../src/index.js";

const IKEV2_CONFIG = Object.freeze({
  ike_port: 500,
  nat_port: 4500,
  server_id: "vpn.example.test",
  pool: "10.92.0.0/24",
  dns: ["1.1.1.1"],
  pki: {
    ca_cert: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
    server_cert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
    server_key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----"
  },
  users: [{ username: "lumen_sub_live", password: "ikev2-password" }]
});

test("renders strongSwan swanctl config with EAP users and server cert", () => {
  const plan = createIkev2ApplyPlan({ ikev2Config: IKEV2_CONFIG });
  assert.equal(plan.modelVersion, "lumen.node-agent.ikev2-runtime.v1");
  const rendered = renderSwanctlConfig(plan.config, {
    serverCertPath: "/etc/swanctl/x509/lumen.pem",
    serverKeyPath: "/etc/swanctl/private/lumen-key.pem"
  });
  assert.match(rendered, /connections \{/);
  assert.match(rendered, /auth = eap-mschapv2/);
  assert.match(rendered, /certs = \/etc\/swanctl\/x509\/lumen\.pem/);
  assert.match(rendered, /id = "lumen_sub_live"/);
  assert.match(rendered, /secret = "ikev2-password"/);
});

test("rejects unresolved IKEv2 credential references", () => {
  assert.throws(
    () => createIkev2ApplyPlan({
      ikev2Config: {
        ...IKEV2_CONFIG,
        users: undefined,
        clientsRef: "vault://subscriptions/p/creds"
      }
    }),
    /unresolved refs/
  );
});

test("applies IKEv2 config through strongSwan swanctl default config path", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lumen-ikev2-"));
  const configDir = join(tempDir, "swanctl");
  const runtimeDir = join(tempDir, "runtime");
  const viciSocket = join(tempDir, "charon.vici");
  const calls = [];
  const plan = createIkev2ApplyPlan({
    ikev2Config: IKEV2_CONFIG,
    configDir,
    runtimeDir
  });

  const result = await applyIkev2Config(plan, {
    dryRun: false,
    env: {
      LUMEN_IKEV2_VICI_SOCKET: viciSocket,
      LUMEN_IKEV2_VICI_WAIT_MS: "500"
    },
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      if (command === "ipsec" && args[0] === "start") {
        mkdirSync(tempDir, { recursive: true });
        writeFileSync(viciSocket, "");
      }
      return { stdout: "", stderr: "" };
    }
  });

  assert.equal(result.implementationStatus, "ikev2-applied");
  assert.deepEqual(calls.map(([command, args]) => [command, args]), [
    ["sh", calls[0][1]],
    ["ipsec", ["stop"]],
    ["ipsec", ["start"]],
    ["swanctl", ["--load-all"]],
    ["swanctl", ["--list-conns"]]
  ]);
});
