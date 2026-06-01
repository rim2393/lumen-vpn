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


class SubscriptionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str | None = Field(default=None, min_length=1, max_length=32)
    node_id: UUID | None = None
    delivery_profile: dict[str, str] | None = None
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


class SubscriptionDeviceRecord(BaseModel):
    id: str
    label: str | None = None
    hwid: str | None = None
    platform: str | None = None
    status: str = "active"
    last_seen_at: datetime | None = None
    metadata_json: dict[str, object] = Field(default_factory=dict)


class SubscriptionDeviceListResponse(BaseModel):
    items: list[SubscriptionDeviceRecord]
