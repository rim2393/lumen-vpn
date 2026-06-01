from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import APIError
from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.schemas import AuditEventCreate
from app.domains.audit.service import create_audit_event, record_audit_event
from app.domains.subscription_assets.service import list_response_rules, list_templates
from app.domains.subscriptions.renderers import (
    RenderedSubscription,
    normalize_render_target,
    render_subscription_for_target,
)
from app.domains.subscriptions.schemas import (
    SubscriptionCreateRequest,
    SubscriptionListResponse,
    SubscriptionResponse,
    SubscriptionUpdateRequest,
)
from app.domains.subscriptions.service import (
    build_public_subscription_manifest,
    build_subscription_manifest,
    get_subscription_by_public_id,
    revoke_subscription,
    subscription_to_response,
    update_subscription,
)
from app.domains.subscriptions.service import (
    create_subscription as create_subscription_record,
)
from app.domains.subscriptions.service import (
    get_subscription as get_subscription_record,
)
from app.domains.subscriptions.service import (
    list_subscriptions as list_subscription_records,
)

router = APIRouter()
SubscriptionReader = Annotated[
    Principal,
    Depends(require_permission(Permission.SUBSCRIPTION_READ)),
]
SubscriptionManager = Annotated[
    Principal,
    Depends(require_permission(Permission.SUBSCRIPTION_MANAGE)),
]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]
RuntimeSettings = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=SubscriptionListResponse)
async def list_subscriptions(
    _: SubscriptionReader,
    session: DatabaseSession,
) -> SubscriptionListResponse:
    subscriptions = await list_subscription_records(session)
    return SubscriptionListResponse(
        items=[subscription_to_response(subscription) for subscription in subscriptions]
    )


@router.post("", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_subscription(
    request: SubscriptionCreateRequest,
    _: SubscriptionManager,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await create_subscription_record(session, request=request)
    await session.commit()
    return subscription_to_response(subscription)


@router.patch("/{subscription_id}", response_model=SubscriptionResponse)
async def patch_subscription(
    subscription_id: UUID,
    request: SubscriptionUpdateRequest,
    principal: SubscriptionManager,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await update_subscription(
        session,
        subscription_id=subscription_id,
        request=request,
    )
    await record_audit_event(
        session,
        principal=principal,
        action="subscription.updated",
        resource_type="subscription",
        resource_id=str(subscription.id),
    )
    await session.commit()
    return subscription_to_response(subscription)


@router.post("/{subscription_id}/revoke", response_model=SubscriptionResponse)
async def revoke_subscription_route(
    subscription_id: UUID,
    principal: SubscriptionManager,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await revoke_subscription(session, subscription_id=subscription_id)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription.revoked",
        resource_type="subscription",
        resource_id=str(subscription.id),
    )
    await session.commit()
    return subscription_to_response(subscription)


@router.get("/public/{public_id}/manifest", response_model=None)
async def get_public_subscription_manifest(
    public_id: str,
    session: DatabaseSession,
):
    try:
        manifest = await build_and_record_public_subscription_request(
            session,
            public_id=public_id,
            target="manifest",
        )
        await session.commit()
        return manifest
    except APIError as error:
        if rule_response := await _response_rule_for_error(session, error):
            return rule_response
        raise


@router.get("/public/{public_id}/render")
async def render_public_subscription(
    public_id: str,
    session: DatabaseSession,
    settings: RuntimeSettings,
    target: str | None = Query(
        default=None,
        description=(
            "Client target or renderer format: hiddify, happ, mihomo, sing-box, "
            "v2ray, amnezia."
        ),
    ),
    render_format: str | None = Query(
        default=None,
        alias="format",
        description="Compatibility alias for target.",
    ),
) -> Response:
    try:
        render_target = normalize_render_target(target or render_format)
        manifest = await build_and_record_public_subscription_request(
            session,
            public_id=public_id,
            target=render_target,
        )
        await session.commit()
    except APIError as error:
        if rule_response := await _response_rule_for_error(session, error):
            return rule_response
        raise
    rendered = render_subscription_for_target(manifest, settings=settings, target=render_target)
    rendered = await _apply_subscription_template(session, rendered, render_target=render_target)
    return _render_response(rendered, render_target=render_target)


@router.get("/{subscription_id}", response_model=SubscriptionResponse)
async def get_subscription(
    subscription_id: UUID,
    _: SubscriptionReader,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await get_subscription_record(session, subscription_id=subscription_id)
    return subscription_to_response(subscription)


@router.get("/{subscription_id}/manifest")
async def get_subscription_manifest(
    subscription_id: UUID,
    _: SubscriptionReader,
    session: DatabaseSession,
) -> dict[str, object]:
    return await build_subscription_manifest(session, subscription_id=subscription_id)


@router.get("/{subscription_id}/render")
async def render_subscription(
    subscription_id: UUID,
    _: SubscriptionReader,
    session: DatabaseSession,
    settings: RuntimeSettings,
    target: str | None = Query(default=None),
    render_format: str | None = Query(default=None, alias="format"),
) -> Response:
    manifest = await build_subscription_manifest(session, subscription_id=subscription_id)
    render_target = normalize_render_target(target or render_format)
    rendered = render_subscription_for_target(manifest, settings=settings, target=render_target)
    rendered = await _apply_subscription_template(session, rendered, render_target=render_target)
    return _render_response(rendered, render_target=render_target)


def _render_response(rendered: RenderedSubscription, *, render_target: str) -> Response:
    return Response(
        content=rendered.body,
        media_type=rendered.content_type,
        headers={
            **rendered.headers,
            "cache-control": "no-store",
            "content-disposition": f'inline; filename="{rendered.filename}"',
            "x-lumen-render-target": render_target,
        },
    )


async def build_and_record_public_subscription_request(
    session: AsyncSession,
    *,
    public_id: str,
    target: str,
) -> dict[str, object]:
    subscription = await get_subscription_by_public_id(session, public_id=public_id)
    manifest = await build_public_subscription_manifest(session, public_id=public_id)
    await create_audit_event(
        session,
        request=AuditEventCreate(
            actor_subject="public-subscription",
            actor_email=None,
            action="subscription.public.rendered",
            resource_type="user",
            resource_id=str(subscription.user_id),
            metadata_json={
                "public_id": subscription.public_id,
                "subscription_id": str(subscription.id),
                "target": target,
            },
        ),
    )
    return manifest


ERROR_RULE_STATUSES = {
    "subscription_not_active": ("disabled", "revoked", "inactive"),
    "subscription_expired": ("expired",),
    "subscription_license_not_active": ("limited", "disabled", "inactive"),
    "subscription_license_expired": ("expired",),
}

UNSAFE_RULE_RESPONSE_HEADERS = {
    "cache-control",
    "content-disposition",
    "content-length",
    "set-cookie",
    "transfer-encoding",
    "x-lumen-render-target",
}


async def _response_rule_for_error(
    session: AsyncSession,
    error: APIError,
) -> Response | None:
    trigger_statuses = ERROR_RULE_STATUSES.get(error.code)
    if not trigger_statuses:
        return None
    rules = await list_response_rules(session)
    rule = next(
        (
            item
            for item in rules
            if item.enabled and item.trigger_status.lower() in trigger_statuses
        ),
        None,
    )
    if rule is None:
        return None

    headers = {
        key: value
        for key, value in rule.headers.items()
        if key.lower() not in UNSAFE_RULE_RESPONSE_HEADERS
    }
    headers["cache-control"] = "no-store"
    headers["x-lumen-response-rule-id"] = rule.id
    return Response(
        content=rule.body,
        status_code=rule.status_code,
        media_type="text/plain; charset=utf-8",
        headers=headers,
    )


async def _apply_subscription_template(
    session: AsyncSession,
    rendered: RenderedSubscription,
    *,
    render_target: str,
) -> RenderedSubscription:
    template_format = _template_format_for_target(render_target)
    if template_format is None:
        return rendered
    templates = await list_templates(session)
    template = next(
        (
            item
            for item in templates
            if item.status.lower() == "active" and item.format == template_format
        ),
        None,
    )
    if template is None:
        return rendered

    content = template.content_json
    body = rendered.body
    prepend = content.get("prepend")
    append = content.get("append")
    allow_body_wrapping = not _is_json_content_type(rendered.content_type)
    if allow_body_wrapping and isinstance(prepend, str) and prepend:
        body = f"{prepend}{body}"
    if allow_body_wrapping and isinstance(append, str) and append:
        body = f"{body}{append}"

    headers = dict(rendered.headers)
    template_headers = content.get("headers")
    if isinstance(template_headers, dict):
        for key, value in template_headers.items():
            normalized_key = str(key).lower()
            if normalized_key in {
                "cache-control",
                "content-disposition",
                "set-cookie",
                "x-lumen-render-target",
            }:
                continue
            if isinstance(value, str):
                headers[str(key)] = value
    headers["x-lumen-template-id"] = template.id

    content_type = rendered.content_type
    if isinstance(content.get("content_type"), str) and content["content_type"]:
        content_type = str(content["content_type"])
    filename = rendered.filename
    if isinstance(content.get("filename"), str) and content["filename"]:
        filename = str(content["filename"])

    return RenderedSubscription(
        body=body,
        content_type=content_type,
        filename=filename,
        headers=headers,
    )


def _is_json_content_type(content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip().lower() in {
        "application/json",
        "application/x-json",
    }


def _template_format_for_target(render_target: str) -> str | None:
    if render_target in {"mihomo", "clash-meta", "clash", "flclash", "koala-clash"}:
        return "mihomo" if render_target == "mihomo" else "clash"
    if render_target == "stash":
        return "stash"
    if render_target in {"sing-box", "nekobox", "nekoray"}:
        return "sing_box"
    if render_target in {
        "raw-uri",
        "v2ray",
        "v2ray-base64",
        "v2rayn",
        "v2rayng",
        "streisand",
        "shadowrocket",
        "hiddify",
        "happ",
    }:
        return "raw_uri"
    if render_target in {"xray-json", "amnezia"}:
        return "xray_json"
    return None
