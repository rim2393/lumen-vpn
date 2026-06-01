from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.infra_billing.schemas import (
    InfraBillingRecordCreateRequest,
    InfraBillingRecordListResponse,
    InfraBillingRecordRecord,
    InfraBillingSummaryResponse,
    InfraProviderCreateRequest,
    InfraProviderListResponse,
    InfraProviderRecord,
    InfraProviderUpdateRequest,
)
from app.domains.infra_billing.service import (
    create_provider,
    create_record,
    delete_provider,
    delete_record,
    list_providers,
    list_records,
    summarize,
    update_provider,
)

router = APIRouter()
BillingManager = Annotated[Principal, Depends(require_permission(Permission.NODE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/providers", response_model=InfraProviderListResponse)
async def read_providers(_: BillingManager, session: DatabaseSession) -> InfraProviderListResponse:
    return await list_providers(session)


@router.post("/providers", response_model=InfraProviderRecord, status_code=201)
async def create_infra_provider(
    request: InfraProviderCreateRequest,
    principal: BillingManager,
    session: DatabaseSession,
) -> InfraProviderRecord:
    return await create_provider(session, request=request, principal=principal)


@router.patch("/providers/{provider_id}", response_model=InfraProviderRecord)
async def update_infra_provider(
    provider_id: UUID,
    request: InfraProviderUpdateRequest,
    principal: BillingManager,
    session: DatabaseSession,
) -> InfraProviderRecord:
    return await update_provider(
        session, provider_id=provider_id, request=request, principal=principal
    )


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_infra_provider(
    provider_id: UUID,
    principal: BillingManager,
    session: DatabaseSession,
) -> None:
    await delete_provider(session, provider_id=provider_id, principal=principal)


@router.get("/records", response_model=InfraBillingRecordListResponse)
async def read_records(
    _: BillingManager,
    session: DatabaseSession,
) -> InfraBillingRecordListResponse:
    return await list_records(session)


@router.post("/records", response_model=InfraBillingRecordRecord, status_code=201)
async def create_infra_billing_record(
    request: InfraBillingRecordCreateRequest,
    principal: BillingManager,
    session: DatabaseSession,
) -> InfraBillingRecordRecord:
    return await create_record(session, request=request, principal=principal)


@router.delete("/records/{record_id}", status_code=204)
async def delete_infra_billing_record(
    record_id: UUID,
    principal: BillingManager,
    session: DatabaseSession,
) -> None:
    await delete_record(session, record_id=record_id, principal=principal)


@router.get("/summary", response_model=InfraBillingSummaryResponse)
async def read_summary(_: BillingManager, session: DatabaseSession) -> InfraBillingSummaryResponse:
    return await summarize(session)
