from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class NodePluginRecord(BaseModel):
    id: UUID
    node_id: UUID | None
    kind: str
    name: str
    config_json: dict[str, object]
    enabled: bool
    created_at: datetime
    updated_at: datetime


class NodePluginListResponse(BaseModel):
    items: list[NodePluginRecord]


class NodePluginCreateRequest(BaseModel):
    node_id: UUID | None = None
    kind: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    config_json: dict[str, object] = Field(default_factory=dict)
    enabled: bool = True


class NodePluginUpdateRequest(BaseModel):
    node_id: UUID | None = None
    kind: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=160)
    config_json: dict[str, object] | None = None
    enabled: bool | None = None
