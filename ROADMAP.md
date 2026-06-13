# Lumen VPN Roadmap

This roadmap describes the path from the current open-source baseline to a complete production product.

Русская версия ниже является основной. English version is included for public review.

## Текущий статус

Lumen VPN уже оформлен как публичный open-source monorepo:

- репозиторий опубликован как `lumen-vpn`;
- backend, web/admin panel, node-agent, Android, Windows desktop, deployment scripts, docs и tests собраны в одном репозитории;
- добавлены README на двух языках, license, security policy, contribution guide, issue templates, PR template и CI;
- приватные runtime-файлы, secrets, логи, build outputs и local credentials исключены из репозитория;
- проект готов к внешнему review и подаче в OpenAI Codex for Open Source.

Дальше roadmap идет не про упаковку репозитория, а про доведение продукта до полностью готовой production-платформы.

## Этап 1. Backend и Admin Panel

Цель: сделать центральную панель управления, через которую оператор может управлять пользователями, подписками, протоколами, нодами и состоянием всей VPN-сети.

Что нужно доделать:

- единая модель пользователей, тарифов, подписок и устройств;
- полноценная страница управления VPN-профилями;
- поддержка всех целевых протоколов в backend и UI;
- генерация client configs и subscription links;
- импорт и экспорт подписок;
- QR-коды, clipboard/file import и ручная выдача конфигов;
- статусы пользователей, лимиты, сроки действия, блокировки и продления;
- аудит действий администратора;
- нормальные API contracts между backend, web, node-agent и client apps;
- тесты на генерацию конфигов, безопасность, лимиты и edge cases.

Результат этапа: backend и web-панель умеют управлять всей VPN-логикой без ручной правки конфигов.

## Этап 2. Node Agent и Поддержка Протоколов На Нодах

Цель: сделать ноды управляемыми из backend, с автоматической установкой, обновлением и синхронизацией конфигураций.

Что нужно доделать:

- node-agent для Linux-серверов;
- поддержка всех протоколов, которые доступны в backend;
- безопасная регистрация ноды в control plane;
- синхронизация inbound/outbound configs;
- health checks, metrics, online/offline статус;
- управление reload/restart без ручного SSH;
- логирование ошибок ноды без утечки secrets;
- rollback конфигурации при неудачном обновлении;
- compatibility matrix по Ubuntu/Debian и поддерживаемым runtime.

Результат этапа: нода подключается к Lumen VPN и управляется из панели как часть сети.

## Этап 3. Простая Выкладка Нод По Логину И Паролю Сервера

Цель: оператор добавляет новый сервер максимально просто: вводит host, login, password или SSH key, а система сама готовит ноду.

Что нужно доделать:

- форма добавления сервера в admin panel;
- SSH-подключение к серверу с явным подтверждением оператора;
- bootstrap script для установки Docker/runtime/node-agent;
- автоматическая проверка OS, firewall, ports, DNS и сетевой доступности;
- установка и регистрация node-agent;
- создание первой рабочей конфигурации ноды;
- отображение прогресса установки по шагам;
- безопасное обращение с временными credentials без сохранения паролей в открытом виде;
- понятные ошибки установки и retry flow.

Результат этапа: новую VPN-ноду можно развернуть из панели, предоставив доступ к серверу, без ручной настройки на сервере.

## Этап 4. Android App

Цель: довести Android-клиент до стабильного пользовательского приложения.

Что нужно доделать:

- стабильный импорт subscription links, QR codes, clipboard и files;
- подключение/отключение VPN в один шаг;
- отображение текущей ноды, протокола, latency и статуса;
- выбор локации/ноды;
- автоматическое обновление подписки;
- обработка expired/disabled subscriptions;
- локальные diagnostics без утечки приватных данных;
- portrait-only release screens;
- release build, signing, versioning и update flow;
- проверка на реальных устройствах и эмуляторах.

Результат этапа: Android app готов к регулярным release builds и реальному использованию пользователями.

## Этап 5. Windows App

Цель: сделать Windows-клиент с нормальной установкой, обновлением и управлением VPN-подключением.

Что нужно доделать:

- installer для Windows;
- system tray app;
- импорт subscription links и configs;
- подключение/отключение VPN;
- управление runtime/service lifecycle;
- выбор ноды и отображение статуса;
- auto-update или документированный manual update flow;
- сбор diagnostics bundle без secrets;
- signed releases и release manifests;
- проверка на Windows 10/11.

Результат этапа: Windows app устанавливается как обычное приложение и стабильно управляет VPN runtime.

## Этап 6. macOS App

Цель: выпустить macOS-клиент с нативным пользовательским опытом и корректной установкой.

Что нужно доделать:

- macOS app shell;
- импорт subscriptions и configs;
- подключение/отключение VPN;
- menu bar status;
- управление permissions и network extension/runtime;
- notarization и signing;
- update flow;
- diagnostics без secrets;
- проверка на Apple Silicon и Intel, если поддержка Intel остается в scope.

Результат этапа: macOS app можно безопасно распространять и устанавливать без ручной настройки.

## Этап 7. iOS App

Цель: подготовить iOS-клиент для пользователей Apple ecosystem.

Что нужно доделать:

- iOS app shell;
- импорт subscription links и QR codes;
- VPN connect/disconnect flow;
- отображение статуса, локации, latency и срока действия подписки;
- Network Extension integration;
- account/subscription UX без хранения лишних secrets;
- TestFlight pipeline;
- App Store readiness review.

Результат этапа: iOS app готов к TestFlight и дальнейшей публикации.

## Этап 8. Production Readiness

Цель: довести весь продукт до состояния, в котором его можно поддерживать как настоящую VPN-платформу.

Что нужно доделать:

- release pipeline для backend, node-agent, Android, Windows, macOS и iOS;
- signed release artifacts и checksums;
- install/update/rollback runbooks;
- backup/restore для control plane;
- monitoring и alerting;
- security audit и threat model;
- dependency/license audit;
- abuse prevention и rate limits;
- документация для операторов и пользователей на двух языках;
- понятная схема версий и changelog;
- публичная compatibility matrix;
- reproducible demo deployment.

Результат этапа: Lumen VPN готов как полноценный production-продукт, а не просто набор отдельных компонентов.

## English Summary

1. Finish the backend and admin panel with full protocol support, subscription management, config generation, audits, and API contracts.
2. Finish the node-agent with full protocol support, safe registration, health checks, config sync, rollback, and metrics.
3. Add one-click node deployment from the admin panel by providing server access credentials or SSH key, with secure bootstrap and visible progress.
4. Finish the Android client with subscription import, connect/disconnect, node selection, diagnostics, release signing, and device verification.
5. Finish the Windows client with installer, tray app, runtime/service lifecycle, diagnostics, signed releases, and Windows 10/11 verification.
6. Build the macOS client with signing, notarization, menu bar status, runtime integration, updates, and diagnostics.
7. Build the iOS client with subscription import, VPN flow, Network Extension integration, TestFlight pipeline, and App Store readiness.
8. Complete production readiness: release pipelines, signed artifacts, runbooks, backup/restore, monitoring, security audit, bilingual docs, compatibility matrix, and demo deployment.
