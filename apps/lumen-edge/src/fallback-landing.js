export const FALLBACK_LANDING_MODEL_VERSION = "lumen.edge.fallback-landing.v1";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeActions(actions = []) {
  return Object.freeze(actions.map((action) => Object.freeze({
    kind: action.kind,
    label: action.label,
    href: action.href ?? null
  })));
}

export function createFallbackLandingModel(input = {}) {
  return Object.freeze({
    modelVersion: FALLBACK_LANDING_MODEL_VERSION,
    status: "fallback",
    reason: input.reason ?? "edge_route_unavailable",
    host: input.host ?? "unknown",
    title: input.title ?? "Lumen Edge fallback",
    message: input.message ?? "The edge service is reachable, but no live route is available for this request.",
    requestId: input.requestId ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    diagnostics: Object.freeze({
      cachePolicy: "no-store",
      secretsIncluded: false,
      liveTrafficEnabled: false
    }),
    actions: normalizeActions(input.actions ?? [
      { kind: "retry", label: "Retry", href: input.retryHref ?? "/" }
    ])
  });
}

export function renderFallbackLandingHtml(model) {
  if (model?.modelVersion !== FALLBACK_LANDING_MODEL_VERSION) {
    throw new Error(`modelVersion must be ${FALLBACK_LANDING_MODEL_VERSION}`);
  }

  const actionLinks = model.actions
    .map((action) => `<a href="${escapeHtml(action.href ?? "#")}" data-kind="${escapeHtml(action.kind)}">${escapeHtml(action.label)}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(model.title)}</title>
</head>
<body>
  <main data-model-version="${escapeHtml(model.modelVersion)}" data-status="fallback">
    <h1>${escapeHtml(model.title)}</h1>
    <p>${escapeHtml(model.message)}</p>
    <dl>
      <dt>Host</dt><dd>${escapeHtml(model.host)}</dd>
      <dt>Reason</dt><dd>${escapeHtml(model.reason)}</dd>
      <dt>Request</dt><dd>${escapeHtml(model.requestId ?? "n/a")}</dd>
    </dl>
    <nav>${actionLinks}</nav>
  </main>
</body>
</html>
`;
}
