# ruff: noqa: E501, RUF001
import json
from html import escape as html_escape
from typing import Annotated
from urllib.parse import quote, urlencode
from uuid import UUID

import segno
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
public_subscription_router = APIRouter()
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
    render_target = normalize_render_target(target or render_format)
    return await _render_public_subscription_request(
        public_id=public_id,
        request=request,
        session=session,
        settings=settings,
        render_target=render_target,
        device_id=device_id,
        hwid=hwid,
        x_lumen_hwid=x_lumen_hwid,
        x_device_id=x_device_id,
        user_agent=user_agent,
        raw=raw,
    )


@public_subscription_router.get("/sub/{public_id}")
@public_subscription_router.get("/sub/{public_id}/{target_path}")
async def render_short_public_subscription(
    public_id: str,
    request: Request,
    session: DatabaseSession,
    settings: RuntimeSettings,
    target_path: str | None = None,
    target: str | None = Query(default=None),
    render_format: str | None = Query(default=None, alias="format"),
    device_id: str | None = Query(default=None),
    hwid: str | None = Query(default=None),
    x_lumen_hwid: str | None = Header(default=None, alias="X-Lumen-HWID"),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    raw: bool = Query(default=False, description="Force raw client subscription output."),
) -> Response:
    render_target = normalize_render_target(target_path or target or render_format or "happ")
    return await _render_public_subscription_request(
        public_id=public_id,
        request=request,
        session=session,
        settings=settings,
        render_target=render_target,
        device_id=device_id,
        hwid=hwid,
        x_lumen_hwid=x_lumen_hwid,
        x_device_id=x_device_id,
        user_agent=user_agent,
        raw=raw,
    )


async def _render_public_subscription_request(
    *,
    public_id: str,
    request: Request,
    session: AsyncSession,
    settings: Settings,
    render_target: str,
    device_id: str | None,
    hwid: str | None,
    x_lumen_hwid: str | None,
    x_device_id: str | None,
    user_agent: str | None,
    raw: bool,
) -> Response:
    try:
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
        if (
            error.code == "subscription_device_id_required"
            and not raw
            and _wants_browser_subscription_page(request)
        ):
            return _subscription_device_binding_page(
                request=request,
                public_id=public_id,
                render_target=render_target,
            )
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


def _public_request_url_with_query(request: Request, **query_params: str) -> str:
    url = request.url.include_query_params(**query_params)
    return _public_url_from_request_url(request, url)


def _public_subscription_page_url(request: Request, public_id: str) -> str:
    query_items = [
        (key, value)
        for key, value in request.query_params.multi_items()
        if key in {"device_id", "hwid"}
    ]
    url = request.url.replace(
        path=f"/sub/{quote(public_id, safe='')}",
        query=urlencode(query_items),
    )
    return _public_url_from_request_url(request, url)


def _subscription_import_url(subscription_url: str, render_target: str) -> str:
    if render_target == "happ":
        return f"happ://add/{quote(subscription_url, safe='')}"
    return subscription_url


def _public_url_from_request_url(request: Request, url: object) -> str:
    scheme = (request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip()
    host = (
        (request.headers.get("x-forwarded-host") or "").split(",", 1)[0].strip()
        or request.headers.get("host")
    )
    if scheme or host:
        url = url.replace(scheme=scheme or url.scheme, netloc=host or url.netloc)
    return str(url)


def _public_subscription_target_url(request: Request, target: str) -> str:
    query_items = [
        (key, value)
        for key, value in request.query_params.multi_items()
        if key not in {"format", "raw", "target"}
    ]
    query_items.append(("target", target))
    return _public_url_from_request_url(
        request,
        request.url.replace(query=urlencode(query_items)),
    )


def _public_subscription_short_target_url(
    request: Request,
    *,
    public_id: str,
    target: str,
    raw: bool = False,
) -> str:
    query_items = [
        (key, value)
        for key, value in request.query_params.multi_items()
        if key in {"device_id", "hwid"}
    ]
    if raw:
        query_items.append(("raw", "1"))
    url = request.url.replace(
        path=f"/sub/{quote(public_id, safe='')}/{quote(target, safe='')}",
        query=urlencode(query_items),
    )
    return _public_url_from_request_url(request, url)


def _subscription_qr_svg(value: str) -> str:
    qr = segno.make(value, error="q")
    width, height = qr.symbol_size(scale=7, border=4)
    svg = qr.svg_inline(scale=7, border=4)
    return svg.replace(
        "<svg ",
        f'<svg viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" ',
        1,
    )


def _subscription_device_binding_page(
    *,
    request: Request,
    public_id: str,
    render_target: str,
) -> Response:
    current_url = _public_url_from_request_url(request, request.url)
    storage_key = f"lumen-sub-device:{public_id}"
    escaped_current_url = html_escape(current_url, quote=True)
    escaped_storage_key = html_escape(storage_key, quote=True)
    escaped_target = html_escape(render_target, quote=True)
    body = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lumen subscription device binding</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center; color: #f4f7fb;
      background: radial-gradient(circle at 30% 0%, #1b2441 0, #101720 42%, #0c1118 100%);
    }}
    body::before {{
      content: ""; position: fixed; inset: 0;
      background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 64px 64px; pointer-events: none;
    }}
    main {{ position: relative; width: min(520px, calc(100% - 28px)); border: 1px solid #293341; background: rgba(19,25,35,.9); border-radius: 16px; padding: 28px; box-shadow: 0 18px 60px rgba(0,0,0,.24); }}
    .mark {{ width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg,#35e4ff,#1468ff); margin-bottom: 18px; }}
    h1 {{ margin: 0 0 10px; font-size: 24px; }}
    p {{ margin: 0; color: #a7b2c2; line-height: 1.55; }}
    a {{ color: #54e7ff; }}
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true"></div>
    <h1>Готовим привязку устройства</h1>
    <p>Сейчас страница подписки откроется заново с постоянным идентификатором этого браузера. Это нужно для лимита устройств и HWID-политики.</p>
    <p><a href="{escaped_current_url}">Продолжить вручную</a></p>
  </main>
  <script>
    (() => {{
      const storageKey = "{escaped_storage_key}";
      const target = "{escaped_target}";
      const generateId = () => {{
        if (globalThis.crypto?.randomUUID) {{
          return `web-${{globalThis.crypto.randomUUID()}}`;
        }}
        const random = Math.random().toString(36).slice(2);
        return `web-${{Date.now().toString(36)}}-${{random}}`;
      }};
      let deviceId = "";
      try {{
        deviceId = localStorage.getItem(storageKey) || "";
        if (!deviceId) {{
          deviceId = generateId();
          localStorage.setItem(storageKey, deviceId);
        }}
      }} catch {{
        deviceId = generateId();
      }}
      const url = new URL(globalThis.location.href);
      if (!url.searchParams.get("hwid") && !url.searchParams.get("device_id")) {{
        url.searchParams.set("hwid", deviceId);
      }}
      if (target && !url.searchParams.get("target") && url.pathname.endsWith("/render")) {{
        url.searchParams.set("target", target);
      }}
      globalThis.location.replace(url.toString());
    }})();
  </script>
</body>
</html>
"""
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={
            "cache-control": "no-store",
            "content-disposition": 'inline; filename="subscription-device.html"',
            "x-lumen-subscription-page": "device-binding",
            "x-lumen-render-target": render_target,
        },
    )


def _subscription_target_tabs(request: Request, public_id: str, current_target: str) -> str:
    targets = (
        ("happ", "Happ"),
        ("hiddify", "Hiddify"),
        ("sing-box", "Sing-box"),
        ("amnezia", "Amnezia"),
    )
    tabs: list[str] = []
    for target, label in targets:
        class_name = "tab active" if target == current_target else "tab"
        href = html_escape(
            _public_subscription_short_target_url(request, public_id=public_id, target=target),
            quote=True,
        )
        aria_current = ' aria-current="page"' if target == current_target else ""
        tabs.append(f'<a class="{class_name}" href="{href}"{aria_current}>{html_escape(label)}</a>')
    return "".join(tabs)


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
    title = _string_value(subpage.get("title")) or _string_value(provider.get("name")) or "Lumen VPN"
    username = _string_value(subscription.get("id")) or "subscription"
    subscription_url = _public_subscription_page_url(request, username)
    status = "\u0410\u043a\u0442\u0438\u0432\u043d\u0430"
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
    escaped_expires = html_escape(
        _human_date(expires_at)
        if expires_at
        else "\u041d\u0435 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u043e"
    )
    escaped_raw = html_escape(subscription_url, quote=True)
    raw_subscription_url = _public_subscription_short_target_url(
        request,
        public_id=username,
        target=render_target,
        raw=True,
    )
    escaped_raw_subscription_url = html_escape(raw_subscription_url, quote=True)
    add_link = _subscription_import_url(subscription_url, render_target)
    escaped_add_link = html_escape(add_link, quote=True)
    tabs_html = _subscription_target_tabs(request, username, render_target)
    qr_svg = _subscription_qr_svg(subscription_url)
    client_label = {
        "happ": "Happ",
        "hiddify": "Hiddify",
        "sing-box": "Sing-box",
        "amnezia": "Amnezia",
    }.get(render_target, render_target)
    body = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escaped_title}</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #111722;
      --bg-soft: #151c29;
      --surface: #1a2230;
      --surface-strong: #202938;
      --line: #2d394b;
      --line-strong: #3d5068;
      --ink: #eef5fb;
      --muted: #98a7ba;
      --muted-strong: #bdc8d6;
      --accent: #22d3ee;
      --accent-soft: rgb(34 211 238 / 12%);
      --success: #2ed4a2;
      --warning: #e5c05f;
      --shadow: 0 24px 70px rgb(0 0 0 / 26%);
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    html {{ min-height: 100%; background: var(--bg); }}
    body {{
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      color: var(--ink);
      background:
        linear-gradient(90deg, rgb(255 255 255 / 3.5%) 1px, transparent 1px),
        linear-gradient(180deg, rgb(255 255 255 / 3.5%) 1px, transparent 1px),
        radial-gradient(circle at 50% -120px, rgb(34 211 238 / 14%), transparent 42%),
        linear-gradient(180deg, #121925 0%, #111722 52%, #10151f 100%);
      background-size: 64px 64px, 64px 64px, auto, auto;
      font-synthesis: none;
      -webkit-font-smoothing: antialiased;
    }}
    a, button {{ font: inherit; }}
    button {{ cursor: pointer; }}
    a {{ color: inherit; }}
    h1, h2, h3, p {{ margin: 0; }}
    h1, h2, h3 {{ color: var(--ink); line-height: 1.12; letter-spacing: 0; }}
    main {{
      width: min(760px, calc(100% - 28px));
      margin: 0 auto;
      padding: 26px 0 64px;
    }}
    .topbar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 70px;
      padding: 14px 18px;
      background: rgb(26 34 48 / 74%);
      border: 1px solid var(--line);
      border-radius: 0 0 var(--radius-lg) var(--radius-lg);
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }}
    .brand {{
      display: inline-flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      text-decoration: none;
    }}
    .brand-mark {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      color: var(--accent);
      background: rgb(34 211 238 / 10%);
      border: 1px solid rgb(34 211 238 / 30%);
      border-radius: var(--radius-sm);
    }}
    .brand-text {{
      display: grid;
      gap: 2px;
      min-width: 0;
      line-height: 1;
    }}
    .brand-text strong {{
      overflow: hidden;
      color: var(--accent);
      font-size: 1.06rem;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}
    .brand-text span {{
      color: var(--muted);
      font-size: .78rem;
      font-weight: 700;
    }}
    .top-actions {{
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }}
    .button {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      min-height: 42px;
      padding: 0 17px;
      color: var(--ink);
      font-weight: 800;
      text-decoration: none;
      background: rgb(20 29 43 / 94%);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }}
    .button:hover {{ transform: translateY(-1px); border-color: var(--line-strong); }}
    .button.primary {{
      color: #dffaff;
      background: linear-gradient(180deg, #146b7f, #125267);
      border-color: #1d95b4;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 12%);
    }}
    .button svg {{ width: 17px; height: 17px; flex: 0 0 auto; }}
    .button[aria-disabled="true"] {{
      pointer-events: none;
      opacity: .72;
    }}
    .page-head {{
      display: grid;
      gap: 8px;
      padding: 34px 0 16px;
      text-align: center;
    }}
    .page-head > * {{ min-width: 0; }}
    .eyebrow {{
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: .72rem;
      font-weight: 800;
      text-transform: uppercase;
    }}
    h1 {{
      margin-top: 6px;
      overflow-wrap: anywhere;
      font-size: clamp(1.8rem, 4.4vw, 2.45rem);
      font-weight: 900;
    }}
    .lead {{
      max-width: 58ch;
      margin: 9px auto 0;
      color: var(--muted);
      font-size: .95rem;
      font-weight: 600;
      line-height: 1.55;
    }}
    .status-badge {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      min-height: 32px;
      margin: 14px auto 0;
      padding: 0 12px;
      color: var(--success);
      font-size: .82rem;
      font-weight: 800;
      background: rgb(46 212 162 / 10%);
      border: 1px solid rgb(46 212 162 / 30%);
      border-radius: var(--radius-sm);
    }}
    .status-badge::before {{
      width: 8px;
      height: 8px;
      content: "";
      background: var(--success);
      border-radius: 999px;
      box-shadow: 0 0 18px var(--success);
    }}
    .metrics {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 22px;
      margin: 18px 0 32px;
      background: rgb(26 34 48 / 88%);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
    }}
    .metric, .panel {{ border: 1px solid var(--line); box-shadow: var(--shadow); }}
    .metric {{
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      min-height: 78px;
      padding: 13px;
      background: linear-gradient(180deg, rgb(255 255 255 / 4%), rgb(255 255 255 / 2%));
      border-radius: var(--radius-sm);
    }}
    .metric-icon, .step-icon {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      color: var(--accent);
      background: var(--accent-soft);
      border: 1px solid rgb(34 211 238 / 22%);
      border-radius: var(--radius-sm);
    }}
    .metric-icon svg, .step-icon svg {{ width: 18px; height: 18px; }}
    .metric span {{
      color: var(--muted);
      font-size: .78rem;
      font-weight: 800;
    }}
    .metric strong {{
      display: block;
      margin-top: 5px;
      overflow-wrap: anywhere;
      color: var(--ink);
      font-size: 1.02rem;
      line-height: 1.14;
    }}
    .panel {{
      padding: 28px 32px 30px;
      background: rgb(26 34 48 / 90%);
      border-radius: var(--radius-lg);
    }}
    .panel-head {{
      display: grid;
      gap: 14px;
      padding-bottom: 16px;
    }}
    h2 {{ font-size: 1.38rem; font-weight: 900; }}
    .tabs {{
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .tab {{
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 16px;
      color: var(--muted-strong);
      font-weight: 800;
      text-decoration: none;
      background: rgb(20 29 43 / 92%);
      border: 1px solid #324358;
      border-radius: var(--radius-sm);
    }}
    .tab:hover {{ color: var(--ink); border-color: var(--line-strong); }}
    .tab.active {{
      color: #dbfbff;
      background: rgb(34 211 238 / 12%);
      border-color: var(--accent);
    }}
    .install-grid {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 300px);
      gap: 16px;
      margin-top: 16px;
    }}
    .steps {{
      display: grid;
      align-content: start;
      gap: 12px;
    }}
    .step {{
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr);
      gap: 14px;
      min-width: 0;
      padding: 18px;
      background: rgb(20 29 43 / 84%);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }}
    .step h3 {{ font-size: 1rem; }}
    .muted {{ margin-top: 7px; color: var(--muted); line-height: 1.5; }}
    .step-actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 14px;
    }}
    .qr-panel {{
      display: grid;
      align-content: start;
      gap: 14px;
      align-self: start;
      padding: 18px;
      background: rgb(20 29 43 / 84%);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }}
    .qr-top {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }}
    .qr-top span {{
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: .72rem;
      font-weight: 800;
      text-transform: uppercase;
    }}
    .qr {{
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 1;
      padding: 24px;
      overflow: hidden;
      background: #fff;
      border: 1px solid #dce6ee;
      border-radius: 10px;
    }}
    .qr svg {{
      display: block;
      width: min(100%, 300px);
      max-width: calc(100% - 8px);
      max-height: calc(100% - 8px);
      height: auto;
      overflow: visible;
    }}
    .qr-actions {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-width: 0;
    }}
    .qr-status {{
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      min-height: 40px;
      padding: 0 12px;
      color: var(--ink);
      font-size: .82rem;
      font-weight: 800;
      background: rgb(15 23 35 / 82%);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }}
    .qr-status::before {{
      flex: 0 0 auto;
      width: 8px;
      height: 8px;
      content: "";
      background: var(--success);
      border-radius: 999px;
      box-shadow: 0 0 16px rgb(46 212 162 / 62%);
    }}
    .qr-status span {{
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}
    .import-status {{
      min-height: 20px;
      margin-top: 10px;
      color: var(--muted);
      font-size: .82rem;
      font-weight: 700;
    }}
    .import-status[data-state="opening"] {{ color: var(--accent); }}
    .import-status[data-state="fallback"] {{ color: var(--warning); }}
    .import-status[data-state="copied"] {{ color: var(--success); }}
    @media (max-width: 920px) {{
      .metrics {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    }}
    @media (max-width: 760px) {{
      .install-grid {{ grid-template-columns: 1fr; }}
      .qr-panel {{ max-width: 360px; width: 100%; margin: 0 auto; }}
    }}
    @media (max-width: 620px) {{
      main {{ width: min(100% - 18px, 760px); padding-top: 10px; }}
      .topbar {{ align-items: flex-start; flex-direction: column; border-radius: var(--radius-lg); }}
      .panel-head {{ align-items: flex-start; }}
      .top-actions, .tabs, .step-actions {{ width: 100%; }}
      .button, .tab {{ width: 100%; }}
      .metrics {{ grid-template-columns: 1fr; }}
      .panel, .metrics {{ padding: 16px; }}
      h1 {{ font-size: 1.7rem; }}
      .qr-panel {{ padding: 14px; }}
      .qr {{ padding: 20px; }}
      .qr svg {{ width: min(100%, 280px); }}
      .qr-actions {{ grid-template-columns: 1fr; }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      *, *::before, *::after {{ scroll-behavior: auto !important; transition: none !important; }}
    }}
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <a class="brand" href="{escaped_raw}">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M9 7h6"/><path d="M9 17h6"/></svg>
        </span>
        <span class="brand-text"><strong>{escaped_title}</strong><span>VPN subscription</span></span>
      </a>
      <nav class="top-actions" aria-label="Support links">
        <a class="button" href="https://t.me/lumentech" rel="noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          Telegram
        </a>
        <a class="button" href="{escaped_raw_subscription_url}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2"/></svg>
          Raw
        </a>
      </nav>
    </header>
    <div class="page-head">
      <div>
        <p class="eyebrow">Lumen public subscription</p>
        <h1>{escaped_username}</h1>
        <p class="lead">\u0413\u043e\u0442\u043e\u0432\u044b\u0439 \u043f\u0440\u043e\u0444\u0438\u043b\u044c \u0434\u043b\u044f {html_escape(client_label)}. \u0421\u043a\u0430\u043d\u0438\u0440\u0443\u0439\u0442\u0435 QR, \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0434\u0438\u043f\u043b\u0438\u043d\u043a \u0438\u043b\u0438 \u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439\u0442\u0435 raw URL.</p>
      </div>
      <span class="status-badge">{escaped_status}</span>
    </div>
    <section class="metrics" aria-label="Subscription summary">
      <article class="metric">
        <span class="metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
        <div><span>\u0421\u0442\u0430\u0442\u0443\u0441</span><strong>{escaped_status}</strong></div>
      </article>
      <article class="metric">
        <span class="metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v15H3V6a2 2 0 0 1 2-2Z"/></svg></span>
        <div><span>\u0418\u0441\u0442\u0435\u043a\u0430\u0435\u0442</span><strong>{escaped_expires}</strong></div>
      </article>
      <article class="metric">
        <span class="metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/></svg></span>
        <div><span>\u0422\u0440\u0430\u0444\u0438\u043a</span><strong>{traffic_label}</strong></div>
      </article>
      <article class="metric">
        <span class="metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg></span>
        <div><span>\u0424\u043e\u0440\u043c\u0430\u0442</span><strong>{html_escape(client_label)}</strong></div>
      </article>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>\u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438</h2>
        <div class="tabs">{tabs_html}</div>
      </div>
      <div class="install-grid">
        <div class="steps">
          <article class="step">
            <span class="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg></span>
            <div>
              <h3>\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430 \u043a\u043b\u0438\u0435\u043d\u0442\u0430</h3>
              <p class="muted">\u0415\u0441\u043b\u0438 {html_escape(client_label)} \u0435\u0449\u0435 \u043d\u0435 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d, \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0441\u0430\u0439\u0442 \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u0438 \u0432\u0435\u0440\u043d\u0438\u0442\u0435\u0441\u044c \u043a \u0438\u043c\u043f\u043e\u0440\u0442\u0443.</p>
              <div class="step-actions">
                <a class="button" href="https://www.happ.su/main" target="_blank" rel="noreferrer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
                  \u0421\u0430\u0439\u0442 \u043a\u043b\u0438\u0435\u043d\u0442\u0430
                </a>
              </div>
            </div>
          </article>
          <article class="step">
            <span class="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg></span>
            <div>
              <h3>\u0418\u043c\u043f\u043e\u0440\u0442</h3>
              <p class="muted">\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 deep link \u0438\u043b\u0438 \u043e\u0442\u0441\u043a\u0430\u043d\u0438\u0440\u0443\u0439\u0442\u0435 QR. \u0414\u043b\u044f \u0440\u0443\u0447\u043d\u043e\u0433\u043e \u043f\u0443\u0442\u0438 \u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439\u0442\u0435 raw URL.</p>
              <div class="step-actions">
                <a class="button primary" href="{escaped_add_link}" data-client-link data-client="{html_escape(client_label, quote=True)}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0443
                </a>
                <a class="button" href="{escaped_raw_subscription_url}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
                  Raw
                </a>
                <button class="button" type="button" data-url="{escaped_raw}" data-copy-url>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><rect x="3" y="3" width="13" height="13" rx="2"/></svg>
                  \u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c
                </button>
              </div>
              <p class="import-status" data-import-status>\u0415\u0441\u043b\u0438 \u043a\u043b\u0438\u0435\u043d\u0442 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u0441\u044f, \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 QR \u0438\u043b\u0438 Raw.</p>
            </div>
          </article>
        </div>
        <aside class="qr-panel">
          <div class="qr-top">
            <h3>QR</h3>
            <span>{html_escape(client_label)}</span>
          </div>
          <div class="qr" role="img" aria-label="QR subscription">{qr_svg}</div>
          <div class="qr-actions">
            <div class="qr-status" title="{escaped_raw}"><span>\u0421\u0441\u044b\u043b\u043a\u0430 \u0433\u043e\u0442\u043e\u0432\u0430 \u0434\u043b\u044f QR</span></div>
            <button class="button" type="button" data-url="{escaped_raw}" data-copy-url>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><rect x="3" y="3" width="13" height="13" rx="2"/></svg>
              \u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c
            </button>
          </div>
        </aside>
      </div>
    </section>
  </main>
  <script>
    (() => {{
      const status = document.querySelector('[data-import-status]');
      const setStatus = (message, state) => {{
        if (!status) return;
        status.textContent = message;
        status.dataset.state = state;
      }};
      document.querySelectorAll('[data-copy-url]').forEach((button) => {{
        button.addEventListener('click', async () => {{
          const value = button.dataset.url || '';
          try {{
            await navigator.clipboard.writeText(value);
            setStatus('\u0421\u0441\u044b\u043b\u043a\u0430 \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0430. \u0412\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u0435\u0451 \u0432 \u043a\u043b\u0438\u0435\u043d\u0442 \u0432\u0440\u0443\u0447\u043d\u0443\u044e.', 'copied');
          }} catch {{
            setStatus('\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043d\u0435 \u0434\u0430\u043b \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c. \u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 Raw \u0438 \u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439\u0442\u0435 URL.', 'fallback');
          }}
        }});
      }});
      document.querySelectorAll('[data-client-link]').forEach((link) => {{
        link.addEventListener('click', () => {{
          const client = link.dataset.client || '\u043a\u043b\u0438\u0435\u043d\u0442';
          setStatus(`\u041e\u0442\u043a\u0440\u044b\u0432\u0430\u044e ${{client}}. \u0415\u0441\u043b\u0438 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u0441\u044f, \u043e\u0442\u0441\u043a\u0430\u043d\u0438\u0440\u0443\u0439\u0442\u0435 QR \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 Raw.`, 'opening');
          window.setTimeout(() => {{
            if (document.visibilityState === 'visible') {{
              setStatus(`\u0415\u0441\u043b\u0438 ${{client}} \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u0441\u044f, \u043d\u0430\u0436\u043c\u0438\u0442\u0435 Raw \u0438\u043b\u0438 \u0441\u043a\u0430\u043d\u0438\u0440\u0443\u0439\u0442\u0435 QR.`, 'fallback');
            }}
          }}, 1600);
        }});
      }});
    }})();
  </script>
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
