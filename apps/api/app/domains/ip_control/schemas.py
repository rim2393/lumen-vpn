from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class IpControlRuleRecord(BaseModel):
    id: UUID
    name: str
    scope: str
    target_id: str | None
    max_active_ips: int
    action: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class IpControlRuleListResponse(BaseModel):
    items: list[IpControlRuleRecord]


class IpControlRuleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    scope: str = "global"
    target_id: str | None = None
    max_active_ips: int = Field(default=2, ge=1, le=1024)
    action: str = "block"
    enabled: bool = True


class IpControlRuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    scope: str | None = None
    target_id: str | None = None
    max_active_ips: int | None = Field(default=None, ge=1, le=1024)
    action: str | None = None
    enabled: bool | None = None


class IpControlEventRecord(BaseModel):
    id: UUID
    user_id: str
    ip: str
    active_ip_count: int
    ip_limit: int
    decision: str
    created_at: datetime


class IpControlEventListResponse(BaseModel):
    items: list[IpControlEventRecord]


class IpControlEvaluateRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    squad_id: str | None = None
    active_ips: list[str] = Field(default_factory=list)
    candidate_ip: str | None = None


class IpControlDecisionResponse(BaseModel):
    allowed: bool
    active_ip_count: int
    ip_limit: int | None
    action: str | None
    rule_id: UUID | None
    decision: str
