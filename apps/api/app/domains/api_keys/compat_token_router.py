from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import APIError
from app.core.rbac import ROLE_PERMISSIONS, Permission, Principal, Role, require_permission
from app.db.session import get_db_session
from app.domains.api_keys.models import ApiKey
from app.domains.api_keys.schemas import ApiKeyCreateRequest
from app.domains.api_keys.service import create_api_key as create_api_key_record
from app.domains.api_keys.service import list_api_keys as list_api_key_records
from app.domains.api_keys.service import revoke_api_key as revoke_api_key_record


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class LumenCamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CreateApiTokenRequestDto(LumenCamelModel):
    token_name: str = Field(alias="tokenName", min_length=1, max_length=128)


class CreateApiTokenResponseDto(LumenCamelModel):
    token: str
    uuid: str


class DeleteApiTokenResponseDto(LumenCamelModel):
    is_deleted: bool


class ApiTokenDto(LumenCamelModel):
    uuid: str
    token: str
    token_name: str
    created_at: datetime
    updated_at: datetime


class DocsInfoDto(LumenCamelModel):
    is_docs_enabled: bool
    scalar_path: str | None
    swagger_path: str | None


class FindAllApiTokensResponseDto(LumenCamelModel):
    api_keys: list[ApiTokenDto]
    docs: DocsInfoDto


router = APIRouter()
ApiTokenManager = Annotated[Principal, Depends(require_permission(Permission.API_KEY_MANAGE))]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=FindAllApiTokensResponseDto)
async def find_all_api_tokens(
    principal: ApiTokenManager,
    session: DbSession,
    settings: AppSettings,
) -> FindAllApiTokensResponseDto:
    _ensure_web_admin_session(principal)
    owner_user_id = None if _can_manage_all_keys(principal) else UUID(principal.subject)
    api_keys = await list_api_key_records(session, owner_user_id=owner_user_id)
    return FindAllApiTokensResponseDto(
        api_keys=[_api_token_dto(api_key) for api_key in api_keys],
        docs=_docs_info(settings),
    )


@router.post(
    "",
    response_model=CreateApiTokenResponseDto,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_token(
    request: CreateApiTokenRequestDto,
    principal: ApiTokenManager,
    session: DbSession,
    settings: AppSettings,
) -> CreateApiTokenResponseDto:
    _ensure_web_admin_session(principal)
    effective_permissions = _effective_permissions(principal=principal)
    api_key, plaintext = await create_api_key_record(
        session,
        owner_user_id=UUID(principal.subject),
        request=ApiKeyCreateRequest(
            name=request.token_name,
            scopes=[permission.value for permission in effective_permissions],
        ),
        settings=settings,
    )
    await session.commit()
    return CreateApiTokenResponseDto(token=plaintext, uuid=str(api_key.id))


@router.delete("/{uuid}", response_model=DeleteApiTokenResponseDto)
async def delete_api_token(
    uuid: UUID,
    principal: ApiTokenManager,
    session: DbSession,
) -> DeleteApiTokenResponseDto:
    _ensure_web_admin_session(principal)
    if not _can_manage_all_keys(principal):
        record = await session.get(ApiKey, uuid)
        if record is not None and record.owner_user_id != UUID(principal.subject):
            raise APIError(
                code="api_key_not_found",
                message="API key was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
    await revoke_api_key_record(session, api_key_id=uuid)
    await session.commit()
    return DeleteApiTokenResponseDto(is_deleted=True)


def _ensure_web_admin_session(principal: Principal) -> None:
    if principal.session_id is None:
        raise APIError(
            code="web_session_required",
            message="This legacy-compatible token controller requires an admin web session.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


def _can_manage_all_keys(principal: Principal) -> bool:
    return bool(principal.roles.intersection({Role.OWNER, Role.ADMIN}))


def _effective_permissions(principal: Principal) -> list[Permission]:
    if principal.permissions:
        return sorted(set(principal.permissions), key=lambda permission: permission.value)
    permissions: set[Permission] = set()
    for role in principal.roles:
        permissions.update(ROLE_PERMISSIONS[role])
    return sorted(permissions, key=lambda permission: permission.value)


def _api_token_dto(api_key: ApiKey) -> ApiTokenDto:
    return ApiTokenDto(
        uuid=str(api_key.id),
        token=api_key.key_prefix,
        token_name=api_key.name,
        created_at=api_key.created_at,
        updated_at=api_key.updated_at,
    )


def _docs_info(settings: Settings) -> DocsInfoDto:
    return DocsInfoDto(
        is_docs_enabled=bool(settings.docs_url or settings.openapi_url),
        scalar_path=None,
        swagger_path=settings.docs_url,
    )
