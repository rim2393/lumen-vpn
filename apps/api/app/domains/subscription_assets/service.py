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
    SubscriptionPageConfigCloneRequest,
    SubscriptionPageConfigCreateRequest,
    SubscriptionPageConfigResponse,
    SubscriptionPageConfigUpdateRequest,
    SubscriptionTemplateCreateRequest,
    SubscriptionTemplateResponse,
    SubscriptionTemplateUpdateRequest,
)

TEMPLATES_KEY = "subscription.templates"
RESPONSE_RULES_KEY = "subscription.response_rules"
SUBPAGE_CONFIGS_KEY = "subscription.subpage_configs"


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
    _ensure_no_secret_like_keys(request.content_json, path=("content_json",))
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
    if "content_json" in data:
        _ensure_no_secret_like_keys(data["content_json"], path=("content_json",))
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


async def list_subpage_configs(session: AsyncSession) -> list[SubscriptionPageConfigResponse]:
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    return [_subpage_config_response(item) for item in _sorted(items)]


async def create_subpage_config(
    session: AsyncSession,
    *,
    request: SubscriptionPageConfigCreateRequest,
    principal: Principal,
) -> SubscriptionPageConfigResponse:
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    _ensure_no_secret_like_keys(request.config_json, path=("config_json",))
    item = {
        "id": f"subpage_{uuid4().hex[:16]}",
        "name": request.name,
        "status": request.status,
        "config_json": request.config_json,
        "order": request.order if request.order is not None else len(items),
    }
    items.append(item)
    await _save_setting_items(session, key=SUBPAGE_CONFIGS_KEY, items=items, principal=principal)
    return _subpage_config_response(item)


async def update_subpage_config(
    session: AsyncSession,
    *,
    config_id: str,
    request: SubscriptionPageConfigUpdateRequest,
    principal: Principal,
) -> SubscriptionPageConfigResponse:
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    item = _find_item(items, item_id=config_id, code="subpage_config_not_found")
    data = request.model_dump(exclude_unset=True)
    if "config_json" in data:
        _ensure_no_secret_like_keys(data["config_json"], path=("config_json",))
    item.update(data)
    await _save_setting_items(session, key=SUBPAGE_CONFIGS_KEY, items=items, principal=principal)
    return _subpage_config_response(item)


async def clone_subpage_config(
    session: AsyncSession,
    *,
    config_id: str,
    request: SubscriptionPageConfigCloneRequest,
    principal: Principal,
) -> SubscriptionPageConfigResponse:
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    source = _find_item(items, item_id=config_id, code="subpage_config_not_found")
    clone = {
        "id": f"subpage_{uuid4().hex[:16]}",
        "name": request.name or f"{source.get('name')} copy",
        "status": request.status or source.get("status", "active"),
        "config_json": dict(source.get("config_json") or {}),
        "order": len(items),
    }
    items.append(clone)
    await _save_setting_items(session, key=SUBPAGE_CONFIGS_KEY, items=items, principal=principal)
    return _subpage_config_response(clone)


async def delete_subpage_config(
    session: AsyncSession,
    *,
    config_id: str,
    principal: Principal,
) -> None:
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    before = len(items)
    items = [item for item in items if item.get("id") != config_id]
    if len(items) == before:
        _raise_not_found("subpage_config_not_found")
    await _save_setting_items(session, key=SUBPAGE_CONFIGS_KEY, items=items, principal=principal)


async def reorder_subpage_configs(
    session: AsyncSession,
    *,
    request: ReorderRequest,
    principal: Principal,
) -> int:
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    return await _reorder(
        session,
        key=SUBPAGE_CONFIGS_KEY,
        items=items,
        request=request,
        principal=principal,
    )


async def resolve_subpage_config(
    session: AsyncSession,
    *,
    config_id: str | None,
) -> SubscriptionPageConfigResponse | None:
    if not config_id:
        return None
    items = await _setting_items(session, SUBPAGE_CONFIGS_KEY)
    item = next((record for record in items if record.get("id") == config_id), None)
    if item is None:
        raise APIError(
            code="subscription_subpage_config_not_found",
            message="Subscription page config was not found.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=[config_id],
        )
    response = _subpage_config_response(item)
    if response.status.lower() != "active":
        raise APIError(
            code="subscription_subpage_config_not_active",
            message="Subscription page config is not active.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=[config_id],
        )
    return response


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


def _subpage_config_response(item: dict[str, object]) -> SubscriptionPageConfigResponse:
    return SubscriptionPageConfigResponse.model_validate(item)


def _ensure_no_secret_like_keys(
    value: object,
    *,
    path: tuple[str, ...] = (),
) -> None:
    forbidden = ("secret", "token", "password", "privatekey", "private_key", "clientsecret")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _ensure_no_secret_like_keys(item, path=(*path, str(index)))
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        normalized = str(key).replace("-", "").replace("_", "").lower()
        if any(fragment.replace("_", "") in normalized for fragment in forbidden):
            detail = ".".join((*path, str(key)))
            raise APIError(
                code="subscription_template_secret_like_key",
                message="Subscription templates must not contain inline secret-like keys.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                details=[detail],
            )
        _ensure_no_secret_like_keys(item, path=(*path, str(key)))
