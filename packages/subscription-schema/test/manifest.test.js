import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBSCRIPTION_MANIFEST_SCHEMA_VERSION,
  createSubscriptionManifest,
  validateSubscriptionManifest
} from "../src/index.js";

test("creates a valid subscription manifest without inline secrets", () => {
  const manifest = createSubscriptionManifest({
    generatedAt: "2026-05-26T00:00:00.000Z",
    provider: { id: "lumen", name: "Lumen VPN" },
    subscription: { id: "sub_123", audience: "android" },
    nodes: [
      {
        id: "ams-1",
        displayName: "Amsterdam 1",
        region: "nl-ams",
        protocols: [
          {
            type: "vless-reality",
            endpoint: { host: "ams-1.example.net", port: 443, transport: "tcp" },
            security: {
              serverName: "www.example.com",
              publicKey: "F1E2D3C4B5A69788776655443322110abcdEFGH_-",
              shortId: "a1b2c3d4",
              fingerprint: "chrome",
              spiderX: "/"
            },
            flow: "xtls-rprx-vision",
            credentialsRef: "vault://subscriptions/sub_123/vless-reality"
          }
        ]
      }
    ]
  });

  assert.equal(manifest.schemaVersion, SUBSCRIPTION_MANIFEST_SCHEMA_VERSION);
  assert.equal(validateSubscriptionManifest(manifest).ok, true);
  assert.equal(manifest.nodes[0].protocols[0].adapter, "vless-reality");
  assert.equal(manifest.nodes[0].protocols[0].security.type, "reality");
  assert.equal(manifest.nodes[0].protocols[0].flow, "xtls-rprx-vision");
});

test("rejects unsupported protocols and inline secret-like fields", () => {
  const result = validateSubscriptionManifest({
    schemaVersion: SUBSCRIPTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: "2026-05-26T00:00:00.000Z",
    provider: { id: "lumen", name: "Lumen VPN" },
    subscription: { id: "sub_123", audience: "android" },
    nodes: [
      {
        id: "ams-1",
        displayName: "Amsterdam 1",
        region: "nl-ams",
        priority: 100,
        protocols: [
          {
            type: "unknown",
            adapter: "unknown",
            endpoint: { host: "ams-1.example.net", port: 443 },
            credentialsRef: "vault://subscriptions/sub_123/unknown",
            password: "do-not-store"
          }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not supported/);
  assert.match(result.errors.join("\n"), /inline secret-like fields/);
});

test("creates a valid VLESS TCP TLS manifest entry", () => {
  const manifest = createSubscriptionManifest({
    generatedAt: "2026-05-26T00:00:00.000Z",
    provider: { id: "lumen", name: "Lumen VPN" },
    subscription: { id: "sub_123", audience: "android" },
    nodes: [
      {
        id: "ams-1",
        displayName: "Amsterdam 1",
        region: "nl-ams",
        protocols: [
          {
            type: "vless-tcp-tls",
            endpoint: { host: "ams-1.example.net", port: 8443 },
            security: { serverName: "ams-1.example.net", alpn: ["h2", "http/1.1"] },
            credentialsRef: "vault://subscriptions/sub_123/vless-tls"
          }
        ]
      }
    ]
  });

  assert.equal(validateSubscriptionManifest(manifest).ok, true);
  assert.equal(manifest.nodes[0].protocols[0].security.type, "tls");
  assert.deepEqual(manifest.nodes[0].protocols[0].security.alpn, ["h2", "http/1.1"]);
});

test("creates a valid OpenVPN-over-Shadowsocks manifest entry", () => {
  const manifest = createSubscriptionManifest({
    generatedAt: "2026-05-26T00:00:00.000Z",
    provider: { id: "lumen", name: "Lumen VPN" },
    subscription: { id: "sub_123", audience: "android" },
    nodes: [
      {
        id: "ams-1",
        displayName: "Amsterdam 1",
        region: "nl-ams",
        protocols: [
          {
            type: "openvpn-shadowsocks",
            endpoint: { host: "ams-1.example.net", port: 28443, transport: "tcp" },
            security: { type: "tls" },
            credentialsRef: "vault://subscriptions/sub_123/openvpn-shadowsocks",
            rendererHints: { openvpnRemoteHost: "127.0.0.1", openvpnRemotePort: 24194 }
          }
        ]
      }
    ]
  });

  assert.equal(validateSubscriptionManifest(manifest).ok, true);
  assert.equal(manifest.nodes[0].protocols[0].adapter, "openvpn-shadowsocks");
});

test("rejects incomplete VLESS Reality and unsafe VLESS TLS manifest entries", () => {
  const missingRealityFields = validateSubscriptionManifest(createUncheckedManifest({
    type: "vless-reality",
    endpoint: { host: "ams-1.example.net", port: 443 },
    security: { serverName: "www.example.com" }
  }));

  assert.equal(missingRealityFields.ok, false);
  assert.match(missingRealityFields.errors.join("\n"), /security\.publicKey/);

  const unsafeTls = validateSubscriptionManifest(createUncheckedManifest({
    type: "vless-tcp-tls",
    endpoint: { host: "ams-1.example.net", port: 443 },
    security: { serverName: "ams-1.example.net", allowInsecure: true }
  }));

  assert.equal(unsafeTls.ok, false);
  assert.match(unsafeTls.errors.join("\n"), /allowInsecure/);
});

test("rejects inline VLESS credential material by key name", () => {
  const result = validateSubscriptionManifest(createUncheckedManifest({
    type: "vless-reality",
    endpoint: { host: "ams-1.example.net", port: 443 },
    security: {
      serverName: "www.example.com",
      publicKey: "F1E2D3C4B5A69788776655443322110abcdEFGH_-",
      shortId: "a1b2c3d4"
    },
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /inline secret-like fields/);
});

test("rejects plaintext credential references", () => {
  const result = validateSubscriptionManifest(createUncheckedManifest({
    type: "vless-tcp-tls",
    adapter: "vless-tcp-tls",
    endpoint: { host: "ams-1.example.net", port: 443 },
    security: { serverName: "ams-1.example.net", alpn: [], allowInsecure: false },
    credentialsRef: "plain-password-token"
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /credentialsRef must be a vault:\/\/ reference/);
});

test("validates WireGuard renderability fields early", () => {
  const missingFields = validateSubscriptionManifest(createUncheckedManifest({
    type: "wireguard",
    endpoint: { host: "ams-1.example.net", port: 51820, transport: "udp" },
    security: {}
  }));
  assert.equal(missingFields.ok, false);
  assert.match(missingFields.errors.join("\n"), /security\.publicKey/);
  assert.match(missingFields.errors.join("\n"), /rendererHints\.address/);
  assert.match(missingFields.errors.join("\n"), /rendererHints\.allowedIps/);

  const wrongTransport = validateSubscriptionManifest(createUncheckedManifest({
    type: "wireguard",
    endpoint: { host: "ams-1.example.net", port: 51820, transport: "tcp" },
    security: { publicKey: "server-public-key" },
    rendererHints: { address: "10.66.0.2/32", allowedIps: "0.0.0.0/0" }
  }));
  assert.equal(wrongTransport.ok, false);
  assert.match(wrongTransport.errors.join("\n"), /endpoint\.transport must be udp/);

  const amnezia = createSubscriptionManifest(createUncheckedManifest({
    type: "wireguard-amneziawg",
    endpoint: { host: "ams-1.example.net", port: 51821, transport: "udp" },
    security: { publicKey: "server-public-key" },
    rendererHints: {
      address: "10.77.0.2/32",
      allowedIps: "0.0.0.0/0",
      Jc: "4",
      S1: "60"
    }
  }));
  assert.equal(validateSubscriptionManifest(amnezia).ok, true);
  assert.equal(amnezia.nodes[0].protocols[0].type, "wireguard-amneziawg");
});

function createUncheckedManifest(protocol) {
  return {
    schemaVersion: SUBSCRIPTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: "2026-05-26T00:00:00.000Z",
    provider: { id: "lumen", name: "Lumen VPN" },
    subscription: { id: "sub_123", audience: "android" },
    nodes: [
      {
        id: "ams-1",
        displayName: "Amsterdam 1",
        region: "nl-ams",
        priority: 100,
        protocols: [
          {
            id: protocol.type,
            adapter: protocol.type,
            credentialsRef: `vault://subscriptions/sub_123/${protocol.type}`,
            ...protocol
          }
        ]
      }
    ]
  };
}
