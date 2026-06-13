# GitHub Rebrand and OSS Checklist

English

Use this checklist when publishing the project for Codex for Open Source review.

## Repository Identity

- GitHub owner: choose the public organization or maintainer account.
- Repository name: `lumen-vpn`.
- Display name: `Lumen VPN`.
- Description: `Open-source self-hosted VPN platform for node orchestration, secure remote access, client configuration delivery, monitoring, and maintainer automation.`
- Topics: `vpn`, `self-hosted`, `android`, `windows`, `kotlin`, `docker`, `monitoring`, `security`, `wireguard`, `openvpn`.

## Before Publishing

- Remove private credentials and generated runtime files.
- Keep `.env.example`, but never commit real `.env` files.
- Do not publish raw subscription URLs, proxy URLs, UUID-bearing links, private keys, logs with user data, support bundles, or backups.
- Confirm root docs exist in English and Russian.
- Confirm CI passes or clearly documents missing credentials/devices.
- Confirm old prototype naming is either removed or explained as compatibility/reference history.

## Codex for OSS Positioning

Project summary:

```text
Lumen VPN is an open-source self-hosted platform for operating distributed networking nodes, delivering client configurations, monitoring service health, and maintaining Android and Windows VPN clients from one repository.
```

Why this repository qualifies:

```text
The project combines Android and Windows clients, deployment tooling, node operations, subscription import, monitoring, release workflows, and security documentation in a public monorepo. It is maintained as transparent infrastructure for legitimate self-hosted networking and secure remote access.
```

How API credits will be used:

```text
We will use API credits to automate maintainer workflows: pull request review, issue triage, test generation, documentation updates, release checklist validation, dependency review, and security-focused code review across Android, desktop, backend, node, and deployment code.
```

---

Русский

Используйте этот checklist перед публикацией проекта для Codex for Open Source review.

## Идентичность репозитория

- GitHub owner: публичная организация или maintainer account.
- Repository name: `lumen-vpn`.
- Display name: `Lumen VPN`.
- Description: `Open-source self-hosted VPN platform for node orchestration, secure remote access, client configuration delivery, monitoring, and maintainer automation.`
- Topics: `vpn`, `self-hosted`, `android`, `windows`, `kotlin`, `docker`, `monitoring`, `security`, `wireguard`, `openvpn`.

## Перед публикацией

- Удалить private credentials и generated runtime files.
- Оставить `.env.example`, но не коммитить реальные `.env`.
- Не публиковать raw subscription URLs, proxy URLs, UUID-bearing links, private keys, logs с пользовательскими данными, support bundles или backups.
- Проверить root docs на английском и русском.
- Проверить CI или честно описать, какие credentials/devices нужны.
- Убрать старое prototype naming или оставить только как compatibility/reference history.

## Позиционирование для Codex for OSS

Project summary:

```text
Lumen VPN is an open-source self-hosted platform for operating distributed networking nodes, delivering client configurations, monitoring service health, and maintaining Android and Windows VPN clients from one repository.
```

Why this repository qualifies:

```text
The project combines Android and Windows clients, deployment tooling, node operations, subscription import, monitoring, release workflows, and security documentation in a public monorepo. It is maintained as transparent infrastructure for legitimate self-hosted networking and secure remote access.
```

How API credits will be used:

```text
We will use API credits to automate maintainer workflows: pull request review, issue triage, test generation, documentation updates, release checklist validation, dependency review, and security-focused code review across Android, desktop, backend, node, and deployment code.
```
