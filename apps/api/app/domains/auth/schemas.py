from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, SecretStr

from app.core.rbac import Permission, Role


class LoginRequest(BaseModel):
    email: EmailStr
    password: SecretStr


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105 - OAuth token type, not a secret.
    expires_at: datetime


class PrincipalResponse(BaseModel):
    subject: str
    email: EmailStr | None
    roles: set[Role]
    permissions: set[Permission]


class RefreshRequest(BaseModel):
    refresh_token: SecretStr


class TotpSetupRequest(BaseModel):
    label: str = "Authenticator"


class TotpSetupResponse(BaseModel):
    method_id: UUID
    secret: str
    otpauth_url: str
    status: Literal["pending"]


class TotpVerifyRequest(BaseModel):
    method_id: UUID
    code: SecretStr


class MfaMethodResponse(BaseModel):
    id: UUID
    kind: str
    label: str
    status: str
    confirmed_at: datetime | None
    last_used_at: datetime | None


class MfaMethodListResponse(BaseModel):
    items: list[MfaMethodResponse]
