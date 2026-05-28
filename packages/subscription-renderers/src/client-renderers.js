import { createHash, createHmac } from "node:crypto";
import { assertValidSubscriptionManifest } from "../../subscription-schema/src/index.js";
import { renderJsonManifest } from "./json-renderer.js";

export const SUPPORTED_RENDER_FORMATS = Object.freeze([
  "lumen-json",
  "sing-box",
  "clash-meta",
  "mihomo"
]);
const LIVE_CLIENT_PROTOCOLS = new Set(["vless-reality", "vless-tcp-tls"]);

function flattenProtocolEntries(manifest) {
  return manifest.nodes.flatMap((node) =>
    node.protocols.map((protocol, index) => ({
      tag: `${node.id}-${protocol.id ?? protocol.type ?? index}`,
      node,
      protocol,
      manifest
    }))
  );
}

function mapClientType(type) {
  if (type === "vless-reality" || type === "vless-tcp-tls") {
    return "vless";
  }
  if (type === "hysteria2") {
    return "hysteria2";
  }
  if (type === "shadowsocks") {
    return "ss";
  }
  return type;
}

function assertLiveClientProtocol(protocol) {
  if (LIVE_CLIENT_PROTOCOLS.has(protocol.type)) {
    return;
  }
  throw new Error(`Protocol ${protocol.type} is not enabled for client rendering`);
}

function compactObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      continue;
    }
    output[key] = value;
  }
  return Object.freeze(output);
}

function rendererSeed(options = {}) {
  const seed = options.credentialSeed ?? process.env.LUMEN_SUBSCRIPTION_RENDERER_SEED;
  if (typeof seed !== "string" || seed.trim().length < 32) {
    throw new Error("credentialSeed must be provided for client subscription rendering");
  }
  return seed;
}

function deriveCredentialText(entry, options, label, length) {
  const base = [
    entry.manifest.subscription.id,
    entry.protocol.credentialsRef,
    entry.protocol.id,
    entry.protocol.type,
    label
  ].join("|");
  return createHmac("sha256", rendererSeed(options)).update(base).digest("base64url").slice(0, length);
}

function deriveUuid(entry, options) {
  const bytes = Buffer.from(deriveCredentialText(entry, options, "uuid", 32), "base64url").subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function credentialsFor(entry, options = {}) {
  return Object.freeze({
    uuid: deriveUuid(entry, options),
    password: deriveCredentialText(entry, options, "password", 24),
    shadowsocksPassword: deriveCredentialText(entry, options, "shadowsocks", 32),
    hysteriaPassword: deriveCredentialText(entry, options, "hysteria2", 24)
  });
}

function nodeLabel(entry) {
  return String(entry.protocol.rendererHints?.name ?? entry.node.displayName ?? entry.node.id);
}

function networkType(protocol) {
  const transport = String(protocol.endpoint.transport ?? "tcp").toLowerCase();
  return transport === "raw" ? "tcp" : transport;
}

function securityName(protocol) {
  return String(protocol.security?.type ?? "none");
}

function renderSingBoxTls(protocol) {
  const security = protocol.security ?? {};
  if (security.type === "none") {
    return null;
  }
  const tls = {
    enabled: true,
    server_name: security.serverName,
    alpn: security.alpn,
    insecure: Boolean(security.allowInsecure)
  };
  if (security.fingerprint) {
    tls.utls = { enabled: true, fingerprint: security.fingerprint };
  }
  if (security.type === "reality") {
    tls.reality = compactObject({
      enabled: true,
      public_key: security.publicKey,
      short_id: security.shortId
    });
  }
  return compactObject(tls);
}

function renderSingBoxOutbound(entry, options) {
  const protocol = entry.protocol;
  assertLiveClientProtocol(protocol);
  const type = mapClientType(protocol.type);
  const credentials = credentialsFor(entry, options);
  const base = {
    tag: nodeLabel(entry),
    type,
    server: protocol.endpoint.host,
    server_port: protocol.endpoint.port
  };

  if (type === "vless") {
    return compactObject({
      ...base,
      uuid: credentials.uuid,
      flow: protocol.flow,
      tls: renderSingBoxTls(protocol)
    });
  }
  if (type === "trojan") {
    return compactObject({ ...base, password: credentials.password, tls: renderSingBoxTls(protocol) });
  }
  if (type === "ss") {
    return compactObject({
      ...base,
      method: protocol.rendererHints?.method ?? "2022-blake3-aes-128-gcm",
      password: credentials.shadowsocksPassword
    });
  }
  if (type === "hysteria2") {
    return compactObject({ ...base, password: credentials.hysteriaPassword, tls: renderSingBoxTls(protocol) });
  }
  return null;
}

export function renderSingBoxConfig(manifest, options = {}) {
  assertValidSubscriptionManifest(manifest);

  const outbounds = flattenProtocolEntries(manifest)
    .map((entry) => renderSingBoxOutbound(entry, options))
    .filter(Boolean);
  if (outbounds.length === 0) {
    throw new Error("Manifest does not contain protocols supported by sing-box renderer");
  }
  const selectorTags = outbounds.map((outbound) => outbound.tag);
  outbounds.push({ type: "selector", tag: "Lumen", outbounds: selectorTags });
  return Object.freeze({
    log: { level: "warn" },
    dns: { servers: [{ tag: "cloudflare", address: "1.1.1.1" }] },
    inbounds: [
      { type: "tun", tag: "tun-in", address: ["172.19.0.1/30"], auto_route: true }
    ],
    outbounds,
    route: { final: "Lumen", auto_detect_interface: true }
  });
}

function yamlScalar(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function yamlObject(value, indent, listItem = false) {
  const lines = [];
  const prefix = " ".repeat(indent);
  const firstPrefix = listItem ? `${prefix}- ` : prefix;
  const childPrefix = " ".repeat(indent + (listItem ? 2 : 0));
  let first = true;
  for (const [key, child] of Object.entries(value)) {
    const currentPrefix = first ? firstPrefix : childPrefix;
    first = false;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      lines.push(`${currentPrefix}${key}:`);
      lines.push(...yamlObject(child, indent + (listItem ? 4 : 2)));
    } else if (Array.isArray(child)) {
      lines.push(`${currentPrefix}${key}:`);
      lines.push(...child.map((item) => `${childPrefix}  - ${yamlScalar(item)}`));
    } else {
      lines.push(`${currentPrefix}${key}: ${yamlScalar(child)}`);
    }
  }
  return lines;
}

function addMihomoSecurity(output, protocol) {
  const security = protocol.security ?? {};
  if (security.serverName) {
    output.servername = security.serverName;
    output.sni = security.serverName;
  }
  output["skip-cert-verify"] = Boolean(security.allowInsecure);
  if (security.fingerprint) {
    output["client-fingerprint"] = security.fingerprint;
  }
  if (security.alpn?.length) {
    output.alpn = security.alpn;
  }
  if (security.type === "reality") {
    output["reality-opts"] = compactObject({
      "public-key": security.publicKey,
      "short-id": security.shortId
    });
  }
}

function renderMihomoProxy(entry, options) {
  const protocol = entry.protocol;
  assertLiveClientProtocol(protocol);
  const type = mapClientType(protocol.type);
  const credentials = credentialsFor(entry, options);
  const base = {
    name: nodeLabel(entry),
    type,
    server: protocol.endpoint.host,
    port: protocol.endpoint.port,
    network: networkType(protocol)
  };

  if (type === "vless") {
    const proxy = { ...base, uuid: credentials.uuid, udp: true, tls: securityName(protocol) !== "none" };
    if (protocol.flow) {
      proxy.flow = protocol.flow;
    }
    addMihomoSecurity(proxy, protocol);
    return compactObject(proxy);
  }
  if (type === "trojan") {
    const proxy = { ...base, password: credentials.password, udp: true, tls: true };
    addMihomoSecurity(proxy, protocol);
    return compactObject(proxy);
  }
  if (type === "ss") {
    return compactObject({
      ...base,
      cipher: protocol.rendererHints?.method ?? "2022-blake3-aes-128-gcm",
      password: credentials.shadowsocksPassword,
      udp: true
    });
  }
  if (type === "hysteria2") {
    const proxy = { ...base, password: credentials.hysteriaPassword, udp: true };
    if (protocol.security?.serverName) {
      proxy.sni = protocol.security.serverName;
    }
    return compactObject(proxy);
  }
  return null;
}

export function renderMihomoYaml(manifest, options = {}) {
  assertValidSubscriptionManifest(manifest);

  const proxies = flattenProtocolEntries(manifest)
    .map((entry) => renderMihomoProxy(entry, options))
    .filter(Boolean);
  if (proxies.length === 0) {
    throw new Error("Manifest does not contain protocols supported by Mihomo renderer");
  }
  const names = proxies.map((proxy) => proxy.name);
  const lines = [
    "mixed-port: 7890",
    "allow-lan: false",
    "mode: rule",
    "log-level: warning",
    "proxies:"
  ];
  if (proxies.length === 0) {
    lines.push("  []");
  }
  for (const proxy of proxies) {
    lines.push(...yamlObject(proxy, 2, true));
  }
  lines.push(
    "proxy-groups:",
    "  - name: Lumen",
    "    type: select",
    "    proxies:",
    ...names.map((name) => `      - ${yamlScalar(name)}`),
    "rules:",
    "  - MATCH,Lumen",
    ""
  );
  return lines.join("\n");
}

export function renderClientSubscription(manifest, format, options = {}) {
  if (!SUPPORTED_RENDER_FORMATS.includes(format)) {
    throw new Error(`Unsupported subscription render format: ${format}`);
  }

  if (format === "lumen-json") {
    return renderJsonManifest(manifest, options);
  }

  if (format === "sing-box") {
    return `${JSON.stringify(renderSingBoxConfig(manifest, options), null, options.space ?? 2)}\n`;
  }

  return renderMihomoYaml(manifest, options);
}
