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
        "status": "configured",
        "scopes": ["admin:login"],
        "metadata_json": {"webauthn": "disabled_until_registered"},
    },
    {
        "provider": "telegram",
        "display_name": "Telegram",
        "enabled": False,
        "status": "disabled",
        "scopes": ["admin:login", "bot:manage"],
        "metadata_json": {"bot_binding": "api-key"},
    },
    {
        "provider": "github",
        "display_name": "GitHub",
        "enabled": False,
        "status": "disabled",
        "scopes": ["read:user", "user:email"],
        "metadata_json": {},
    },
    {
        "provider": "google",
        "display_name": "Google",
        "enabled": False,
        "status": "disabled",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "pocketid",
        "display_name": "Pocket ID",
        "enabled": False,
        "status": "disabled",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "keycloak",
        "display_name": "Keycloak",
        "enabled": False,
        "status": "disabled",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "generic_oauth2",
        "display_name": "Generic OAuth2",
        "enabled": False,
        "status": "disabled",
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
    result = await session.execute(select(PanelSetting).where(PanelSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting is None:
        setting = PanelSetting(key=key, value_json=request.value_json, updated_by=principal.subject)
        session.add(setting)
    else:
        setting.value_json = request.value_json
        setting.updated_by = principal.subject
    await session.flush()
    return setting


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
    metadata = data.get("metadata_json")
    if isinstance(metadata, dict):
        _ensure_no_secret_like_keys(metadata)
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
        providers.append(merged)
    return providers


async def _save_auth_providers(
    session: AsyncSession,
    *,
    providers: list[dict[str, object]],
    principal: Principal,
) -> None:
    request = SettingUpdateRequest(value_json={"items": providers})
    await upsert_setting(session, key=AUTH_PROVIDERS_KEY, request=request, principal=principal)


def _auth_provider_response(record: dict[str, object]) -> AuthProviderResponse:
    return AuthProviderResponse.model_validate(record)


def _ensure_no_secret_like_keys(metadata: dict[str, object]) -> None:
    forbidden = ("secret", "token", "password", "privatekey", "private_key", "clientsecret")
    for key in metadata:
        normalized = key.replace("-", "").replace("_", "").lower()
        if any(fragment.replace("_", "") in normalized for fragment in forbidden):
            raise APIError(
                code="auth_provider_secret_like_metadata",
                message=(
                    "Auth provider metadata must reference secrets by backend config, "
                    "not store them."
                ),
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[key],
            )
