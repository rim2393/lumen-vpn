from fastapi import status
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.settings.models import PanelSetting
from app.domains.settings.schemas import (
    AuthProviderResponse,
    AuthProviderUpdateRequest,
    SettingGroupResponse,
    SettingGroupUpdateRequest,
    SettingResponse,
    SettingUpdateRequest,
)

AUTH_PROVIDERS_KEY = "auth.providers"
PANEL_IDENTITY_KEY = "panel.identity"
SUBSCRIPTION_DELIVERY_KEY = "subscription.delivery"
SECURITY_POLICY_KEY = "security.policy"
NODE_DEFAULTS_KEY = "node.defaults"
TYPED_SETTING_KEYS = frozenset(
    {
        PANEL_IDENTITY_KEY,
        SUBSCRIPTION_DELIVERY_KEY,
        SECURITY_POLICY_KEY,
        NODE_DEFAULTS_KEY,
    }
)
IMPLEMENTED_AUTH_PROVIDERS = frozenset(
    {
        "password",
        "passkey",
        "telegram",
        "github",
        "google",
        "keycloak",
        "pocketid",
        "generic_oauth2",
    }
)
RESERVED_SETTING_KEYS = frozenset({AUTH_PROVIDERS_KEY, *TYPED_SETTING_KEYS})


class PanelIdentitySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_name: str = Field(default="Lumen", min_length=1, max_length=80)
    support_url: HttpUrl | None = None
    docs_url: HttpUrl | None = None
    default_locale: str = Field(default="ru", pattern="^(en|ru)$")


class SubscriptionDeliverySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="Lumen VPN", min_length=1, max_length=120)
    support_url: HttpUrl | None = None
    profile_page_url: HttpUrl | None = None
    update_interval_hours: int = Field(default=2, ge=1, le=168)
    happ_announce: str | None = Field(default=None, max_length=512)
    random_host_order: bool = False


class SecurityPolicySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require_mfa_for_admins: bool = False
    api_key_max_ttl_days: int = Field(default=90, ge=1, le=3650)
    session_ttl_minutes: int = Field(default=720, ge=5, le=43200)


class NodeDefaultsSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_region: str = Field(default="global", min_length=1, max_length=64)
    heartbeat_interval_seconds: int = Field(default=30, ge=5, le=3600)
    command_poll_interval_seconds: int = Field(default=30, ge=5, le=3600)
    runtime_metrics_retention_days: int = Field(default=30, ge=1, le=365)


SETTING_GROUP_MODELS: dict[str, type[BaseModel]] = {
    PANEL_IDENTITY_KEY: PanelIdentitySettings,
    SUBSCRIPTION_DELIVERY_KEY: SubscriptionDeliverySettings,
    SECURITY_POLICY_KEY: SecurityPolicySettings,
    NODE_DEFAULTS_KEY: NodeDefaultsSettings,
}
SETTING_GROUP_METADATA: dict[str, tuple[str, str]] = {
    PANEL_IDENTITY_KEY: (
        "Panel identity",
        "Product name, documentation links and default locale exposed in the panel.",
    ),
    SUBSCRIPTION_DELIVERY_KEY: (
        "Subscription delivery",
        "Client-facing subscription presentation and update behavior.",
    ),
    SECURITY_POLICY_KEY: (
        "Security policy",
        "Panel-wide MFA, API key and session lifetime policy.",
    ),
    NODE_DEFAULTS_KEY: (
        "Node defaults",
        "Default node runtime intervals and operational retention windows.",
    ),
}
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
        "enabled": True,
        "status": "active",
        "scopes": ["admin:login"],
        "metadata_json": {"runtime": "webauthn"},
    },
    {
        "provider": "telegram",
        "display_name": "Telegram",
        "enabled": False,
        "status": "needs_configuration",
        "scopes": ["admin:login"],
        "metadata_json": {"runtime": "telegram-widget"},
    },
    {
        "provider": "github",
        "display_name": "GitHub",
        "enabled": False,
        "status": "needs_configuration",
        "scopes": ["read:user", "user:email"],
        "metadata_json": {},
    },
    {
        "provider": "google",
        "display_name": "Google",
        "enabled": False,
        "status": "needs_configuration",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "pocketid",
        "display_name": "Pocket ID",
        "enabled": False,
        "status": "needs_configuration",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "keycloak",
        "display_name": "Keycloak",
        "enabled": False,
        "status": "needs_configuration",
        "scopes": ["openid", "email", "profile"],
        "metadata_json": {},
    },
    {
        "provider": "generic_oauth2",
        "display_name": "Generic OAuth2",
        "enabled": False,
        "status": "needs_configuration",
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


def _setting_group_response(key: str, setting: PanelSetting | None) -> SettingGroupResponse:
    model = SETTING_GROUP_MODELS[key]
    title, description = SETTING_GROUP_METADATA[key]
    value = setting.value_json if setting is not None else model().model_dump(mode="json")
    validated = model.model_validate(value).model_dump(mode="json")
    return SettingGroupResponse(
        key=key,
        title=title,
        description=description,
        value_json=validated,
        updated_by=setting.updated_by if setting is not None else None,
        updated_at=setting.updated_at if setting is not None else None,
    )


async def list_setting_groups(session: AsyncSession) -> list[SettingGroupResponse]:
    result = await session.execute(
        select(PanelSetting).where(PanelSetting.key.in_(TYPED_SETTING_KEYS))
    )
    settings_by_key = {setting.key: setting for setting in result.scalars().all()}
    return [
        _setting_group_response(key, settings_by_key.get(key))
        for key in SETTING_GROUP_MODELS
    ]


async def update_setting_group(
    session: AsyncSession,
    *,
    group_key: str,
    request: SettingGroupUpdateRequest,
    principal: Principal,
) -> SettingGroupResponse:
    model = SETTING_GROUP_MODELS.get(group_key)
    if model is None:
        raise APIError(
            code="setting_group_not_found",
            message="Typed settings group was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=[group_key],
        )
    try:
        value_json = model.model_validate(request.value_json).model_dump(mode="json")
    except ValidationError as exc:
        raise APIError(
            code="setting_group_invalid",
            message="Typed settings group payload is invalid.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[str(error["loc"]) for error in exc.errors()],
        ) from exc
    await _upsert_setting(session, key=group_key, value_json=value_json, principal=principal)
    setting = await get_setting(session, key=group_key)
    return _setting_group_response(group_key, setting)


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


async def list_auth_providers(
    session: AsyncSession,
    *,
    settings: Settings | None = None,
) -> list[AuthProviderResponse]:
    providers = await _auth_provider_records(session, settings=settings)
    return [_auth_provider_response(provider) for provider in providers]


async def update_auth_provider(
    session: AsyncSession,
    *,
    provider: str,
    request: AuthProviderUpdateRequest,
    principal: Principal,
    settings: Settings | None = None,
) -> AuthProviderResponse:
    settings = settings or get_settings()
    providers = await _auth_provider_records(session, settings=settings)
    record = next((item for item in providers if item["provider"] == provider), None)
    if record is None:
        raise APIError(
            code="auth_provider_not_found",
            message="Authentication provider was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    data = request.model_dump(exclude_unset=True)
    runtime = _auth_provider_runtime(provider, settings)
    if data.get("enabled") is True and not runtime["implemented"]:
        raise APIError(
            code="auth_provider_not_live",
            message=(
                "This authentication provider is catalog-only until its login callback "
                "and account-binding flow are implemented."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=[provider],
        )
    if data.get("enabled") is True and not runtime["configured"]:
        raise APIError(
            code="auth_provider_not_configured",
            message=(
                "This authentication provider has a real backend flow, but its required "
                "environment configuration is missing."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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


async def _auth_provider_records(
    session: AsyncSession,
    *,
    settings: Settings | None = None,
) -> list[dict[str, object]]:
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
    settings = settings or get_settings()
    for default in DEFAULT_AUTH_PROVIDERS:
        provider_id = str(default["provider"])
        persisted_record = persisted.get(provider_id)
        merged = {**default, **(persisted_record or {})}
        runtime = _auth_provider_runtime(provider_id, settings)
        if not runtime["implemented"]:
            merged["enabled"] = False
            merged["status"] = default["status"]
            merged["scopes"] = default["scopes"]
            merged["metadata_json"] = default["metadata_json"]
        elif not runtime["configured"]:
            merged["enabled"] = False
            merged["status"] = "needs_configuration"
            merged["scopes"] = default["scopes"]
            merged["metadata_json"] = {
                **dict(default.get("metadata_json") or {}),
                "missing": runtime["missing"],
            }
        else:
            merged["status"] = "active"
            if persisted_record is None:
                merged["enabled"] = bool(runtime.get("default_enabled", default["enabled"]))
            merged["metadata_json"] = {
                **dict(default.get("metadata_json") or {}),
                **dict(merged.get("metadata_json") or {}),
            }
        providers.append(merged)
    return providers


def _auth_provider_runtime(provider: str, settings: Settings) -> dict[str, object]:
    if provider not in IMPLEMENTED_AUTH_PROVIDERS:
        return {"implemented": False, "configured": False, "missing": ["implementation"]}
    if provider == "password":
        return {"implemented": True, "configured": True, "missing": [], "default_enabled": True}
    if provider == "passkey":
        missing = []
        if not settings.webauthn_enabled:
            missing.append("webauthn_enabled")
        if not (settings.webauthn_origin or settings.panel_public_url):
            missing.append("panel_public_url")
        return {
            "implemented": True,
            "configured": not missing,
            "missing": missing,
            "default_enabled": settings.webauthn_enabled,
        }
    if provider == "telegram":
        missing = []
        if not settings.telegram_login_enabled:
            missing.append("telegram_login_enabled")
        if not (settings.telegram_bot_token or settings.telegram_bot_token_file):
            missing.append("telegram_bot_token")
        if not settings.telegram_bot_username:
            missing.append("telegram_bot_username")
        return {
            "implemented": True,
            "configured": not missing,
            "missing": missing,
            "default_enabled": settings.telegram_login_enabled,
        }
    if provider == "github":
        return _oauth_runtime(
            enabled=settings.github_oauth_enabled,
            client_id=settings.github_oauth_client_id,
            secret=settings.github_oauth_client_secret,
            secret_file=settings.github_oauth_client_secret_file,
            issuer=True,
        )
    if provider == "google":
        return _oauth_runtime(
            enabled=settings.google_oauth_enabled,
            client_id=settings.google_oauth_client_id,
            secret=settings.google_oauth_client_secret,
            secret_file=settings.google_oauth_client_secret_file,
            issuer=True,
        )
    if provider == "keycloak":
        return _oauth_runtime(
            enabled=settings.keycloak_oauth_enabled,
            client_id=settings.keycloak_oauth_client_id,
            secret=settings.keycloak_oauth_client_secret,
            secret_file=settings.keycloak_oauth_client_secret_file,
            issuer=settings.keycloak_oauth_issuer,
        )
    if provider == "pocketid":
        return _oauth_runtime(
            enabled=settings.pocketid_oauth_enabled,
            client_id=settings.pocketid_oauth_client_id,
            secret=settings.pocketid_oauth_client_secret,
            secret_file=settings.pocketid_oauth_client_secret_file,
            issuer=settings.pocketid_oauth_issuer,
        )
    if provider == "generic_oauth2":
        missing_endpoint = not (
            settings.generic_oauth2_issuer
            or (
                settings.generic_oauth2_authorization_endpoint
                and settings.generic_oauth2_token_endpoint
                and settings.generic_oauth2_userinfo_endpoint
            )
        )
        runtime = _oauth_runtime(
            enabled=settings.generic_oauth2_enabled,
            client_id=settings.generic_oauth2_client_id,
            secret=settings.generic_oauth2_client_secret,
            secret_file=settings.generic_oauth2_client_secret_file,
            issuer=not missing_endpoint,
        )
        if missing_endpoint and "issuer" in runtime["missing"]:
            runtime["missing"] = [
                value if value != "issuer" else "issuer_or_endpoints"
                for value in runtime["missing"]
            ]
        return runtime
    return {
        "implemented": False,
        "configured": False,
        "missing": ["implementation"],
        "default_enabled": False,
    }


def _oauth_runtime(
    *,
    enabled: bool,
    client_id: str | None,
    secret: object,
    secret_file: str | None,
    issuer: object,
) -> dict[str, object]:
    missing = []
    if not enabled:
        missing.append("enabled")
    if not client_id:
        missing.append("client_id")
    if not (secret or secret_file):
        missing.append("client_secret")
    if not issuer:
        missing.append("issuer")
    return {
        "implemented": True,
        "configured": not missing,
        "missing": missing,
        "default_enabled": enabled,
    }


async def _save_auth_providers(
    session: AsyncSession,
    *,
    providers: list[dict[str, object]],
    principal: Principal,
) -> None:
    request = SettingUpdateRequest(value_json={"items": providers})
    await _upsert_setting(
        session,
        key=AUTH_PROVIDERS_KEY,
        value_json=request.value_json,
        principal=principal,
    )


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
