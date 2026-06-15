import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createFallbackLandingModel, renderFallbackLandingHtml } from "./fallback-landing.js";
import { renderDeviceBindingHtml, renderSubscriptionPageHtml, wantsHtmlSubscriptionPage } from "./subscription-page.js";
import {
  matchSubscriptionManifestPath,
  matchSubscriptionRenderPath,
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

  const upstreamQuery = buildUpstreamQuery(url.searchParams);
  const upstreamUrl = `${apiInternalUrl}/api/v1/subscriptions/public/${encodeURIComponent(publicId)}/manifest${formatQuery(upstreamQuery)}`;
  const upstream = await input.fetchImpl(upstreamUrl, {
    headers: buildSubscriptionProxyHeaders(request, "application/json")
  });
  const body = await upstream.text();
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
  return true;
}

async function proxySubscriptionRender(request, response, input) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const match = matchSubscriptionRenderPath(url.pathname);
  if (match === null) {
    return false;
  }
  if (!validateSubscriptionPublicId(match.publicId)) {
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

  const target = match.target || url.searchParams.get("target") || url.searchParams.get("format") || inferTargetFromUserAgent(request.headers["user-agent"]);
  if (!match.target && wantsHtmlSubscriptionPage(request)) {
    const manifestQuery = buildUpstreamQuery(url.searchParams);
    const manifestUrl = `${apiInternalUrl}/api/v1/subscriptions/public/${encodeURIComponent(match.publicId)}/manifest${formatQuery(manifestQuery)}`;
    const manifestResponse = await input.fetchImpl(manifestUrl, {
      headers: buildSubscriptionProxyHeaders(request, "application/json")
    });
    const manifestText = await manifestResponse.text();
    if (!manifestResponse.ok) {
      if (manifestResponse.status === 428 && isDeviceBindingRequired(manifestText)) {
        const publicUrl = buildExternalRequestUrl(request, url);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-lumen-subscription-page": "device-binding"
        });
        response.end(renderDeviceBindingHtml({
          publicId: match.publicId,
          publicUrl
        }));
        return true;
      }
      response.writeHead(manifestResponse.status, {
        "content-type": manifestResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(manifestText);
      return true;
    }
    const publicUrl = buildExternalRequestUrl(request, url);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(renderSubscriptionPageHtml({
      manifest: JSON.parse(manifestText),
      publicUrl
    }));
    return true;
  }
  const upstreamQuery = buildUpstreamQuery(url.searchParams);
  upstreamQuery.set("target", target);
  const upstreamUrl = `${apiInternalUrl}/api/v1/subscriptions/public/${encodeURIComponent(match.publicId)}/render${formatQuery(upstreamQuery)}`;
  const upstream = await input.fetchImpl(upstreamUrl, {
    headers: buildSubscriptionProxyHeaders(request, request.headers.accept ?? "*/*")
  });
  const body = await upstream.text();
  const headers = {
    "content-type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
    "cache-control": "no-store"
  };
  copySafeUpstreamHeaders(upstream.headers, headers);
  response.writeHead(upstream.status, headers);
  response.end(body);
  return true;
}

function isDeviceBindingRequired(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.code === "subscription_device_id_required";
  } catch {
    return false;
  }
}

function copySafeUpstreamHeaders(source, target) {
  const blocked = new Set([
    "cache-control",
    "connection",
    "content-length",
    "content-type",
    "date",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ]);
  for (const [name, value] of source.entries()) {
    const normalizedName = String(name).trim().toLowerCase();
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedName || blocked.has(normalizedName) || !normalizedValue) {
      continue;
    }
    if (normalizedName.includes("\r") || normalizedName.includes("\n")) {
      continue;
    }
    if (normalizedValue.includes("\r") || normalizedValue.includes("\n")) {
      continue;
    }
    target[normalizedName] = normalizedValue;
  }
}

function buildUpstreamQuery(searchParams) {
  const upstreamQuery = new URLSearchParams(searchParams);
  upstreamQuery.delete("format");
  return upstreamQuery;
}

function formatQuery(searchParams) {
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function buildSubscriptionProxyHeaders(request, accept) {
  const headers = { accept };
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"])
    || firstHeaderValue(request.headers.host);
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"])
    || (request.headers["x-forwarded-ssl"] === "on" ? "https" : null)
    || inferPublicProto(forwardedHost);
  if (forwardedHost) {
    headers["X-Forwarded-Host"] = forwardedHost;
  }
  if (forwardedProto) {
    headers["X-Forwarded-Proto"] = forwardedProto;
  }
  for (const [incomingName, upstreamName] of [
    ["x-lumen-hwid", "X-Lumen-HWID"],
    ["x-device-id", "X-Device-Id"]
  ]) {
    const value = firstHeaderValue(request.headers[incomingName]);
    if (value) {
      headers[upstreamName] = value;
    }
  }
  return headers;
}

function inferPublicProto(host) {
  const value = String(host ?? "").toLowerCase();
  if (!value || value.startsWith("localhost") || value.startsWith("127.") || value.startsWith("[::1]")) {
    return "http";
  }
  return "https";
}

function inferTargetFromUserAgent(userAgent = "") {
  const value = String(userAgent).toLowerCase();
  if (value.includes("lumenvpn") || value.includes("lumen vpn")) {
    return "lumen-json";
  }
  if (value.includes("hiddify")) {
    return "hiddify";
  }
  if (value.includes("happ")) {
    return "happ";
  }
  if (value.includes("sing-box") || value.includes("singbox") || value.includes("nekobox")) {
    return "sing-box";
  }
  if (value.includes("clash") || value.includes("mihomo") || value.includes("stash")) {
    return "mihomo";
  }
  return "happ";
}

export function buildExternalRequestUrl(request, url) {
  const proto = firstHeaderValue(request.headers["x-forwarded-proto"])
    || (request.headers["x-forwarded-ssl"] === "on" ? "https" : null)
    || url.protocol.replace(":", "")
    || "http";
  const host = firstHeaderValue(request.headers["x-forwarded-host"])
    || request.headers.host
    || url.host
    || "localhost";
  return `${proto}://${host}${url.pathname.replace(/\/$/, "")}`;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return firstHeaderValue(value[0]);
  }
  if (typeof value !== "string") {
    return null;
  }
  const first = value.split(",")[0]?.trim();
  return first || null;
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

      if (await proxySubscriptionRender(request, response, { env, fetchImpl })) {
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
