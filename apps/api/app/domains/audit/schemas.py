from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AuditEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_subject: str = Field(min_length=1, max_length=128)
    actor_email: str | None = Field(default=None, max_length=320)
    action: str = Field(min_length=1, max_length=128)
    resource_type: str = Field(min_length=1, max_length=64)
    resource_id: str | None = Field(default=None, max_length=128)
    metadata_json: dict[str, str] = Field(default_factory=dict)


class AuditEventResponse(BaseModel):
    id: UUID
    actor_subject: str
    actor_email: str | None
    action: str
    resource_type: str
    resource_id: str | None
    metadata_json: dict[str, str]
    created_at: datetime


class AuditEventListResponse(BaseModel):
    items: list[AuditEventResponse]
