# Security Policy / Политика безопасности

English

## Reporting

Please report vulnerabilities privately to the maintainers before opening a public issue. Do not include exploit-ready details, private subscription URLs, tokens, passwords, private keys, server credentials, or user data in public GitHub issues.

If the repository does not yet list a public security contact, open a minimal issue that says you need a private security contact and wait for maintainer response.

## Trust Boundaries

- User-controlled subscription text, URLs, QR content, files, and clipboard.
- Remote subscription responses.
- Lumen cabinet/auth responses and refresh tokens.
- Android `VpnService` tunnel file descriptor and per-app routing rules.
- Windows service/runtime process boundaries.
- Native hiddify-core/sing-box/OpenVPN/AmneziaWG runtime components.
- Node provisioning, release manifests, installer-generated secrets, and backups.

## Implemented Controls

- No hardcoded user credentials or server passwords in tracked source.
- Tokens are stored in encrypted preferences where supported.
- Passwords, tokens, private keys, UUID-bearing proxy URLs, and subscription URLs are redacted before diagnostic display/logging.
- Imported profiles are validated before runtime config generation.
- Cleartext traffic is disabled by Android network security config.
- Backups exclude secure Android token storage and local Room database data.
- Installer docs require generated secrets and private `.env` files to stay outside the repository.
- CI includes a public secret scan gate.

## Remaining Release Work

- Run a full dependency/license audit for shipped Android AARs, JVM libraries, native runtimes, and transitive dependencies.
- Test production Lumen subscriptions for each supported protocol family.
- Validate traffic leak behavior on physical Android devices with always-on VPN and lockdown mode enabled.
- Validate Windows service lifecycle and runtime process isolation.
- Publish signed release manifests and document key rotation.

---

Русский

## Репорты

Сообщайте об уязвимостях приватно мейнтейнерам до открытия публичного issue. Не публикуйте exploit-ready детали, private subscription URLs, tokens, passwords, private keys, server credentials или user data в GitHub issues.

Если в репозитории еще нет публичного security contact, откройте минимальный issue о том, что нужен приватный security contact, и дождитесь ответа.

## Trust Boundaries

- Пользовательские subscription text, URLs, QR content, files и clipboard.
- Remote subscription responses.
- Lumen cabinet/auth responses и refresh tokens.
- Android `VpnService` tunnel file descriptor и per-app routing rules.
- Windows service/runtime process boundaries.
- Native hiddify-core/sing-box/OpenVPN/AmneziaWG runtime components.
- Node provisioning, release manifests, installer-generated secrets и backups.

## Реализованные меры

- В tracked source нет hardcoded user credentials или server passwords.
- Tokens хранятся в encrypted preferences там, где это поддерживается.
- Passwords, tokens, private keys, UUID-bearing proxy URLs и subscription URLs редактируются перед diagnostic display/logging.
- Imported profiles валидируются перед генерацией runtime config.
- Cleartext traffic отключен в Android network security config.
- Backups исключают secure Android token storage и local Room database data.
- Installer docs требуют держать generated secrets и private `.env` вне репозитория.
- CI содержит public secret scan gate.

## Осталось перед релизом

- Провести полный dependency/license audit для Android AARs, JVM libraries, native runtimes и transitive dependencies.
- Проверить production Lumen subscriptions для каждой supported protocol family.
- Проверить traffic leak behavior на физических Android devices с always-on VPN и lockdown mode.
- Проверить Windows service lifecycle и runtime process isolation.
- Публиковать signed release manifests и document key rotation.
