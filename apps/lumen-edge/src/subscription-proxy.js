export const SUBSCRIPTION_PROXY_MODEL_VERSION = "lumen.edge.subscription-proxy.v1";

const PUBLIC_ID_PATTERN = /^lumen_sub_[A-Za-z0-9_-]{16,}$/;

export function matchSubscriptionManifestPath(pathname) {
  const match = pathname.match(/^\/(?:sub|api\/sub)\/([^/]+)(?:\/manifest)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function validateSubscriptionPublicId(publicId) {
  return typeof publicId === "string" && PUBLIC_ID_PATTERN.test(publicId);
}

export function normalizeApiInternalUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

