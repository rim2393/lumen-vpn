import { assertValidSubscriptionManifest } from "../../subscription-schema/src/index.js";
import { renderJsonManifest } from "./json-renderer.js";

export const SUPPORTED_RENDER_FORMATS = Object.freeze([
  "lumen-json",
  "sing-box-skeleton",
  "clash-meta-skeleton"
]);

function flattenProtocolEntries(manifest) {
  return manifest.nodes.flatMap((node) =>
    node.protocols.map((protocol, index) => ({
      tag: `${node.id}-${protocol.id ?? protocol.type ?? index}`,
      node,
      protocol
    }))
  );
}

function mapSingBoxType(type) {
  if (type === "vless-reality" || type === "vless-tcp-tls") {
    return "vless";
  }
  if (type === "hysteria2") {
    return "hysteria2";
  }
  if (type === "shadowsocks") {
    return "shadowsocks";
  }
  return type;
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
    output[key] = value;
  }
  return Object.freeze(output);
}

function renderSingBoxTls(protocol) {
  const security = protocol.security ?? {};
  if (security.type === "reality") {
    return compactObject({
      enabled: true,
      server_name: security.serverName,
      utls: compactObject({
        enabled: Boolean(security.fingerprint),
        fingerprint: security.fingerprint
      }),
      reality: compactObject({
        enabled: true,
        public_key: security.publicKey,
        short_id: security.shortId,
        spider_x: security.spiderX
      })
    });
  }

  if (security.type === "tls") {
    return compactObject({
      enabled: true,
      server_name: security.serverName,
      alpn: security.alpn,
      insecure: security.allowInsecure
    });
  }

  return null;
}

function renderSingBoxOutbound(tag, node, protocol) {
  return compactObject({
    tag,
    type: mapSingBoxType(protocol.type),
    server: protocol.endpoint.host,
    server_port: protocol.endpoint.port,
    region: node.region,
    credentials_ref: protocol.credentialsRef,
    flow: protocol.flow,
    transport: compactObject({ type: protocol.endpoint.transport }),
    tls: renderSingBoxTls(protocol),
    lumen_adapter: protocol.adapter,
    implementation_status: protocol.type === "vless-reality" || protocol.type === "vless-tcp-tls"
      ? "skeleton-no-inline-credentials"
      : "placeholder"
  });
}

export function renderSingBoxSkeleton(manifest) {
  assertValidSubscriptionManifest(manifest);

  const entries = flattenProtocolEntries(manifest);
  return Object.freeze({
    schemaVersion: "lumen.sing-box-skeleton.v1",
    note: "Skeleton only. Resolve credentialsRef out of band before producing a runnable client config.",
    outbounds: Object.freeze(
      entries.map(({ tag, node, protocol }) =>
        renderSingBoxOutbound(tag, node, protocol)
      )
    )
  });
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function yamlBoolean(value) {
  return value ? "true" : "false";
}

function pushYamlArray(lines, key, value, indent = "    ") {
  if (Array.isArray(value) && value.length > 0) {
    lines.push(`${indent}${key}: [${value.map(yamlScalar).join(", ")}]`);
  }
}

function pushClashSecurity(lines, protocol) {
  const security = protocol.security ?? {};

  if (security.type === "reality") {
    lines.push("    tls: true");
    lines.push(`    servername: ${yamlScalar(security.serverName)}`);
    if (protocol.flow) {
      lines.push(`    flow: ${yamlScalar(protocol.flow)}`);
    }
    if (security.fingerprint) {
      lines.push(`    client-fingerprint: ${yamlScalar(security.fingerprint)}`);
    }
    lines.push("    reality-opts:");
    lines.push(`      public-key: ${yamlScalar(security.publicKey)}`);
    if (security.shortId !== null && security.shortId !== undefined) {
      lines.push(`      short-id: ${yamlScalar(security.shortId)}`);
    }
    if (security.spiderX) {
      lines.push(`      spider-x: ${yamlScalar(security.spiderX)}`);
    }
    return;
  }

  if (security.type === "tls") {
    lines.push("    tls: true");
    lines.push(`    servername: ${yamlScalar(security.serverName)}`);
    lines.push(`    skip-cert-verify: ${yamlBoolean(security.allowInsecure)}`);
    pushYamlArray(lines, "alpn", security.alpn);
  }
}

export function renderClashMetaSkeleton(manifest) {
  assertValidSubscriptionManifest(manifest);

  const lines = [
    "# Lumen Clash Meta skeleton. Credentials are resolved out of band.",
    "proxies:"
  ];

  for (const { tag, node, protocol } of flattenProtocolEntries(manifest)) {
    lines.push(`  - name: ${yamlScalar(tag)}`);
    lines.push(`    type: ${yamlScalar(mapSingBoxType(protocol.type))}`);
    lines.push(`    server: ${yamlScalar(protocol.endpoint.host)}`);
    lines.push(`    port: ${protocol.endpoint.port}`);
    lines.push(`    network: ${yamlScalar(protocol.endpoint.transport)}`);
    pushClashSecurity(lines, protocol);
    lines.push(`    region: ${yamlScalar(node.region)}`);
    lines.push(`    lumen_credentials_ref: ${yamlScalar(protocol.credentialsRef)}`);
    lines.push(`    lumen_adapter: ${yamlScalar(protocol.adapter)}`);
    lines.push(`    lumen_implementation_status: ${yamlScalar(protocol.type === "vless-reality" || protocol.type === "vless-tcp-tls" ? "skeleton-no-inline-credentials" : "placeholder")}`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderClientSubscription(manifest, format, options = {}) {
  if (!SUPPORTED_RENDER_FORMATS.includes(format)) {
    throw new Error(`Unsupported subscription render format: ${format}`);
  }

  if (format === "lumen-json") {
    return renderJsonManifest(manifest, options);
  }

  if (format === "sing-box-skeleton") {
    const skeleton = renderSingBoxSkeleton(manifest);
    return `${JSON.stringify(skeleton, null, options.space ?? 2)}\n`;
  }

  return renderClashMetaSkeleton(manifest);
}
