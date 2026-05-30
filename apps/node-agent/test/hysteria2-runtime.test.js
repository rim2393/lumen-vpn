import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HYSTERIA2_RELOAD_ARGV,
  applyHysteria2Config,
  createHysteria2ApplyPlan
} from "../src/hysteria2-runtime.js";

function validConfig() {
  return {
    listen: ":443",
    tls: { cert: "/etc/hysteria/cert.pem", key: "/etc/hysteria/key.pem" },
    auth: { type: "password", password: "lumen-managed-secret" }
  };
}

test("createHysteria2ApplyPlan accepts a complete server config", () => {
  const plan = createHysteria2ApplyPlan({ id: "ob-1", hysteria2Config: validConfig() });
  assert.equal(plan.config.listen, ":443");
  assert.equal(plan.modelVersion, "lumen.node-agent.hysteria2-runtime.v1");
});

test("createHysteria2ApplyPlan rejects an incomplete config", () => {
  assert.throws(
    () => createHysteria2ApplyPlan({ config: { listen: ":443" } }),
    /auth must be an object/
  );
  assert.throws(
    () => createHysteria2ApplyPlan({ config: { auth: {}, tls: {} } }),
    /listen must be a non-empty string/
  );
  assert.throws(
    () => createHysteria2ApplyPlan({ config: { listen: ":443", auth: {} } }),
    /tls\.cert\+tls\.key or an acme block/
  );
});

test("createHysteria2ApplyPlan rejects unresolved credential refs", () => {
  const config = { ...validConfig(), auth: { type: "password", credentialsRef: "vault://x" } };
  assert.throws(() => createHysteria2ApplyPlan({ config }), /unresolved refs/);
});

test("applyHysteria2Config dry-run summarizes the reload command without touching disk", async () => {
  const plan = createHysteria2ApplyPlan({ config: validConfig() });
  const result = await applyHysteria2Config(plan, { dryRun: true });
  assert.equal(result.implementationStatus, "hysteria2-dry-run");
  assert.equal(result.reloadCommand, DEFAULT_HYSTERIA2_RELOAD_ARGV.join(" "));
});

test("applyHysteria2Config writes the config and runs the reload command when applied", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-hy2-"));
  const configPath = join(dir, "config.json");
  const calls = [];
  const plan = createHysteria2ApplyPlan({ config: validConfig(), configPath });
  try {
    const result = await applyHysteria2Config(plan, {
      dryRun: false,
      execFileImpl: async (command, args) => {
        calls.push([command, args]);
      }
    });
    assert.equal(result.implementationStatus, "hysteria2-applied");
    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.equal(written.listen, ":443");
    assert.deepEqual(calls[0], ["systemctl", ["restart", "hysteria-server"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
