# Security hardening TODO (API backend)

## Закрыто

- [x] Изолировать `SUPPORT` от админских привилегий управления пользователями
  и убрать `USER_MANAGE`.
- [x] Закрыть `admin_compat` от `SUPPORT` и `SUBSCRIPTION_READ`.
- [x] Зафиксировать выдачу API-ключей на уровне фактических прав вызывающего в
  Lumen-совместимом `/api/tokens`.
- [x] Добавить принудительные проверки изменения/удаления пользователя и
  массовых действий в сервисном слое.
- [x] Прогнать регрессионные проверки контроля маршрутов доступа и эскалации:
  `python -m pytest apps/api/tests/test_rbac_bootstrap.py
  apps/api/tests/test_security_services.py
  apps/api/tests/test_auth_user_api_key_routes.py
  apps/api/tests/test_admin_compat_routes.py -q` -> `25 passed` on
  2026-06-04.
- [x] Прогнать узкий lint по RBAC/auth/admin API surface:
  `python -m ruff check apps/api/app/core/rbac.py
  apps/api/app/domains/admin_compat apps/api/app/domains/api_keys
  apps/api/tests/test_rbac_bootstrap.py apps/api/tests/test_security_services.py
  apps/api/tests/test_auth_user_api_key_routes.py
  apps/api/tests/test_admin_compat_routes.py` -> `All checks passed` on
  2026-06-04.
- [x] Убрать широкий lint-долг `A005`: модуль `apps/api/app/core/logging.py`
  переименован в `apps/api/app/core/logging_config.py`; `python -m ruff check
  apps/api/app/core apps/api/app/main.py ...` -> `All checks passed` on
  2026-06-04.

## Открыто

- [ ] Нет открытых backend security TODO в этом файле на 2026-06-04.
