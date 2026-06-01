from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.audit.service import record_audit_event
from app.domains.ip_control.models import (
    ACTION_BLOCK,
    ACTIONS,
    SCOPE_GLOBAL,
    SCOPE_SQUAD,
    SCOPE_USER,
    SCOPES,
    IpControlEvent,
    IpControlRule,
)
from app.domains.ip_control.schemas import (
    IpControlDecisionResponse,
    IpControlEvaluateRequest,
    IpControlEventListResponse,
    IpControlEventRecord,
    IpControlRuleCreateRequest,
    IpControlRuleListResponse,
    IpControlRuleRecord,
    IpControlRuleUpdateRequest,
)

# Most-specific scope wins when several rules match a request.
_SCOPE_PRIORITY = {SCOPE_USER: 0, SCOPE_SQUAD: 1, SCOPE_GLOBAL: 2}


def _rule_record(rule: IpControlRule) -> IpControlRuleRecord:
    return IpControlRuleRecord(
        id=rule.id,
        name=rule.name,
        scope=rule.scope,
        target_id=rule.target_id,
        max_active_ips=rule.max_active_ips,
        action=rule.action,
        enabled=rule.enabled,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


def _event_record(event: IpControlEvent) -> IpControlEventRecord:
    return IpControlEventRecord(
        id=event.id,
        user_id=event.user_id,
        ip=event.ip,
        active_ip_count=event.active_ip_count,
        ip_limit=event.ip_limit,
        decision=event.decision,
        created_at=event.created_at,
    )


def _validate_scope_action(scope: str, action: str, target_id: str | None) -> None:
    if scope not in SCOPES:
        raise APIError(
            code="ip_control_invalid_scope",
            message=f"scope must be one of {', '.join(SCOPES)}",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if action not in ACTIONS:
        raise APIError(
            code="ip_control_invalid_action",
            message=f"action must be one of {', '.join(ACTIONS)}",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if scope != SCOPE_GLOBAL and not target_id:
        raise APIError(
            code="ip_control_target_required",
            message="target_id is required for user/squad scoped rules",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )


def resolve_effective_rule(
    rules: list[IpControlRule],
    *,
    user_id: str,
    squad_id: str | None,
) -> IpControlRule | None:
    """Pick the most specific enabled rule matching the subject (pure)."""

    candidates: list[IpControlRule] = []
    for rule in rules:
        if not rule.enabled:
            continue
        if rule.scope == SCOPE_USER and rule.target_id == user_id:
            candidates.append(rule)
        elif rule.scope == SCOPE_SQUAD and squad_id and rule.target_id == squad_id:
            candidates.append(rule)
        elif rule.scope == SCOPE_GLOBAL:
            candidates.append(rule)
    if not candidates:
        return None
    return min(candidates, key=lambda rule: _SCOPE_PRIORITY[rule.scope])


async def list_rules(session: AsyncSession) -> IpControlRuleListResponse:
    result = await session.execute(select(IpControlRule).order_by(IpControlRule.name))
    return IpControlRuleListResponse(
        items=[_rule_record(rule) for rule in result.scalars().all()]
    )


async def create_rule(
    session: AsyncSession,
    *,
    request: IpControlRuleCreateRequest,
    principal: Principal,
) -> IpControlRuleRecord:
    _validate_scope_action(request.scope, request.action, request.target_id)
    rule = IpControlRule(
        name=request.name,
        scope=request.scope,
        target_id=request.target_id,
        max_active_ips=request.max_active_ips,
        action=request.action,
        enabled=request.enabled,
    )
    session.add(rule)
    await session.flush()
    await record_audit_event(
        session,
        principal=principal,
        action="ip_control.rule.created",
        resource_type="ip_control_rule",
        resource_id=str(rule.id),
        metadata_json={"scope": rule.scope, "max_active_ips": str(rule.max_active_ips)},
    )
    await session.commit()
    return _rule_record(rule)


async def _get_rule(session: AsyncSession, rule_id) -> IpControlRule:
    rule = await session.get(IpControlRule, rule_id)
    if rule is None:
        raise APIError(
            code="ip_control_rule_not_found",
            message="IP control rule not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return rule


async def update_rule(
    session: AsyncSession,
    *,
    rule_id,
    request: IpControlRuleUpdateRequest,
    principal: Principal,
) -> IpControlRuleRecord:
    rule = await _get_rule(session, rule_id)
    scope = request.scope if request.scope is not None else rule.scope
    action = request.action if request.action is not None else rule.action
    target_id = request.target_id if request.target_id is not None else rule.target_id
    _validate_scope_action(scope, action, target_id)

    if request.name is not None:
        rule.name = request.name
    rule.scope = scope
    rule.action = action
    rule.target_id = target_id
    if request.max_active_ips is not None:
        rule.max_active_ips = request.max_active_ips
    if request.enabled is not None:
        rule.enabled = request.enabled

    await record_audit_event(
        session,
        principal=principal,
        action="ip_control.rule.updated",
        resource_type="ip_control_rule",
        resource_id=str(rule.id),
    )
    await session.commit()
    return _rule_record(rule)


async def delete_rule(session: AsyncSession, *, rule_id, principal: Principal) -> None:
    rule = await _get_rule(session, rule_id)
    await session.delete(rule)
    await record_audit_event(
        session,
        principal=principal,
        action="ip_control.rule.deleted",
        resource_type="ip_control_rule",
        resource_id=str(rule_id),
    )
    await session.commit()


async def list_events(session: AsyncSession, *, limit: int = 100) -> IpControlEventListResponse:
    result = await session.execute(
        select(IpControlEvent).order_by(IpControlEvent.created_at.desc()).limit(limit)
    )
    return IpControlEventListResponse(
        items=[_event_record(event) for event in result.scalars().all()]
    )


async def build_ip_control_policy(
    session: AsyncSession,
    *,
    user_id: str | None = None,
    squad_id: str | None = None,
) -> dict[str, object] | None:
    """Return the effective IP-control rule in node/subscription policy shape."""

    result = await session.execute(select(IpControlRule))
    rules = list(result.scalars().all())
    if user_id is not None:
        rule = resolve_effective_rule(rules, user_id=user_id, squad_id=squad_id)
    else:
        rule = next(
            (
                item
                for item in rules
                if item.enabled and item.scope == SCOPE_GLOBAL
            ),
            None,
        )
    if rule is None:
        return None
    return {
        "ruleId": str(rule.id),
        "scope": rule.scope,
        "targetId": rule.target_id,
        "maxActiveIps": rule.max_active_ips,
        "action": rule.action,
    }


async def evaluate_access(
    session: AsyncSession,
    *,
    request: IpControlEvaluateRequest,
) -> IpControlDecisionResponse:
    """Decide whether the subject's active IP set is within its effective rule.

    A blocked decision is persisted as an event so operators can audit abuse.
    """

    result = await session.execute(select(IpControlRule))
    rule = resolve_effective_rule(
        list(result.scalars().all()),
        user_id=request.user_id,
        squad_id=request.squad_id,
    )

    distinct_ips = set(request.active_ips)
    if request.candidate_ip:
        distinct_ips.add(request.candidate_ip)
    active_ip_count = len(distinct_ips)

    if rule is None:
        return IpControlDecisionResponse(
            allowed=True,
            active_ip_count=active_ip_count,
            ip_limit=None,
            action=None,
            rule_id=None,
            decision="allowed",
        )

    over_limit = active_ip_count > rule.max_active_ips
    blocked = over_limit and rule.action == ACTION_BLOCK
    if over_limit:
        decision = "blocked" if blocked else "notified"
        session.add(
            IpControlEvent(
                user_id=request.user_id,
                ip=request.candidate_ip or next(iter(distinct_ips), ""),
                active_ip_count=active_ip_count,
                ip_limit=rule.max_active_ips,
                decision=decision,
            )
        )
        await session.commit()
    else:
        decision = "allowed"

    return IpControlDecisionResponse(
        allowed=not blocked,
        active_ip_count=active_ip_count,
        ip_limit=rule.max_active_ips,
        action=rule.action,
        rule_id=rule.id,
        decision=decision,
    )
