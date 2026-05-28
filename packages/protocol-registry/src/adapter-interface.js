export const PROTOCOL_ADAPTER_CONTRACT_VERSION = "lumen.protocol-adapter.v1";

const ADAPTER_STATUSES = new Set(["catalog", "experimental", "stable", "deprecated"]);

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function freezeArray(value) {
  return Object.freeze([...(value ?? [])]);
}

export function defineProtocolAdapter(adapter) {
  const errors = [];

  if (adapter === null || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new Error("Protocol adapter must be an object");
  }

  requireString(adapter.protocol, "protocol", errors);
  requireString(adapter.displayName, "displayName", errors);
  requireString(adapter.status, "status", errors);

  if (adapter.status && !ADAPTER_STATUSES.has(adapter.status)) {
    errors.push(`status must be one of ${[...ADAPTER_STATUSES].join(", ")}`);
  }

  if (adapter.planOutbound !== undefined && typeof adapter.planOutbound !== "function") {
    errors.push("planOutbound must be a function when provided");
  }

  if (adapter.validateConfig !== undefined && typeof adapter.validateConfig !== "function") {
    errors.push("validateConfig must be a function when provided");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid protocol adapter: ${errors.join("; ")}`);
  }

  return Object.freeze({
    contractVersion: PROTOCOL_ADAPTER_CONTRACT_VERSION,
    protocol: adapter.protocol,
    displayName: adapter.displayName,
    status: adapter.status,
    capabilities: freezeArray(adapter.capabilities),
    requiredCredentialRefs: freezeArray(adapter.requiredCredentialRefs),
    rendererHints: Object.freeze({ ...(adapter.rendererHints ?? {}) }),
    validateConfig: adapter.validateConfig ?? (() => ({ ok: true, errors: Object.freeze([]) })),
    planOutbound: adapter.planOutbound ?? (() => {
      throw new Error(`Protocol adapter ${adapter.protocol} does not implement planOutbound`);
    })
  });
}

export function createProtocolRegistry(adapters = []) {
  const byProtocol = new Map();

  for (const adapter of adapters) {
    const normalized = defineProtocolAdapter(adapter);
    if (byProtocol.has(normalized.protocol)) {
      throw new Error(`Duplicate protocol adapter: ${normalized.protocol}`);
    }
    byProtocol.set(normalized.protocol, normalized);
  }

  return Object.freeze({
    list() {
      return Object.freeze([...byProtocol.values()]);
    },
    has(protocol) {
      return byProtocol.has(protocol);
    },
    get(protocol) {
      return byProtocol.get(protocol) ?? null;
    },
    require(protocol) {
      const adapter = byProtocol.get(protocol);
      if (!adapter) {
        throw new Error(`Protocol adapter not registered: ${protocol}`);
      }
      return adapter;
    }
  });
}
