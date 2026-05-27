from enum import StrEnum
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import APIError
from app.core.security import constant_time_equal
from app.db.session import get_db_session


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    SUPPORT = "support"
    NODE = "node"
    USER = "user"


class Permission(StrEnum):
    API_KEY_MANAGE = "api_key:manage"
    LICENSE_MANAGE = "license:manage"
    NODE_MANAGE = "node:manage"
    SUBSCRIPTION_READ = "subscription:read"
    SUBSCRIPTION_MANAGE = "subscription:manage"
    USER_MANAGE = "user:manage"


ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.OWNER: frozenset(Permission),
    Role.ADMIN: frozenset(
        {
            Permission.API_KEY_MANAGE,
            Permission.LICENSE_MANAGE,
            Permission.NODE_MANAGE,
            Permission.SUBSCRIPTION_READ,
            Permission.SUBSCRIPTION_MANAGE,
            Permission.USER_MANAGE,
        }
    ),
    Role.SUPPORT: frozenset(
        {
            Permission.SUBSCRIPTION_READ,
            Permission.USER_MANAGE,
        }
    ),
    Role.NODE: frozenset({Permission.SUBSCRIPTION_READ}),
    Role.USER: frozenset({Permission.SUBSCRIPTION_READ}),
}


class Principal(BaseModel):
    subject: str
    email: EmailStr | None = None
    roles: set[Role]
    permissions: set[Permission]
    session_id: UUID | None = None
    api_key_id: UUID | None = None


async def get_current_principal(
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    api_key: Annotated[str | None, Header(alias="X-Lumen-Api-Key")] = None,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> Principal:
    if api_key is not None:
        expected_api_key = (
            settings.bootstrap_admin_api_key.get_secret_value()
            if settings.bootstrap_admin_api_key is not None
            else ""
        )
        if expected_api_key and constant_time_equal(api_key, expected_api_key):
            return Principal(
                subject="bootstrap-admin",
                roles={Role.OWNER},
                permissions=set(Permission),
            )
        if (
            settings.api_key_hash_pepper is not None
            and settings.api_key_hash_pepper.get_secret_value()
        ):
            return await _principal_from_api_key(session, api_key=api_key, settings=settings)

    bearer_token = _extract_bearer_token(authorization)
    if bearer_token is not None and settings.session_hash_pepper is not None:
        return await _principal_from_session(session, token=bearer_token, settings=settings)

    raise APIError(
        code="authentication_required",
        message="A valid API key is required.",
        status_code=status.HTTP_401_UNAUTHORIZED,
    )


def has_permission(principal: Principal, permission: Permission) -> bool:
    if permission in principal.permissions:
        return True
    return any(permission in ROLE_PERMISSIONS[role] for role in principal.roles)


def _extract_bearer_token(authorization: str | None) -> str | None:
    if authorization is None:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise APIError(
            code="invalid_authorization_header",
            message="Authorization header must use the Bearer scheme.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return token


async def _principal_from_api_key(
    session: AsyncSession,
    *,
    api_key: str,
    settings: Settings,
) -> Principal:
    from app.domains.api_keys.service import verify_api_key
    from app.domains.users.models import User

    record = await verify_api_key(session, api_key=api_key, settings=settings)
    user = await session.get(User, record.owner_user_id)
    if user is None or user.status != "active":
        raise APIError(
            code="api_key_owner_inactive",
            message="API key owner is not active.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    permissions = {Permission(scope) for scope in record.scopes}
    return Principal(
        subject=str(user.id),
        email=user.email,
        roles=set(),
        permissions=permissions,
        api_key_id=record.id,
    )


async def _principal_from_session(
    session: AsyncSession,
    *,
    token: str,
    settings: Settings,
) -> Principal:
    from app.domains.auth.service import verify_session_token

    user_session, user = await verify_session_token(session, token=token, settings=settings)
    role = Role(user.role)
    return Principal(
        subject=str(user.id),
        email=user.email,
        roles={role},
        permissions=set(ROLE_PERMISSIONS[role]),
        session_id=user_session.id,
    )


def require_permission(permission: Permission):
    async def dependency(
        principal: Annotated[Principal, Depends(get_current_principal)],
    ) -> Principal:
        if not has_permission(principal, permission):
            raise APIError(
                code="permission_denied",
                message="The caller is not allowed to perform this action.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return principal

    return dependency
