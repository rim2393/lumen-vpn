from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SettingUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value_json: dict[str, object] = Field(default_factory=dict)


class SettingResponse(BaseModel):
    id: UUID
    key: str
    value_json: dict[str, object]
    updated_by: str | None
    updated_at: datetime


class SettingListResponse(BaseModel):
    items: list[SettingResponse]


class SettingGroupUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value_json: dict[str, object] = Field(default_factory=dict)


class SettingGroupResponse(BaseModel):
    key: str
    title: str
    description: str
    value_json: dict[str, object]
    updated_by: str | None
    updated_at: datetime | None


class SettingGroupListResponse(BaseModel):
    items: list[SettingGroupResponse]


class AuthProviderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    status: str | None = Field(default=None, min_length=1, max_length=32)
    scopes: list[str] | None = None
    metadata_json: dict[str, object] | None = None


class AuthProviderResponse(BaseModel):
    provider: str
    display_name: str
    enabled: bool
    status: str
    scopes: list[str]
    metadata_json: dict[str, object]


class AuthProviderListResponse(BaseModel):
    items: list[AuthProviderResponse]
