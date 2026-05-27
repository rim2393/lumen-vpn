from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.schemas import AuditEventCreate, AuditEventListResponse, AuditEventResponse
from app.domains.audit.service import (
    audit_event_response,
    create_audit_event,
    list_audit_events,
)

router = APIRouter()
AuditReader = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/events", response_model=AuditEventListResponse)
async def list_events(
    _: AuditReader,
    session: DatabaseSession,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> AuditEventListResponse:
    events = await list_audit_events(session, limit=limit)
    return AuditEventListResponse(items=[audit_event_response(event) for event in events])


@router.post("/events", response_model=AuditEventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    request: AuditEventCreate,
    _: AuditReader,
    session: DatabaseSession,
) -> AuditEventResponse:
    event = await create_audit_event(session, request=request)
    await session.commit()
    return audit_event_response(event)
