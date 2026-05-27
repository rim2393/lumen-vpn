export const SUBSCRIPTION_MANIFEST_SCHEMA_VERSION = "lumen.subscription-manifest.v1";

export const SUPPORTED_SUBSCRIPTION_PROTOCOLS = Object.freeze([
  "vless-reality",
  "vless-tcp-tls",
  "vless",
  "trojan",
  "shadowsocks",
  "wireguard",
  "hysteria2"
]);

const SUPPORTED_PROTOCOL_SET = new Set(SUPPORTED_SUBSCRIPTION_PROTOCOLS);
const PROTOCOL_SECURITY_DEFAULTS = Object.freeze({
  "vless-reality": "reality",
  "vless-tcp-tls": "tls"
});

const SUPPORTED_SECURITY_TYPES = new Set(["none", "reality", "tls"]);
const SUPPORTED_FINGERPRINTS = new Set([
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "random",
  "randomized",
  "none"
]);

const FORBIDDEN_INLINE_SECRET_KEYS = new Set([
  "secret",
  "secrets",
  "password",
  "passwd",
  "token",
  "accessToken",
  "access_token",
  "bearerToken",
  "bearer_token",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
  "uuid",
  "clientUuid",
  "client_uuid",
  "userUuid",
  "user_uuid",
  "vlessUuid",
  "vless_uuid",
  "subscriptionUrl",
  "subscription_url",
  "generatedConfig",
  "generated_config"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key) {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function findForbiddenInlineSecretKeys(value, path = "$", violations = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenInlineSecretKeys(item, `${path}[${index}]`, violations));
    return violations;
  }

  if (!isPlainObject(value)) {
    return violations;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    for (const forbiddenKey of FORBIDDEN_INLINE_SECRET_KEYS) {
      if (normalized === normalizeKey(forbiddenKey)) {
        violations.push(`${path}.${key}`);
      }
    }
    findForbiddenInlineSecretKeys(child, `${path}.${key}`, violations);
  }

  return violations;
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requirePort(value, path, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer TCP/UDP port`);
  }
}

function optionalString(value, path, errors) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    errors.push(`${path} must be a string when provided`);
  }
}

function optionalBoolean(value, path, errors) {
  if (value !== null && value !== undefined && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean when provided`);
  }
}

function normalizeStringArray(value = []) {
  if (value === null || value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    return value;
  }
  return Object.freeze([...value]);
}

function normalizeProtocolEndpoint(endpoint = {}) {
  return Object.freeze({
    host: endpoint.host,
    port: endpoint.port,
    transport: endpoint.transport ?? "tcp",
    network: endpoint.network ?? "public"
  });
}

function normalizeProtocolSecurity(protocol = {}) {
  const security = protocol.security ?? {};
  const type = security.type ?? PROTOCOL_SECURITY_DEFAULTS[protocol.type] ?? "none";

  return Object.freeze({
    type,
    serverName: security.serverName ?? null,
    publicKey: security.publicKey ?? null,
    shortId: security.shortId ?? null,
    fingerprint: security.fingerprint ?? null,
    spiderX: security.spiderX ?? null,
    alpn: normalizeStringArray(security.alpn),
    allowInsecure: security.allowInsecure ?? false
  });
}

function normalizeProtocol(protocol = {}) {
  return Object.freeze({
    id: protocol.id ?? protocol.type,
    type: protocol.type,
    adapter: protocol.adapter ?? protocol.type,
    endpoint: normalizeProtocolEndpoint(protocol.endpoint),
    security: normalizeProtocolSecurity(protocol),
    flow: protocol.flow ?? null,
    credentialsRef: protocol.credentialsRef,
    capabilities: Object.freeze([...(protocol.capabilities ?? [])]),
    rendererHints: Object.freeze({ ...(protocol.rendererHints ?? {}) })
  });
}

function normalizeNode(node = {}) {
  return Object.freeze({
    id: node.id,
    displayName: node.displayName ?? node.id,
    region: node.region ?? "unknown",
    priority: node.priority ?? 100,
    tags: Object.freeze([...(node.tags ?? [])]),
    protocols: Object.freeze((node.protocols ?? []).map(normalizeProtocol)),
    metadata: Object.freeze({ ...(node.metadata ?? {}) })
  });
}

export function createSubscriptionManifest(input = {}) {
  const manifest = Object.freeze({
    schemaVersion: SUBSCRIPTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    provider: Object.freeze({
      id: input.provider?.id,
      name: input.provider?.name
    }),
    subscription: Object.freeze({
      id: input.subscription?.id,
      audience: input.subscription?.audience ?? "lumen-client",
      expiresAt: input.subscription?.expiresAt ?? null,
      refreshAfter: input.subscription?.refreshAfter ?? null
    }),
    nodes: Object.freeze((input.nodes ?? []).map(normalizeNode)),
    renderHints: Object.freeze({
      preferredFormats: Object.freeze([...(input.renderHints?.preferredFormats ?? ["lumen-json"])])
    }),
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });

  return assertValidSubscriptionManifest(manifest);
}

export function validateSubscriptionManifest(manifest) {
  const errors = [];

  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  if (manifest.schemaVersion !== SUBSCRIPTION_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SUBSCRIPTION_MANIFEST_SCHEMA_VERSION}`);
  }

  requireString(manifest.generatedAt, "generatedAt", errors);
  requireString(manifest.provider?.id, "provider.id", errors);
  requireString(manifest.provider?.name, "provider.name", errors);
  requireString(manifest.subscription?.id, "subscription.id", errors);
  requireString(manifest.subscription?.audience, "subscription.audience", errors);

  if (!Array.isArray(manifest.nodes)) {
    errors.push("nodes must be an array");
  } else {
    manifest.nodes.forEach((node, nodeIndex) => {
      const nodePath = `nodes[${nodeIndex}]`;
      requireString(node.id, `${nodePath}.id`, errors);
      requireString(node.displayName, `${nodePath}.displayName`, errors);
      requireString(node.region, `${nodePath}.region`, errors);

      if (!Number.isInteger(node.priority)) {
        errors.push(`${nodePath}.priority must be an integer`);
      }

      if (!Array.isArray(node.protocols) || node.protocols.length === 0) {
        errors.push(`${nodePath}.protocols must contain at least one protocol`);
      } else {
        node.protocols.forEach((protocol, protocolIndex) => {
          const protocolPath = `${nodePath}.protocols[${protocolIndex}]`;
          optionalString(protocol.id, `${protocolPath}.id`, errors);
          requireString(protocol.type, `${protocolPath}.type`, errors);
          requireString(protocol.adapter, `${protocolPath}.adapter`, errors);
          requireString(protocol.credentialsRef, `${protocolPath}.credentialsRef`, errors);
          requireString(protocol.endpoint?.host, `${protocolPath}.endpoint.host`, errors);
          requirePort(protocol.endpoint?.port, `${protocolPath}.endpoint.port`, errors);

          if (protocol.type && !SUPPORTED_PROTOCOL_SET.has(protocol.type)) {
            errors.push(`${protocolPath}.type is not supported: ${protocol.type}`);
          }

          validateProtocolSecurity(protocol, protocolPath, errors);
        });
      }
    });
  }

  const secretViolations = findForbiddenInlineSecretKeys(manifest);
  if (secretViolations.length > 0) {
    errors.push(`inline secret-like fields are not allowed: ${secretViolations.join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidSubscriptionManifest(manifest) {
  const result = validateSubscriptionManifest(manifest);
  if (!result.ok) {
    throw new Error(`Invalid subscription manifest: ${result.errors.join("; ")}`);
  }
  return manifest;
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push(`${path}[${index}] must be a non-empty string`);
    }
  });
}

function validateShortId(value, path, errors) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "string" || !/^[0-9a-fA-F]{0,16}$/.test(value)) {
    errors.push(`${path} must be 0 to 16 hex characters`);
  }
}

function validateProtocolSecurity(protocol, protocolPath, errors) {
  const security = protocol.security ?? {
    type: PROTOCOL_SECURITY_DEFAULTS[protocol.type] ?? "none",
    alpn: [],
    allowInsecure: false
  };
  requireString(security.type, `${protocolPath}.security.type`, errors);

  if (security.type && !SUPPORTED_SECURITY_TYPES.has(security.type)) {
    errors.push(`${protocolPath}.security.type is not supported: ${security.type}`);
  }

  if (protocol.type in PROTOCOL_SECURITY_DEFAULTS && security.type !== PROTOCOL_SECURITY_DEFAULTS[protocol.type]) {
    errors.push(`${protocolPath}.security.type must be ${PROTOCOL_SECURITY_DEFAULTS[protocol.type]} for ${protocol.type}`);
  }

  optionalString(protocol.flow, `${protocolPath}.flow`, errors);
  optionalString(security.serverName, `${protocolPath}.security.serverName`, errors);
  optionalString(security.publicKey, `${protocolPath}.security.publicKey`, errors);
  optionalString(security.shortId, `${protocolPath}.security.shortId`, errors);
  optionalString(security.fingerprint, `${protocolPath}.security.fingerprint`, errors);
  optionalString(security.spiderX, `${protocolPath}.security.spiderX`, errors);
  optionalBoolean(security.allowInsecure, `${protocolPath}.security.allowInsecure`, errors);
  validateStringArray(security.alpn, `${protocolPath}.security.alpn`, errors);
  validateShortId(security.shortId, `${protocolPath}.security.shortId`, errors);

  if (security.fingerprint && !SUPPORTED_FINGERPRINTS.has(security.fingerprint)) {
    errors.push(`${protocolPath}.security.fingerprint must be one of ${[...SUPPORTED_FINGERPRINTS].join(", ")}`);
  }

  if ((protocol.type === "vless-reality" || protocol.type === "vless-tcp-tls") && (protocol.endpoint?.transport ?? "tcp") !== "tcp") {
    errors.push(`${protocolPath}.endpoint.transport must be tcp for ${protocol.type}`);
  }

  if (protocol.type === "vless-reality") {
    requireString(security.serverName, `${protocolPath}.security.serverName`, errors);
    requireString(security.publicKey, `${protocolPath}.security.publicKey`, errors);
    optionalString(security.spiderX, `${protocolPath}.security.spiderX`, errors);
  }

  if (protocol.type === "vless-tcp-tls") {
    requireString(security.serverName, `${protocolPath}.security.serverName`, errors);
    if (security.allowInsecure === true) {
      errors.push(`${protocolPath}.security.allowInsecure must remain false`);
    }
  }
}
