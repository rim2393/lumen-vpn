from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class HwidInspectorRow(BaseModel):
    user_id: UUID
    username: str | None
    email: str
    device_limit: int | None
    device_count: int
    status: str
    devices: list[str] = Field(default_factory=list)


class HwidInspectorResponse(BaseModel):
    items: list[HwidInspectorRow]


class SrhInspectorRow(BaseModel):
    subscription_id: UUID
    public_id: str
    user_id: UUID
    status: str
    parser: str
    config_hash: str | None
    response_headers: dict[str, str]


class SrhInspectorResponse(BaseModel):
    items: list[SrhInspectorRow]


class SessionInspectorRow(BaseModel):
    id: UUID
    user_id: UUID
    email: str | None
    status: str
    ip_fingerprint: str | None
    user_agent_fingerprint: str | None
    expires_at: datetime
    created_at: datetime
    updated_at: datetime


class SessionInspectorResponse(BaseModel):
    items: list[SessionInspectorRow]


class TorrentReportRow(BaseModel):
    id: UUID
    action: str
    actor_email: str | None
    resource_id: str | None
    metadata_json: dict[str, str]
    created_at: datetime


class TorrentReportResponse(BaseModel):
    items: list[TorrentReportRow]


class HappRoutingRow(BaseModel):
    subscription_id: UUID
    public_id: str
    user_id: UUID
    username: str | None
    node_id: UUID | None
    node_name: str | None
    node_status: str | None
    route_status: str
    delivery_profile: dict[str, str]


class HappRoutingResponse(BaseModel):
    items: list[HappRoutingRow]


class ToolSummaryResponse(BaseModel):
    hwid_over_limit: int
    sessions_active: int
    torrent_events: int
    happ_routes: int
