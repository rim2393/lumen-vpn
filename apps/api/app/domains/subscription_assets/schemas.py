from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TemplateFormat = Literal["xray_json", "mihomo", "stash", "sing_box", "clash", "raw_uri"]


class SubscriptionTemplateCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    format: TemplateFormat
    status: str = Field(default="active", max_length=32)
    content_json: dict[str, object] = Field(default_factory=dict)
    order: int | None = Field(default=None, ge=0)


class SubscriptionTemplateUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    format: TemplateFormat | None = None
    status: str | None = Field(default=None, max_length=32)
    content_json: dict[str, object] | None = None
    order: int | None = Field(default=None, ge=0)


class SubscriptionTemplateResponse(BaseModel):
    id: str
    name: str
    format: TemplateFormat
    status: str
    content_json: dict[str, object]
    order: int


class SubscriptionTemplateListResponse(BaseModel):
    items: list[SubscriptionTemplateResponse]


class ResponseRuleCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    trigger_status: str = Field(min_length=1, max_length=64)
    status_code: int = Field(default=200, ge=100, le=599)
    body: str = Field(default="", max_length=4096)
    headers: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    order: int | None = Field(default=None, ge=0)


class ResponseRuleUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    trigger_status: str | None = Field(default=None, min_length=1, max_length=64)
    status_code: int | None = Field(default=None, ge=100, le=599)
    body: str | None = Field(default=None, max_length=4096)
    headers: dict[str, str] | None = None
    enabled: bool | None = None
    order: int | None = Field(default=None, ge=0)


class ResponseRuleResponse(BaseModel):
    id: str
    name: str
    trigger_status: str
    status_code: int
    body: str
    headers: dict[str, str]
    enabled: bool
    order: int


class ResponseRuleListResponse(BaseModel):
    items: list[ResponseRuleResponse]


class ReorderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(min_length=1)


class ReorderResponse(BaseModel):
    updated: int


class ResponseRuleTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subscription_status: str = Field(min_length=1, max_length=64)


class ResponseRuleTestResponse(BaseModel):
    matched: bool
    rule: ResponseRuleResponse | None
    status_code: int
    body: str
    headers: dict[str, str]
