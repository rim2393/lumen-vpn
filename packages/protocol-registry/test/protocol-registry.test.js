import test from "node:test";
import assert from "node:assert/strict";
import {
  createProtocolRegistry,
  detectExclusiveBindPortConflicts,
  defaultProtocolRegistry,
  protocolCatalogAdapters,
  protocolCatalogEntries
} from "../src/index.js";

function realityRequest(overrides = {}) {
  return {
    nodeId: "ams-1",
    outboundId: "ams-vless-reality",
    endpoint: { host: "ams-1.example.net", port: 443 },
    bind: { address: "0.0.0.0", port: 443, protocol: "tcp" },
    credentialsRef: "vault://nodes/ams-1/vless-reality",
    security: {
      serverName: "www.example.com",
      publicKey: "F1E2D3C4B5A69788776655443322110abcdEFGH_-",
      shortId: "a1b2c3d4",
      fingerprint: "chrome",
      spiderX: "/"
    },
    ...overrides
  };
}

test("default registry exposes all production-plan adapters while catalog entries stay separate", () => {
  const protocols = defaultProtocolRegistry.list().map((adapter) => adapter.protocol);
  assert.deepEqual(protocols, [
    "vless-reality",
    "vless-tcp-tls",
    "trojan",
    "shadowsocks",
    "wireguard",
    "hysteria2",
    "openvpn-shadowsocks"
  ]);
  assert.deepEqual(protocolCatalogEntries.map((adapter) => adapter.protocol), ["vless", "trojan", "shadowsocks", "wireguard", "hysteria2"]);
  assert.equal(defaultProtocolRegistry.require("vless-reality").status, "experimental");
  assert.equal(defaultProtocolRegistry.require("vless-tcp-tls").status, "experimental");
  assert.equal(defaultProtocolRegistry.require("hysteria2").status, "experimental");
  assert.equal(defaultProtocolRegistry.get("vless"), null);
});

test("catalog adapters cannot provision live outbound plans", () => {
  const wireguard = protocolCatalogAdapters.find((adapter) => adapter.protocol === "wireguard");
  assert.equal(wireguard.status, "catalog");
  assert.throws(() => wireguard.planOutbound({
    nodeId: "ams-1",
    outboundId: "wg-1",
    endpoint: { host: "ams-1.example.net", port: 51820 },
    credentialsRef: "vault://nodes/ams-1/wireguard"
  }), /catalog-only/);
});

test("rejects duplicate protocol adapters", () => {
  assert.throws(
    () => createProtocolRegistry([defaultProtocolRegistry.require("vless-reality"), defaultProtocolRegistry.require("vless-reality")]),
    /Duplicate protocol adapter/
  );
});

test("VLESS Reality adapter validates config and renders a safe Xray-shaped plan", () => {
  const plan = defaultProtocolRegistry.require("vless-reality").planOutbound(realityRequest());

  assert.equal(plan.kind, "lumen.protocol-outbound.xray.v1");
  assert.equal(plan.implementationStatus, "config-plan");
  assert.equal(plan.xray.inbound.streamSettings.security, "reality");
  assert.equal(plan.clientSecurity.publicKey, "F1E2D3C4B5A69788776655443322110abcdEFGH_-");
  assert.equal(plan.bind.exclusive, true);
  assert.equal(plan.portReservations[0].port, 443);
  assert.deepEqual(plan.requiredCapabilities, ["runtime.xray_core"]);
  assert.doesNotMatch(JSON.stringify(plan), /password|privateKey|accessToken|uuid/i);
});

test("VLESS TLS adapter rejects unsafe TLS and inline secret-like fields", () => {
  const adapter = defaultProtocolRegistry.require("vless-tcp-tls");

  const plan = adapter.planOutbound({
    nodeId: "ams-1",
    outboundId: "ams-vless-tls",
    endpoint: { host: "ams-1.example.net", port: 8443 },
    credentialsRef: "vault://nodes/ams-1/vless-tls",
    security: { serverName: "ams-1.example.net", alpn: ["h2", "http/1.1"] }
  });

  assert.equal(plan.xray.inbound.streamSettings.security, "tls");
  assert.deepEqual(plan.clientSecurity.alpn, ["h2", "http/1.1"]);
  assert.equal(plan.portReservations[0].exclusive, true);

  assert.equal(adapter.validateConfig({
    nodeId: "ams-1",
    outboundId: "ams-vless-tls",
    endpoint: { host: "ams-1.example.net", port: 443 },
    credentialsRef: "vault://nodes/ams-1/vless-tls",
    security: { serverName: "ams-1.example.net", allowInsecure: true }
  }).ok, false);

  assert.throws(
    () => defaultProtocolRegistry.require("vless-reality").planOutbound(realityRequest({
      security: {
        serverName: "www.example.com",
        publicKey: "F1E2D3C4B5A69788776655443322110abcdEFGH_-",
        privateKey: "must-not-inline"
      }
    })),
    /Inline secret-like fields/
  );
});

test("detects overlapping exclusive bind ports from adapter plans", () => {
  const left = defaultProtocolRegistry.require("vless-reality").planOutbound(realityRequest({
    outboundId: "left"
  }));
  const right = defaultProtocolRegistry.require("vless-reality").planOutbound(realityRequest({
    outboundId: "right",
    bind: { address: "127.0.0.1", port: 443, protocol: "tcp" }
  }));

  const conflicts = detectExclusiveBindPortConflicts([left, right]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "exclusive_bind_port");
  assert.deepEqual(conflicts[0].ownerIds, ["left", "right"]);
});

test("runtime protocol adapters produce non-catalog outbound plans without inline secrets", () => {
  const plan = defaultProtocolRegistry.require("hysteria2").planOutbound({
    nodeId: "ams-1",
    outboundId: "hy2-1",
    endpoint: { host: "ams-1.example.net", port: 443, transport: "udp" },
    bind: { address: "0.0.0.0", port: 443, protocol: "udp" },
    credentialsRef: "vault://nodes/ams-1/hysteria2",
    security: { serverName: "ams-1.example.net" }
  });

  assert.equal(plan.kind, "lumen.protocol-outbound.runtime-plan.v1");
  assert.equal(plan.protocol, "hysteria2");
  assert.equal(plan.runtime, "hysteria2");
  assert.equal(plan.implementationStatus, "config-plan");
  assert.deepEqual(plan.requiredCapabilities, ["runtime.hysteria2"]);
  assert.equal(plan.portReservations[0].protocol, "udp");
  assert.doesNotMatch(JSON.stringify(plan), /password|privateKey|accessToken|uuid/i);

  assert.equal(defaultProtocolRegistry.require("trojan").validateConfig({
    nodeId: "ams-1",
    outboundId: "trojan-1",
    endpoint: { host: "ams-1.example.net", port: 443 },
    credentialsRef: "vault://nodes/ams-1/trojan",
    password: "must-not-inline"
  }).ok, false);
});
