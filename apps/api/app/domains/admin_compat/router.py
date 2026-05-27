from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Principal, get_current_principal
from app.db.session import get_db_session
from app.domains.admin_compat.schemas import (
    AdminUsersResponse,
    ApiKeysResponse,
    AuthSessionResponse,
    LicenseSummaryResponse,
)
from app.domains.admin_compat.service import (
    list_admin_api_keys,
    list_admin_users,
    read_auth_session,
    read_license_summary,
)

router = APIRouter(prefix="/api")
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("/auth/session", response_model=AuthSessionResponse)
async def get_session(
    principal: CurrentPrincipal,
    session: DbSession,
    settings: AppSettings,
) -> AuthSessionResponse:
    return await read_auth_session(session, principal=principal, settings=settings)


@router.get("/admin/users", response_model=AdminUsersResponse)
async def get_admin_users(
    principal: CurrentPrincipal,
    session: DbSession,
) -> AdminUsersResponse:
    return await list_admin_users(session, principal=principal)


@router.get("/admin/api-keys", response_model=ApiKeysResponse)
async def get_admin_api_keys(
    principal: CurrentPrincipal,
    session: DbSession,
) -> ApiKeysResponse:
    return await list_admin_api_keys(session, principal=principal)


@router.get("/admin/license", response_model=LicenseSummaryResponse | None)
async def get_admin_license(
    principal: CurrentPrincipal,
    session: DbSession,
) -> LicenseSummaryResponse | None:
    return await read_license_summary(session, principal=principal)
