from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class HwidDeviceRecord(BaseModel):
    id: str
    label: str
    hwid: str | None = None
    platform: str | None = None
    status: str = "active"
    last_seen_at: str | None = None
    subscription_id: str | None = None


class HwidInspectorRow(BaseModel):
    user_id: UUID
    username: str | None
    email: str
    device_limit: int | None
    device_count: int
    status: str
    devices: list[str] = Field(default_factory=list)
    device_records: list[HwidDeviceRecord] = Field(default_factory=list)
    subscription_ids: list[str] = Field(default_factory=list)


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
    is_current: bool = False
    ip_fingerprint: str | None
    user_agent_fingerprint: str | None
    expires_at: datetime
    revoked_at: datetime | None
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


class TopUserRow(BaseModel):
    rank: int
    user_id: UUID
    email: str
    username: str | None
    status: str
    traffic_used_gb: float
    traffic_limit_gb: float | None
    traffic_percent: float | None
    device_count: int
    device_limit: int | None
    expires_at: datetime | None
    risk: str


class TopUserResponse(BaseModel):
    items: list[TopUserRow]
    metric: str


class UserIpRecord(BaseModel):
    user_id: UUID
    email: str | None
    username: str | None
    ip: str
    sources: list[str] = Field(default_factory=list)
    subscription_ids: list[str] = Field(default_factory=list)
    node_ids: list[UUID] = Field(default_factory=list)
    first_seen_at: datetime
    last_seen_at: datetime
    evidence_count: int
    last_target: str | None = None
    last_decision: str | None = None


class UserIpResponse(BaseModel):
    items: list[UserIpRecord]


class NodeUserIpRecord(BaseModel):
    node_id: UUID
    node_name: str | None
    user_id: UUID
    email: str | None
    username: str | None
    ip: str
    subscription_ids: list[str] = Field(default_factory=list)
    first_seen_at: datetime
    last_seen_at: datetime
    evidence_count: int
    last_target: str | None = None


class NodeUserIpResponse(BaseModel):
    items: list[NodeUserIpRecord]


class X25519KeypairResponse(BaseModel):
    public_key: str
    private_key: str
    encoding: str = "base64url-nopad"


class NodeKeyResponse(BaseModel):
    token: str
    token_prefix: str
    hash_algorithm: str = "hmac-sha256"
    stored: bool = False


class ToolSnippetRecord(BaseModel):
    id: UUID
    name: str
    content: str
    description: str | None = None
    language: str = "text"
    order: int = 0
    updated_at: datetime
    updated_by: str | None = None


class ToolSnippetCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=12000)
    description: str | None = Field(default=None, max_length=512)
    language: str = Field(default="text", min_length=1, max_length=32)
    order: int | None = None


class ToolSnippetUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    content: str | None = Field(default=None, min_length=1, max_length=12000)
    description: str | None = Field(default=None, max_length=512)
    language: str | None = Field(default=None, min_length=1, max_length=32)
    order: int | None = None


class ToolSnippetListResponse(BaseModel):
    items: list[ToolSnippetRecord]
