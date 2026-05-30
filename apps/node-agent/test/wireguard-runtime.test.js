import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WIREGUARD_RELOAD_ARGV,
  applyWireguardConfig,
  createWireguardApplyPlan,
  renderWireguardIni
} from "../src/wireguard-runtime.js";

function validConfig() {
  return {
    interface: {
      private_key: "QPrivateKeyBase64==",
      address: "10.66.66.1/24",
      listen_port: 51820
    },
    peers: [
      {
        public_key: "PeerPublicKeyBase64==",
        allowed_ips: "10.66.66.2/32",
        persistent_keepalive: 25
      }
    ]
  };
}

test("renderWireguardIni emits a valid wg-quick config", () => {
  const ini = renderWireguardIni(validConfig());
  assert.match(ini, /\[Interface]/);
  assert.match(ini, /PrivateKey = QPrivateKeyBase64==/);
  assert.match(ini, /ListenPort = 51820/);
  assert.match(ini, /\[Peer]/);
  assert.match(ini, /PublicKey = PeerPublicKeyBase64==/);
  assert.match(ini, /AllowedIPs = 10\.66\.66\.2\/32/);
  assert.match(ini, /PersistentKeepalive = 25/);
});

test("renderWireguardIni passes AmneziaWG obfuscation params through verbatim", () => {
  const config = validConfig();
  config.interface.Jc = 4;
  config.interface.S1 = 60;
  config.interface.H1 = 1234567890;
  const ini = renderWireguardIni(config);
  assert.match(ini, /\nJc = 4/);
  assert.match(ini, /\nS1 = 60/);
  assert.match(ini, /\nH1 = 1234567890/);
});

test("createWireguardApplyPlan rejects incomplete configs", () => {
  assert.throws(
    () => createWireguardApplyPlan({ config: { interface: {}, peers: [] } }),
    /private_key must be a non-empty string/
  );
  assert.throws(
    () => createWireguardApplyPlan({ config: { interface: validConfig().interface, peers: [] } }),
    /peers must contain at least one peer/
  );
  assert.throws(
    () =>
      createWireguardApplyPlan({
        config: { interface: validConfig().interface, peers: [{ public_key: "x" }] }
      }),
    /allowed_ips must be a non-empty string/
  );
});

test("createWireguardApplyPlan rejects unresolved refs", () => {
  const config = validConfig();
  config.interface.credentialsRef = "vault://x";
  assert.throws(() => createWireguardApplyPlan({ config }), /unresolved refs/);
});

test("applyWireguardConfig dry-run summarizes reload without touching disk", async () => {
  const plan = createWireguardApplyPlan({ config: validConfig() });
  const result = await applyWireguardConfig(plan, { dryRun: true });
  assert.equal(result.implementationStatus, "wireguard-dry-run");
  assert.equal(result.reloadCommand, DEFAULT_WIREGUARD_RELOAD_ARGV.join(" "));
});

test("applyWireguardConfig writes the .conf and runs the reload command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-wg-"));
  const configPath = join(dir, "lumen-wg.conf");
  const calls = [];
  const plan = createWireguardApplyPlan({ config: validConfig(), configPath });
  try {
    const result = await applyWireguardConfig(plan, {
      dryRun: false,
      execFileImpl: async (command, args) => {
        calls.push([command, args]);
      }
    });
    assert.equal(result.implementationStatus, "wireguard-applied");
    const written = readFileSync(configPath, "utf-8");
    assert.match(written, /\[Interface]/);
    assert.deepEqual(calls[0], ["systemctl", ["restart", "wg-quick@lumen-wg"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
