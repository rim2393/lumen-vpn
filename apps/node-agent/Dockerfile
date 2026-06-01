FROM node:24.13.0-alpine AS runtime

ARG XRAY_VERSION=v26.5.9
ARG SING_BOX_VERSION=1.13.12

ENV NODE_ENV=production
ENV XRAY_LOCATION_ASSET=/usr/local/share/xray

WORKDIR /srv/lumen-node-agent

RUN apk add --no-cache ca-certificates curl gcompat unzip \
  && mkdir -p /usr/local/share/xray \
  && curl -fsSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" \
  && unzip -j /tmp/xray.zip xray geoip.dat geosite.dat -d /usr/local/share/xray \
  && install -m 0755 /usr/local/share/xray/xray /usr/local/bin/xray \
  && curl -fsSL -o /tmp/sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-linux-amd64.tar.gz" \
  && tar -xzf /tmp/sing-box.tar.gz -C /tmp \
  && install -m 0755 "/tmp/sing-box-${SING_BOX_VERSION}-linux-amd64/sing-box" /usr/local/bin/sing-box \
  && rm -rf /tmp/xray.zip /tmp/sing-box.tar.gz "/tmp/sing-box-${SING_BOX_VERSION}-linux-amd64"

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

ENTRYPOINT ["node", "/srv/lumen-node-agent/src/cli.js"]
CMD ["--run"]
