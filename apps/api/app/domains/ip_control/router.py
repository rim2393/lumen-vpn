from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.ip_control.schemas import (
    IpControlDecisionResponse,
    IpControlEvaluateRequest,
    IpControlEventListResponse,
    IpControlRuleCreateRequest,
    IpControlRuleListResponse,
    IpControlRuleRecord,
    IpControlRuleUpdateRequest,
)
from app.domains.ip_control.service import (
    create_rule,
    delete_rule,
    evaluate_access,
    list_events,
    list_rules,
    update_rule,
)

router = APIRouter()
IpControlManager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/rules", response_model=IpControlRuleListResponse)
async def read_rules(_: IpControlManager, session: DatabaseSession) -> IpControlRuleListResponse:
    return await list_rules(session)


@router.post("/rules", response_model=IpControlRuleRecord, status_code=201)
async def create_ip_control_rule(
    request: IpControlRuleCreateRequest,
    principal: IpControlManager,
    session: DatabaseSession,
) -> IpControlRuleRecord:
    return await create_rule(session, request=request, principal=principal)


@router.patch("/rules/{rule_id}", response_model=IpControlRuleRecord)
async def update_ip_control_rule(
    rule_id: UUID,
    request: IpControlRuleUpdateRequest,
    principal: IpControlManager,
    session: DatabaseSession,
) -> IpControlRuleRecord:
    return await update_rule(session, rule_id=rule_id, request=request, principal=principal)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_ip_control_rule(
    rule_id: UUID,
    principal: IpControlManager,
    session: DatabaseSession,
) -> None:
    await delete_rule(session, rule_id=rule_id, principal=principal)


@router.get("/events", response_model=IpControlEventListResponse)
async def read_events(
    _: IpControlManager,
    session: DatabaseSession,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> IpControlEventListResponse:
    return await list_events(session, limit=limit)


@router.post("/evaluate", response_model=IpControlDecisionResponse)
async def evaluate_ip_control(
    request: IpControlEvaluateRequest,
    _: IpControlManager,
    session: DatabaseSession,
) -> IpControlDecisionResponse:
    return await evaluate_access(session, request=request)
