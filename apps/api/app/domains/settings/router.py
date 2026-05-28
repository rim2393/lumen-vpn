from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.service import record_audit_event
from app.domains.settings.schemas import (
    AuthProviderListResponse,
    AuthProviderResponse,
    AuthProviderUpdateRequest,
    SettingListResponse,
    SettingResponse,
    SettingUpdateRequest,
)
from app.domains.settings.service import (
    get_setting,
    list_auth_providers,
    list_settings,
    setting_response,
    update_auth_provider,
    upsert_setting,
)

router = APIRouter()
SettingsManager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]
SettingKey = Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9_.-]{1,126}[a-z0-9]$")]


@router.get("", response_model=SettingListResponse)
async def list_panel_settings(
    _: SettingsManager,
    session: DatabaseSession,
) -> SettingListResponse:
    settings = await list_settings(session)
    return SettingListResponse(items=[setting_response(setting) for setting in settings])


@router.get("/auth/providers", response_model=AuthProviderListResponse)
async def list_panel_auth_providers(
    _: SettingsManager,
    session: DatabaseSession,
) -> AuthProviderListResponse:
    return AuthProviderListResponse(items=await list_auth_providers(session))


@router.patch("/auth/providers/{provider}", response_model=AuthProviderResponse)
async def patch_panel_auth_provider(
    provider: str,
    request: AuthProviderUpdateRequest,
    principal: SettingsManager,
    session: DatabaseSession,
) -> AuthProviderResponse:
    record = await update_auth_provider(
        session,
        provider=provider,
        request=request,
        principal=principal,
    )
    await record_audit_event(
        session,
        principal=principal,
        action="auth_provider.updated",
        resource_type="auth_provider",
        resource_id=provider,
    )
    await session.commit()
    return record


@router.get("/{key}", response_model=SettingResponse)
async def read_panel_setting(
    key: SettingKey,
    _: SettingsManager,
    session: DatabaseSession,
) -> SettingResponse:
    setting = await get_setting(session, key=key)
    return setting_response(setting)


@router.put("/{key}", response_model=SettingResponse)
async def update_panel_setting(
    key: SettingKey,
    request: SettingUpdateRequest,
    principal: SettingsManager,
    session: DatabaseSession,
) -> SettingResponse:
    setting = await upsert_setting(session, key=key, request=request, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="setting.updated",
        resource_type="setting",
        resource_id=key,
    )
    await session.commit()
    return setting_response(setting)
