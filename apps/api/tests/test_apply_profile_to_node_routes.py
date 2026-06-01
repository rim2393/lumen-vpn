from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, Role, get_current_principal
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.ip_control.models import IpControlRule
from app.domains.licenses.models import License
from app.domains.licenses.service import hash_license_key
from app.domains.node_plugins.models import NodePlugin
from app.domains.nodes.models import Node, NodeCommand
from app.domains.protocols.models import ProtocolProfile
from app.domains.subscriptions.models import Subscription
from app.domains.users.models import User
from app.main import create_app


@dataclass(frozen=True)
class RouteApp:
    client: AsyncClient
    sessionmaker: async_sessionmaker[AsyncSession]


@pytest.fixture
async def route_app(tmp_path) -> AsyncIterator[RouteApp]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
    )
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessionmaker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    async def override_principal() -> Principal:
        return Principal(
            subject="owner",
            email="owner@example.com",
            roles={Role.OWNER},
            permissions={Permission.NODE_MANAGE},
        )

    app = create_app(settings)
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[get_current_principal] = override_principal
    app.dependency_overrides[get_settings] = lambda: settings
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield RouteApp(client=client, sessionmaker=sessionmaker)
    app.dependency_overrides.clear()
    await engine.dispose()


async def _seed_profile(
    route_app: RouteApp,
    adapter: str,
    *,
    status: str = "active",
    with_subscription: bool = True,
) -> tuple[str, str]:
    async with route_app.sessionmaker() as session:
        node = Node(
            name=f"node-{adapter}-{uuid4().hex[:6]}",
            region="eu",
            public_address="203.0.113.90",
            status="active",
            capabilities={},
        )
        session.add(node)
        await session.flush()
        profile = ProtocolProfile(
            id=uuid4(),
            name=f"{adapter}-{uuid4().hex[:6]}",
            node_id=node.id,
            adapter=adapter,
            status=status,
            config_json={},
            port_reservations=[{"address": "0.0.0.0", "port": 443, "protocol": "udp"}],  # noqa: S104
            credentials_ref="vault://subscriptions/profile/creds",
        )
        session.add(profile)
        if with_subscription:
            user = User(email=f"{adapter}-{uuid4().hex[:8]}@example.test", status="active")
            license_record = License(
                license_key_hash=hash_license_key(f"{adapter}-{uuid4()}"),
                customer_ref=f"customer-{adapter}",
                status="active",
                max_devices=3,
                metadata_json={},
            )
            session.add_all([user, license_record])
            await session.flush()
            session.add(
                Subscription(
                    public_id=f"lumen_sub_{uuid4().hex}",
                    user_id=user.id,
                    license_id=license_record.id,
                    node_id=node.id,
                    status="active",
                    delivery_profile={
                        "profile_id": str(profile.id),
                        "protocol": adapter,
                        "adapter": adapter,
                    },
                    config_hash="sha256:test",
                )
            )
        await session.commit()
        return str(profile.id), str(node.id)


async def test_apply_hysteria2_profile_queues_outbound_apply(route_app: RouteApp) -> None:
    profile_id, node_id = await _seed_profile(route_app, "hysteria2")
    response = await route_app.client.post(f"/api/v1/profiles/{profile_id}/apply-to-node")
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["adapter"] == "hysteria2"
    assert body["node_id"] == node_id
    assert body["command_type"] == "outbound.apply"

    async with route_app.sessionmaker() as session:
        command = (
            await session.execute(
                select(NodeCommand).where(NodeCommand.node_id == UUID(node_id))
            )
        ).scalar_one()
        assert command.command_type == "outbound.apply"
        assert "hysteria2Config" in command.payload_json
        assert "clientsRef" not in command.payload_json["hysteria2Config"]
        assert command.payload_json["hysteria2Config"]["auth"]["password"]


async def test_apply_profile_includes_node_policy_and_xray_plugin_rules(
    route_app: RouteApp,
) -> None:
    profile_id, node_id = await _seed_profile(route_app, "vless-tcp-tls")
    async with route_app.sessionmaker() as session:
        session.add(
            NodePlugin(
                node_id=None,
                kind="torrent-blocker",
                name="Fleet torrent blocker",
                config_json={"mode": "block"},
                enabled=True,
            )
        )
        session.add(
            IpControlRule(
                name="global-ip-cap",
                scope="global",
                max_active_ips=2,
                action="block",
                enabled=True,
            )
        )
        await session.commit()

    response = await route_app.client.post(f"/api/v1/profiles/{profile_id}/apply-to-node")
    assert response.status_code == 202, response.text

    async with route_app.sessionmaker() as session:
        command = (
            await session.execute(
                select(NodeCommand).where(NodeCommand.node_id == UUID(node_id))
            )
        ).scalar_one()
        policy = command.payload_json["nodePolicy"]
        assert policy["modelVersion"] == "lumen.node-policy.v1"
        assert policy["ipControl"]["maxActiveIps"] == 2
        assert policy["plugins"][0]["kind"] == "torrent-blocker"
        xray_config = command.payload_json["xrayConfig"]
        assert "clientsRef" not in xray_config["inbounds"][0]["settings"]
        assert xray_config["inbounds"][0]["settings"]["clients"]
        assert {"tag": "blocked", "protocol": "blackhole"} in xray_config["outbounds"]
        assert xray_config["routing"]["rules"][0]["protocol"] == ["bittorrent"]
        assert xray_config["routing"]["rules"][0]["outboundTag"] == "blocked"
        assert xray_config["inbounds"][0]["sniffing"] == {
            "enabled": True,
            "destOverride": ["http", "tls", "quic"],
            "routeOnly": True,
        }


async def test_apply_xray_profile_keeps_other_active_xray_inbounds_on_same_node(
    route_app: RouteApp,
) -> None:
    async with route_app.sessionmaker() as session:
        node = Node(
            name="node-xray-multi",
            region="eu",
            public_address="203.0.113.91",
            status="active",
            capabilities={},
        )
        session.add(node)
        await session.flush()
        user = User(email="xray-multi@example.test", status="active")
        license_record = License(
            license_key_hash=hash_license_key("xray-multi-license"),
            customer_ref="xray-multi",
            status="active",
            max_devices=3,
            metadata_json={},
        )
        session.add_all([user, license_record])
        await session.flush()
        profiles = []
        for adapter, port in (("socks5", 24082), ("http-proxy", 24083)):
            profile = ProtocolProfile(
                id=uuid4(),
                name=f"{adapter}-multi",
                node_id=node.id,
                adapter=adapter,
                status="active",
                config_json={},
                port_reservations=[
                    {"address": "0.0.0.0", "port": port, "protocol": "tcp"}  # noqa: S104
                ],
                credentials_ref="vault://subscriptions/profile/creds",
            )
            profiles.append(profile)
            session.add(profile)
            await session.flush()
            session.add(
                Subscription(
                    public_id=f"lumen_sub_{adapter.replace('-', '_')}_{uuid4().hex}",
                    user_id=user.id,
                    license_id=license_record.id,
                    node_id=node.id,
                    status="active",
                    delivery_profile={
                        "profile_id": str(profile.id),
                        "protocol": adapter,
                        "adapter": adapter,
                    },
                    config_hash=f"sha256:{adapter}",
                )
            )
        await session.commit()
        target_profile_id = str(profiles[1].id)

    response = await route_app.client.post(f"/api/v1/profiles/{target_profile_id}/apply-to-node")
    assert response.status_code == 202, response.text

    async with route_app.sessionmaker() as session:
        command = (
            await session.execute(
                select(NodeCommand).where(NodeCommand.node_id == node.id)
            )
        ).scalar_one()
        xray_config = command.payload_json["xrayConfig"]
        inbounds = xray_config["inbounds"]
        assert [(inbound["protocol"], inbound["port"]) for inbound in inbounds] == [
            ("socks", 24082),
            ("http", 24083),
        ]
        assert set(command.payload_json["profileIds"]) == {str(profile.id) for profile in profiles}


async def test_apply_inactive_profile_is_rejected(route_app: RouteApp) -> None:
    profile_id, _ = await _seed_profile(route_app, "hysteria2", status="disabled")
    response = await route_app.client.post(f"/api/v1/profiles/{profile_id}/apply-to-node")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "profile_not_active"


async def test_apply_profile_without_real_subscription_is_rejected(route_app: RouteApp) -> None:
    profile_id, _ = await _seed_profile(route_app, "hysteria2", with_subscription=False)
    response = await route_app.client.post(f"/api/v1/profiles/{profile_id}/apply-to-node")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "profile_runtime_clients_required"
