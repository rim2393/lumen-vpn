FROM node:24.13.0-alpine AS runtime

ARG XRAY_VERSION=v26.5.9
ARG SING_BOX_VERSION=1.13.12
ARG AMNEZIAWG_TOOLS_VERSION=1.0.20260223
ARG SHADOWSOCKS_RUST_VERSION=1.24.0
ARG V2RAY_PLUGIN_VERSION=1.3.2
ARG SIMPLE_OBFS_VERSION=v0.0.5

ENV NODE_ENV=production
ENV XRAY_LOCATION_ASSET=/usr/local/share/xray

WORKDIR /srv/lumen-node-agent

RUN apk add --no-cache ca-certificates curl gcompat iproute2 iptables libev pcre tar unzip wireguard-tools wireguard-tools-wg-quick xz \
  && apk add --no-cache --virtual .simple-obfs-build-deps asciidoc autoconf automake build-base git libev-dev libtool linux-headers openssl-dev pcre-dev xmlto zlib-dev \
  && mkdir -p /usr/local/share/xray \
  && curl -fsSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" \
  && unzip -j /tmp/xray.zip xray geoip.dat geosite.dat -d /usr/local/share/xray \
  && install -m 0755 /usr/local/share/xray/xray /usr/local/bin/xray \
  && curl -fsSL -o /tmp/sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-linux-amd64.tar.gz" \
  && tar -xzf /tmp/sing-box.tar.gz -C /tmp \
  && install -m 0755 "/tmp/sing-box-${SING_BOX_VERSION}-linux-amd64/sing-box" /usr/local/bin/sing-box \
  && curl -fsSL -o /tmp/amneziawg-tools.zip "https://github.com/amnezia-vpn/amneziawg-tools/releases/download/v${AMNEZIAWG_TOOLS_VERSION}/alpine-3.19-amneziawg-tools.zip" \
  && unzip -j /tmp/amneziawg-tools.zip "alpine-3.19-amneziawg-tools/awg" "alpine-3.19-amneziawg-tools/awg-quick" -d /usr/local/bin \
  && chmod 0755 /usr/local/bin/awg /usr/local/bin/awg-quick \
  && curl -fsSL -o /tmp/shadowsocks-rust.tar.xz "https://github.com/shadowsocks/shadowsocks-rust/releases/download/v${SHADOWSOCKS_RUST_VERSION}/shadowsocks-v${SHADOWSOCKS_RUST_VERSION}.x86_64-unknown-linux-musl.tar.xz" \
  && mkdir -p /tmp/shadowsocks-rust \
  && tar -xJf /tmp/shadowsocks-rust.tar.xz -C /tmp/shadowsocks-rust \
  && install -m 0755 "$(find /tmp/shadowsocks-rust -type f -name ssserver | head -n 1)" /usr/local/bin/ssserver \
  && curl -fsSL -o /tmp/v2ray-plugin.tar.gz "https://github.com/shadowsocks/v2ray-plugin/releases/download/v${V2RAY_PLUGIN_VERSION}/v2ray-plugin-linux-amd64-v${V2RAY_PLUGIN_VERSION}.tar.gz" \
  && mkdir -p /tmp/v2ray-plugin \
  && tar -xzf /tmp/v2ray-plugin.tar.gz -C /tmp/v2ray-plugin \
  && install -m 0755 "$(find /tmp/v2ray-plugin -type f -name 'v2ray-plugin*' | head -n 1)" /usr/local/bin/v2ray-plugin \
  && git clone --depth 1 --branch "${SIMPLE_OBFS_VERSION}" https://github.com/shadowsocks/simple-obfs.git /tmp/simple-obfs \
  && cd /tmp/simple-obfs \
  && git submodule update --init --recursive \
  && ./autogen.sh \
  && ./configure --prefix=/usr/local \
  && make -j"$(nproc)" \
  && install -m 0755 src/obfs-server /usr/local/bin/obfs-server \
  && apk del .simple-obfs-build-deps \
  && rm -rf /tmp/xray.zip /tmp/sing-box.tar.gz /tmp/amneziawg-tools.zip /tmp/shadowsocks-rust.tar.xz /tmp/shadowsocks-rust /tmp/v2ray-plugin.tar.gz /tmp/v2ray-plugin /tmp/simple-obfs "/tmp/sing-box-${SING_BOX_VERSION}-linux-amd64"

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

ENTRYPOINT ["node", "/srv/lumen-node-agent/src/cli.js"]
CMD ["--run"]
