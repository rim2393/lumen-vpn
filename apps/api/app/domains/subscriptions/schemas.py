from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SubscriptionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    license_id: UUID
    node_id: UUID | None = None
    delivery_profile: dict[str, str] = Field(default_factory=dict)
    config_hash: str | None = Field(default=None, max_length=128)
    expires_at: datetime | None = None


class SubscriptionResponse(BaseModel):
    id: UUID
    public_id: str
    user_id: UUID
    license_id: UUID
    node_id: UUID | None
    status: str
    delivery_profile: dict[str, str]
    config_hash: str | None
    expires_at: datetime | None
    revoked_at: datetime | None


class SubscriptionListResponse(BaseModel):
    items: list[SubscriptionResponse]
