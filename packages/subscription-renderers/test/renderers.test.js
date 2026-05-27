import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionManifest } from "../../subscription-schema/src/index.js";
import {
  renderClientSubscription,
  renderClashMetaSkeleton,
  renderJsonManifest,
  renderSingBoxSkeleton
} from "../src/index.js";

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

test("renders sing-box and clash skeletons without inline credentials", () => {
  const manifest = fixtureManifest();
  const singBox = renderSingBoxSkeleton(manifest);
  const clash = renderClashMetaSkeleton(manifest);

  assert.equal(singBox.outbounds[0].type, "vless");
  assert.equal(singBox.outbounds[0].implementation_status, "skeleton-no-inline-credentials");
  assert.equal(singBox.outbounds[0].tls.reality.public_key, "F1E2D3C4B5A69788776655443322110abcdEFGH_-");
  assert.match(clash, /reality-opts:/);
  assert.match(clash, /public-key:/);
  assert.match(clash, /lumen_credentials_ref/);
  assert.doesNotMatch(JSON.stringify(singBox), /password|privateKey|accessToken|uuid/i);
  assert.doesNotMatch(clash, /password|privateKey|accessToken|uuid/i);
});

test("dispatches renderer formats and rejects unknown formats", () => {
  const manifest = fixtureManifest();
  assert.match(renderClientSubscription(manifest, "clash-meta-skeleton"), /proxies:/);
  assert.throws(() => renderClientSubscription(manifest, "raw-url"), /Unsupported/);
});

test("renders VLESS TCP TLS skeleton fields without credentials", () => {
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

  const singBox = renderSingBoxSkeleton(manifest);
  const clash = renderClashMetaSkeleton(manifest);

  assert.equal(singBox.outbounds[0].tls.server_name, "ams-1.example.net");
  assert.deepEqual(singBox.outbounds[0].tls.alpn, ["h2"]);
  assert.match(clash, /skip-cert-verify: false/);
  assert.doesNotMatch(JSON.stringify(singBox), /password|privateKey|accessToken|uuid/i);
  assert.doesNotMatch(clash, /password|privateKey|accessToken|uuid/i);
});
