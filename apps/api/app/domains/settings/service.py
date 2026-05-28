from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.settings.models import PanelSetting
from app.domains.settings.schemas import (
    AuthProviderResponse,
    AuthProviderUpdateRequest,
    SettingResponse,
    SettingUpdateRequest,
)

AUTH_PROVIDERS_KEY = "auth.providers"
LIVE_AUTH_PROVIDERS = frozenset({"password"})
RESERVED_SETTING_KEYS = frozenset({AUTH_PROVIDERS_KEY})
DEFAULT_AUTH_PROVIDERS: tuple[dict[str, object], ...] = (
    {
        "provider": "password",
        "display_name": "Password",
        "enabled": True,
        "status": "active",
        "scopes": ["admin:login"],
        "metadata_json": {"mfa_required": True},
    },
    {
        "provider": "passkey",
        "display_name": "Passkey",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["admin:login"],
        "metadata_json": {"webauthn": "disabled_until_registered"},
    },
    {
        "provider": "telegram",
        "display_name": "Telegram",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["admin:login"],
        "metadata_json": {"bot_binding": "disabled_until_callback_implemented"},
    },
    {
        "provider": "github",
        "display_name": "GitHub",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["read:user", "user:email"],
        "metadata_json": {},
    },
    {
        "provider": "google",
        "display_name": "Google",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "pocketid",
        "display_name": "Pocket ID",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "keycloak",
        "display_name": "Keycloak",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "generic_oauth2",
        "display_name": "Generic OAuth2",
        "enabled": False,
        "status": "unimplemented",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
)


async def list_settings(session: AsyncSession) -> list[PanelSetting]:
    result = await session.execute(select(PanelSetting).order_by(PanelSetting.key.asc()))
    return list(result.scalars().all())


async def get_setting(session: AsyncSession, *, key: str) -> PanelSetting:
    result = await session.execute(select(PanelSetting).where(PanelSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting is None:
        raise APIError(
            code="setting_not_found",
            message="Setting was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return setting


async def upsert_setting(
    session: AsyncSession,
    *,
    key: str,
    request: SettingUpdateRequest,
    principal: Principal,
) -> PanelSetting:
    if key in RESERVED_SETTING_KEYS:
        raise APIError(
            code="setting_reserved_key",
            message="This setting is managed by a typed backend endpoint.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[key],
        )
    await _upsert_setting(session, key=key, value_json=request.value_json, principal=principal)
    result = await session.execute(select(PanelSetting).where(PanelSetting.key == key))
    return result.scalar_one()


async def _upsert_setting(
    session: AsyncSession,
    *,
    key: str,
    value_json: dict[str, object],
    principal: Principal,
) -> None:
    _ensure_no_secret_like_keys(
        value_json,
        code="setting_secret_like_key",
        message="Panel settings must reference secret material by backend config, not store it.",
    )
    result = await session.execute(select(PanelSetting).where(PanelSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting is None:
        setting = PanelSetting(key=key, value_json=value_json, updated_by=principal.subject)
        session.add(setting)
    else:
        setting.value_json = value_json
        setting.updated_by = principal.subject
    await session.flush()


async def list_auth_providers(session: AsyncSession) -> list[AuthProviderResponse]:
    providers = await _auth_provider_records(session)
    return [_auth_provider_response(provider) for provider in providers]


async def update_auth_provider(
    session: AsyncSession,
    *,
    provider: str,
    request: AuthProviderUpdateRequest,
    principal: Principal,
) -> AuthProviderResponse:
    providers = await _auth_provider_records(session)
    record = next((item for item in providers if item["provider"] == provider), None)
    if record is None:
        raise APIError(
            code="auth_provider_not_found",
            message="Authentication provider was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    data = request.model_dump(exclude_unset=True)
    if data.get("enabled") is True and provider not in LIVE_AUTH_PROVIDERS:
        raise APIError(
            code="auth_provider_not_live",
            message=(
                "This authentication provider is catalog-only until its login callback "
                "and account-binding flow are implemented."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[provider],
        )
    metadata = data.get("metadata_json")
    if isinstance(metadata, dict):
        _ensure_no_secret_like_keys(
            metadata,
            code="auth_provider_secret_like_metadata",
            message=(
                "Auth provider metadata must reference secrets by backend config, "
                "not store them."
            ),
        )
    record.update(data)
    await _save_auth_providers(session, providers=providers, principal=principal)
    return _auth_provider_response(record)


def setting_response(setting: PanelSetting) -> SettingResponse:
    return SettingResponse(
        id=setting.id,
        key=setting.key,
        value_json=setting.value_json,
        updated_by=setting.updated_by,
        updated_at=setting.updated_at,
    )


async def _auth_provider_records(session: AsyncSession) -> list[dict[str, object]]:
    result = await session.execute(
        select(PanelSetting).where(PanelSetting.key == AUTH_PROVIDERS_KEY)
    )
    setting = result.scalar_one_or_none()
    persisted: dict[str, dict[str, object]] = {}
    if setting is not None:
        raw_items = setting.value_json.get("items")
        if isinstance(raw_items, list):
            persisted = {
                str(item.get("provider")): dict(item)
                for item in raw_items
                if isinstance(item, dict) and item.get("provider")
            }
    providers = []
    for default in DEFAULT_AUTH_PROVIDERS:
        provider_id = str(default["provider"])
        merged = {**default, **persisted.get(provider_id, {})}
        if provider_id not in LIVE_AUTH_PROVIDERS:
            merged["enabled"] = False
            merged["status"] = default["status"]
            merged["scopes"] = default["scopes"]
            merged["metadata_json"] = default["metadata_json"]
        providers.append(merged)
    return providers


async def _save_auth_providers(
    session: AsyncSession,
    *,
    providers: list[dict[str, object]],
    principal: Principal,
) -> None:
    request = SettingUpdateRequest(value_json={"items": providers})
    await _upsert_setting(session, key=AUTH_PROVIDERS_KEY, value_json=request.value_json, principal=principal)


def _auth_provider_response(record: dict[str, object]) -> AuthProviderResponse:
    return AuthProviderResponse.model_validate(record)


def _ensure_no_secret_like_keys(
    value: object,
    *,
    code: str,
    message: str,
    path: tuple[str, ...] = (),
) -> None:
    forbidden = ("secret", "token", "password", "privatekey", "private_key", "clientsecret")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _ensure_no_secret_like_keys(
                item,
                code=code,
                message=message,
                path=(*path, str(index)),
            )
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        normalized = key.replace("-", "").replace("_", "").lower()
        if any(fragment.replace("_", "") in normalized for fragment in forbidden):
            detail = ".".join((*path, key))
            raise APIError(
                code=code,
                message=message,
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[detail],
            )
        _ensure_no_secret_like_keys(
            item,
            code=code,
            message=message,
            path=(*path, key),
        )
