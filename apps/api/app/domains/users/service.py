from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.security import hash_password
from app.domains.users.models import User
from app.domains.users.schemas import UserCreateRequest, UserResponse


async def list_users(session: AsyncSession) -> list[User]:
    result = await session.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


async def get_user(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise APIError(
            code="user_not_found",
            message="User was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return user


async def create_user(session: AsyncSession, *, request: UserCreateRequest) -> User:
    email = request.email.lower()
    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        raise APIError(
            code="user_email_already_exists",
            message="A user with this email already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )
    user = User(
        email=email,
        password_hash=hash_password(request.password) if request.password is not None else None,
        role=request.role.value,
        status=request.status,
    )
    session.add(user)
    await session.flush()
    return user


def user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        status=user.status,
        created_at=user.created_at,
    )
