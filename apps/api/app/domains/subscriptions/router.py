from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.audit.service import record_audit_event
from app.domains.subscriptions.renderers import (
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


@router.get("/public/{public_id}/manifest")
async def get_public_subscription_manifest(
    public_id: str,
    session: DatabaseSession,
) -> dict[str, object]:
    return await build_public_subscription_manifest(session, public_id=public_id)


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
    manifest = await build_public_subscription_manifest(session, public_id=public_id)
    render_target = normalize_render_target(target or render_format)
    rendered = render_subscription_for_target(manifest, settings=settings, target=render_target)
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
