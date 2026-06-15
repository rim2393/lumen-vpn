import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildExternalRequestUrl,
  createFallbackLandingModel,
  createLumenEdgeServer,
  matchSubscriptionManifestPath,
  matchSubscriptionRenderPath,
  renderDeviceBindingHtml,
  renderSubscriptionPageHtml,
  renderFallbackLandingHtml,
  validateSubscriptionPublicId
} from "../src/index.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function assertNoMojibake(html) {
  const fragments = ["\u0420\u045F", "\u0420\u0491", "\u0420\u0451", "\u0420\u00B0", "\u0432\u045A", "\u0432\u2020", "\u0420\u00A0"];
  assert.equal(fragments.some((fragment) => html.includes(fragment)), false);
}

test("creates fallback landing model with safe diagnostics", () => {
  const model = createFallbackLandingModel({
    host: "edge.example.net",
    requestId: "req_123",
    generatedAt: "2026-05-26T00:00:00.000Z"
  });

  assert.equal(model.status, "fallback");
  assert.equal(model.diagnostics.secretsIncluded, false);
  assert.equal(model.diagnostics.liveTrafficEnabled, false);
});

test("renders escaped fallback html", () => {
  const html = renderFallbackLandingHtml(createFallbackLandingModel({
    host: "<edge>",
    requestId: "req_123",
    generatedAt: "2026-05-26T00:00:00.000Z"
  }));

  assert.match(html, /&lt;edge&gt;/);
  assert.doesNotMatch(html, /privateKey|accessToken|password/);
});

test("matches public subscription manifest routes", () => {
  assert.equal(matchSubscriptionManifestPath("/sub/lumen_sub_abc1234567890xyz/manifest"), "lumen_sub_abc1234567890xyz");
  assert.equal(matchSubscriptionManifestPath("/api/sub/lumen_sub_abc1234567890xyz/manifest"), "lumen_sub_abc1234567890xyz");
  assert.equal(matchSubscriptionManifestPath("/api/sub/lumen_sub_abc1234567890xyz"), null);
  assert.equal(matchSubscriptionManifestPath("/sub/%E0%A4%A/manifest"), "%E0%A4%A");
  assert.equal(matchSubscriptionManifestPath("/unknown/lumen_sub_abc1234567890xyz"), null);
  assert.equal(validateSubscriptionPublicId("lumen_sub_abc1234567890xyz"), true);
  assert.equal(validateSubscriptionPublicId("../secret"), false);
});

test("matches public subscription render routes", () => {
  assert.deepEqual(matchSubscriptionRenderPath("/sub/lumen_sub_abc1234567890xyz"), {
    publicId: "lumen_sub_abc1234567890xyz",
    target: null
  });
  assert.deepEqual(matchSubscriptionRenderPath("/sub/lumen_sub_abc1234567890xyz/hiddify"), {
    publicId: "lumen_sub_abc1234567890xyz",
    target: "hiddify"
  });
  assert.equal(matchSubscriptionRenderPath("/sub/lumen_sub_abc1234567890xyz/manifest"), null);
});

test("proxies public subscription manifest without exposing API credentials", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response(JSON.stringify({
        schemaVersion: "lumen.subscription-manifest.v1",
        subscription: { id: "lumen_sub_abc1234567890xyz" },
        nodes: []
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz/manifest?device_id=device-1&device_label=Pixel`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.schemaVersion, "lumen.subscription-manifest.v1");
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/manifest?device_id=device-1&device_label=Pixel");
    assert.equal(upstreamCalls[0].options.headers.accept, "application/json");
    assert.equal(upstreamCalls[0].options.headers.authorization, undefined);
  } finally {
    await close(server);
  }
});

test("proxies public rendered subscription with target negotiation", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response("vless://example\n", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "profile-title": "base64:THVtZW4=",
          "set-cookie": "session=bad",
          "subscription-userinfo": "upload=0; download=0; total=0; expire=0",
          "x-lumen-custom": "typed",
          "x-lumen-render-target": "hiddify"
        }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz/hiddify?device_id=device-1&hwid=HWID-1`, {
      headers: { "x-device-id": "HEADER-DEVICE" }
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body, "vless://example\n");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-lumen-custom"), "typed");
    assert.equal(response.headers.get("x-lumen-render-target"), "hiddify");
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/render?device_id=device-1&hwid=HWID-1&target=hiddify");
    assert.equal(upstreamCalls[0].options.headers.authorization, undefined);
    assert.equal(upstreamCalls[0].options.headers["X-Forwarded-Host"], `127.0.0.1:${port}`);
    assert.equal(upstreamCalls[0].options.headers["X-Forwarded-Proto"], "http");
    assert.equal(upstreamCalls[0].options.headers["X-Device-Id"], "HEADER-DEVICE");
  } finally {
    await close(server);
  }
});

test("infers Lumen native manifest target for LumenVPN user agent", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response(JSON.stringify({ schemaVersion: "lumen.subscription-manifest.v1", nodes: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-lumen-render-target": "lumen-json"
        }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz?hwid=HWID-1`, {
      headers: { "user-agent": "LumenVPN/1.0 Android" }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.schemaVersion, "lumen.subscription-manifest.v1");
    assert.equal(response.headers.get("x-lumen-render-target"), "lumen-json");
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/render?hwid=HWID-1&target=lumen-json");
  } finally {
    await close(server);
  }
});

test("defaults short raw subscription requests to Happ target", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response("vless://example\n", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-lumen-render-target": "happ"
        }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body, "vless://example\n");
    assert.equal(response.headers.get("x-lumen-render-target"), "happ");
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/render?target=happ");
  } finally {
    await close(server);
  }
});

test("renders browser subscription portal while preserving client render endpoints", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response(JSON.stringify({
        schemaVersion: "lumen.subscription-manifest.v1",
        provider: { name: "Lumen" },
        subscription: { id: "lumen_sub_abc1234567890xyz", expiresAt: "2027-12-20T00:00:00Z" },
        nodes: [{ protocols: [{ type: "vless-reality" }, { type: "hysteria2" }] }],
        metadata: { profileTitle: "Lumen Live Compat", supportUrl: "https://t.me/lumen" }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz`, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0" }
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(body, /Lumen Live Compat/);
    assert.match(body, /Hiddify/);
    assert.match(body, /happ:\/\/add\/https?%3A%2F%2F127\.0\.0\.1%3A\d+%2Fsub%2Flumen_sub_abc1234567890xyz%2Fhapp%3Fraw%3D1/);
    assert.match(body, /happ:\/\/import\/https?%3A%2F%2F127\.0\.0\.1%3A\d+%2Fsub%2Flumen_sub_abc1234567890xyz%2Fhapp%3Fraw%3D1/);
    assert.match(body, /data-copy-url/);
    assert.match(body, /data-lumen-qr="raw-happ"/);
    assert.match(body, /data-qr-value="http:\/\/127\.0\.0\.1:\d+\/sub\/lumen_sub_abc1234567890xyz\/happ\?raw=1"/);
    assert.match(body, /\/sub\/lumen_sub_abc1234567890xyz\/happ\?raw=1/);
    assert.match(body, /\/sub\/lumen_sub_abc1234567890xyz\/mihomo/);
    assert.match(body, /\/sub\/lumen_sub_abc1234567890xyz\/v2ray-base64/);
    assert.match(body, /Subscription is active/);
    assert.match(body, /1 server/);
    assert.match(body, /2 protocols/);
    assert.match(body, /Streisand/);
    assert.match(body, /Shadowrocket/);
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/manifest");
  } finally {
    await close(server);
  }
});

test("renders device binding page when browser portal requires HWID", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response(JSON.stringify({
        error: {
          code: "subscription_device_id_required",
          message: "This subscription requires a device id or HWID.",
          details: []
        }
      }), {
        status: 428,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz`, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0" }
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("x-lumen-subscription-page"), "device-binding");
    assert.match(body, /lumen-sub-device:lumen_sub_abc1234567890xyz/);
    assert.match(body, /url\.searchParams\.set\("hwid", deviceId\)/);
    assert.doesNotMatch(body, /subscription_device_id_required/);
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/manifest");
  } finally {
    await close(server);
  }
});

test("uses forwarded public URL for subscription portal links", async () => {
  const upstreamCalls = [];
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return new Response(JSON.stringify({
        schemaVersion: "lumen.subscription-manifest.v1",
        provider: { name: "Lumen" },
        subscription: { id: "lumen_sub_abc1234567890xyz" },
        nodes: [],
        metadata: { profileTitle: "Lumen Live Compat" }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz`, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "sub.example"
      }
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /https:\/\/sub\.example\/sub\/lumen_sub_abc1234567890xyz\/hiddify/);
    assert.match(body, /happ:\/\/import\/https%3A%2F%2Fsub\.example%2Fsub%2Flumen_sub_abc1234567890xyz%2Fhapp%3Fraw%3D1/);
    assert.match(body, /data-qr-value="https:\/\/sub\.example\/sub\/lumen_sub_abc1234567890xyz\/happ\?raw=1"/);
    assert.doesNotMatch(body, /http:\/\/sub\.example/);
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/manifest");
    assert.equal(upstreamCalls[0].options.headers["X-Forwarded-Host"], "sub.example");
    assert.equal(upstreamCalls[0].options.headers["X-Forwarded-Proto"], "https");
  } finally {
    await close(server);
  }
});

test("subscription portal exposes Happ raw import actions", () => {
  const html = renderSubscriptionPageHtml({
    publicUrl: "https://sub.example/sub/lumen_sub_abc1234567890xyz",
    manifest: {
      provider: { name: "Lumen" },
      subscription: { id: "lumen_sub_abc1234567890xyz" },
      metadata: { profileTitle: "Lumen Live Compat" }
    }
  });

  const rawHappUrl = "https://sub.example/sub/lumen_sub_abc1234567890xyz/happ?raw=1";
  const encodedRawHappUrl = encodeURIComponent(rawHappUrl);

  assert.match(html, new RegExp(`happ://add/${encodedRawHappUrl}`));
  assert.match(html, new RegExp(`happ://import/${encodedRawHappUrl}`));
  assert.match(html, /data-client-link data-client="Happ"/);
  assert.match(html, /data-client-link data-client="Happ iOS"/);
  assert.match(html, new RegExp(`data-copy-url data-url="${rawHappUrl.replaceAll("?", "\\?")}"`));
  assert.match(html, new RegExp(`<code>${rawHappUrl.replaceAll("?", "\\?")}</code>`));
});

test("builds external request URL from forwarded headers", () => {
  const url = new URL("http://127.0.0.1/sub/lumen_sub_abc1234567890xyz");
  const publicUrl = buildExternalRequestUrl({
    headers: {
      host: "127.0.0.1",
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "sub.example, internal"
    }
  }, url);

  assert.equal(publicUrl, "https://sub.example/sub/lumen_sub_abc1234567890xyz");
});

test("escapes subscription portal fields", () => {
  const html = renderSubscriptionPageHtml({
    publicUrl: "https://sub.example/sub/lumen_sub_abc1234567890xyz",
    manifest: {
      provider: { name: "<brand>" },
      subscription: { id: "lumen_sub_abc1234567890xyz" },
      metadata: { profileTitle: "<script>alert(1)</script>" }
    }
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("subscription portal applies selected subpage config", () => {
  const html = renderSubscriptionPageHtml({
    publicUrl: "https://sub.example/sub/lumen_sub_abc1234567890xyz",
    manifest: {
      provider: { name: "Lumen" },
      subscription: { id: "lumen_sub_abc1234567890xyz" },
      metadata: {
        profileTitle: "Default title",
        subpage: {
          cards: ["status", "links"],
          configId: "subpage_qa",
          configName: "QA public page",
          supportText: "QA help",
          theme: "QA Dark",
          title: "QA configured title"
        }
      }
    }
  });

  assert.match(html, /QA configured title/);
  assert.match(html, /theme-qa-dark/);
  assert.match(html, /data-subpage-config-id="subpage_qa"/);
  assert.match(html, /data-subpage-config-name="QA public page"/);
  assert.match(html, /aria-label="QA help"/);
  assert.match(html, /Manual import URLs/);
  assert.doesNotMatch(html, /Hiddify/);
});

test("renders v2rayNG deep link and no mojibake text", () => {
  const html = renderSubscriptionPageHtml({
    publicUrl: "https://sub.example/sub/lumen_sub_abc1234567890xyz",
    manifest: {
      provider: { name: "Lumen" },
      subscription: { id: "lumen_sub_abc1234567890xyz" },
      metadata: { profileTitle: "Lumen Live Compat" }
    }
  });

  assert.match(html, /v2rayng:\/\/install-sub\?url=/);
  assert.match(html, /Add subscription/);
  assert.match(html, /Advanced formats/);
  assert.match(html, /class="action primary"/);
  assertNoMojibake(html);
});

test("renders device binding page without mojibake text", () => {
  const html = renderDeviceBindingHtml({
    publicId: "lumen_sub_abc1234567890xyz",
    publicUrl: "https://sub.example/sub/lumen_sub_abc1234567890xyz"
  });

  assert.match(html, /Preparing device binding/);
  assert.match(html, /Continue manually/);
  assertNoMojibake(html);
});

test("subscription portal keeps long provider names out of the header brand", () => {
  const html = renderSubscriptionPageHtml({
    publicUrl: "https://sub.example/sub/lumen_sub_abc1234567890xyz",
    manifest: {
      provider: { name: "Lumen dev test 2026-06-14 15:22 UTC" },
      subscription: { id: "lumen_sub_abc1234567890xyz" },
      metadata: { profileTitle: "Lumen dev test 2026-06-14 15:22 UTC" }
    }
  });

  assert.match(html, /<div class="brand"><span class="mark" aria-hidden="true"><\/span>Lumen<\/div>/);
});

test("subscription nginx CSP permits inline portal assets", () => {
  const config = readFileSync(new URL("../../../deploy/nginx/lumen-subscription.conf.template", import.meta.url), "utf8");

  assert.match(config, /style-src 'self' 'unsafe-inline'/);
  assert.match(config, /script-src 'self' 'unsafe-inline'/);
});

test("malformed public subscription id returns 404 instead of upstream error", async () => {
  const server = createLumenEdgeServer({
    env: { API_INTERNAL_URL: "http://api.internal:8000" },
    fetchImpl: async () => {
      throw new Error("fetch must not be called for invalid ids");
    },
    randomUUID: () => "req_test"
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/sub/%E0%A4%A/manifest`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "subscription_not_found");
  } finally {
    await close(server);
  }
});
