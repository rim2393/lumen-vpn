from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SettingUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value_json: dict[str, str] = Field(default_factory=dict)


class SettingResponse(BaseModel):
    id: UUID
    key: str
    value_json: dict[str, str]
    updated_by: str | None
    updated_at: datetime


class SettingListResponse(BaseModel):
    items: list[SettingResponse]
