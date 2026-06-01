export const OUTBOUND_MODEL_VERSION = "lumen.node-agent.outbound.v1";

const FORBIDDEN_INLINE_SECRET_KEYS = new Set([
  "secret",
  "secrets",
  "password",
  "passwd",
  "token",
  "accessToken",
  "access_token",
  "privateKey",
  "private_key",
  "subscriptionUrl",
  "subscription_url",
  "generatedConfig",
  "generated_config"
]);

const RUNTIME_CREDENTIAL_PAYLOAD_ROOTS = Object.freeze([
  "$.payload.xrayConfig",
  "$.payload.hysteria2Config",
  "$.payload.naiveConfig",
  "$.payload.openvpnConfig",
  "$.payload.openvpnShadowsocksConfig",
  "$.payload.singBoxShadowsocksConfig",
  "$.payload.shadowsocksPluginConfig",
  "$.payload.tuicConfig",
  "$.payload.wireguardConfig"
]);

const RUNTIME_CREDENTIAL_KEYS = new Set([
  "password",
  "passwd",
  "privateKey",
  "private_key"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key) {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function isAllowedRuntimeCredentialKey(path, key, options) {
  if (!options.allowRuntimeCredentialPayloads) {
    return false;
  }
  const normalized = normalizeKey(key);
  const isRuntimeCredentialKey = [...RUNTIME_CREDENTIAL_KEYS].some(
    (allowedKey) => normalized === normalizeKey(allowedKey)
  );
  if (!isRuntimeCredentialKey) {
    return false;
  }
  return RUNTIME_CREDENTIAL_PAYLOAD_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`)
  );
}

function findForbiddenKeys(value, path = "$", violations = [], options = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findForbiddenKeys(item, `${path}[${index}]`, violations, options)
    );
    return violations;
  }

  if (!isPlainObject(value)) {
    return violations;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    for (const forbiddenKey of FORBIDDEN_INLINE_SECRET_KEYS) {
      if (
        normalized === normalizeKey(forbiddenKey) &&
        !isAllowedRuntimeCredentialKey(path, key, options)
      ) {
        violations.push(`${path}.${key}`);
      }
    }
    findForbiddenKeys(child, `${path}.${key}`, violations, options);
  }

  return violations;
}

function freezeArray(value) {
  return Object.freeze([...(value ?? [])]);
}

function assertString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function assertPort(value, path, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer port between 1 and 65535`);
  }
}

export function assertNoInlineSecrets(value, options = {}) {
  const violations = findForbiddenKeys(value, "$", [], options);
  if (violations.length > 0) {
    throw new Error(`Inline secret-like fields are not allowed: ${violations.join(", ")}`);
  }
}

export function validateOutboundPlan(plan) {
  const errors = [];

  if (!isPlainObject(plan)) {
    return { ok: false, errors: ["outbound plan must be an object"] };
  }

  if (plan.modelVersion !== OUTBOUND_MODEL_VERSION) {
    errors.push(`modelVersion must be ${OUTBOUND_MODEL_VERSION}`);
  }

  assertString(plan.id, "id", errors);
  assertString(plan.nodeId, "nodeId", errors);
  assertString(plan.protocol, "protocol", errors);
  assertString(plan.adapter, "adapter", errors);
  assertString(plan.endpoint?.host, "endpoint.host", errors);
  assertPort(plan.endpoint?.port, "endpoint.port", errors);
  assertString(plan.credentialsRef, "credentialsRef", errors);

  try {
    assertNoInlineSecrets(plan);
  } catch (error) {
    errors.push(error.message);
  }

  return { ok: errors.length === 0, errors };
}

export function createOutboundPlan(input = {}) {
  assertNoInlineSecrets(input);

  const plan = Object.freeze({
    modelVersion: OUTBOUND_MODEL_VERSION,
    id: input.id,
    nodeId: input.nodeId,
    protocol: input.protocol,
    adapter: input.adapter ?? input.protocol,
    displayName: input.displayName ?? input.id,
    endpoint: Object.freeze({
      host: input.endpoint?.host,
      port: input.endpoint?.port,
      transport: input.endpoint?.transport ?? "tcp"
    }),
    bind: Object.freeze({
      address: input.bind?.address ?? "0.0.0.0",
      port: input.bind?.port ?? input.endpoint?.port,
      protocol: input.bind?.protocol ?? input.endpoint?.transport ?? "tcp"
    }),
    credentialsRef: input.credentialsRef,
    requiredCapabilities: freezeArray(input.requiredCapabilities),
    tags: freezeArray(input.tags),
    status: input.status ?? "queued",
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });

  const result = validateOutboundPlan(plan);
  if (!result.ok) {
    throw new Error(`Invalid outbound plan: ${result.errors.join("; ")}`);
  }

  return plan;
}
