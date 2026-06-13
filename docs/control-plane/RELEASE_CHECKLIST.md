# Release Checklist

## v0.1.0-prototype Gate

- [ ] Public installer repo contains no private source code.
- [ ] Private Docker images build and are version-pinned.
- [ ] GHCR images are published without a floating `latest` tag:
      `ghcr.io/rim2393/lumen-api:${LUMEN_VERSION}`,
      `ghcr.io/rim2393/lumen-web:${LUMEN_VERSION}`,
      `ghcr.io/rim2393/lumen-node-agent:${LUMEN_VERSION}`, and
      `ghcr.io/rim2393/lumen-subscription-page:${LUMEN_VERSION}`.
- [ ] Release manifest pins each GHCR image by digest after publish.
- [ ] API container listens on `${PORT:-8000}` and exposes
      `/api/v1/health/live`.
- [ ] Web container listens on `${PORT:-3000}`, serves the Vite build, and
      proxies `/api/` to `${LUMEN_API_UPSTREAM}`. Default upstream is
      `http://api:${LUMEN_API_INTERNAL_PORT:-8000}`.
- [ ] Web API runtime base URL is set with `LUMEN_WEB_API_BASE_URL` or legacy
      `API_BASE_URL`; if neither is set the bundle uses `window.location.origin`
      so same-origin `/api/` proxying works.
- [ ] Node-agent image runs as a non-root user, uses the
      `lumen-node-agent` CLI entrypoint, and receives tokens through env or
      `_FILE` secret mounts. Default command is `--run`, which exchanges the
      install token once, persists a node token in state, and heartbeats.
- [ ] Subscription image is built from `apps/lumen-edge`, listens on
      `${PORT:-8080}`, and serves only the non-secret fallback landing surface.
- [ ] Clean VPS panel install completes.
- [ ] Nginx and acme.sh TLS works.
- [ ] First admin login works.
- [ ] RBAC checks enforce backend permissions.
- [ ] API keys are scoped, hash-stored, and shown once.
- [ ] Free three-node license mode works.
- [ ] Paid node pause/resume works.
- [ ] Push node provisioning from panel works.
- [ ] Fallback pull node install exists.
- [ ] Node-agent connects outbound.
- [ ] Protocol framework exists.
- [ ] Protocol adapters pass install/remove/health/export/conflict tests one by
      one.
- [ ] `lumen.subscription.v1` validates.
- [ ] Sing-box and Mihomo renderers validate.
- [ ] Client fixtures parse.
- [ ] Backup works.
- [ ] Restore path is tested or documented as incomplete in `REMAINING.md`.
- [ ] Support bundle redacts secrets.
- [ ] CI checks are green or failures are documented in `REMAINING.md`.
