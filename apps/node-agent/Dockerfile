FROM node:24.13.0-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /srv/lumen-node-agent

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

ENTRYPOINT ["node", "/srv/lumen-node-agent/src/cli.js"]
CMD ["--dry-run"]
