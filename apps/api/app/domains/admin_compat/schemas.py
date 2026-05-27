from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


ApiSource = Literal["api"]


class AuthSessionResponse(CamelModel):
    email: str
    expires_at: datetime
    name: str
    role: Literal["owner", "admin", "operator", "auditor"]
    scopes: list[str]
    user_id: str


class AdminUserRecord(CamelModel):
    display_name: str
    email: str
    expires_at: datetime
    id: str
    mfa_enabled: bool
    role: Literal["owner", "admin", "operator", "user"]
    status: Literal["active", "limited", "disabled"]
    subscription: Literal["trial", "paid", "grace", "expired"]
    traffic_used_gb: float


class AdminUsersResponse(CamelModel):
    generated_at: datetime
    items: list[AdminUserRecord]
    source: ApiSource
    total: int


class ApiKeyRecord(CamelModel):
    created_at: datetime
    expires_at: datetime | None
    fingerprint: str
    id: str
    last_used_at: datetime | None
    name: str
    owner: str
    scopes: list[str]
    status: Literal["active", "expiring", "revoked"]


class ApiKeysResponse(CamelModel):
    generated_at: datetime
    items: list[ApiKeyRecord]
    source: ApiSource
    total: int


class LicenseAuditEvent(CamelModel):
    at: datetime
    label: str


class LicenseSummaryResponse(CamelModel):
    audit_events: list[LicenseAuditEvent]
    expires_at: datetime
    features: list[str]
    issued_to: str
    plan: str
    seats_limit: int
    seats_used: int
    status: Literal["valid", "expiring", "invalid"]
