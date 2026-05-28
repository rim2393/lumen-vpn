import { createProtocolRegistry, defineProtocolAdapter } from "./adapter-interface.js";
import { vlessProtocolAdapters } from "./vless.js";

export const protocolCatalogEntries = Object.freeze([
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

export const protocolCatalogAdapters = Object.freeze(
  protocolCatalogEntries.map((config) => defineProtocolAdapter({
    status: "catalog",
    ...config,
    planOutbound: () => {
      throw new Error(`Protocol ${config.protocol} is catalog-only until a production adapter is registered`);
    }
  }))
);

export const defaultProtocolRegistry = createProtocolRegistry([
  ...vlessProtocolAdapters
]);
