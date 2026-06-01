import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TUIC_RELOAD_ARGV,
  applyTuicConfig,
  createTuicApplyPlan,
  renderTuicSingBoxConfig
} from "../src/tuic-runtime.js";

function validConfig() {
  return {
    server: "[::]:443",
    users: { "11111111-1111-1111-1111-111111111111": "lumen-managed-secret" },
    certificate: "/etc/tuic/cert.pem",
    private_key: "/etc/tuic/key.pem",
    congestion_control: "bbr"
  };
}

test("createTuicApplyPlan accepts a complete server config", () => {
  const plan = createTuicApplyPlan({ id: "ob-1", tuicConfig: validConfig() });
  assert.equal(plan.config.server, "[::]:443");
  assert.equal(plan.modelVersion, "lumen.node-agent.tuic-runtime.v1");
});

test("createTuicApplyPlan rejects an incomplete config", () => {
  assert.throws(
    () => createTuicApplyPlan({ config: { server: "[::]:443", users: {} } }),
    /users must map at least one uuid/
  );
  assert.throws(
    () => createTuicApplyPlan({ config: { users: { a: "b" }, certificate: "c", private_key: "k" } }),
    /server must be a non-empty/
  );
  assert.throws(
    () => createTuicApplyPlan({ config: { server: "[::]:443", users: { a: "b" } } }),
    /certificate\+private_key or an acme block/
  );
});

test("createTuicApplyPlan rejects unresolved credential refs", () => {
  const config = { ...validConfig(), users: { credentialsRef: "vault://x" } };
  assert.throws(() => createTuicApplyPlan({ config }), /unresolved refs/);
});

test("applyTuicConfig dry-run summarizes the reload command without touching disk", async () => {
  const plan = createTuicApplyPlan({ config: validConfig() });
  const result = await applyTuicConfig(plan, { dryRun: true });
  assert.equal(result.implementationStatus, "tuic-dry-run");
  assert.equal(result.reloadCommand, DEFAULT_TUIC_RELOAD_ARGV.join(" "));
});

test("applyTuicConfig writes the config and runs the reload command when applied", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-tuic-"));
  const configPath = join(dir, "config.json");
  const calls = [];
  const plan = createTuicApplyPlan({ config: validConfig(), configPath });
  try {
    const result = await applyTuicConfig(plan, {
      dryRun: false,
      execFileImpl: async (command, args) => {
        calls.push([command, args]);
      }
    });
    assert.equal(result.implementationStatus, "tuic-applied");
    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.equal(written.server, "[::]:443");
    assert.deepEqual(calls[0], ["systemctl", ["restart", "tuic-server"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderTuicSingBoxConfig emits a runnable sing-box inbound", () => {
  const rendered = renderTuicSingBoxConfig(validConfig());
  assert.equal(rendered.inbounds[0].type, "tuic");
  assert.equal(rendered.inbounds[0].listen_port, 443);
  assert.equal(rendered.inbounds[0].users[0].uuid, "11111111-1111-1111-1111-111111111111");
  assert.equal(rendered.inbounds[0].users[0].password, "lumen-managed-secret");
  assert.equal(rendered.inbounds[0].tls.certificate_path, "/etc/tuic/cert.pem");
});

test("applyTuicConfig process mode validates and starts managed sing-box", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-tuic-process-"));
  const configPath = join(dir, "config.json");
  const logPath = join(dir, "sing-box.log");
  const pidFile = join(dir, "sing-box.pid");
  const calls = [];
  const spawned = [];
  const plan = createTuicApplyPlan({ config: validConfig(), configPath });
  try {
    const result = await applyTuicConfig(plan, {
      dryRun: false,
      env: {
        LUMEN_TUIC_RELOAD_MODE: "process",
        LUMEN_TUIC_LOG_FILE: logPath,
        LUMEN_TUIC_PID_FILE: pidFile,
        LUMEN_TUIC_BINARY: "sing-box-test"
      },
      execFileImpl: async (command, args) => {
        calls.push([command, args]);
      },
      spawnImpl: (command, args) => {
        spawned.push([command, args]);
        return { pid: 12346, unref() {} };
      }
    });
    assert.equal(result.implementationStatus, "tuic-managed-process-started");
    assert.deepEqual(calls[0], ["sing-box-test", ["check", "-c", configPath]]);
    assert.deepEqual(spawned[0], ["sing-box-test", ["run", "-c", configPath]]);
    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.equal(written.inbounds[0].type, "tuic");
    assert.equal(readFileSync(pidFile, "utf-8").trim(), "12346");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
