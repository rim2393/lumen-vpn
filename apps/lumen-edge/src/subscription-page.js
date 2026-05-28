export const SUBSCRIPTION_PAGE_MODEL_VERSION = "lumen.edge.subscription-page.v1";

const CLIENTS = Object.freeze([
  { key: "hiddify", label: "Hiddify", scheme: "hiddify" },
  { key: "happ", label: "Happ", scheme: null },
  { key: "v2ray", label: "v2rayNG / v2rayN", scheme: null },
  { key: "mihomo", label: "Mihomo / Clash Meta", scheme: null },
  { key: "sing-box", label: "Sing-box / NekoBox", scheme: null },
  { key: "amnezia", label: "Amnezia / Xray JSON", scheme: null }
]);

export function wantsHtmlSubscriptionPage(request) {
  const accept = String(request.headers.accept ?? "");
  const userAgent = String(request.headers["user-agent"] ?? "").toLowerCase();
  return accept.includes("text/html") && !/(hiddify|happ|clash|mihomo|sing-box|v2ray|nekobox|stash)/.test(userAgent);
}

export function renderSubscriptionPageHtml({ manifest, publicUrl }) {
  const provider = manifest.provider?.name || "Lumen";
  const title = manifest.metadata?.profileTitle || provider;
  const subscription = manifest.subscription ?? {};
  const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
  const expiresText = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? expiresAt.toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" })
    : "без срока";
  const clientLinks = CLIENTS.map((client) => {
    const targetUrl = `${publicUrl}/${client.key}`;
    const importUrl = client.scheme === "hiddify"
      ? `hiddify://import/${targetUrl}#${encodeURIComponent(title)}`
      : targetUrl;
    return { ...client, importUrl, targetUrl };
  });

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Subscription</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #10151d; color: #f7fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #10151d 0%, #151a25 100%); }
    body::before { content: ""; position: fixed; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 40px 40px; pointer-events: none; }
    main { position: relative; width: min(860px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 54px; }
    header, section { border: 1px solid #2d3748; background: rgba(28, 34, 46, .88); border-radius: 16px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 28px; }
    .brand { display: flex; gap: 12px; align-items: center; font-weight: 800; color: #56dff7; font-size: 22px; }
    .mark { width: 30px; height: 30px; border-left: 4px solid #22d3ee; border-right: 4px solid #22d3ee; border-radius: 7px; }
    .telegram { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid #1d9bf0; border-radius: 10px; color: #35d2ff; text-decoration: none; font-weight: 800; }
    .card { margin-top: 28px; padding: 28px 32px; }
    .status { display: grid; grid-template-columns: 54px 1fr; gap: 14px; align-items: center; }
    .check { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: rgba(16, 185, 129, .15); border: 1px solid #10b981; color: #69f0ae; font-size: 24px; }
    h1, h2, p { margin: 0; }
    h1 { font-size: clamp(24px, 4vw, 34px); }
    h2 { font-size: 20px; margin-bottom: 16px; }
    .muted { color: #a6b0c0; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
    .info { border: 1px solid #334155; border-radius: 10px; padding: 14px; background: rgba(15, 23, 42, .35); }
    .info span { display: block; color: #94a3b8; font-size: 13px; margin-bottom: 5px; }
    .apps { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    .app { border: 1px solid #334155; background: #1b2330; color: #edf2f7; border-radius: 10px; padding: 14px; text-decoration: none; display: flex; justify-content: space-between; align-items: center; min-height: 58px; }
    .app:hover { border-color: #22d3ee; color: #67e8f9; }
    .copy { margin-top: 18px; display: grid; gap: 10px; }
    code { display: block; word-break: break-all; color: #cbd5e1; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; }
    @media (max-width: 620px) { header { padding: 18px; } .card { padding: 22px 18px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand"><span class="mark" aria-hidden="true"></span>${escapeHtml(provider)}</div>
      <a class="telegram" href="${escapeHtml(manifest.metadata?.supportUrl || "#")}" aria-label="Support">↗</a>
    </header>
    <section class="card">
      <div class="status">
        <div class="check">✓</div>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="muted">Подписка активна · истекает: ${escapeHtml(expiresText)}</p>
        </div>
      </div>
      <div class="grid">
        <div class="info"><span>Профиль</span><strong>${escapeHtml(title)}</strong></div>
        <div class="info"><span>Статус</span><strong>Активна</strong></div>
        <div class="info"><span>Subscription ID</span><strong>${escapeHtml(subscription.id || "")}</strong></div>
        <div class="info"><span>Форматы</span><strong>URI · YAML · JSON</strong></div>
      </div>
    </section>
    <section class="card">
      <h2>Добавить подписку</h2>
      <div class="apps">
        ${clientLinks.map((client) => `<a class="app" href="${escapeHtml(client.importUrl)}"><strong>${escapeHtml(client.label)}</strong><span>Открыть</span></a>`).join("")}
      </div>
      <div class="copy">
        <p class="muted">Для ручного импорта используйте нужный URL формата:</p>
        ${clientLinks.map((client) => `<code>${escapeHtml(client.targetUrl)}</code>`).join("")}
      </div>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
