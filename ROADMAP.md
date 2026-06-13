# Roadmap / Дорожная карта

English

This roadmap is intentionally public and honest. It is used to show maintainers, contributors, and reviewers what is implemented, what is being consolidated, and what still needs production validation.

## Milestone 1: Public OSS Baseline

- Publish the repository as `lumen-vpn`.
- Keep Android, Windows desktop, deploy scripts, node operations, tests, and docs in one repository.
- Add bilingual README, contributing guide, security policy, roadmap, issue templates, and PR template.
- Confirm that CI runs ShellCheck, Compose rendering, secret scanning, release manifest validation, Android tests, and desktop tests where practical.
- Remove or ignore generated build outputs, private runtime files, logs, support bundles, and local credentials.

## Milestone 2: Monorepo Consolidation

- Keep backend API source in `apps/api`.
- Keep web/admin frontend source in `apps/web`.
- Keep node-agent source in `apps/node-agent`.
- Document package boundaries and release ownership.
- Replace prototype naming with `Lumen VPN` or neutral compatibility wording.

## Milestone 3: Client and Protocol Validation

- Keep subscription import working for links, files, clipboard, and QR codes.
- Validate Android runtime paths for supported protocol families.
- Validate Windows runtime packaging and service lifecycle.
- Publish compatibility notes and known limitations without exposing private subscriptions or credentials.

## Milestone 4: Release Quality

- Publish signed release manifests.
- Add dependency and license audit output.
- Add security reporting and responsible disclosure process.
- Add reproducible install/update/rollback runbooks.
- Maintain bilingual operator docs.

---

Русский

Эта дорожная карта намеренно публичная и честная. Она показывает мейнтейнерам, контрибьюторам и reviewer'ам, что уже реализовано, что переносится в монорепозиторий и что еще требует production validation.

## Milestone 1: Public OSS Baseline

- Опубликовать репозиторий как `lumen-vpn`.
- Держать Android, Windows desktop, deploy scripts, node operations, tests и docs в одном репозитории.
- Добавить bilingual README, contributing guide, security policy, roadmap, issue templates и PR template.
- Подтвердить CI: ShellCheck, Compose rendering, secret scanning, release manifest validation, Android tests и desktop tests там, где это практично.
- Удалить или игнорировать generated build outputs, private runtime files, logs, support bundles и local credentials.

## Milestone 2: Monorepo Consolidation

- Держать backend API source в `apps/api`.
- Держать web/admin frontend source в `apps/web`.
- Держать node-agent source в `apps/node-agent`.
- Описать package boundaries и release ownership.
- Заменить prototype naming на `Lumen VPN` или нейтральные compatibility wording.

## Milestone 3: Client and Protocol Validation

- Сохранить импорт подписок из links, files, clipboard и QR codes.
- Проверить Android runtime paths для поддерживаемых protocol families.
- Проверить Windows runtime packaging и service lifecycle.
- Опубликовать compatibility notes и known limitations без private subscriptions или credentials.

## Milestone 4: Release Quality

- Публиковать signed release manifests.
- Добавить dependency/license audit output.
- Добавить security reporting и responsible disclosure process.
- Добавить reproducible install/update/rollback runbooks.
- Поддерживать bilingual operator docs.
