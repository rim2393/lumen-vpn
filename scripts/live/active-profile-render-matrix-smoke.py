from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import ssl
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import get_settings
from app.db.session import create_engine
from app.domains.licenses.models import License
from app.domains.licenses.service import hash_license_key
from app.domains.nodes.models import Node
from app.domains.protocols.models import Host, ProtocolProfile
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.service import create_subscription_public_id
from app.domains.users.models import User


PANEL_PUBLIC_URL = os.environ.get("PANEL_PUBLIC_URL", "https://panel.lumentech.tel").rstrip("/")
QA_TAG = "qa-active-render-matrix"
RAW_TARGETS = {
    "raw-uri",
    "v2ray",
    "v2rayn",
    "v2rayng",
    "streisand",
    "shadowrocket",
    "hiddify",
    "happ",
}
MIHOMO_TARGETS = {"mihomo", "clash-meta", "clash", "flclash", "stash", "koala-clash"}
SING_BOX_TARGETS = {"sing-box", "nekobox", "nekoray"}
XRAY_TARGETS = {"xray-json", "amnezia"}
TARGETS = [
    "lumen-json",
    *sorted(RAW_TARGETS),
    "v2ray-base64",
    *sorted(MIHOMO_TARGETS),
    *sorted(SING_BOX_TARGETS),
    *sorted(XRAY_TARGETS),
]
STRUCTURED_TARGETS = MIHOMO_TARGETS | SING_BOX_TARGETS | XRAY_TARGETS


def _http_get(url: str) -> tuple[int, dict[str, str], str]:
    request = Request(
        url,
        headers={
            "User-Agent": "Lumen-active-profile-render-matrix/1.0",
            "X-Lumen-HWID": "qa-active-render-matrix",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=20, context=ssl.create_default_context()) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, {key.lower(): value for key, value in response.headers.items()}, body
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, {key.lower(): value for key, value in exc.headers.items()}, body


def _assert_success_contract(*, adapter: str, target: str, headers: dict[str, str], body: str) -> None:
    if headers.get("x-lumen-render-target") != target:
        raise AssertionError(f"{adapter}/{target}: missing normalized render target header")
    if "subscription-userinfo" not in headers:
        raise AssertionError(f"{adapter}/{target}: missing subscription-userinfo")
    lowered = body.lower()
    forbidden = ("skeleton", "placeholder", "access_token")
    if target != "lumen-json":
        forbidden = (*forbidden, "credentialsref")
        if not adapter.startswith("wireguard"):
            forbidden = (*forbidden, "privatekey", "private_key", "secretkey")
    if any(marker in lowered for marker in forbidden):
        raise AssertionError(f"{adapter}/{target}: forbidden marker leaked")
    if target == "lumen-json":
        parsed = json.loads(body)
        protocols = parsed.get("nodes", [{}])[0].get("protocols", [])
        if not protocols or protocols[0].get("adapter") != adapter:
            raise AssertionError(f"{adapter}/{target}: manifest does not reference live adapter")
    elif target == "v2ray-base64":
        decoded = base64.b64decode(body.strip()).decode("utf-8")
        if not decoded.strip():
            raise AssertionError(f"{adapter}/{target}: empty base64 payload")
    elif target in RAW_TARGETS:
        if not body.strip():
            raise AssertionError(f"{adapter}/{target}: empty raw payload")
    elif target in MIHOMO_TARGETS:
        if "proxies:" not in body:
            raise AssertionError(f"{adapter}/{target}: missing Mihomo proxies section")
    elif target in SING_BOX_TARGETS:
        parsed = json.loads(body)
        if not parsed.get("outbounds"):
            raise AssertionError(f"{adapter}/{target}: missing sing-box outbounds")
    elif target in XRAY_TARGETS:
        parsed = json.loads(body)
        if not parsed.get("outbounds"):
            raise AssertionError(f"{adapter}/{target}: missing Xray outbounds")


def _assert_expected_unsupported(*, adapter: str, target: str, status: int, body: str) -> bool:
    if status != 422 or target not in STRUCTURED_TARGETS:
        return False
    parsed = json.loads(body)
    code = parsed.get("error", {}).get("code")
    if code != "subscription_render_target_unsupported_for_protocol":
        raise AssertionError(f"{adapter}/{target}: unexpected 422 code {code!r}")
    return True


async def _live_bindings(session) -> list[tuple[ProtocolProfile, Host]]:
    result = await session.execute(
        select(ProtocolProfile, Host)
        .join(Host, Host.protocol_profile_id == ProtocolProfile.id)
        .join(Node, Node.id == ProtocolProfile.node_id)
        .where(Node.name == "node-01")
        .where(Node.status == "active")
        .where(ProtocolProfile.status == "active")
        .where(Host.status == "active")
        .where(Host.hidden.is_(False))
        .where(Host.subscription_excluded.is_(False))
        .order_by(ProtocolProfile.adapter.asc(), ProtocolProfile.created_at.asc(), Host.created_at.asc())
    )
    bindings: dict[str, tuple[ProtocolProfile, Host]] = {}
    for profile, host in result:
        bindings.setdefault(profile.adapter, (profile, host))
    return list(bindings.values())


async def main() -> None:
    run_id = f"{QA_TAG}-{secrets.token_hex(6)}"
    settings = get_settings()
    engine = create_engine(settings)
    sessionmaker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    created_ids: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    try:
        async with sessionmaker() as session:
            bindings = await _live_bindings(session)
            if not bindings:
                raise RuntimeError("No active real profile+host bindings exist on node-01")
            for profile, host in bindings:
                user = User(
                    email=f"{run_id}-{profile.adapter}@example.test",
                    username=f"{run_id}-{profile.adapter}",
                    display_name=f"Active render matrix {profile.adapter}",
                    status="active",
                    traffic_limit_gb=500,
                    traffic_used_gb=0,
                    device_limit=10,
                    expires_at=datetime.now(UTC) + timedelta(hours=6),
                    tags=["qa", "render-matrix"],
                    metadata_json={"qa": QA_TAG, "run": run_id, "adapter": profile.adapter},
                )
                session.add(user)
                await session.flush()

                license_record = License(
                    license_key_hash=hash_license_key(f"{run_id}-{profile.adapter}-license"),
                    customer_ref=f"{run_id}-{profile.adapter}",
                    status="active",
                    max_devices=10,
                    starts_at=datetime.now(UTC) - timedelta(minutes=1),
                    expires_at=datetime.now(UTC) + timedelta(hours=6),
                    metadata_json={"qa": QA_TAG, "run": run_id, "adapter": profile.adapter},
                )
                session.add(license_record)
                await session.flush()

                public_id = await create_subscription_public_id(session)
                subscription = Subscription(
                    public_id=public_id,
                    user_id=user.id,
                    license_id=license_record.id,
                    node_id=profile.node_id,
                    status="active",
                    delivery_profile={
                        "protocol": profile.adapter,
                        "adapter": profile.adapter,
                        "profile_id": str(profile.id),
                        "host_id": str(host.id),
                        "profile_title": f"Lumen Active Matrix {profile.adapter}",
                        "traffic_limit_gb": "500",
                        "client": ",".join(TARGETS),
                    },
                    config_hash=f"sha256:{run_id}:{profile.adapter}",
                    expires_at=datetime.now(UTC) + timedelta(hours=6),
                )
                session.add(subscription)
                await session.flush()
                created_ids.append(
                    {
                        "adapter": profile.adapter,
                        "subscription": subscription.id,
                        "license": license_record.id,
                        "user": user.id,
                        "public_id": public_id,
                    }
                )
            await session.commit()

        for record in created_ids:
            adapter = record["adapter"]
            adapter_results = {"adapter": adapter, "ok": 0, "expected_422": 0}
            for target in TARGETS:
                url = f"{PANEL_PUBLIC_URL}/api/v1/subscriptions/public/{record['public_id']}/render?target={target}"
                status, headers, body = _http_get(url)
                if status == 200:
                    _assert_success_contract(adapter=adapter, target=target, headers=headers, body=body)
                    adapter_results["ok"] += 1
                elif _assert_expected_unsupported(adapter=adapter, target=target, status=status, body=body):
                    adapter_results["expected_422"] += 1
                else:
                    raise AssertionError(f"{adapter}/{target}: unexpected status {status}")
            results.append(adapter_results)

        async with sessionmaker() as session:
            await _cleanup(session, created_ids)
            leftovers = await _leftovers(session, run_id)
            await session.commit()
        print(
            json.dumps(
                {
                    "ok": True,
                    "profiles_checked": len(results),
                    "targets_per_profile": len(TARGETS),
                    "results": results,
                    "cleanup_leftovers": leftovers,
                },
                ensure_ascii=False,
            )
        )
    finally:
        if created_ids:
            async with sessionmaker() as session:
                await _cleanup(session, created_ids)
                await session.commit()
        await engine.dispose()


async def _cleanup(session, records: list[dict[str, Any]]) -> None:
    for record in records:
        await session.execute(delete(Subscription).where(Subscription.id == record["subscription"]))
        await session.execute(delete(License).where(License.id == record["license"]))
        await session.execute(delete(User).where(User.id == record["user"]))


async def _leftovers(session, run_id: str) -> dict[str, int]:
    return {
        "subscriptions": (
            await session.execute(
                select(func.count()).select_from(Subscription).where(Subscription.config_hash.like(f"sha256:{run_id}:%"))
            )
        ).scalar_one(),
        "licenses": (
            await session.execute(
                select(func.count()).select_from(License).where(License.customer_ref.like(f"{run_id}-%"))
            )
        ).scalar_one(),
        "users": (
            await session.execute(select(func.count()).select_from(User).where(User.username.like(f"{run_id}-%")))
        ).scalar_one(),
    }


if __name__ == "__main__":
    asyncio.run(main())
