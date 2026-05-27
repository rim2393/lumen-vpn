FROM node:24.13.0-alpine AS runtime

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /srv/lumen-edge

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "./src/server.js"]
