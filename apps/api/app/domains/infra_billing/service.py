from uuid import UUID

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.audit.service import record_audit_event
from app.domains.infra_billing.models import InfraBillingRecord, InfraProvider
from app.domains.infra_billing.schemas import (
    InfraBillingCurrencyTotal,
    InfraBillingRecordCreateRequest,
    InfraBillingRecordListResponse,
    InfraBillingRecordRecord,
    InfraBillingSummaryResponse,
    InfraProviderCreateRequest,
    InfraProviderListResponse,
    InfraProviderRecord,
    InfraProviderUpdateRequest,
)


def _provider_record(provider: InfraProvider) -> InfraProviderRecord:
    return InfraProviderRecord(
        id=provider.id,
        name=provider.name,
        login_url=provider.login_url,
        notes=provider.notes,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


def _billing_record(record: InfraBillingRecord) -> InfraBillingRecordRecord:
    return InfraBillingRecordRecord(
        id=record.id,
        provider_id=record.provider_id,
        node_id=record.node_id,
        amount=record.amount,
        currency=record.currency,
        period=record.period,
        note=record.note,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def list_providers(session: AsyncSession) -> InfraProviderListResponse:
    result = await session.execute(select(InfraProvider).order_by(InfraProvider.name))
    return InfraProviderListResponse(
        items=[_provider_record(p) for p in result.scalars().all()]
    )


async def create_provider(
    session: AsyncSession,
    *,
    request: InfraProviderCreateRequest,
    principal: Principal,
) -> InfraProviderRecord:
    existing = await session.scalar(
        select(InfraProvider).where(InfraProvider.name == request.name)
    )
    if existing is not None:
        raise APIError(
            code="infra_provider_exists",
            message="A provider with this name already exists",
            status_code=status.HTTP_409_CONFLICT,
        )
    provider = InfraProvider(
        name=request.name,
        login_url=request.login_url,
        notes=request.notes,
    )
    session.add(provider)
    await session.flush()
    await record_audit_event(
        session,
        principal=principal,
        action="infra_billing.provider.created",
        resource_type="infra_provider",
        resource_id=str(provider.id),
    )
    await session.commit()
    return _provider_record(provider)


async def _get_provider(session: AsyncSession, provider_id: UUID) -> InfraProvider:
    provider = await session.get(InfraProvider, provider_id)
    if provider is None:
        raise APIError(
            code="infra_provider_not_found",
            message="Infrastructure provider not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return provider


async def update_provider(
    session: AsyncSession,
    *,
    provider_id: UUID,
    request: InfraProviderUpdateRequest,
    principal: Principal,
) -> InfraProviderRecord:
    provider = await _get_provider(session, provider_id)
    if request.name is not None:
        provider.name = request.name
    if request.login_url is not None:
        provider.login_url = request.login_url
    if request.notes is not None:
        provider.notes = request.notes
    await record_audit_event(
        session,
        principal=principal,
        action="infra_billing.provider.updated",
        resource_type="infra_provider",
        resource_id=str(provider.id),
    )
    await session.commit()
    return _provider_record(provider)


async def delete_provider(
    session: AsyncSession,
    *,
    provider_id: UUID,
    principal: Principal,
) -> None:
    provider = await _get_provider(session, provider_id)
    await session.delete(provider)
    await record_audit_event(
        session,
        principal=principal,
        action="infra_billing.provider.deleted",
        resource_type="infra_provider",
        resource_id=str(provider_id),
    )
    await session.commit()


async def list_records(session: AsyncSession) -> InfraBillingRecordListResponse:
    result = await session.execute(
        select(InfraBillingRecord).order_by(InfraBillingRecord.period.desc())
    )
    return InfraBillingRecordListResponse(
        items=[_billing_record(r) for r in result.scalars().all()]
    )


async def create_record(
    session: AsyncSession,
    *,
    request: InfraBillingRecordCreateRequest,
    principal: Principal,
) -> InfraBillingRecordRecord:
    await _get_provider(session, request.provider_id)
    record = InfraBillingRecord(
        provider_id=request.provider_id,
        node_id=request.node_id,
        amount=request.amount,
        currency=request.currency.upper(),
        period=request.period,
        note=request.note,
    )
    session.add(record)
    await session.flush()
    await record_audit_event(
        session,
        principal=principal,
        action="infra_billing.record.created",
        resource_type="infra_billing_record",
        resource_id=str(record.id),
        metadata_json={"amount": str(record.amount), "currency": record.currency},
    )
    await session.commit()
    return _billing_record(record)


async def delete_record(
    session: AsyncSession,
    *,
    record_id: UUID,
    principal: Principal,
) -> None:
    record = await session.get(InfraBillingRecord, record_id)
    if record is None:
        raise APIError(
            code="infra_billing_record_not_found",
            message="Billing record not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    await session.delete(record)
    await record_audit_event(
        session,
        principal=principal,
        action="infra_billing.record.deleted",
        resource_type="infra_billing_record",
        resource_id=str(record_id),
    )
    await session.commit()


async def summarize(session: AsyncSession) -> InfraBillingSummaryResponse:
    providers = int(await session.scalar(select(func.count()).select_from(InfraProvider)) or 0)
    records = int(await session.scalar(select(func.count()).select_from(InfraBillingRecord)) or 0)
    totals = await session.execute(
        select(
            InfraBillingRecord.currency,
            func.sum(InfraBillingRecord.amount),
            func.count(),
        ).group_by(InfraBillingRecord.currency)
    )
    totals_by_currency = [
        InfraBillingCurrencyTotal(
            currency=currency,
            total=float(total or 0.0),
            records=int(count or 0),
        )
        for currency, total, count in totals.all()
    ]
    return InfraBillingSummaryResponse(
        providers=providers,
        records=records,
        totals_by_currency=totals_by_currency,
    )
