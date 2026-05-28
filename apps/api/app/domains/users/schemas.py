from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr

from app.core.rbac import Role
from app.domains.audit.schemas import AuditEventResponse
from app.domains.subscriptions.schemas import SubscriptionResponse


class UserCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: SecretStr | None = Field(default=None, min_length=8)
    role: Role = Role.USER
    status: str = Field(default="active", examples=["active"])
    username: str | None = Field(default=None, min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=160)
    telegram_id: str | None = Field(default=None, max_length=64)
    traffic_limit_gb: float | None = Field(default=None, ge=0)
    traffic_used_gb: float = Field(default=0, ge=0)
    device_limit: int | None = Field(default=None, ge=0)
    expires_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    metadata_json: dict[str, object] = Field(default_factory=dict)


class UserUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr | None = None
    password: SecretStr | None = Field(default=None, min_length=8)
    role: Role | None = None
    status: str | None = Field(default=None, examples=["active"])
    username: str | None = Field(default=None, min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=160)
    telegram_id: str | None = Field(default=None, max_length=64)
    traffic_limit_gb: float | None = Field(default=None, ge=0)
    traffic_used_gb: float | None = Field(default=None, ge=0)
    device_limit: int | None = Field(default=None, ge=0)
    expires_at: datetime | None = None
    tags: list[str] | None = None
    metadata_json: dict[str, object] | None = None


class UserBulkActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_ids: list[UUID] = Field(min_length=1)
    status: str | None = None
    expires_at: datetime | None = None
    traffic_delta_gb: float | None = None
    tags: list[str] | None = None


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    role: Role
    status: str = Field(examples=["active"])
    username: str | None
    display_name: str | None
    telegram_id: str | None
    traffic_limit_gb: float | None
    traffic_used_gb: float
    device_limit: int | None
    expires_at: datetime | None
    tags: list[str]
    metadata_json: dict[str, object]
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: list[UserResponse]


class UserTagListResponse(BaseModel):
    items: list[str]


class UserBulkActionResponse(BaseModel):
    updated: int
    items: list[UserResponse]


class UserDeviceRecord(BaseModel):
    id: str
    label: str | None = None
    hwid: str | None = None
    platform: str | None = None
    status: str = "active"
    last_seen_at: datetime | None = None
    metadata_json: dict[str, object] = Field(default_factory=dict)


class UserAccessibleNodeRecord(BaseModel):
    id: UUID
    name: str
    region: str
    public_address: str
    status: str


class UserDetailResponse(BaseModel):
    user: UserResponse
    subscriptions: list[SubscriptionResponse]
    devices: list[UserDeviceRecord]
    accessible_nodes: list[UserAccessibleNodeRecord]
    request_history: list[AuditEventResponse]
