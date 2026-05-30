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
from app.domains.nodes.models import Node, NodeCommand
from app.domains.protocols.models import ProtocolProfile
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
    route_app: RouteApp, adapter: str, *, status: str = "active"
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
        assert command.payload_json["hysteria2Config"]["clientsRef"]


async def test_apply_inactive_profile_is_rejected(route_app: RouteApp) -> None:
    profile_id, _ = await _seed_profile(route_app, "hysteria2", status="disabled")
    response = await route_app.client.post(f"/api/v1/profiles/{profile_id}/apply-to-node")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "profile_not_active"
