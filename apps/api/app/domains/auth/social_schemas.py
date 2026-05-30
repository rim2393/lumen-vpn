from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class OAuthProviderInfo(BaseModel):
    provider: str
    display_name: str
    kind: str  # "oauth2" | "oidc" | "telegram" | "webauthn"
    enabled: bool
    bot_username: str | None = None  # populated for the Telegram login widget only


class OAuthProviderListResponse(BaseModel):
    items: list[OAuthProviderInfo]


class OAuthStartResponse(BaseModel):
    provider: str
    authorization_url: str
    state: str


class LinkedIdentityResponse(BaseModel):
    id: UUID
    provider: str
    subject: str
    email: str | None
    display_name: str | None
    last_login_at: datetime | None
    created_at: datetime


class LinkedIdentityListResponse(BaseModel):
    items: list[LinkedIdentityResponse]


class TelegramLoginRequest(BaseModel):
    """Payload produced by the Telegram Login Widget."""

    id: int
    auth_date: int
    hash: str
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None


class WebAuthnOptionsResponse(BaseModel):
    """Raw WebAuthn options JSON forwarded to the browser navigator.credentials call."""

    options: dict[str, Any]
    challenge_id: UUID


class WebAuthnAuthenticateOptionsRequest(BaseModel):
    email: str | None = None


class WebAuthnRegisterVerifyRequest(BaseModel):
    challenge_id: UUID
    label: str | None = Field(default=None, max_length=128)
    credential: dict[str, Any]


class WebAuthnAuthenticateVerifyRequest(BaseModel):
    challenge_id: UUID
    credential: dict[str, Any]


class WebAuthnCredentialResponse(BaseModel):
    id: UUID
    label: str | None
    aaguid: str | None
    transports: list[str]
    sign_count: int
    last_used_at: datetime | None
    created_at: datetime


class WebAuthnCredentialListResponse(BaseModel):
    items: list[WebAuthnCredentialResponse]
