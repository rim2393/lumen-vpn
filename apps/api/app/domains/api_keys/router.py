from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import APIError
from app.core.rbac import (
    Permission,
    Principal,
    Role,
    grantable_permissions,
    require_permission,
)
from app.db.session import get_db_session
from app.domains.api_keys.models import ApiKey
from app.domains.api_keys.schemas import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyListResponse,
)
from app.domains.api_keys.service import api_key_to_response
from app.domains.api_keys.service import create_api_key as create_api_key_record
from app.domains.api_keys.service import list_api_keys as list_api_key_records
from app.domains.api_keys.service import revoke_api_key as revoke_api_key_record
from app.domains.users.models import User

router = APIRouter()
ApiKeyManager = Annotated[Principal, Depends(require_permission(Permission.API_KEY_MANAGE))]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=ApiKeyListResponse)
async def list_api_keys(
    principal: ApiKeyManager,
    session: DbSession,
) -> ApiKeyListResponse:
    owner_user_id = None if _can_manage_all_keys(principal) else _principal_uuid(principal)
    api_keys = await list_api_key_records(session, owner_user_id=owner_user_id)
    return ApiKeyListResponse(items=[api_key_to_response(api_key) for api_key in api_keys])


@router.post("", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    request: ApiKeyCreateRequest,
    principal: ApiKeyManager,
    session: DbSession,
    settings: AppSettings,
) -> ApiKeyCreateResponse:
    _ensure_scopes_within_caller(principal, request.scopes)
    owner_user_id = await _resolve_owner_user_id(session, principal=principal, request=request)
    api_key, plaintext = await create_api_key_record(
        session,
        owner_user_id=owner_user_id,
        request=request,
        settings=settings,
    )
    await session.commit()
    return ApiKeyCreateResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        api_key=plaintext,
        expires_at=api_key.expires_at,
    )


@router.delete("/{api_key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    api_key_id: UUID,
    principal: ApiKeyManager,
    session: DbSession,
) -> None:
    if not _can_manage_all_keys(principal):
        record = await session.get(ApiKey, api_key_id)
        if record is not None and record.owner_user_id != _principal_uuid(principal):
            raise APIError(
                code="api_key_not_found",
                message="API key was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
    await revoke_api_key_record(session, api_key_id=api_key_id)
    await session.commit()


def _ensure_scopes_within_caller(principal: Principal, scopes: list[str]) -> None:
    allowed = {permission.value for permission in grantable_permissions(principal)}
    exceeded = [scope for scope in scopes if scope not in allowed]
    if exceeded:
        raise APIError(
            code="api_key_scope_exceeds_caller",
            message="An API key cannot be granted scopes beyond the caller's own permissions.",
            status_code=status.HTTP_403_FORBIDDEN,
            details=sorted(set(exceeded)),
        )


def _can_manage_all_keys(principal: Principal) -> bool:
    return principal.subject == "bootstrap-admin" or bool(
        principal.roles.intersection({Role.OWNER, Role.ADMIN})
    )


def _principal_uuid(principal: Principal) -> UUID:
    return UUID(principal.subject)


async def _resolve_owner_user_id(
    session: AsyncSession,
    *,
    principal: Principal,
    request: ApiKeyCreateRequest,
) -> UUID:
    if request.owner_user_id is not None and _can_manage_all_keys(principal):
        user = await session.get(User, request.owner_user_id)
        if user is None:
            raise APIError(
                code="api_key_owner_not_found",
                message="API key owner user was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        return user.id
    if principal.subject != "bootstrap-admin":
        return _principal_uuid(principal)

    result = await session.execute(
        select(User)
        .where(User.status == "active")
        .where(User.role.in_(["owner", "admin"]))
        .order_by(User.created_at.asc())
    )
    user = result.scalars().first()
    if user is None:
        raise APIError(
            code="api_key_owner_required",
            message=(
                "Create an active owner/admin user before creating API keys with bootstrap auth."
            ),
            status_code=status.HTTP_409_CONFLICT,
        )
    return user.id
