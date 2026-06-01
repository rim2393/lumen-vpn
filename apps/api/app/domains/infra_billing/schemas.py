from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class InfraProviderRecord(BaseModel):
    id: UUID
    name: str
    login_url: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class InfraProviderListResponse(BaseModel):
    items: list[InfraProviderRecord]


class InfraProviderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    login_url: str | None = Field(default=None, max_length=512)
    notes: str | None = Field(default=None, max_length=1024)


class InfraProviderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    login_url: str | None = Field(default=None, max_length=512)
    notes: str | None = Field(default=None, max_length=1024)


class InfraBillingRecordRecord(BaseModel):
    id: UUID
    provider_id: UUID
    node_id: UUID | None
    amount: float
    currency: str
    period: str
    note: str | None
    created_at: datetime
    updated_at: datetime


class InfraBillingRecordListResponse(BaseModel):
    items: list[InfraBillingRecordRecord]


class InfraBillingRecordCreateRequest(BaseModel):
    provider_id: UUID
    node_id: UUID | None = None
    amount: float = Field(ge=0)
    currency: str = Field(default="USD", min_length=1, max_length=8)
    period: str = Field(min_length=1, max_length=16)
    note: str | None = Field(default=None, max_length=512)


class InfraBillingCurrencyTotal(BaseModel):
    currency: str
    total: float
    records: int


class InfraBillingSummaryResponse(BaseModel):
    providers: int
    records: int
    totals_by_currency: list[InfraBillingCurrencyTotal]
