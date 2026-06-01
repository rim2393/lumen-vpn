import { defineProtocolAdapter } from "./adapter-interface.js";
import { createBindReservation } from "./port-reservations.js";
import { assertNoInlineSecretLikeFields } from "./secret-scan.js";

export const GENERIC_OUTBOUND_PLAN_KIND = "lumen.protocol-outbound.runtime-plan.v1";

const PROTOCOL_RUNTIMES = Object.freeze({
  trojan: Object.freeze({
    runtime: "xray-core",
    capability: "runtime.xray_core",
    credentialSlots: Object.freeze(["passwordRef"]),
    transport: "tcp"
  }),
  shadowsocks: Object.freeze({
    runtime: "sing-box",
    capability: "runtime.sing_box",
    credentialSlots: Object.freeze(["methodRef", "passwordRef"]),
    transport: "tcp"
  }),
  wireguard: Object.freeze({
    runtime: "wireguard",
    capability: "runtime.wireguard",
    credentialSlots: Object.freeze(["privateKeyRef", "peerPublicKeyRef"]),
    transport: "udp"
  }),
  hysteria2: Object.freeze({
    runtime: "hysteria2",
    capability: "runtime.hysteria2",
    credentialSlots: Object.freeze(["authRef"]),
    transport: "udp"
  }),
  "openvpn-shadowsocks": Object.freeze({
    runtime: "openvpn-shadowsocks",
    capability: "runtime.openvpn_shadowsocks",
    credentialSlots: Object.freeze(["usernameRef", "passwordRef", "shadowsocksPasswordRef"]),
    transport: "tcp"
  })
});

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

function normalizeEndpoint(endpoint = {}, defaultTransport, errors) {
  const normalized = {
    host: endpoint.host,
    port: endpoint.port,
    transport: endpoint.transport ?? defaultTransport,
    network: endpoint.network ?? "public"
  };
  requireString(normalized.host, "endpoint.host", errors);
  requirePort(normalized.port, "endpoint.port", errors);
  requireString(normalized.transport, "endpoint.transport", errors);
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
  requireString(normalized.protocol, "bind.protocol", errors);
  if (typeof normalized.exclusive !== "boolean") {
    errors.push("bind.exclusive must be a boolean");
  }
  return freezeObject(normalized);
}

export function validateRuntimeProtocolConfig(protocol, request = {}) {
  try {
    assertNoInlineSecretLikeFields(request, `${protocol} outbound request`);
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const runtime = PROTOCOL_RUNTIMES[protocol];
  const errors = [];
  requireString(request.nodeId, "nodeId", errors);
  requireString(request.outboundId, "outboundId", errors);
  requireString(request.credentialsRef, "credentialsRef", errors);
  const endpoint = normalizeEndpoint(request.endpoint, runtime.transport, errors);
  const bind = normalizeBind(request.bind, endpoint, errors);

  return {
    ok: errors.length === 0,
    errors,
    normalized: errors.length === 0
      ? Object.freeze({
        protocol,
        nodeId: request.nodeId,
        outboundId: request.outboundId,
        displayName: request.displayName ?? request.outboundId,
        endpoint,
        bind,
        credentialsRef: request.credentialsRef,
        security: freezeObject(request.security ?? {}),
        rendererHints: freezeObject(request.rendererHints ?? {}),
        tags: freezeArray(request.tags),
        metadata: freezeObject(request.metadata ?? {})
      })
      : null
  };
}

export function createRuntimeProtocolOutboundPlan(protocol, request = {}) {
  const runtime = PROTOCOL_RUNTIMES[protocol];
  if (!runtime) {
    throw new Error(`Unsupported runtime protocol: ${protocol}`);
  }
  const result = validateRuntimeProtocolConfig(protocol, request);
  if (!result.ok) {
    throw new Error(`Invalid ${protocol} protocol config: ${result.errors.join("; ")}`);
  }
  const normalized = result.normalized;
  const reservation = createBindReservation({
    ownerId: normalized.outboundId,
    address: normalized.bind.address,
    port: normalized.bind.port,
    protocol: normalized.bind.protocol,
    purpose: `${protocol}-listener`,
    exclusive: normalized.bind.exclusive
  });

  return Object.freeze({
    kind: GENERIC_OUTBOUND_PLAN_KIND,
    protocol,
    adapter: protocol,
    runtime: runtime.runtime,
    implementationStatus: "config-plan",
    nodeId: normalized.nodeId,
    outboundId: normalized.outboundId,
    displayName: normalized.displayName,
    endpoint: normalized.endpoint,
    bind: normalized.bind,
    portReservations: Object.freeze([reservation]),
    credentialsRef: normalized.credentialsRef,
    credentialSlots: runtime.credentialSlots,
    requiredCapabilities: Object.freeze([runtime.capability]),
    security: normalized.security,
    rendererHints: normalized.rendererHints,
    tags: normalized.tags,
    metadata: normalized.metadata,
    warnings: Object.freeze([
      "Plan is a protocol shape only. Resolve credentialsRef and render live runtime config outside this package."
    ])
  });
}

function runtimeAdapter(config) {
  return defineProtocolAdapter({
    ...config,
    status: "experimental",
    validateConfig: (request) => validateRuntimeProtocolConfig(config.protocol, request),
    planOutbound: (request) => createRuntimeProtocolOutboundPlan(config.protocol, request)
  });
}

export const runtimeProtocolAdapters = Object.freeze([
  runtimeAdapter({
    protocol: "trojan",
    displayName: "Trojan",
    capabilities: Object.freeze(["tcp", "tls", "xray-core"]),
    requiredCredentialRefs: Object.freeze(["passwordRef"]),
    rendererHints: Object.freeze({ singBoxType: "trojan", clashMetaType: "trojan" })
  }),
  runtimeAdapter({
    protocol: "shadowsocks",
    displayName: "Shadowsocks",
    capabilities: Object.freeze(["tcp", "udp", "sing-box"]),
    requiredCredentialRefs: Object.freeze(["methodRef", "passwordRef"]),
    rendererHints: Object.freeze({ singBoxType: "shadowsocks", clashMetaType: "ss" })
  }),
  runtimeAdapter({
    protocol: "wireguard",
    displayName: "WireGuard",
    capabilities: Object.freeze(["udp", "kernel-wireguard"]),
    requiredCredentialRefs: Object.freeze(["privateKeyRef", "peerPublicKeyRef"]),
    rendererHints: Object.freeze({ singBoxType: "wireguard", clashMetaType: "wireguard" })
  }),
  runtimeAdapter({
    protocol: "hysteria2",
    displayName: "Hysteria2",
    capabilities: Object.freeze(["udp", "quic", "hysteria2"]),
    requiredCredentialRefs: Object.freeze(["authRef"]),
    rendererHints: Object.freeze({ singBoxType: "hysteria2", clashMetaType: "hysteria2" })
  }),
  runtimeAdapter({
    protocol: "openvpn-shadowsocks",
    displayName: "OpenVPN over Shadowsocks",
    capabilities: Object.freeze(["tcp", "openvpn", "shadowsocks"]),
    requiredCredentialRefs: Object.freeze(["usernameRef", "passwordRef", "shadowsocksPasswordRef"]),
    rendererHints: Object.freeze({ rawType: "openvpn", delivery: "ovpn-socks-proxy" })
  })
]);
