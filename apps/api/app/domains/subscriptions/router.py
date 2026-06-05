# ruff: noqa: E501, RUF001
import json
from html import escape as html_escape
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
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
    SubscriptionDeviceListResponse,
    SubscriptionIssueFromProfileRequest,
    SubscriptionListResponse,
    SubscriptionResponse,
    SubscriptionUpdateRequest,
)
from app.domains.subscriptions.service import (
    build_public_subscription_manifest,
    build_subscription_manifest,
    clone_subscription,
    delete_subscription,
    enforce_public_subscription_device,
    get_subscription_by_public_id,
    get_subscription_by_short_uuid,
    issue_subscription_from_profile,
    list_subscription_devices,
    lookup_subscriptions,
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


@router.post(
    "/actions/issue-from-profile",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def issue_subscription_from_profile_route(
    request: SubscriptionIssueFromProfileRequest,
    principal: SubscriptionManager,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await issue_subscription_from_profile(session, request=request)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription.issued_from_profile",
        resource_type="subscription",
        resource_id=str(subscription.id),
        metadata_json={
            "profile_id": str(request.profile_id),
            "host_id": str(request.host_id) if request.host_id else None,
            "user_id": str(request.user_id),
            "license_id": str(request.license_id),
        },
    )
    await session.commit()
    return subscription_to_response(subscription)


@router.get("/lookup", response_model=SubscriptionListResponse)
async def lookup_subscription_records(
    _: SubscriptionReader,
    session: DatabaseSession,
    query: str = Query(..., min_length=1, max_length=160),
) -> SubscriptionListResponse:
    subscriptions = await lookup_subscriptions(session, query=query)
    return SubscriptionListResponse(
        items=[subscription_to_response(subscription) for subscription in subscriptions]
    )


@router.get("/by-short-uuid/{short_uuid}", response_model=SubscriptionResponse)
async def get_subscription_by_short_uuid_route(
    short_uuid: str,
    _: SubscriptionReader,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await get_subscription_by_short_uuid(session, short_uuid=short_uuid)
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


@router.post(
    "/{subscription_id}/clone",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def clone_subscription_route(
    subscription_id: UUID,
    principal: SubscriptionManager,
    session: DatabaseSession,
) -> SubscriptionResponse:
    subscription = await clone_subscription(session, subscription_id=subscription_id)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription.cloned",
        resource_type="subscription",
        resource_id=str(subscription.id),
        metadata_json={"source_subscription_id": str(subscription_id)},
    )
    await session.commit()
    return subscription_to_response(subscription)


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subscription_route(
    subscription_id: UUID,
    principal: SubscriptionManager,
    session: DatabaseSession,
) -> Response:
    subscription = await delete_subscription(session, subscription_id=subscription_id)
    await record_audit_event(
        session,
        principal=principal,
        action="subscription.deleted",
        resource_type="subscription",
        resource_id=str(subscription.id),
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/public/{public_id}/manifest", response_model=None)
async def get_public_subscription_manifest(
    public_id: str,
    request: Request,
    session: DatabaseSession,
    device_id: str | None = Query(default=None),
    hwid: str | None = Query(default=None),
    x_lumen_hwid: str | None = Header(default=None, alias="X-Lumen-HWID"),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
):
    try:
        manifest = await build_and_record_public_subscription_request(
            session,
            public_id=public_id,
            target="manifest",
            device_id=device_id or hwid or x_lumen_hwid or x_device_id,
            device_label=user_agent,
            client_ip=_public_client_ip(request),
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
    request: Request,
    session: DatabaseSession,
    settings: RuntimeSettings,
    target: str | None = Query(
        default=None,
        description=(
            "Client target or renderer format: raw-uri, hiddify, happ, mihomo, "
            "clash-meta, sing-box, v2ray, v2ray-base64, v2rayn, v2rayng, "
            "streisand, shadowrocket, xray-json, amnezia."
        ),
    ),
    render_format: str | None = Query(
        default=None,
        alias="format",
        description="Compatibility alias for target.",
    ),
    device_id: str | None = Query(default=None),
    hwid: str | None = Query(default=None),
    x_lumen_hwid: str | None = Header(default=None, alias="X-Lumen-HWID"),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    raw: bool = Query(default=False, description="Force raw client subscription output."),
) -> Response:
    try:
        render_target = normalize_render_target(target or render_format)
        manifest = await build_and_record_public_subscription_request(
            session,
            public_id=public_id,
            target=render_target,
            device_id=device_id or hwid or x_lumen_hwid or x_device_id,
            device_label=user_agent,
            client_ip=_public_client_ip(request),
        )
        await session.commit()
    except APIError as error:
        if rule_response := await _response_rule_for_error(session, error):
            return rule_response
        raise
    rendered = render_subscription_for_target(manifest, settings=settings, target=render_target)
    rendered = await _apply_subscription_template(session, rendered, render_target=render_target)
    if not raw and _wants_browser_subscription_page(request):
        return _subscription_browser_page(
            manifest,
            request=request,
            rendered=rendered,
            render_target=render_target,
        )
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


@router.get("/{subscription_id}/devices", response_model=SubscriptionDeviceListResponse)
async def get_subscription_devices(
    subscription_id: UUID,
    _: SubscriptionReader,
    session: DatabaseSession,
) -> SubscriptionDeviceListResponse:
    return SubscriptionDeviceListResponse(
        items=await list_subscription_devices(session, subscription_id=subscription_id)
    )


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


def _wants_browser_subscription_page(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "text/html" in accept.lower()


def _subscription_browser_page(
    manifest: dict[str, object],
    *,
    request: Request,
    rendered: RenderedSubscription,
    render_target: str,
) -> Response:
    subscription = _dict_value(manifest, "subscription")
    metadata = _dict_value(manifest, "metadata")
    provider = _dict_value(manifest, "provider")
    subpage = _dict_value(metadata, "subpage")
    raw_url = str(request.url.include_query_params(raw="1"))
    title = _string_value(subpage.get("title")) or _string_value(provider.get("name")) or "Lumen VPN"
    username = _string_value(subscription.get("id")) or "subscription"
    status = "Активна"
    expires_at = _string_value(subscription.get("expiresAt"))
    traffic_limit = _string_value(metadata.get("trafficLimitGb"))
    traffic_used = _string_value(metadata.get("trafficUsedGb")) or "0"
    traffic_label = (
        f"{html_escape(traffic_used)} GB / {html_escape(traffic_limit)} GB"
        if traffic_limit
        else f"{html_escape(traffic_used)} GB"
    )
    escaped_title = html_escape(title)
    escaped_username = html_escape(username)
    escaped_status = html_escape(status)
    escaped_expires = html_escape(_human_date(expires_at) if expires_at else "Не ограничено")
    escaped_raw = html_escape(raw_url, quote=True)
    encoded_raw = quote(raw_url, safe="")
    add_link = f"happ://add/{encoded_raw}" if render_target == "happ" else escaped_raw
    app_title = "Happ" if render_target == "happ" else render_target
    body = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escaped_title}</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh; color: #f4f7fb;
      background: radial-gradient(circle at 30% 0%, #1b2441 0, #101720 42%, #0c1118 100%);
    }}
    body::before {{
      content: ""; position: fixed; inset: 0;
      background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 64px 64px; pointer-events: none;
    }}
    main {{ position: relative; width: min(760px, calc(100% - 28px)); margin: 0 auto; padding: 36px 0 64px; }}
    header {{ display: flex; align-items: center; justify-content: space-between; padding: 18px 0 34px; }}
    .brand {{ display: flex; align-items: center; gap: 12px; color: #43d9f5; font-size: 24px; font-weight: 800; }}
    .mark {{ width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg,#35e4ff,#1468ff); }}
    .telegram {{ color: #41d9ff; border: 1px solid #263545; border-radius: 10px; padding: 12px 14px; text-decoration: none; }}
    section {{ border: 1px solid #293341; background: rgba(19,25,35,.86); border-radius: 16px; padding: 28px 32px; margin-bottom: 28px; box-shadow: 0 18px 60px rgba(0,0,0,.24); }}
    .summary {{ display: grid; grid-template-columns: 48px 1fr; gap: 18px; align-items: start; }}
    .ok {{ display: grid; place-items: center; width: 48px; height: 48px; color: #42e0b5; border: 1px solid #168467; background: rgba(20,124,95,.18); border-radius: 50%; font-size: 24px; }}
    h1 {{ margin: 0 0 4px; font-size: 22px; }}
    .muted {{ color: #9aa6b5; margin: 0; }}
    .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 22px; }}
    .metric {{ border: 1px solid #304052; border-radius: 9px; padding: 12px; background: rgba(28,38,52,.68); }}
    .metric b {{ display: block; margin-top: 6px; }}
    .metric.blue {{ border-color: #245c91; background: rgba(28,66,103,.45); }}
    .metric.green {{ border-color: #1d7d51; background: rgba(22,82,54,.38); }}
    .metric.red {{ border-color: #8b3444; background: rgba(86,32,47,.38); }}
    .metric.gold {{ border-color: #806321; background: rgba(82,64,24,.34); }}
    h2 {{ margin: 0 0 18px; font-size: 24px; }}
    .tabs {{ display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }}
    .tab {{ border: 1px solid #314457; color: #dce8f3; background: #1b2430; border-radius: 8px; padding: 12px 18px; font-weight: 700; }}
    .tab.active {{ color: #45e5ff; border-color: #1fc7e8; background: rgba(32,164,196,.18); }}
    .step {{ display: grid; grid-template-columns: 44px 1fr; gap: 18px; align-items: start; padding: 18px 20px; border: 1px solid #293645; border-radius: 14px; background: rgba(26,35,47,.78); margin-top: 14px; }}
    .icon {{ display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: rgba(32,172,204,.16); color: #48dfff; border: 1px solid #218fa5; }}
    .button {{ display: inline-flex; align-items: center; gap: 10px; margin-top: 14px; padding: 12px 18px; border-radius: 8px; background: #164d61; color: #54e7ff; border: 0; text-decoration: none; font-weight: 800; cursor: pointer; }}
    .button:hover {{ background: #1e637b; }}
    .raw {{ overflow-wrap: anywhere; color: #9fb0c1; font-size: 13px; margin-top: 12px; }}
    @media (max-width: 640px) {{ main {{ width: min(100% - 20px, 760px); padding-top: 20px; }} section {{ padding: 20px; }} .grid {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand"><span class="mark"></span><span>{escaped_title}</span></div>
      <a class="telegram" href="https://t.me/lumentech" rel="noreferrer">Telegram</a>
    </header>
    <section>
      <div class="summary">
        <div class="ok">✓</div>
        <div>
          <h1>{escaped_username}</h1>
          <p class="muted">Подписка готова к установке</p>
          <div class="grid">
            <div class="metric blue"><span>Имя пользователя</span><b>{escaped_username}</b></div>
            <div class="metric green"><span>Статус</span><b>{escaped_status}</b></div>
            <div class="metric red"><span>Истекает</span><b>{escaped_expires}</b></div>
            <div class="metric gold"><span>Трафик</span><b>{traffic_label}</b></div>
          </div>
        </div>
      </div>
    </section>
    <section>
      <h2>Установка</h2>
      <div class="tabs">
        <button class="tab active" type="button">{html_escape(app_title)}</button>
        <button class="tab" type="button">Hiddify</button>
        <button class="tab" type="button">Sing-box</button>
        <button class="tab" type="button">Amnezia</button>
      </div>
      <div class="step">
        <div class="icon">↓</div>
        <div>
          <h3>Установка приложения</h3>
          <p class="muted">Установите подходящий клиент для вашей платформы, затем добавьте подписку кнопкой ниже.</p>
          <a class="button" href="https://www.happ.su/main" target="_blank" rel="noreferrer">Открыть сайт приложения</a>
        </div>
      </div>
      <div class="step">
        <div class="icon">＋</div>
        <div>
          <h3>Добавление подписки</h3>
          <p class="muted">Нажмите кнопку ниже — приложение откроется, и подписка добавится автоматически.</p>
          <a class="button" href="{html_escape(add_link, quote=True)}">Добавить подписку</a>
          <button class="button" type="button" data-url="{escaped_raw}" onclick="navigator.clipboard.writeText(this.dataset.url)">Скопировать ссылку</button>
          <p class="raw">{escaped_raw}</p>
        </div>
      </div>
    </section>
  </main>
</body>
</html>
"""
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={
            **rendered.headers,
            "cache-control": "no-store",
            "content-disposition": 'inline; filename="subscription.html"',
            "x-lumen-render-target": render_target,
            "x-lumen-subscription-page": "browser",
        },
    )


def _dict_value(mapping: dict[str, object], key: str) -> dict[str, object]:
    value = mapping.get(key)
    return value if isinstance(value, dict) else {}


def _string_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _human_date(value: str) -> str:
    return value.split("T", 1)[0]


async def build_and_record_public_subscription_request(
    session: AsyncSession,
    *,
    public_id: str,
    target: str,
    device_id: str | None = None,
    device_label: str | None = None,
    client_ip: str | None = None,
) -> dict[str, object]:
    subscription = await get_subscription_by_public_id(session, public_id=public_id)
    device_result = await enforce_public_subscription_device(
        session,
        subscription=subscription,
        device_id=device_id,
        device_label=device_label,
    )
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
                **({"client_ip": client_ip} if client_ip else {}),
                **({"node_id": str(subscription.node_id)} if subscription.node_id else {}),
                **(
                    {
                        "device_id": str(device_result["device_id"]),
                        "device_status": str(device_result["device_status"]),
                    }
                    if device_result is not None
                    else {}
                ),
            },
        ),
    )
    return manifest


def _public_client_ip(request: Request) -> str | None:
    for header in ("CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"):
        value = request.headers.get(header)
        if not value:
            continue
        candidate = value.split(",", 1)[0].strip()
        if candidate:
            return candidate
    return request.client.host if request.client else None


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
    if not allow_body_wrapping:
        body = _apply_json_template_merge(body, content)
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


def _apply_json_template_merge(body: str, content: dict[str, object]) -> str:
    merge = content.get("merge")
    if not isinstance(merge, dict) or not merge:
        return body
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        return body
    merged = _deep_merge_json(parsed, merge)
    return f"{json.dumps(merged, indent=2, ensure_ascii=False)}\n"


def _deep_merge_json(
    base: dict[str, object],
    patch: dict[str, object],
) -> dict[str, object]:
    merged = dict(base)
    for key, value in patch.items():
        existing = merged.get(key)
        if isinstance(existing, dict) and isinstance(value, dict):
            merged[key] = _deep_merge_json(existing, value)
        else:
            merged[key] = value
    return merged


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
