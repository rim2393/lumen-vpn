from uuid import uuid4

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.rbac import Principal
from app.domains.settings.models import PanelSetting
from app.domains.subscription_assets.schemas import (
    ReorderRequest,
    ResponseRuleCreateRequest,
    ResponseRuleResponse,
    ResponseRuleTestResponse,
    ResponseRuleUpdateRequest,
    SubscriptionTemplateCreateRequest,
    SubscriptionTemplateResponse,
    SubscriptionTemplateUpdateRequest,
)

TEMPLATES_KEY = "subscription.templates"
RESPONSE_RULES_KEY = "subscription.response_rules"


async def list_templates(session: AsyncSession) -> list[SubscriptionTemplateResponse]:
    items = await _setting_items(session, TEMPLATES_KEY)
    return [_template_response(item) for item in _sorted(items)]


async def create_template(
    session: AsyncSession,
    *,
    request: SubscriptionTemplateCreateRequest,
    principal: Principal,
) -> SubscriptionTemplateResponse:
    items = await _setting_items(session, TEMPLATES_KEY)
    item = {
        "id": f"tpl_{uuid4().hex[:16]}",
        "name": request.name,
        "format": request.format,
        "status": request.status,
        "content_json": request.content_json,
        "order": request.order if request.order is not None else len(items),
    }
    items.append(item)
    await _save_setting_items(session, key=TEMPLATES_KEY, items=items, principal=principal)
    return _template_response(item)


async def update_template(
    session: AsyncSession,
    *,
    template_id: str,
    request: SubscriptionTemplateUpdateRequest,
    principal: Principal,
) -> SubscriptionTemplateResponse:
    items = await _setting_items(session, TEMPLATES_KEY)
    item = _find_item(items, item_id=template_id, code="template_not_found")
    data = request.model_dump(exclude_unset=True)
    item.update(data)
    await _save_setting_items(session, key=TEMPLATES_KEY, items=items, principal=principal)
    return _template_response(item)


async def delete_template(
    session: AsyncSession,
    *,
    template_id: str,
    principal: Principal,
) -> None:
    items = await _setting_items(session, TEMPLATES_KEY)
    before = len(items)
    items = [item for item in items if item.get("id") != template_id]
    if len(items) == before:
        _raise_not_found("template_not_found")
    await _save_setting_items(session, key=TEMPLATES_KEY, items=items, principal=principal)


async def reorder_templates(
    session: AsyncSession,
    *,
    request: ReorderRequest,
    principal: Principal,
) -> int:
    items = await _setting_items(session, TEMPLATES_KEY)
    return await _reorder(
        session,
        key=TEMPLATES_KEY,
        items=items,
        request=request,
        principal=principal,
    )


async def list_response_rules(session: AsyncSession) -> list[ResponseRuleResponse]:
    items = await _setting_items(session, RESPONSE_RULES_KEY)
    return [_rule_response(item) for item in _sorted(items)]


async def create_response_rule(
    session: AsyncSession,
    *,
    request: ResponseRuleCreateRequest,
    principal: Principal,
) -> ResponseRuleResponse:
    items = await _setting_items(session, RESPONSE_RULES_KEY)
    item = {
        "id": f"rule_{uuid4().hex[:16]}",
        "name": request.name,
        "trigger_status": request.trigger_status,
        "status_code": request.status_code,
        "body": request.body,
        "headers": request.headers,
        "enabled": request.enabled,
        "order": request.order if request.order is not None else len(items),
    }
    items.append(item)
    await _save_setting_items(session, key=RESPONSE_RULES_KEY, items=items, principal=principal)
    return _rule_response(item)


async def update_response_rule(
    session: AsyncSession,
    *,
    rule_id: str,
    request: ResponseRuleUpdateRequest,
    principal: Principal,
) -> ResponseRuleResponse:
    items = await _setting_items(session, RESPONSE_RULES_KEY)
    item = _find_item(items, item_id=rule_id, code="response_rule_not_found")
    item.update(request.model_dump(exclude_unset=True))
    await _save_setting_items(session, key=RESPONSE_RULES_KEY, items=items, principal=principal)
    return _rule_response(item)


async def delete_response_rule(
    session: AsyncSession,
    *,
    rule_id: str,
    principal: Principal,
) -> None:
    items = await _setting_items(session, RESPONSE_RULES_KEY)
    before = len(items)
    items = [item for item in items if item.get("id") != rule_id]
    if len(items) == before:
        _raise_not_found("response_rule_not_found")
    await _save_setting_items(session, key=RESPONSE_RULES_KEY, items=items, principal=principal)


async def reorder_response_rules(
    session: AsyncSession,
    *,
    request: ReorderRequest,
    principal: Principal,
) -> int:
    items = await _setting_items(session, RESPONSE_RULES_KEY)
    return await _reorder(
        session,
        key=RESPONSE_RULES_KEY,
        items=items,
        request=request,
        principal=principal,
    )


async def test_response_rule(
    session: AsyncSession,
    *,
    subscription_status: str,
) -> ResponseRuleTestResponse:
    rules = await list_response_rules(session)
    match = next(
        (
            rule
            for rule in rules
            if rule.enabled and rule.trigger_status.lower() == subscription_status.lower()
        ),
        None,
    )
    if match is None:
        return ResponseRuleTestResponse(
            matched=False,
            rule=None,
            status_code=200,
            body="",
            headers={},
        )
    return ResponseRuleTestResponse(
        matched=True,
        rule=match,
        status_code=match.status_code,
        body=match.body,
        headers=match.headers,
    )


async def _setting_items(session: AsyncSession, key: str) -> list[dict[str, object]]:
    result = await session.execute(select(PanelSetting).where(PanelSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting is None:
        return []
    raw = setting.value_json.get("items")
    if not isinstance(raw, list):
        return []
    return [dict(item) for item in raw if isinstance(item, dict)]


async def _save_setting_items(
    session: AsyncSession,
    *,
    key: str,
    items: list[dict[str, object]],
    principal: Principal,
) -> None:
    normalized = _sorted(items)
    result = await session.execute(select(PanelSetting).where(PanelSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting is None:
        session.add(
            PanelSetting(
                key=key,
                value_json={"items": normalized},
                updated_by=principal.subject,
            )
        )
    else:
        setting.value_json = {"items": normalized}
        setting.updated_by = principal.subject
    await session.flush()


async def _reorder(
    session: AsyncSession,
    *,
    key: str,
    items: list[dict[str, object]],
    request: ReorderRequest,
    principal: Principal,
) -> int:
    items_by_id = {str(item.get("id")): item for item in items}
    missing = [item_id for item_id in request.ids if item_id not in items_by_id]
    if missing:
        raise APIError(
            code="subscription_asset_not_found",
            message="One or more subscription assets were not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details=missing,
        )
    for order, item_id in enumerate(request.ids):
        items_by_id[item_id]["order"] = order
    await _save_setting_items(session, key=key, items=items, principal=principal)
    return len(request.ids)


def _find_item(items: list[dict[str, object]], *, item_id: str, code: str) -> dict[str, object]:
    item = next((record for record in items if record.get("id") == item_id), None)
    if item is None:
        _raise_not_found(code)
    return item


def _raise_not_found(code: str) -> None:
    raise APIError(
        code=code,
        message="Subscription asset was not found.",
        status_code=status.HTTP_404_NOT_FOUND,
    )


def _sorted(items: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(
        items,
        key=lambda item: (int(item.get("order", 1_000_000)), str(item.get("name", ""))),
    )


def _template_response(item: dict[str, object]) -> SubscriptionTemplateResponse:
    return SubscriptionTemplateResponse.model_validate(item)


def _rule_response(item: dict[str, object]) -> ResponseRuleResponse:
    return ResponseRuleResponse.model_validate(item)
