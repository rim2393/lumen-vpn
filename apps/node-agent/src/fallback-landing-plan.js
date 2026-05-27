import { assertNoInlineSecrets } from "./outbound-model.js";

export const FALLBACK_LANDING_PLAN_VERSION = "lumen.node-agent.fallback-landing.v1";
export const DEFAULT_FALLBACK_LANDING_TEMPLATE_REF = "builtin://node-agent/landing/default";
export const FALLBACK_LANDING_STATUSES = Object.freeze(["enabled", "disabled"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function assertKnown(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return value;
}

function hasScriptTag(html) {
  return /<\s*script\b/i.test(html);
}

function validateInlineHtml(value, path, errors) {
  if (value === null) {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${path} must be a string when provided`);
    return;
  }

  if (hasScriptTag(value)) {
    errors.push(`${path} must not contain <script> tags`);
  }
}

export function validateFallbackLandingPlan(plan) {
  const errors = [];

  if (!isPlainObject(plan)) {
    return { ok: false, errors: ["fallback landing plan must be an object"] };
  }

  if (plan.modelVersion !== FALLBACK_LANDING_PLAN_VERSION) {
    errors.push(`modelVersion must be ${FALLBACK_LANDING_PLAN_VERSION}`);
  }

  requireString(plan.id, "id", errors);
  requireString(plan.nodeId, "nodeId", errors);
  assertKnown(plan.status, FALLBACK_LANDING_STATUSES, "status", errors);

  if (plan.templateRef !== null) {
    requireString(plan.templateRef, "templateRef", errors);
  }

  if (plan.staticRoot !== null) {
    requireString(plan.staticRoot, "staticRoot", errors);
  }

  validateInlineHtml(plan.inlineHtml, "inlineHtml", errors);

  if (plan.status === "enabled" && plan.templateRef === null && plan.staticRoot === null && plan.inlineHtml === null) {
    errors.push("enabled fallback landing plan requires templateRef, staticRoot, or inlineHtml");
  }

  try {
    assertNoInlineSecrets(plan);
  } catch (error) {
    errors.push(error.message);
  }

  return { ok: errors.length === 0, errors };
}

export function createFallbackLandingPlan(input = {}) {
  assertNoInlineSecrets(input);

  const status = input.status ?? (input.enabled === false ? "disabled" : "enabled");
  const templateRef = Object.hasOwn(input, "templateRef")
    ? input.templateRef
    : DEFAULT_FALLBACK_LANDING_TEMPLATE_REF;
  const plan = Object.freeze({
    modelVersion: FALLBACK_LANDING_PLAN_VERSION,
    id: input.id,
    nodeId: input.nodeId,
    status,
    templateRef: normalizeOptionalString(templateRef),
    staticRoot: normalizeOptionalString(input.staticRoot),
    inlineHtml: normalizeOptionalString(input.inlineHtml),
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });

  const result = validateFallbackLandingPlan(plan);
  if (!result.ok) {
    throw new Error(`Invalid fallback landing plan: ${result.errors.join("; ")}`);
  }

  return plan;
}
