import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NODE_POLICY_MODEL_VERSION,
  applyNodePolicy,
  createNodePolicyApplyPlan,
  validateNodePolicy
} from "../src/index.js";

const nodePolicy = Object.freeze({
  modelVersion: NODE_POLICY_MODEL_VERSION,
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
});

test("node policy validates and writes a runtime artifact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-policy-"));
  try {
    const policyPath = join(dir, "policy.json");
    const plan = createNodePolicyApplyPlan({
      id: "profile-1",
      nodePolicy,
      policyPath
    });
    const result = await applyNodePolicy(plan, { dryRun: false });

    assert.equal(result.implementationStatus, "node-policy-applied");
    assert.equal(result.pluginsApplied, 1);
    assert.equal(result.ipControlApplied, true);
    const written = JSON.parse(readFileSync(policyPath, "utf8"));
    assert.equal(written.plugins[0].kind, "torrent-blocker");
    assert.equal(written.ipControl.maxActiveIps, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("node policy rejects inline secret-like payloads", () => {
  const result = validateNodePolicy({
    ...nodePolicy,
    plugins: [
      {
        id: "plugin-1",
        kind: "domain-filter",
        name: "bad",
        config: { token: "plain" },
        enabled: true
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /secret-like/i);
});
