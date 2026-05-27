from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal
from app.domains.audit.models import AuditEvent
from app.domains.audit.schemas import AuditEventCreate, AuditEventResponse


async def record_audit_event(
    session: AsyncSession,
    *,
    principal: Principal,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    metadata_json: dict[str, str] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_subject=principal.subject,
        actor_email=principal.email,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata_json=metadata_json or {},
    )
    session.add(event)
    await session.flush()
    return event


async def create_audit_event(session: AsyncSession, *, request: AuditEventCreate) -> AuditEvent:
    event = AuditEvent(**request.model_dump())
    session.add(event)
    await session.flush()
    return event


async def list_audit_events(session: AsyncSession, *, limit: int = 100) -> list[AuditEvent]:
    result = await session.execute(
        select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
    )
    return list(result.scalars().all())


def audit_event_response(event: AuditEvent) -> AuditEventResponse:
    return AuditEventResponse(
        id=event.id,
        actor_subject=event.actor_subject,
        actor_email=event.actor_email,
        action=event.action,
        resource_type=event.resource_type,
        resource_id=event.resource_id,
        metadata_json=event.metadata_json,
        created_at=event.created_at,
    )
