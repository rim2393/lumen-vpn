import { defineProtocolAdapter } from "./adapter-interface.js";
import { createBindReservation } from "./port-reservations.js";
import { assertNoInlineSecretLikeFields } from "./secret-scan.js";

export const XRAY_OUTBOUND_PLAN_KIND = "lumen.protocol-outbound.xray.v1";

const XRAY_CORE_CAPABILITY = "runtime.xray_core";
const TCP_TRANSPORT = "tcp";
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

function freezeArray(value) {
  return Object.freeze([...(value ?? [])]);
}

function freezeObject(value) {
  return Object.freeze({ ...value });
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requirePort(value, path, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${path} must be an integer port between 1 and 65535`);
  }
}

function requireTcpTransport(value, path, errors) {
  if ((value ?? TCP_TRANSPORT) !== TCP_TRANSPORT) {
    errors.push(`${path} must be tcp for Xray VLESS Reality/TLS`);
  }
}

function normalizeEndpoint(endpoint = {}, errors) {
  const normalized = {
    host: endpoint.host,
    port: endpoint.port,
    transport: endpoint.transport ?? TCP_TRANSPORT,
    network: endpoint.network ?? "public"
  };

  requireString(normalized.host, "endpoint.host", errors);
  requirePort(normalized.port, "endpoint.port", errors);
  requireTcpTransport(normalized.transport, "endpoint.transport", errors);

  return freezeObject(normalized);
}

function normalizeBind(bind = {}, endpoint, errors) {
  const normalized = {
    address: bind.address ?? "0.0.0.0",
    port: bind.port ?? endpoint.port,
    protocol: bind.protocol ?? endpoint.transport,
    exclusive: bind.exclusive ?? true
  };

  requireString(normalized.address, "bind.address", errors);
  requirePort(normalized.port, "bind.port", errors);
  requireTcpTransport(normalized.protocol, "bind.protocol", errors);

  if (typeof normalized.exclusive !== "boolean") {
    errors.push("bind.exclusive must be a boolean");
  }

  return freezeObject(normalized);
}

function normalizeStringArray(value, path, errors) {
  if (value === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of strings`);
    return Object.freeze([]);
  }

  const normalized = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push(`${path}[${index}] must be a non-empty string`);
    } else {
      normalized.push(item);
    }
  });
  return Object.freeze(normalized);
}

function validateShortId(shortId, path, errors) {
  if (shortId === undefined || shortId === null) {
    return;
  }
  if (typeof shortId !== "string" || !/^[0-9a-fA-F]{0,16}$/.test(shortId)) {
    errors.push(`${path} must be 0 to 16 hex characters`);
  }
}

function normalizeDestination(destination, serverName, errors) {
  if (destination === undefined || destination === null) {
    return `${serverName}:443`;
  }

  if (typeof destination === "string") {
    requireString(destination, "security.destination", errors);
    return destination;
  }

  if (typeof destination === "object" && !Array.isArray(destination)) {
    requireString(destination.host, "security.destination.host", errors);
    requirePort(destination.port, "security.destination.port", errors);
    return `${destination.host}:${destination.port}`;
  }

  errors.push("security.destination must be a host:port string or an object with host and port");
  return `${serverName}:443`;
}

function normalizeFingerprint(value, errors) {
  const fingerprint = value ?? "chrome";
  requireString(fingerprint, "security.fingerprint", errors);
  if (typeof fingerprint === "string" && !SUPPORTED_FINGERPRINTS.has(fingerprint)) {
    errors.push(`security.fingerprint must be one of ${[...SUPPORTED_FINGERPRINTS].join(", ")}`);
  }
  return fingerprint;
}

function normalizeCommonRequest(request, protocol, errors) {
  requireString(request.nodeId, "nodeId", errors);
  requireString(request.outboundId, "outboundId", errors);
  requireString(request.credentialsRef, "credentialsRef", errors);

  const endpoint = normalizeEndpoint(request.endpoint, errors);
  const bind = normalizeBind(request.bind, endpoint, errors);

  return {
    protocol,
    nodeId: request.nodeId,
    outboundId: request.outboundId,
    displayName: request.displayName ?? request.outboundId,
    endpoint,
    bind,
    credentialsRef: request.credentialsRef,
    tags: freezeArray(request.tags),
    metadata: freezeObject(request.metadata ?? {})
  };
}

function normalizeRealitySecurity(security = {}, errors) {
  const serverNames = normalizeStringArray(security.serverNames, "security.serverNames", errors);
  const serverName = security.serverName ?? serverNames[0];

  requireString(serverName, "security.serverName", errors);
  requireString(security.publicKey, "security.publicKey", errors);
  if (typeof security.publicKey === "string" && /\s/.test(security.publicKey)) {
    errors.push("security.publicKey must not contain whitespace");
  }

  validateShortId(security.shortId, "security.shortId", errors);
  const shortIds = security.shortIds === undefined
    ? Object.freeze(security.shortId === undefined ? [] : [security.shortId])
    : normalizeStringArray(security.shortIds, "security.shortIds", errors);
  shortIds.forEach((shortId, index) => validateShortId(shortId, `security.shortIds[${index}]`, errors));

  const normalizedServerNames = serverNames.length > 0 ? serverNames : Object.freeze([serverName]);

  return freezeObject({
    type: "reality",
    serverName,
    serverNames: normalizedServerNames,
    publicKey: security.publicKey,
    shortId: security.shortId ?? shortIds[0] ?? "",
    shortIds,
    fingerprint: normalizeFingerprint(security.fingerprint, errors),
    spiderX: security.spiderX ?? "/",
    destination: normalizeDestination(security.destination, serverName, errors)
  });
}

function normalizeTlsSecurity(security = {}, errors) {
  requireString(security.serverName, "security.serverName", errors);

  if (security.allowInsecure === true) {
    errors.push("security.allowInsecure must remain false for production subscription entries");
  }

  return freezeObject({
    type: "tls",
    serverName: security.serverName,
    alpn: normalizeStringArray(security.alpn, "security.alpn", errors),
    allowInsecure: false
  });
}

function createXrayPlan(common, security, xrayStreamSettings, credentialSlots) {
  const reservation = createBindReservation({
    ownerId: common.outboundId,
    address: common.bind.address,
    port: common.bind.port,
    protocol: common.bind.protocol,
    purpose: `${common.protocol}-listener`,
    exclusive: common.bind.exclusive
  });

  return Object.freeze({
    kind: XRAY_OUTBOUND_PLAN_KIND,
    protocol: common.protocol,
    adapter: common.protocol,
    runtime: "xray-core",
    implementationStatus: "config-plan",
    nodeId: common.nodeId,
    outboundId: common.outboundId,
    displayName: common.displayName,
    endpoint: common.endpoint,
    bind: common.bind,
    portReservations: Object.freeze([reservation]),
    credentialsRef: common.credentialsRef,
    credentialSlots: freezeArray(credentialSlots),
    requiredCapabilities: Object.freeze([XRAY_CORE_CAPABILITY]),
    tags: common.tags,
    metadata: common.metadata,
    clientSecurity: security,
    xray: Object.freeze({
      configShape: `xray.inbound.${common.protocol}.v1`,
      inbound: Object.freeze({
        protocol: "vless",
        listen: common.bind.address,
        port: common.bind.port,
        settings: Object.freeze({
          decryption: "none",
          clientsRef: common.credentialsRef
        }),
        streamSettings: xrayStreamSettings
      })
    }),
    warnings: Object.freeze([
      "Plan is a protocol shape only. Resolve credentialsRef and render live Xray config outside this package."
    ])
  });
}

export function validateVlessRealityConfig(request = {}) {
  try {
    assertNoInlineSecretLikeFields(request, "vless-reality outbound request");
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const errors = [];
  const common = normalizeCommonRequest(request, "vless-reality", errors);
  const security = normalizeRealitySecurity(request.security, errors);

  return {
    ok: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? Object.freeze({ ...common, security }) : null
  };
}

export function validateVlessTcpTlsConfig(request = {}) {
  try {
    assertNoInlineSecretLikeFields(request, "vless-tcp-tls outbound request");
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const errors = [];
  const common = normalizeCommonRequest(request, "vless-tcp-tls", errors);
  const security = normalizeTlsSecurity(request.security, errors);

  return {
    ok: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? Object.freeze({ ...common, security }) : null
  };
}

export function createVlessRealityOutboundPlan(request = {}) {
  const result = validateVlessRealityConfig(request);
  if (!result.ok) {
    throw new Error(`Invalid vless-reality protocol config: ${result.errors.join("; ")}`);
  }

  const { security, ...common } = result.normalized;
  return createXrayPlan(
    common,
    security,
    Object.freeze({
      network: "tcp",
      security: "reality",
      realitySettings: Object.freeze({
        serverNames: security.serverNames,
        destination: security.destination,
        shortIds: security.shortIds
      })
    }),
    ["clientsRef", "realityKeyPairRef"]
  );
}

export function createVlessTcpTlsOutboundPlan(request = {}) {
  const result = validateVlessTcpTlsConfig(request);
  if (!result.ok) {
    throw new Error(`Invalid vless-tcp-tls protocol config: ${result.errors.join("; ")}`);
  }

  const { security, ...common } = result.normalized;
  return createXrayPlan(
    common,
    security,
    Object.freeze({
      network: "tcp",
      security: "tls",
      tlsSettings: Object.freeze({
        serverName: security.serverName,
        alpn: security.alpn,
        certificatesRef: common.credentialsRef
      })
    }),
    ["clientsRef", "tlsCertificateRef"]
  );
}

export const vlessRealityAdapter = defineProtocolAdapter({
  protocol: "vless-reality",
  displayName: "VLESS Reality",
  status: "experimental",
  capabilities: Object.freeze(["tcp", "reality", "xray-core"]),
  requiredCredentialRefs: Object.freeze(["clientsRef", "realityKeyPairRef"]),
  rendererHints: Object.freeze({
    family: "vless",
    security: "reality",
    singBoxType: "vless",
    clashMetaType: "vless"
  }),
  validateConfig: validateVlessRealityConfig,
  planOutbound: createVlessRealityOutboundPlan
});

export const vlessTcpTlsAdapter = defineProtocolAdapter({
  protocol: "vless-tcp-tls",
  displayName: "VLESS TCP TLS",
  status: "experimental",
  capabilities: Object.freeze(["tcp", "tls", "xray-core"]),
  requiredCredentialRefs: Object.freeze(["clientsRef", "tlsCertificateRef"]),
  rendererHints: Object.freeze({
    family: "vless",
    security: "tls",
    singBoxType: "vless",
    clashMetaType: "vless"
  }),
  validateConfig: validateVlessTcpTlsConfig,
  planOutbound: createVlessTcpTlsOutboundPlan
});

export const vlessProtocolAdapters = Object.freeze([
  vlessRealityAdapter,
  vlessTcpTlsAdapter
]);
