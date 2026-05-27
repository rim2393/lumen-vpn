import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createFallbackLandingModel, renderFallbackLandingHtml } from "./fallback-landing.js";
import {
  matchSubscriptionManifestPath,
  normalizeApiInternalUrl,
  validateSubscriptionPublicId
} from "./subscription-proxy.js";

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function proxySubscriptionManifest(request, response, input) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const publicId = matchSubscriptionManifestPath(url.pathname);
  if (publicId === null) {
    return false;
  }
  if (!validateSubscriptionPublicId(publicId)) {
    writeJson(response, 404, {
      error: {
        code: "subscription_not_found",
        message: "Subscription was not found."
      }
    });
    return true;
  }

  const apiInternalUrl = normalizeApiInternalUrl(input.env.API_INTERNAL_URL);
  if (apiInternalUrl === null) {
    writeJson(response, 503, {
      error: {
        code: "subscription_upstream_unavailable",
        message: "Subscription upstream is not configured."
      }
    });
    return true;
  }

  const upstreamUrl = `${apiInternalUrl}/api/v1/subscriptions/public/${encodeURIComponent(publicId)}/manifest`;
  const upstream = await input.fetchImpl(upstreamUrl, {
    headers: { accept: "application/json" }
  });
  const body = await upstream.text();
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
  return true;
}

export function createLumenEdgeServer(input = {}) {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const uuid = input.randomUUID ?? randomUUID;

  return createServer(async (request, response) => {
    try {
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok\n");
        return;
      }

      if (await proxySubscriptionManifest(request, response, { env, fetchImpl })) {
        return;
      }

      const model = createFallbackLandingModel({
        host: request.headers.host,
        reason: env.LUMEN_EDGE_FALLBACK_REASON,
        requestId: request.headers["x-request-id"] || uuid()
      });
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(renderFallbackLandingHtml(model));
    } catch {
      writeJson(response, 502, {
        error: {
          code: "subscription_upstream_error",
          message: "Subscription upstream request failed."
        }
      });
    }
  });
}

export function listenFromEnv(input = {}) {
  const env = input.env ?? process.env;
  const port = Number.parseInt(env.PORT || env.LUMEN_EDGE_PORT || "8080", 10);
  const server = createLumenEdgeServer(input);
  server.listen(port, "0.0.0.0", () => {
    console.log(`lumen-edge listening on ${port}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  listenFromEnv();
}

