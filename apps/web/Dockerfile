FROM node:24.13.0-alpine AS build

WORKDIR /srv/lumen-web

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html ./
COPY public ./public
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts ./
COPY src ./src

ARG VITE_LUMEN_API_MODE=api
ARG VITE_LUMEN_API_BASE_URL=__LUMEN_WEB_API_BASE_URL__
ENV VITE_LUMEN_API_MODE=${VITE_LUMEN_API_MODE} \
    VITE_LUMEN_API_BASE_URL=${VITE_LUMEN_API_BASE_URL}

RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29.3-alpine AS runtime

ENV PORT=3000 \
    LUMEN_API_UPSTREAM= \
    LUMEN_WEB_API_BASE_URL=

COPY --from=build --chown=101:101 /srv/lumen-web/dist /usr/share/nginx/html

USER root

RUN mkdir -p /etc/nginx/templates \
 && printf '%s\n' \
    'server {' \
    '  listen ${PORT};' \
    '  server_name _;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '' \
    '  location = /healthz {' \
    '    access_log off;' \
    '    add_header Content-Type text/plain;' \
    '    return 200 "ok\n";' \
    '  }' \
    '' \
    '  location /api/ {' \
    '    proxy_http_version 1.1;' \
    '    proxy_set_header Host $host;' \
    '    proxy_set_header X-Real-IP $remote_addr;' \
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
    '    proxy_set_header X-Forwarded-Proto $scheme;' \
    '    proxy_pass ${LUMEN_API_UPSTREAM};' \
    '  }' \
    '' \
    '  location / {' \
    '    try_files $uri $uri/ /index.html;' \
    '  }' \
    '}' \
    > /etc/nginx/templates/lumen-web.conf.template \
 && printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    '' \
    'PORT="${PORT:-3000}"' \
    'LUMEN_API_UPSTREAM="${LUMEN_API_UPSTREAM:-http://api:${LUMEN_API_INTERNAL_PORT:-8000}}"' \
    'export PORT LUMEN_API_UPSTREAM' \
    '' \
    'placeholder="__LUMEN_WEB_API_BASE_URL__"' \
    'api_base_url="${LUMEN_WEB_API_BASE_URL:-${API_BASE_URL:-}}"' \
    '' \
    'if [ -n "$api_base_url" ]; then' \
    '  escaped_api_base_url=$(printf "%s" "$api_base_url" | sed -e "s/[\\\\&@\"]/\\\\&/g")' \
    '  find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s@\"$placeholder\"@\"$escaped_api_base_url\"@g" {} +' \
    'else' \
    '  find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s@\"$placeholder\"@window.location.origin@g" {} +' \
    'fi' \
    '' \
    'envsubst '\''${PORT} ${LUMEN_API_UPSTREAM}'\'' < /etc/nginx/templates/lumen-web.conf.template > /etc/nginx/conf.d/default.conf' \
    'exec "$@"' \
    > /usr/local/bin/lumen-web-entrypoint \
 && chmod +x /usr/local/bin/lumen-web-entrypoint \
 && chown -R 101:101 /etc/nginx/conf.d /usr/share/nginx/html

USER 101

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/lumen-web-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
