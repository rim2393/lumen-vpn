# Lumen VPN

English | [Русский](README.ru.md)

Lumen VPN is an open-source, self-hosted VPN platform for operating distributed nodes, delivering client configuration, monitoring service health, and maintaining Android and Windows clients from one repository.

The project is being prepared as a public monorepo. It keeps the Android app, Windows desktop client, deployment templates, installer scripts, protocol/runtime integration code, and operator documentation together so maintainers can review, test, release, and secure the whole product from one place.

## Scope

- Android VPN client: `app/`
- Backend API and control plane: `apps/api/`
- Admin web console: `apps/web/`
- Node agent: `apps/node-agent/`
- Lumen Edge fallback/subscription service: `apps/lumen-edge/`
- Shared backend/web/node packages: `packages/`
- Windows desktop client and MSI packaging: `desktop/`
- Android protocol integration modules: `amnezia-openvpn/`, `amnezia-protocol-api/`, `amnezia-utils/`
- Server deployment templates: `deploy/`
- Installer, backup, restore, release, and diagnostics scripts: `scripts/`
- Release metadata templates: `release/`
- Product and operator docs: `docs/`
- Project knowledge base for maintainers: `PROJECT_WIKI/`

The recommended GitHub repository name is `lumen-vpn`. The product name shown to users is `Lumen VPN`.

## Goals

- Provide a transparent self-hosted control plane and node operations path.
- Support subscription import from links, files, clipboard, and QR codes.
- Support common modern VPN/proxy profile families used by compatible clients.
- Keep Android release screens portrait-only.
- Keep secrets, tokens, subscription URLs, private keys, generated runtime configs, and server credentials out of source control.
- Make maintainer work auditable through tests, CI, release manifests, security notes, and documented decisions.

## Current Components

| Area | Status |
| --- | --- |
| Android client | Active Kotlin/Compose app, package `tel.lumentech.vpn` |
| Windows client | Kotlin/JVM desktop client with Windows packaging scripts |
| Deployment | Docker Compose and Nginx templates for panel/node installs |
| Node operations | Installer, doctor, backup, restore, upgrade, rollback, support bundle scripts |
| Security hygiene | Secret scanner, redaction rules, encrypted token storage notes |
| CI | ShellCheck, Compose rendering, secret scan, release manifest validation |

The backend, web console, node-agent, Android client, Windows client, deployment scripts, shared packages, and operator docs are now represented in one repository. Documentation should still mark incomplete runtime paths honestly instead of implying production readiness without validation.

## Quick Start

### Android

```powershell
.\gradlew.bat :app:assembleDebug
```

### Windows Desktop

```powershell
.\gradlew.bat :desktop:test
.\desktop\packaging\build-msi.ps1
```

### Backend API

```bash
cd apps/api
python -m pytest
```

### Web Console and Node Packages

```bash
cd apps/web
npm test
npm run build
```

### Installer Validation

```bash
for f in scripts/*.sh scripts/lib/*.sh; do bash -n "$f"; done
shellcheck scripts/*.sh scripts/lib/*.sh
docker compose --env-file .env.example -f deploy/compose/lumen.yml config
docker compose --env-file .env.example -f deploy/compose/lumen-node.yml config
./scripts/secret-scan.sh .
```

## Documentation

- [Install guide](docs/INSTALL.md)
- [Node install guide](docs/NODE_INSTALL.md)
- [Operations guide](docs/OPERATIONS.md)
- [Release process](docs/RELEASE.md)
- [OSS notices](docs/OSS_NOTICES.md)
- [Security policy](SECURITY.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## Open Source Maintenance

Lumen VPN is structured for real maintainer workflows:

- pull request review;
- issue triage;
- test generation and regression checks;
- release checklist validation;
- documentation updates;
- security-focused code review;
- dependency and license auditing.

This makes the project a good fit for tooling such as Codex for Open Source, provided the public repository contains the complete maintained source, honest status, CI evidence, and no private credentials.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
