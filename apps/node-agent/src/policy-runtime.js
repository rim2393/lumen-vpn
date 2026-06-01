import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNoInlineSecrets } from "./outbound-model.js";

export const NODE_POLICY_MODEL_VERSION = "lumen.node-policy.v1";
export const NODE_POLICY_APPLY_MODEL_VERSION = "lumen.node-agent.policy-apply.v1";
export const DEFAULT_NODE_POLICY_DIR = "/var/lib/lumen-node/policies";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validatePlugin(plugin, index, errors) {
  if (!isPlainObject(plugin)) {
    errors.push(`nodePolicy.plugins[${index}] must be an object`);
    return;
  }
  for (const key of ["id", "kind", "name"]) {
    if (typeof plugin[key] !== "string" || plugin[key].trim().length === 0) {
      errors.push(`nodePolicy.plugins[${index}].${key} must be a non-empty string`);
    }
  }
  if (plugin.config !== undefined && !isPlainObject(plugin.config)) {
    errors.push(`nodePolicy.plugins[${index}].config must be an object when provided`);
  }
  if (plugin.enabled !== undefined && typeof plugin.enabled !== "boolean") {
    errors.push(`nodePolicy.plugins[${index}].enabled must be a boolean when provided`);
  }
}

function validateIpControl(ipControl, errors) {
  if (ipControl === undefined) {
    return;
  }
  if (!isPlainObject(ipControl)) {
    errors.push("nodePolicy.ipControl must be an object when provided");
    return;
  }
  if (!Number.isInteger(ipControl.maxActiveIps) || ipControl.maxActiveIps < 1) {
    errors.push("nodePolicy.ipControl.maxActiveIps must be a positive integer");
  }
  if (!["block", "notify"].includes(ipControl.action)) {
    errors.push("nodePolicy.ipControl.action must be block or notify");
  }
}

export function validateNodePolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["nodePolicy must be an object"]) });
  }
  if (policy.modelVersion !== NODE_POLICY_MODEL_VERSION) {
    errors.push(`nodePolicy.modelVersion must be ${NODE_POLICY_MODEL_VERSION}`);
  }
  if (!Array.isArray(policy.plugins)) {
    errors.push("nodePolicy.plugins must be an array");
  } else {
    policy.plugins.forEach((plugin, index) => validatePlugin(plugin, index, errors));
  }
  validateIpControl(policy.ipControl, errors);
  try {
    assertNoInlineSecrets(policy);
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function createNodePolicyApplyPlan(input = {}) {
  const policy = input.nodePolicy ?? input.policy;
  const result = validateNodePolicy(policy);
  if (!result.ok) {
    throw new Error(`Invalid node policy: ${result.errors.join("; ")}`);
  }
  const id = input.id ?? "node-policy";
  const policyPath = input.policyPath ??
    join(input.policyDir ?? DEFAULT_NODE_POLICY_DIR, `${id}.json`);
  return Object.freeze({
    modelVersion: NODE_POLICY_APPLY_MODEL_VERSION,
    id,
    policyPath,
    nodePolicy: Object.freeze({
      ...policy,
      plugins: Object.freeze(policy.plugins.map((plugin) => Object.freeze({ ...plugin }))),
      ipControl: policy.ipControl ? Object.freeze({ ...policy.ipControl }) : undefined
    })
  });
}

export async function applyNodePolicy(plan, input = {}) {
  if (!plan || plan.modelVersion !== NODE_POLICY_APPLY_MODEL_VERSION) {
    throw new Error(`policy plan must be ${NODE_POLICY_APPLY_MODEL_VERSION}`);
  }
  if (input.dryRun !== false) {
    return Object.freeze({
      implementationStatus: "node-policy-dry-run",
      policyPath: plan.policyPath,
      pluginsApplied: plan.nodePolicy.plugins.length,
      ipControlApplied: Boolean(plan.nodePolicy.ipControl)
    });
  }
  mkdirSync(dirname(plan.policyPath), { recursive: true });
  writeFileSync(plan.policyPath, `${JSON.stringify(plan.nodePolicy, null, 2)}\n`, {
    mode: 0o600
  });
  return Object.freeze({
    implementationStatus: "node-policy-applied",
    policyPath: plan.policyPath,
    pluginsApplied: plan.nodePolicy.plugins.length,
    ipControlApplied: Boolean(plan.nodePolicy.ipControl)
  });
}
