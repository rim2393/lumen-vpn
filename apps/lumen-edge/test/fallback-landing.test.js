import test from "node:test";
import assert from "node:assert/strict";
import {
  createFallbackLandingModel,
  createLumenEdgeServer,
  matchSubscriptionManifestPath,
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
  assert.equal(matchSubscriptionManifestPath("/api/sub/lumen_sub_abc1234567890xyz"), "lumen_sub_abc1234567890xyz");
  assert.equal(matchSubscriptionManifestPath("/sub/%E0%A4%A/manifest"), "%E0%A4%A");
  assert.equal(matchSubscriptionManifestPath("/unknown/lumen_sub_abc1234567890xyz"), null);
  assert.equal(validateSubscriptionPublicId("lumen_sub_abc1234567890xyz"), true);
  assert.equal(validateSubscriptionPublicId("../secret"), false);
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
    const response = await fetch(`http://127.0.0.1:${port}/sub/lumen_sub_abc1234567890xyz/manifest`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.schemaVersion, "lumen.subscription-manifest.v1");
    assert.equal(upstreamCalls[0].url, "http://api.internal:8000/api/v1/subscriptions/public/lumen_sub_abc1234567890xyz/manifest");
    assert.equal(upstreamCalls[0].options.headers.accept, "application/json");
    assert.equal(upstreamCalls[0].options.headers.authorization, undefined);
  } finally {
    await close(server);
  }
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
