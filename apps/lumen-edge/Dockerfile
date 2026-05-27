FROM node:24.13.0-alpine AS runtime

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /srv/lumen-edge

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--input-type=module", "-e", "import { createServer } from 'node:http'; import { randomUUID } from 'node:crypto'; import { createFallbackLandingModel, renderFallbackLandingHtml } from './src/index.js'; const port = Number.parseInt(process.env.PORT || process.env.LUMEN_EDGE_PORT || '8080', 10); const server = createServer((request, response) => { if (request.url === '/healthz') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok\\n'); return; } const model = createFallbackLandingModel({ host: request.headers.host, reason: process.env.LUMEN_EDGE_FALLBACK_REASON, requestId: request.headers['x-request-id'] || randomUUID() }); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(renderFallbackLandingHtml(model)); }); server.listen(port, '0.0.0.0', () => console.log(`lumen-edge listening on ${port}`));"]
