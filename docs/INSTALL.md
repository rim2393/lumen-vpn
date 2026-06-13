# Install guide

## Supported host

- Debian 12 or Ubuntu 22.04/24.04
- systemd
- root or sudo access
- Public DNS records for the panel and subscription domains
- Ports `80` and `443` available on the host
- Docker Engine with Compose v2

## Production install

1. Clone this repository.
2. Copy `.env.example` to a private path, usually `/opt/lumen/.env`.
3. Set domains, ACME email, timezone, and release image references.
4. Put registry credentials in `REGISTRY_TOKEN_FILE` if private image pulls
   require authentication.
5. Run a dry run:

```bash
sudo ./scripts/install.sh --config /opt/lumen/.env --dry-run
```

6. Run the installer:

```bash
sudo ./scripts/install.sh --config /opt/lumen/.env
```

The installer generates missing secrets, installs Docker/Compose and Nginx when
needed, renders Nginx templates, issues TLS certificates with acme.sh, starts
the Compose stack, runs backend bootstrap commands, and performs health checks.

## Image pinning

Release manifests provide full image references with tags and digests:

```text
ghcr.io/rim2393/lumen-api:v0.1.0@sha256:<64 hex chars>
```

The installer refuses production installs when an image digest is missing,
zeroed, or marked as `CHANGE_ME`.

## First admin

Set `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_USERNAME`. If
`FIRST_ADMIN_PASSWORD=GENERATE`, the installer asks the private API image to
generate a first admin password and recovery codes. These values are printed
once by the backend command and are not stored in this repository.

