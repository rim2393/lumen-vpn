import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionManifest } from "../../subscription-schema/src/index.js";
import {
  renderClientSubscription,
  renderJsonManifest,
  renderMihomoYaml,
  renderSingBoxConfig
} from "../src/index.js";

const CREDENTIAL_SEED = "0123456789abcdef0123456789abcdef";

function fixtureManifest() {
  return createSubscriptionManifest({
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
            endpoint: { host: "ams-1.example.net", port: 443 },
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
}

test("renders stable lumen json", () => {
  const output = renderJsonManifest(fixtureManifest());
  assert.match(output, /"schemaVersion": "lumen\.subscription-manifest\.v1"/);
  assert.match(output, /"credentialsRef": "vault:\/\/subscriptions\/sub_123\/vless-reality"/);
  assert.match(output, /"publicKey": "F1E2D3C4B5A69788776655443322110abcdEFGH_-"/);
  assert.doesNotMatch(output, /password|privateKey|accessToken|uuid/i);
});

test("renders runnable sing-box and Mihomo configs with derived credentials", () => {
  const manifest = fixtureManifest();
  const singBox = renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED });
  const mihomo = renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED });

  assert.equal(singBox.outbounds[0].type, "vless");
  assert.match(singBox.outbounds[0].uuid, /^[0-9a-f-]{36}$/);
  assert.equal(singBox.outbounds[0].tls.reality.public_key, "F1E2D3C4B5A69788776655443322110abcdEFGH_-");
  assert.match(mihomo, /reality-opts:/);
  assert.match(mihomo, /public-key:/);
  assert.match(mihomo, /uuid:/);
  assert.doesNotMatch(JSON.stringify(singBox), /skeleton|placeholder|credentialsRef|privateKey|accessToken/i);
  assert.doesNotMatch(mihomo, /skeleton|placeholder|credentialsRef|privateKey|accessToken/i);
});

test("dispatches renderer formats and rejects unknown formats", () => {
  const manifest = fixtureManifest();
  assert.match(renderClientSubscription(manifest, "clash-meta", { credentialSeed: CREDENTIAL_SEED }), /proxies:/);
  assert.match(renderClientSubscription(manifest, "mihomo", { credentialSeed: CREDENTIAL_SEED }), /proxies:/);
  assert.match(renderClientSubscription(manifest, "sing-box", { credentialSeed: CREDENTIAL_SEED }), /"outbounds":/);
  assert.throws(() => renderClientSubscription(manifest, "raw-url"), /Unsupported/);
  assert.throws(() => renderClientSubscription(manifest, "sing-box"), /credentialSeed/);
});

test("renders VLESS TCP TLS fields with real derived credentials", () => {
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
            security: { serverName: "ams-1.example.net", alpn: ["h2"] },
            credentialsRef: "vault://subscriptions/sub_123/vless-tls"
          }
        ]
      }
    ]
  });

  const singBox = renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED });
  const mihomo = renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED });

  assert.equal(singBox.outbounds[0].tls.server_name, "ams-1.example.net");
  assert.deepEqual(singBox.outbounds[0].tls.alpn, ["h2"]);
  assert.match(singBox.outbounds[0].uuid, /^[0-9a-f-]{36}$/);
  assert.match(mihomo, /skip-cert-verify: false/);
  assert.doesNotMatch(JSON.stringify(singBox), /skeleton|placeholder|credentialsRef|privateKey|accessToken/i);
  assert.doesNotMatch(mihomo, /skeleton|placeholder|credentialsRef|privateKey|accessToken/i);
});

test("renders Hysteria2, Trojan and Shadowsocks with real derived credentials", () => {
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
            type: "trojan",
            endpoint: { host: "ams-1.example.net", port: 443 },
            security: { serverName: "ams-1.example.net" },
            credentialsRef: "vault://subscriptions/sub_123/trojan"
          },
          {
            type: "shadowsocks",
            endpoint: { host: "ams-1.example.net", port: 8388 },
            rendererHints: { method: "aes-256-gcm" },
            credentialsRef: "vault://subscriptions/sub_123/shadowsocks"
          },
          {
            type: "hysteria2",
            endpoint: { host: "ams-1.example.net", port: 443, transport: "udp" },
            security: { serverName: "hy2.example.net" },
            credentialsRef: "vault://subscriptions/sub_123/hysteria2"
          }
        ]
      }
    ]
  });

  const singBox = renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED });
  const mihomo = renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED });

  assert.equal(singBox.outbounds[0].type, "trojan");
  assert.equal(singBox.outbounds[1].type, "ss");
  assert.equal(singBox.outbounds[1].method, "aes-256-gcm");
  assert.equal(singBox.outbounds[2].type, "hysteria2");
  assert.match(mihomo, /type: "trojan"/);
  assert.match(mihomo, /type: "ss"/);
  assert.match(mihomo, /type: "hysteria2"/);
  assert.doesNotMatch(JSON.stringify(singBox), /skeleton|placeholder|credentialsRef|privateKey|accessToken/i);
  assert.doesNotMatch(mihomo, /skeleton|placeholder|credentialsRef|privateKey|accessToken/i);
});

test("rejects WireGuard from client renderers until real key material is available", () => {
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
            type: "wireguard",
            endpoint: { host: "ams-1.example.net", port: 51820, transport: "udp" },
            credentialsRef: "vault://subscriptions/sub_123/wireguard"
          }
        ]
      }
    ]
  });

  assert.throws(
    () => renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED }),
    /not enabled for client rendering/
  );
  assert.throws(
    () => renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED }),
    /not enabled for client rendering/
  );
});

test("rejects OpenVPN-over-Shadowsocks from generic sing-box and Mihomo renderers", () => {
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
            credentialsRef: "vault://subscriptions/sub_123/openvpn-shadowsocks",
            rendererHints: { openvpnRemoteHost: "127.0.0.1", openvpnRemotePort: 24194 }
          }
        ]
      }
    ]
  });

  assert.throws(
    () => renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED }),
    /not enabled for client rendering/
  );
  assert.throws(
    () => renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED }),
    /not enabled for client rendering/
  );
});

test("renders VLESS VMess and Trojan edge transports for sing-box and Mihomo", () => {
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
            type: "vless-ws-tls",
            endpoint: { host: "ams-1.example.net", port: 8443, transport: "ws" },
            path: "/vless-ws",
            security: { type: "tls", serverName: "vless-ws.example.net" },
            credentialsRef: "vault://subscriptions/sub_123/vless-ws"
          },
          {
            type: "vmess-grpc-tls",
            endpoint: { host: "ams-1.example.net", port: 9443, transport: "grpc" },
            serviceName: "vmessGrpc",
            security: { type: "tls", serverName: "vmess-grpc.example.net" },
            credentialsRef: "vault://subscriptions/sub_123/vmess-grpc"
          },
          {
            type: "trojan-httpupgrade-tls",
            endpoint: { host: "ams-1.example.net", port: 10443, transport: "httpupgrade" },
            path: "/trojan-upgrade",
            security: { type: "tls", serverName: "trojan-upgrade.example.net" },
            credentialsRef: "vault://subscriptions/sub_123/trojan-upgrade"
          }
        ]
      }
    ]
  });

  const singBox = renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED });
  assert.equal(singBox.outbounds[0].transport.type, "ws");
  assert.equal(singBox.outbounds[0].transport.path, "/vless-ws");
  assert.equal(singBox.outbounds[1].type, "vmess");
  assert.equal(singBox.outbounds[1].transport.type, "grpc");
  assert.equal(singBox.outbounds[1].transport.service_name, "vmessGrpc");
  assert.equal(singBox.outbounds[2].type, "trojan");
  assert.equal(singBox.outbounds[2].transport.type, "httpupgrade");
  assert.equal(singBox.outbounds[2].transport.path, "/trojan-upgrade");

  const mihomo = renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED });
  assert.match(mihomo, /ws-opts:/);
  assert.match(mihomo, /grpc-opts:/);
  assert.match(mihomo, /grpc-service-name: "vmessGrpc"/);
  assert.ok(mihomo.includes('path: "/trojan-upgrade"'));
});

test("renders XHTTP only for Mihomo until sing-box has a stable outbound shape", () => {
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
            type: "vless-xhttp-tls",
            endpoint: { host: "ams-1.example.net", port: 8443, transport: "xhttp" },
            path: "/xhttp",
            mode: "stream-up",
            security: { type: "tls", serverName: "xhttp.example.net" },
            credentialsRef: "vault://subscriptions/sub_123/xhttp"
          }
        ]
      }
    ]
  });

  assert.throws(
    () => renderSingBoxConfig(manifest, { credentialSeed: CREDENTIAL_SEED }),
    /supported by sing-box renderer/
  );
  const mihomo = renderMihomoYaml(manifest, { credentialSeed: CREDENTIAL_SEED });
  assert.match(mihomo, /xhttp-opts:/);
  assert.ok(mihomo.includes('path: "/xhttp"'));
  assert.match(mihomo, /mode: "stream-up"/);
});
