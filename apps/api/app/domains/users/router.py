from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.users.schemas import UserCreateRequest, UserListResponse, UserResponse
from app.domains.users.service import create_user as create_user_record
from app.domains.users.service import get_user as get_user_record
from app.domains.users.service import list_users as list_user_records
from app.domains.users.service import user_to_response

router = APIRouter()
UserManager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=UserListResponse)
async def list_users(
    _: UserManager,
    session: DbSession,
) -> UserListResponse:
    users = await list_user_records(session)
    return UserListResponse(items=[user_to_response(user) for user in users])


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    request: UserCreateRequest,
    _: UserManager,
    session: DbSession,
) -> UserResponse:
    user = await create_user_record(session, request=request)
    await session.commit()
    return user_to_response(user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    _: UserManager,
    session: DbSession,
) -> UserResponse:
    user = await get_user_record(session, user_id)
    return user_to_response(user)
