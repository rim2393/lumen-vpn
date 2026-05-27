from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.service import record_audit_event
from app.domains.settings.schemas import SettingListResponse, SettingResponse, SettingUpdateRequest
from app.domains.settings.service import (
    get_setting,
    list_settings,
    setting_response,
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
