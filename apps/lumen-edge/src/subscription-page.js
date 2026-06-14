import QRCode from "qrcode";

export const SUBSCRIPTION_PAGE_MODEL_VERSION = "lumen.edge.subscription-page.v1";

const CLIENTS = Object.freeze([
  {
    key: "hiddify",
    label: "Hiddify",
    platform: "Android, iOS, Windows, macOS, Linux",
    renderer: "Raw URI subscription",
    scheme: "hiddify"
  },
  {
    key: "happ",
    label: "Happ",
    platform: "Android, iOS, Windows, macOS",
    renderer: "Raw URI subscription",
    scheme: "happ"
  },
  {
    key: "v2ray",
    label: "v2rayNG / v2rayN",
    platform: "Android, Windows",
    renderer: "Raw URI subscription",
    scheme: "v2rayng"
  },
  {
    key: "v2ray-base64",
    label: "v2ray base64",
    platform: "Legacy v2ray clients",
    renderer: "Base64 URI subscription",
    scheme: null
  },
  {
    key: "streisand",
    label: "Streisand",
    platform: "iOS, macOS",
    renderer: "Raw URI subscription",
    scheme: null
  },
  {
    key: "shadowrocket",
    label: "Shadowrocket",
    platform: "iOS",
    renderer: "Raw URI subscription",
    scheme: null
  },
  {
    key: "mihomo",
    label: "Mihomo / Clash Meta",
    platform: "Desktop, Android",
    renderer: "YAML proxy groups",
    scheme: null
  },
  {
    key: "flclash",
    label: "FlClash",
    platform: "Android, Windows, macOS, Linux",
    renderer: "YAML proxy groups",
    scheme: null
  },
  {
    key: "stash",
    label: "Stash",
    platform: "iOS, macOS",
    renderer: "YAML proxy groups",
    scheme: null
  },
  {
    key: "koala-clash",
    label: "Koala Clash",
    platform: "Android",
    renderer: "YAML proxy groups",
    scheme: null
  },
  {
    key: "sing-box",
    label: "Sing-box / NekoBox",
    platform: "Android, iOS, desktop",
    renderer: "sing-box JSON",
    scheme: null
  },
  {
    key: "nekoray",
    label: "NekoRay",
    platform: "Windows, Linux",
    renderer: "sing-box JSON",
    scheme: null
  },
  {
    key: "amnezia",
    label: "Amnezia / Xray JSON",
    platform: "Android, iOS, desktop",
    renderer: "Xray JSON",
    scheme: null
  }
]);

export function wantsHtmlSubscriptionPage(request) {
  const accept = String(request.headers.accept ?? "");
  const userAgent = String(request.headers["user-agent"] ?? "").toLowerCase();
  return accept.includes("text/html") && !/(hiddify|happ|clash|mihomo|sing-box|v2ray|nekobox|stash)/.test(userAgent);
}

export function renderDeviceBindingHtml({ publicId, publicUrl }) {
  const safePublicId = String(publicId ?? "");
  const safePublicUrl = String(publicUrl ?? "");
  const storageKey = `lumen-sub-device:${safePublicId}`;
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lumen subscription device binding</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #10151d; color: #f7fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 30% 0%, #1b2441 0, #101720 42%, #0c1118 100%); }
    body::before { content: ""; position: fixed; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 64px 64px; pointer-events: none; }
    main { position: relative; width: min(520px, calc(100% - 28px)); border: 1px solid #293341; background: rgba(19,25,35,.9); border-radius: 16px; padding: 28px; box-shadow: 0 18px 60px rgba(0,0,0,.24); }
    .mark { width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg,#35e4ff,#1468ff); margin-bottom: 18px; }
    h1 { margin: 0 0 10px; font-size: 24px; }
    p { margin: 0; color: #a7b2c2; line-height: 1.55; }
    a { color: #54e7ff; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true"></div>
    <h1>Preparing device binding</h1>
    <p>The subscription page will reopen with a stable identifier for this browser. This is required for device limits and HWID policy.</p>
    <p><a href="${escapeHtml(safePublicUrl)}">Continue manually</a></p>
  </main>
  <script>
    (() => {
      const storageKey = ${JSON.stringify(storageKey)};
      const generateId = () => {
        if (globalThis.crypto?.randomUUID) {
          return "web-" + globalThis.crypto.randomUUID();
        }
        const random = Math.random().toString(36).slice(2);
        return "web-" + Date.now().toString(36) + "-" + random;
      };
      let deviceId = "";
      try {
        deviceId = localStorage.getItem(storageKey) || "";
        if (!deviceId) {
          deviceId = generateId();
          localStorage.setItem(storageKey, deviceId);
        }
      } catch {
        deviceId = generateId();
      }
      const url = new URL(globalThis.location.href);
      if (!url.searchParams.get("hwid") && !url.searchParams.get("device_id")) {
        url.searchParams.set("hwid", deviceId);
      }
      globalThis.location.replace(url.toString());
    })();
  </script>
</body>
</html>`;
}

export function renderSubscriptionPageHtml({ manifest, publicUrl }) {
  const provider = manifest.provider?.name || "Lumen";
  const subpage = normalizeSubpageConfig(manifest.metadata?.subpage);
  const title = subpage.title || manifest.metadata?.profileTitle || provider;
  const subscription = manifest.subscription ?? {};
  const serverCount = Array.isArray(manifest.nodes) && manifest.nodes.length > 0
    ? manifest.nodes.length
    : 1;
  const serverLabel = serverCount === 1 ? "1 live server" : `${serverCount} live servers`;
  const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
  const expiresText = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "No expiry";
  const supportUrl = manifest.metadata?.supportUrl || "#";
  const supportText = subpage.supportText || "Support";
  const enabledCards = new Set(subpage.cards);
  const showStatus = enabledCards.size === 0 || enabledCards.has("status");
  const showApps = enabledCards.size === 0 || enabledCards.has("apps");
  const showLinks = enabledCards.size === 0 || enabledCards.has("links") || enabledCards.has("qr");
  const clientLinks = CLIENTS.map((client) => {
    const targetUrl = client.key === "happ" ? `${publicUrl}/${client.key}?raw=1` : `${publicUrl}/${client.key}`;
    const encodedTargetUrl = encodeURIComponent(targetUrl);
    let importUrl = targetUrl;
    let iosImportUrl = targetUrl;
    if (client.scheme === "hiddify") {
      importUrl = `hiddify://import/${targetUrl}#${encodeURIComponent(title)}`;
    }
    if (client.scheme === "happ") {
      importUrl = `happ://add/${encodedTargetUrl}`;
      iosImportUrl = `happ://import/${encodedTargetUrl}`;
    }
    if (client.scheme === "v2rayng") {
      importUrl = `v2rayng://install-sub?url=${encodedTargetUrl}#${encodeURIComponent(title)}`;
    }
    return { ...client, importUrl, iosImportUrl, targetUrl };
  });
  const happLink = clientLinks.find((client) => client.key === "happ");
  const featuredLinks = clientLinks.filter((client) => ["happ", "hiddify", "v2ray"].includes(client.key));
  const advancedLinks = clientLinks.filter((client) => !["happ", "hiddify", "v2ray"].includes(client.key));
  const rawSubscriptionUrl = happLink?.targetUrl ?? `${publicUrl}/v2ray`;
  const qrSvg = renderQrSvg(rawSubscriptionUrl);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Subscription</title>
  <style>
    :root { color-scheme: dark; --bg: #070b12; --panel: rgba(14, 20, 31, .88); --line: rgba(148, 163, 184, .22); --line-strong: rgba(103, 232, 249, .42); --text: #f8fafc; --muted: #9aa8ba; --cyan: #67e8f9; --green: #86efac; --violet: #a78bfa; --shadow: 0 22px 70px rgba(0, 0, 0, .38); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; background: radial-gradient(circle at 18% 0%, rgba(103,232,249,.24), transparent 28%), radial-gradient(circle at 82% 12%, rgba(167,139,250,.18), transparent 24%), linear-gradient(180deg, #08101d 0%, #070b12 52%, #05070b 100%); }
    body::before { content: ""; position: fixed; inset: 0; background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px); background-size: 42px 42px; mask-image: linear-gradient(to bottom, black, transparent 74%); pointer-events: none; }
    main { position: relative; width: min(960px, calc(100% - 28px)); margin: 0 auto; padding: 22px 0 max(44px, env(safe-area-inset-bottom)); }
    header, section { border: 1px solid var(--line); background: var(--panel); border-radius: 18px; box-shadow: var(--shadow); backdrop-filter: blur(18px); }
    header { display: flex; justify-content: space-between; gap: 14px; align-items: center; padding: 16px 18px; margin-bottom: 14px; }
    .brand { display: flex; gap: 10px; align-items: center; font-weight: 850; color: var(--text); font-size: 20px; letter-spacing: 0; }
    .mark { width: 32px; height: 32px; border-radius: 10px; background: linear-gradient(135deg, var(--cyan), #2563eb 58%, var(--violet)); box-shadow: 0 0 24px rgba(103,232,249,.32); }
    .telegram { display: grid; place-items: center; min-width: 44px; min-height: 44px; padding: 0 14px; border: 1px solid rgba(103,232,249,.5); border-radius: 12px; color: var(--cyan); text-decoration: none; font-weight: 800; background: rgba(8, 145, 178, .12); }
    .card { margin-top: 14px; padding: 22px; }
    .hero { overflow: hidden; background: linear-gradient(135deg, rgba(14,20,31,.96), rgba(15,23,42,.9)); }
    .status { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: start; }
    .check { min-width: 78px; min-height: 34px; border-radius: 999px; display: grid; place-items: center; background: rgba(22, 163, 74, .14); border: 1px solid rgba(134,239,172,.5); color: var(--green); font-size: 13px; font-weight: 900; }
    h1, h2, p { margin: 0; }
    h1 { font-size: clamp(28px, 7vw, 46px); line-height: 1.03; max-width: 12ch; }
    h2 { font-size: 18px; margin-bottom: 14px; }
    .muted { color: var(--muted); margin-top: 8px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
    .info { border: 1px solid var(--line); border-radius: 14px; padding: 13px; background: rgba(3, 7, 18, .34); min-width: 0; }
    .info span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
    .info strong { display: block; overflow-wrap: anywhere; font-size: 16px; line-height: 1.35; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
    .action { min-height: 52px; border: 1px solid var(--line); background: rgba(15,23,42,.82); color: var(--text); border-radius: 14px; padding: 12px 14px; text-decoration: none; font-weight: 850; display: flex; align-items: center; justify-content: center; text-align: center; }
    .action.primary { border-color: var(--line-strong); color: #06131a; background: linear-gradient(135deg, var(--cyan), #7dd3fc); box-shadow: 0 12px 36px rgba(34, 211, 238, .18); }
    button.action { cursor: pointer; font: inherit; }
    .apps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .app { border: 1px solid var(--line); background: rgba(15, 23, 42, .68); color: var(--text); border-radius: 14px; padding: 14px; text-decoration: none; display: grid; gap: 6px; min-height: 96px; }
    .app:hover, .app:focus-visible, .action:hover, .action:focus-visible { border-color: var(--line-strong); outline: none; }
    .app span { color: var(--muted); font-size: 12px; }
    .app em { color: var(--cyan); font-style: normal; font-size: 13px; }
    details { margin-top: 12px; border: 1px solid var(--line); border-radius: 14px; background: rgba(3,7,18,.24); }
    summary { cursor: pointer; padding: 14px; font-weight: 850; color: var(--cyan); }
    .advanced { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0 14px 14px; }
    .copy { margin-top: 14px; display: grid; gap: 10px; }
    .qr-import { display: grid; grid-template-columns: minmax(142px, 190px) 1fr; gap: 18px; align-items: center; margin-bottom: 16px; }
    .qr-box { display: grid; place-items: center; width: 100%; aspect-ratio: 1; border: 1px solid rgba(248,250,252,.42); border-radius: 18px; background: #f8fafc; padding: 12px; }
    .qr-box svg { width: 100%; height: 100%; display: block; }
    .qr-help { display: grid; gap: 8px; }
    code { display: block; word-break: break-all; color: #dbeafe; background: rgba(2,6,23,.72); border: 1px solid var(--line); border-radius: 12px; padding: 12px; font-size: 12px; }
    @media (max-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .apps, .advanced { grid-template-columns: 1fr; } }
    @media (max-width: 560px) { main { width: min(100% - 18px, 960px); padding-top: 10px; } header { padding: 12px; } .brand { font-size: 18px; } .telegram { padding: 0 12px; } .card { padding: 18px; } .status, .qr-import { grid-template-columns: 1fr; } .check { justify-self: start; } .actions { grid-template-columns: 1fr; } .qr-box { max-width: 220px; justify-self: center; } h1 { max-width: none; } }
  </style>
</head>
<body class="${escapeHtml(subpage.theme ? `theme-${cssToken(subpage.theme)}` : "")}">
  <main>
    <header>
      <div class="brand"><span class="mark" aria-hidden="true"></span>${escapeHtml(provider)}</div>
      <a class="telegram" href="${escapeHtml(supportUrl)}" aria-label="${escapeHtml(supportText)}">Help</a>
    </header>
    ${showStatus ? `<section class="card hero" data-subpage-config-id="${escapeHtml(subpage.configId ?? "")}" data-subpage-config-name="${escapeHtml(subpage.configName ?? "")}">
      <div class="status">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="muted">Subscription is active - expires: ${escapeHtml(expiresText)}</p>
        </div>
        <div class="check">ACTIVE</div>
      </div>
      <div class="grid">
        <div class="info"><span>Profile</span><strong>${escapeHtml(title)}</strong></div>
        <div class="info"><span>Status</span><strong>Active</strong></div>
        <div class="info"><span>Servers</span><strong>${escapeHtml(serverLabel)}</strong></div>
        <div class="info"><span>Formats</span><strong>URI / YAML / JSON</strong></div>
      </div>
    </section>` : ""}
    ${showApps ? `<section class="card">
      <h2>Add subscription</h2>
      ${happLink ? `<div class="actions" aria-label="Happ import actions">
        <a class="action primary" href="${escapeHtml(happLink.importUrl)}" data-client-link data-client="Happ">Open in Happ</a>
        <a class="action" href="${escapeHtml(happLink.iosImportUrl)}" data-client-link data-client="Happ iOS">Open in Happ iOS</a>
        <a class="action" href="${escapeHtml(happLink.targetUrl)}">Raw Happ</a>
        <button class="action" type="button" data-copy-url data-url="${escapeHtml(happLink.targetUrl)}">Copy Raw</button>
      </div>` : ""}
      <div class="apps">
        ${featuredLinks.map((client) => `<a class="app" href="${escapeHtml(client.importUrl)}"><strong>${escapeHtml(client.label)}</strong><span>${escapeHtml(client.platform)}</span><em>${escapeHtml(client.renderer)}</em></a>`).join("")}
      </div>
      <details>
        <summary>Advanced formats</summary>
        <div class="advanced">
          ${advancedLinks.map((client) => `<a class="app" href="${escapeHtml(client.importUrl)}"><strong>${escapeHtml(client.label)}</strong><span>${escapeHtml(client.platform)}</span><em>${escapeHtml(client.renderer)}</em></a>`).join("")}
        </div>
      </details>
    </section>` : ""}
    ${showLinks ? `<section class="card">
      <h2>Manual import URLs</h2>
      <div class="qr-import">
        <div class="qr-box" aria-label="QR code for raw Happ subscription">${qrSvg}</div>
        <div class="qr-help">
          <strong>QR import</strong>
          <p class="muted">Scan this code from Happ or another compatible client. It contains the same Raw Happ URL as the buttons above.</p>
        </div>
      </div>
      <div class="copy">
        <p class="muted">For manual import, copy the universal URL or a client-specific format URL:</p>
        <code>${escapeHtml(rawSubscriptionUrl)}</code>
        ${clientLinks.map((client) => `<code>${escapeHtml(client.targetUrl)}</code>`).join("")}
      </div>
    </section>` : ""}
  </main>
  <script>
    document.querySelectorAll("[data-copy-url]").forEach((button) => {
      button.addEventListener("click", async () => {
        const value = button.dataset.url || "";
        try {
          await navigator.clipboard.writeText(value);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Open Raw and copy";
        }
      });
    });
  </script>
</body>
</html>`;
}

export function renderQrSvg(value) {
  const qr = QRCode.create(String(value ?? ""), {
    errorCorrectionLevel: "M",
    margin: 2
  });
  const size = qr.modules.size;
  const margin = 2;
  const viewBoxSize = size + margin * 2;
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(x, y)) {
        rects.push(`<rect x="${x + margin}" y="${y + margin}" width="1" height="1"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" role="img" data-lumen-qr="raw-happ" data-qr-value="${escapeHtml(value)}"><rect width="${viewBoxSize}" height="${viewBoxSize}" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}

function normalizeSubpageConfig(value) {
  const config = value && typeof value === "object" ? value : {};
  const cards = Array.isArray(config.cards)
    ? config.cards.filter((card) => typeof card === "string" && card.length > 0)
    : [];
  return {
    cards,
    configId: typeof config.configId === "string" ? config.configId : null,
    configName: typeof config.configName === "string" ? config.configName : null,
    supportText: typeof config.supportText === "string" ? config.supportText : null,
    theme: typeof config.theme === "string" ? config.theme : null,
    title: typeof config.title === "string" ? config.title : null
  };
}

function cssToken(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
