# Contributing / Участие в разработке

English

Thanks for helping maintain Lumen VPN. This repository is intended to contain the full product surface: Android, Windows desktop, deployment, node operations, release metadata, tests, and documentation.

## Ground Rules

- Do not commit secrets, tokens, private keys, subscription URLs, generated runtime configs, support bundles, backups, or server credentials.
- Keep Android release screens portrait-only.
- Do not add fake/demo success paths for production features.
- Describe unfinished backend, node, protocol, or client work honestly.
- Keep public wording focused on legitimate self-hosted networking, node orchestration, secure remote access, config management, monitoring, and maintainer automation.

## Development Flow

1. Open an issue for non-trivial changes.
2. Keep pull requests scoped to one feature, fix, or documentation area.
3. Add or update tests when behavior changes.
4. Update docs when commands, deployment steps, protocols, or security boundaries change.
5. Run the relevant checks before requesting review.

## Useful Checks

```powershell
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :desktop:test
```

```bash
for f in scripts/*.sh scripts/lib/*.sh; do bash -n "$f"; done
shellcheck scripts/*.sh scripts/lib/*.sh
docker compose --env-file .env.example -f deploy/compose/lumen.yml config
docker compose --env-file .env.example -f deploy/compose/lumen-node.yml config
./scripts/secret-scan.sh .
```

## Pull Request Checklist

- The change has a clear user/operator/maintainer purpose.
- Security-sensitive data is not logged, stored in docs, or committed.
- Public docs are updated in English and Russian when user-facing behavior changes.
- CI checks pass or the failure is explained in the PR.

---

Русский

Спасибо за помощь с Lumen VPN. Этот репозиторий должен содержать весь продуктовый контур: Android, Windows desktop, deployment, node operations, release metadata, tests и documentation.

## Правила

- Не коммитьте secrets, tokens, private keys, subscription URLs, generated runtime configs, support bundles, backups или server credentials.
- Android release screens должны оставаться portrait-only.
- Не добавляйте fake/demo success paths для production features.
- Честно описывайте незавершенную backend, node, protocol или client работу.
- В публичных текстах используйте легитимные формулировки: self-hosted networking, node orchestration, secure remote access, config management, monitoring, maintainer automation.

## Процесс

1. Для нетривиальных изменений откройте issue.
2. Держите pull request в рамках одной feature/fix/docs области.
3. Добавляйте или обновляйте tests при изменении поведения.
4. Обновляйте docs при изменении команд, deployment steps, protocols или security boundaries.
5. Перед review запускайте релевантные проверки.

## Checklist для PR

- Изменение имеет понятную пользу для пользователя, оператора или мейнтейнера.
- Security-sensitive data не попадает в logs, docs или commits.
- Public docs обновлены на английском и русском, если меняется пользовательское поведение.
- CI проходит или причина падения объяснена в PR.
