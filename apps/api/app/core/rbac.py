from enum import StrEnum
from typing import Annotated

from fastapi import Depends, Header, status
from pydantic import BaseModel, EmailStr

from app.core.config import Settings, get_settings
from app.core.errors import APIError
from app.core.security import constant_time_equal


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


async def get_current_principal(
    settings: Annotated[Settings, Depends(get_settings)],
    api_key: Annotated[str | None, Header(alias="X-Lumen-Api-Key")] = None,
) -> Principal:
    if (
        settings.bootstrap_admin_api_key is None
        or settings.bootstrap_admin_api_key.get_secret_value() == ""
    ):
        raise APIError(
            code="auth_not_implemented",
            message="Authentication dependency is not wired yet.",
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
        )

    if api_key is not None:
        expected_api_key = settings.bootstrap_admin_api_key.get_secret_value()
        if constant_time_equal(api_key, expected_api_key):
            return Principal(
                subject="bootstrap-admin",
                roles={Role.OWNER},
                permissions=set(Permission),
            )

    raise APIError(
        code="authentication_required",
        message="A valid API key is required.",
        status_code=status.HTTP_401_UNAUTHORIZED,
    )


def has_permission(principal: Principal, permission: Permission) -> bool:
    if permission in principal.permissions:
        return True
    return any(permission in ROLE_PERMISSIONS[role] for role in principal.roles)


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
