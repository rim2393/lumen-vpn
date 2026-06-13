# Lumen VPN

[English](README.md) | Русский

Lumen VPN - открытая self-hosted VPN-платформа для управления распределенными узлами, доставки клиентских конфигураций, мониторинга состояния сервиса и поддержки Android/Windows клиентов из одного репозитория.

Проект готовится как публичный монорепозиторий. В одном дереве должны жить Android-приложение, Windows-клиент, deploy-шаблоны, installer scripts, интеграции protocol/runtime и документация оператора, чтобы мейнтейнеры могли ревьюить, тестировать, релизить и проверять безопасность всего продукта в одном месте.

## Состав

- Android VPN client: `app/`
- Backend API и control plane: `apps/api/`
- Admin web console: `apps/web/`
- Node agent: `apps/node-agent/`
- Lumen Edge fallback/subscription service: `apps/lumen-edge/`
- Shared backend/web/node packages: `packages/`
- Windows desktop client и MSI packaging: `desktop/`
- Android protocol integration modules: `amnezia-openvpn/`, `amnezia-protocol-api/`, `amnezia-utils/`
- Server deployment templates: `deploy/`
- Installer, backup, restore, release и diagnostics scripts: `scripts/`
- Release metadata templates: `release/`
- Product/operator docs: `docs/`
- Project knowledge base для мейнтейнеров: `PROJECT_WIKI/`

Рекомендуемое имя репозитория на GitHub: `lumen-vpn`. Пользовательский бренд: `Lumen VPN`.

## Цели

- Дать прозрачный self-hosted путь для control plane и node operations.
- Поддерживать импорт подписок из ссылок, файлов, clipboard и QR-кодов.
- Поддерживать распространенные современные VPN/proxy profile families, совместимые с клиентами.
- Оставить Android release screens строго portrait-only.
- Не хранить в source control secrets, tokens, subscription URLs, private keys, generated runtime configs и server credentials.
- Сделать работу мейнтейнера проверяемой через tests, CI, release manifests, security notes и documented decisions.

## Текущее состояние

| Зона | Статус |
| --- | --- |
| Android client | Активное Kotlin/Compose приложение, package `tel.lumentech.vpn` |
| Windows client | Kotlin/JVM desktop client с Windows packaging scripts |
| Deployment | Docker Compose и Nginx templates для panel/node installs |
| Node operations | Installer, doctor, backup, restore, upgrade, rollback, support bundle scripts |
| Security hygiene | Secret scanner, redaction rules, encrypted token storage notes |
| CI | ShellCheck, Compose rendering, secret scan, release manifest validation |

Backend, web console, node-agent, Android client, Windows client, deployment scripts, shared packages и operator docs теперь представлены в одном репозитории. Документация все равно должна честно помечать незавершенные runtime paths, а не выдавать их за production-ready без validation.

## Быстрый старт

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

## Документация

- [Install guide](docs/INSTALL.md)
- [Node install guide](docs/NODE_INSTALL.md)
- [Operations guide](docs/OPERATIONS.md)
- [Release process](docs/RELEASE.md)
- [OSS notices](docs/OSS_NOTICES.md)
- [Security policy](SECURITY.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## Open Source Maintenance

Lumen VPN должен выглядеть как настоящий maintained OSS project:

- pull request review;
- issue triage;
- test generation и regression checks;
- release checklist validation;
- documentation updates;
- security-focused code review;
- dependency/license auditing.

Именно так проект лучше позиционировать для Codex for Open Source: не как закрытый сервис, а как открытый инструмент для legitimate self-hosted networking, node orchestration, secure remote access, config management, monitoring и maintainer automation.

## Лицензия

Проект распространяется под GNU Affero General Public License v3.0 or later. См. [LICENSE](LICENSE).
