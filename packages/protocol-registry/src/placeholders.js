import { createProtocolRegistry, defineProtocolAdapter } from "./adapter-interface.js";
import { vlessProtocolAdapters } from "./vless.js";

function createPlaceholderPlan(protocol, request = {}) {
  return Object.freeze({
    kind: "lumen.protocol-outbound.placeholder.v1",
    protocol,
    nodeId: request.nodeId ?? null,
    outboundId: request.outboundId ?? null,
    endpoint: Object.freeze({ ...(request.endpoint ?? {}) }),
    credentialsRef: request.credentialsRef ?? null,
    implementationStatus: "not-implemented",
    warnings: Object.freeze([
      "Protocol adapter is a placeholder and must not be used to provision live traffic."
    ])
  });
}

function placeholderAdapter(config) {
  return defineProtocolAdapter({
    status: "placeholder",
    ...config,
    planOutbound: (request) => createPlaceholderPlan(config.protocol, request)
  });
}

export const firstProtocolPlaceholders = Object.freeze([
  Object.freeze({
    protocol: "vless",
    displayName: "VLESS",
    capabilities: Object.freeze(["tcp", "tls", "reality", "grpc"]),
    requiredCredentialRefs: Object.freeze(["uuidRef"]),
    rendererHints: Object.freeze({ singBoxType: "vless", clashMetaType: "vless" })
  }),
  Object.freeze({
    protocol: "trojan",
    displayName: "Trojan",
    capabilities: Object.freeze(["tcp", "tls", "grpc"]),
    requiredCredentialRefs: Object.freeze(["passwordRef"]),
    rendererHints: Object.freeze({ singBoxType: "trojan", clashMetaType: "trojan" })
  }),
  Object.freeze({
    protocol: "shadowsocks",
    displayName: "Shadowsocks",
    capabilities: Object.freeze(["tcp", "udp"]),
    requiredCredentialRefs: Object.freeze(["methodRef", "passwordRef"]),
    rendererHints: Object.freeze({ singBoxType: "shadowsocks", clashMetaType: "ss" })
  }),
  Object.freeze({
    protocol: "wireguard",
    displayName: "WireGuard",
    capabilities: Object.freeze(["udp", "kernel-wireguard"]),
    requiredCredentialRefs: Object.freeze(["privateKeyRef", "peerPublicKeyRef"]),
    rendererHints: Object.freeze({ singBoxType: "wireguard", clashMetaType: "wireguard" })
  }),
  Object.freeze({
    protocol: "hysteria2",
    displayName: "Hysteria2",
    capabilities: Object.freeze(["udp", "quic"]),
    requiredCredentialRefs: Object.freeze(["authRef"]),
    rendererHints: Object.freeze({ singBoxType: "hysteria2", clashMetaType: "hysteria2" })
  })
]);

export const protocolPlaceholderAdapters = Object.freeze(
  firstProtocolPlaceholders.map((config) => placeholderAdapter(config))
);

export const defaultProtocolRegistry = createProtocolRegistry([
  ...vlessProtocolAdapters,
  ...protocolPlaceholderAdapters
]);
