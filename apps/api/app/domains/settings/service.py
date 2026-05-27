from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.settings.models import PanelSetting
from app.domains.settings.schemas import SettingResponse, SettingUpdateRequest


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


def setting_response(setting: PanelSetting) -> SettingResponse:
    return SettingResponse(
        id=setting.id,
        key=setting.key,
        value_json=setting.value_json,
        updated_by=setting.updated_by,
        updated_at=setting.updated_at,
    )
