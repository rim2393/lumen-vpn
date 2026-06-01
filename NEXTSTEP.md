# NEXTSTEP — паритет с Remnawave 2.7.4

> Эталон: живой инстанс `https://service.lumentech.tel` — **Remnawave `backend:2` (v2.7.4)**.
> Стек эталона: `remnawave/backend:2` + `postgres:17.6` + `valkey/valkey:9-alpine` +
> `remnawave/subscription-page:latest` + `remnawave/caddy-with-auth:latest`.
> Цель: закрыть дыры (бэк → фронт), а повторяющиеся экраны сделать визуально 1-в-1 как у Remnawave.
> Доп. экраны, которых у Remnawave нет (MFA, Guard-portal, License, API-keys) — оставляем как есть.

Легенда: `[ ]` не начато · `[~]` в работе · `[x]` готово (ruff+pytest+tsc зелёные) · `[?]` нужно проверить

---

## Фаза 0 — Выравнивание стека (инфра)
- [x] Сверить наши образы в `deploy/compose/*.yml` с эталоном Remnawave 2.7.4
  - [x] Postgres → `postgres:17.6` (`.env.example`)
  - [x] Redis → `valkey/valkey:9-alpine` + сервис на `valkey-server`/`valkey-cli` (`lumen.yml`)
  - [x] subscription-page сервис присутствует (`subscription` в `lumen.yml`)
  - [~] reverse-proxy: у нас **nginx** (функц. эквивалент caddy-with-auth) — своп на Caddy = отдельное решение, НЕ делаю сейчас
- [ ] Реальные `@sha256` дайджесты — release-шаг (Block B), сейчас placeholder-нули
- [ ] **Проверить на деплое** (compose в песочнице запустить нельзя — valkey-смена не протестирована локально)

## Фаза 1 — Бэкенд-дыры (СРОЧНО, full-stack блокеры)
### 1.1 prometheus-reporter  `[x]`
- [x] домен `app/domains/metrics/` (service + router)
- [x] эндпоинт `GET /api/v1/metrics` (Prometheus text v0.0.4, под `NODE_MANAGE`)
- [x] подключён в `app/api/v1/router.py`
- [x] тест `tests/test_metrics_routes.py`
- [x] ruff + pytest зелёные (109 passed)
- [ ] (опц.) отдельный scrape-токен вместо JWT для Prometheus

### 1.2 ip-control (anti-abuse / лимит одновременных IP)  `[x]`
- [x] модель/миграция `0006_ip_control` (rules + events)
- [x] service: resolve_effective_rule (user>squad>global) + evaluate_access + CRUD
- [x] router `/api/v1/ip-control/{rules,events,evaluate}`
- [x] тест `tests/test_ip_control_routes.py`
- [x] ruff + pytest зелёные (изолированный прогон; полный — после 1.3)

### 1.3 node-plugins (плагины ноды / фильтрация трафика)  `[x]`
> torrent-blocker-reports УЖЕ есть в `tools` — переиспользовано, не дублировано.
- [x] модель/миграция `0007_node_plugins` (kind, config_json, node_id nullable=глобальный)
- [x] service: CRUD + фильтр по node (node-specific + global)
- [x] router `/api/v1/node-plugins`
- [x] тест `tests/test_node_plugins_routes.py`
- [x] ruff + pytest зелёные (изолированный; полный — после 1.4)

### 1.4 infra-billing (CRM / учёт стоимости инфры)  `[x]`
- [x] домен + миграция `0008_infra_billing` (providers + records, период/валюта/нода)
- [x] service: CRUD + summary (totals_by_currency)
- [x] router `/api/v1/infra-billing/{providers,records,summary}`
- [x] тест `tests/test_infra_billing_routes.py`
- [x] ruff + pytest зелёные — **полный прогон: 113 passed**

## Фаза 2 — Фронт-дыры
### 2.1 Config Profile editor (xray-редактор)  `[x]` (функционально)
- [x] проверено: `ProfilesPage` уже имеет `configJson` в форме + computed-config view (copy/download) — редактирование конфига есть
- [ ] (опц.) Monaco-подсветка/валидация — косметика, не блокер паритета «по функции»

### 2.2 Node Plugins screen  `[x]`
- [x] `NodePluginsPage` (создание/таблица/enable-disable/delete) + навигация + роут `/node-plugins`
- [x] API-слой: types + httpClient + dev-mock + хуки (`useNodePlugins*`)
- [x] tsc -b зелёный

### 2.3 Infra Billing screen (CRM)  `[x]`
- [x] `InfraBillingPage` (провайдеры + записи + сводка по валютам) + навигация + роут `/infra-billing`
- [x] API-слой: types + httpClient + dev-mock + хуки (`useInfra*`)
- [x] tsc -b зелёный

### 2.4 Мелочи
- [x] отдельный экран ошибки 5xx — `ErrorPage` + `errorElement` на корневом роуте
- [x] Templates editor — проверено: create/update-хуки есть (CRUD-редактор present)
- [x] OAuth2 callback — поток backend-handled (LoginPage → `startOAuth` → провайдер → бэк ставит сессию/редирект); отдельный фронт-роут не нужен
- [x] Subpage Configs — `SubscriptionPublicPage` present (функционально)
- [~] Nodes Bandwidth Table / Statistic Nodes — сейчас покрыто инлайн через `useNodeMetricsData` в NodesPage; отдельные экраны = нужны bandwidth-stats эндпоинты в бэке (отложено)
- [ ] гео-карта на Dashboard — нужен map-движок/данные (косметика, отложено)

## Фаза 3 — Визуальный паритет 1-в-1
> Для экранов, эквивалентных Remnawave, привести вёрстку/раскладку как у эталона.
> ⚠️ Ограничение песочницы: пиксельную фидельность нельзя проверить (нет рендера; vite/vitest виснет).
> Делаю проверяемую часть — **информационную архитектуру**: титулованные секции + сетки карточек +
> термины как у Remnawave (их фронт на Mantine: `<Title>` + `<SimpleGrid>` карточек по секциям).
> Финальную визуальную доводку смотришь ты в живом приложении.
- [x] Dashboard / Home — титулованные секции метрик (Users / Infrastructure / Subscriptions & license) + RU. Гео-карта отложена. `tsc` зелёный.
- [x] Node plugins / Infra billing — новые экраны + полный RU.
- [x] Nodes — RU: шапка/описание/колонки/статусы/Обновить. Остаток: сырые JSX-литералы (Inspect/Resume/Quarantine, описания статусов, внутр. заголовок) — обернуть в t().

### ⚠️ Системная находка по RU
Старые страницы местами **хардкодят английский текст прямо в JSX мимо `t()`**. Полная RU-локализация = на каждой странице обернуть сырые литералы в `t()` + добить ключи в словаре. Структурно (IA/раскладка) экраны уже соответствуют Remnawave.

Очередь RU-свипа (обернуть литералы + ключи), по убыванию заметности:
- [x] Nodes — полностью RU (шапка/колонки/статусы/описания/кнопки). Остаток: динамич. префикс "Last heartbeat" (некрит.)
- [x] Hosts — полностью RU (шапка/таблица/колонки/массовые действия/форма/редактор/operator-guide)
- [x] Profiles — уже был полностью RU (использует t() повсеместно) — проверено
- [x] Squads — RU (шапка/таблица/редактор/форма/состав/матрица). Мелочь: лейбл "Editor JSON"
- [x] Settings — RU (шапка/реестр/колонки KEY-VALUE/аутентификация/форма). Провайдер-строки = данные.
- [ ] Subscription / Subscription Page
- [ ] Templates
- [ ] Response rules
- [ ] Tools (HWID/SRH/Torrent/Sessions)
- [ ] License / API keys
- [ ] Users (+ детально)
- [ ] Hosts
- [ ] Nodes (+ metrics / bandwidth / stats)
- [ ] Config Profiles (+ editor)
- [ ] Internal / External Squads
- [ ] Response Rules
- [ ] Settings (Remnawave Settings)
- [ ] Subscription Settings / Subpage
- [ ] Templates
- [ ] Tools: HWID / SRH / Torrent / Sessions (у нас 1 страница → раскладка как у Remnawave)

---

## Рендер фронта для визуального ревью (РАБОТАЕТ, демо строго локально)
- `.claude/launch.json` (в корне `D:\android-app-new`) → preview-инструмент стартует `npm run dev` на :5173 в фоне.
- Демо-фикстуры включаются флагом `VITE_LUMEN_USE_FIXTURES=true` в `apps/web/.env.development.local`.
  Чтобы включить локально: создать этот файл с этой строкой (он gitignored).
- **Защита «демо НИКОГДА в прод» — 3 слоя (в `ApiClientProvider`):**
  1. `import.meta.env.DEV` — компайл-тайм `false` в `vite build` ⇒ ветка и импорт фикстур вырезаются из прод-бандла.
  2. флаг живёт только в `.env.development.local` — а в этом репо `.gitignore` правило `.env.*` (кроме `.env.example`) ⇒ **любой env-файл с флагом физически нельзя закоммитить/запушить**; vite не грузит `.env.development.local` в prod-режиме.
  3. PROD-tripwire: если флаг всё же виден в prod-сборке → приложение падает с ошибкой (fail-closed), а не молча отдаёт демо.
- Скриншоты/инспекция — через preview-инструмент; HMR подхватывает правки.

## Команды проверки (memo)
```
cd D:/android-app-new/_work/full-revna-like-projekt/apps/api
.venv-test/Scripts/python.exe -m ruff check app tests
.venv-test/Scripts/python.exe -m pytest -q
cd ../node-agent && node --test
cd ../web && npx tsc -b      # vitest НЕ запускать (виснет)
```

## Правила
- Ничего не пушить/деплоить без явной команды владельца. На прод по SSH — только чтение (порт 23234).
- Ротация засветившихся секретов (root-пароль ноды-эталона, ghp-токен) — на стороне владельца.
- `.research/` и `build/` не трогать.
