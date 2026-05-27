from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    scopes: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None
    owner_user_id: UUID | None = None


class ApiKeyCreateResponse(BaseModel):
    id: UUID
    name: str
    key_prefix: str
    api_key: str
    expires_at: datetime | None


class ApiKeyResponse(BaseModel):
    id: UUID
    name: str
    key_prefix: str
    scopes: list[str]
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None


class ApiKeyListResponse(BaseModel):
    items: list[ApiKeyResponse]
