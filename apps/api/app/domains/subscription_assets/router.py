from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.service import record_audit_event
from app.domains.subscription_assets.schemas import (
    ReorderRequest,
    ReorderResponse,
    ResponseRuleCreateRequest,
    ResponseRuleListResponse,
    ResponseRuleResponse,
    ResponseRuleTestRequest,
    ResponseRuleTestResponse,
    ResponseRuleUpdateRequest,
    SubscriptionTemplateCreateRequest,
    SubscriptionTemplateListResponse,
    SubscriptionTemplateResponse,
    SubscriptionTemplateUpdateRequest,
)
from app.domains.subscription_assets.service import (
    create_response_rule,
    create_template,
    delete_response_rule,
    delete_template,
    list_response_rules,
    list_templates,
    reorder_response_rules,
    reorder_templates,
    test_response_rule,
    update_response_rule,
    update_template,
)

templates_router = APIRouter()
response_rules_router = APIRouter()
Manager = Annotated[Principal, Depends(require_permission(Permission.USER_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


@templates_router.get("", response_model=SubscriptionTemplateListResponse)
async def read_templates(_: Manager, session: DatabaseSession) -> SubscriptionTemplateListResponse:
    return SubscriptionTemplateListResponse(items=await list_templates(session))


@templates_router.post(
    "",
    response_model=SubscriptionTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_template(
    request: SubscriptionTemplateCreateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> SubscriptionTemplateResponse:
    template = await create_template(session, request=request, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription_template.created",
        resource_type="subscription_template",
        resource_id=template.id,
    )
    await session.commit()
    return template


@templates_router.patch("/{template_id}", response_model=SubscriptionTemplateResponse)
async def patch_template(
    template_id: str,
    request: SubscriptionTemplateUpdateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> SubscriptionTemplateResponse:
    template = await update_template(
        session,
        template_id=template_id,
        request=request,
        principal=principal,
    )
    await record_audit_event(
        session,
        principal=principal,
        action="subscription_template.updated",
        resource_type="subscription_template",
        resource_id=template.id,
    )
    await session.commit()
    return template


@templates_router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template_route(
    template_id: str,
    principal: Manager,
    session: DatabaseSession,
) -> None:
    await delete_template(session, template_id=template_id, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription_template.deleted",
        resource_type="subscription_template",
        resource_id=template_id,
    )
    await session.commit()


@templates_router.post("/actions/reorder", response_model=ReorderResponse)
async def reorder_template_route(
    request: ReorderRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ReorderResponse:
    updated = await reorder_templates(session, request=request, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription_template.reordered",
        resource_type="subscription_template",
        metadata_json={"template_ids": request.ids},
    )
    await session.commit()
    return ReorderResponse(updated=updated)


@response_rules_router.get("", response_model=ResponseRuleListResponse)
async def read_response_rules(_: Manager, session: DatabaseSession) -> ResponseRuleListResponse:
    return ResponseRuleListResponse(items=await list_response_rules(session))


@response_rules_router.post(
    "",
    response_model=ResponseRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_response_rule(
    request: ResponseRuleCreateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResponseRuleResponse:
    rule = await create_response_rule(session, request=request, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="response_rule.created",
        resource_type="response_rule",
        resource_id=rule.id,
    )
    await session.commit()
    return rule


@response_rules_router.patch("/{rule_id}", response_model=ResponseRuleResponse)
async def patch_response_rule(
    rule_id: str,
    request: ResponseRuleUpdateRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResponseRuleResponse:
    rule = await update_response_rule(
        session,
        rule_id=rule_id,
        request=request,
        principal=principal,
    )
    await record_audit_event(
        session,
        principal=principal,
        action="response_rule.updated",
        resource_type="response_rule",
        resource_id=rule.id,
    )
    await session.commit()
    return rule


@response_rules_router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_response_rule_route(
    rule_id: str,
    principal: Manager,
    session: DatabaseSession,
) -> None:
    await delete_response_rule(session, rule_id=rule_id, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="response_rule.deleted",
        resource_type="response_rule",
        resource_id=rule_id,
    )
    await session.commit()


@response_rules_router.post("/actions/reorder", response_model=ReorderResponse)
async def reorder_response_rule_route(
    request: ReorderRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ReorderResponse:
    updated = await reorder_response_rules(session, request=request, principal=principal)
    await record_audit_event(
        session,
        principal=principal,
        action="response_rule.reordered",
        resource_type="response_rule",
        metadata_json={"rule_ids": request.ids},
    )
    await session.commit()
    return ReorderResponse(updated=updated)


@response_rules_router.post("/test", response_model=ResponseRuleTestResponse)
async def test_response_rule_route(
    request: ResponseRuleTestRequest,
    principal: Manager,
    session: DatabaseSession,
) -> ResponseRuleTestResponse:
    _ = principal
    return await test_response_rule(session, subscription_status=request.subscription_status)
