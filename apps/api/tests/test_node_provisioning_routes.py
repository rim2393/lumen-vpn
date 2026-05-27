from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, Role, get_current_principal
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.nodes.models import Node, NodeInstallToken
from app.main import create_app


@dataclass(frozen=True)
class RouteTestApp:
    client: AsyncClient
    sessionmaker: async_sessionmaker[AsyncSession]


@pytest.fixture
async def route_app(tmp_path) -> AsyncIterator[RouteTestApp]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        node_token_hash_pepper=SecretStr("test-node-token-pepper"),
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
        yield RouteTestApp(client=client, sessionmaker=sessionmaker)

    app.dependency_overrides.clear()
    await engine.dispose()


def provisioning_payload() -> dict[str, object]:
    return {
        "idempotency_key": "route-provision-001",
        "node": {
            "name": "route-edge-1",
            "region": "eu",
            "public_address": "203.0.113.20",
        },
        "ssh": {
            "host": "203.0.113.20",
            "port": 22,
            "username": "root",
            "credentials_ref": "vault://lumen/nodes/route-edge-1/ssh",
        },
        "requested_capabilities": {"service_manager": "systemd"},
    }


async def test_node_provisioning_route_flow_uses_one_time_tokens(
    route_app: RouteTestApp,
) -> None:
    create_response = await route_app.client.post(
        "/api/v1/nodes/provisioning-jobs",
        json=provisioning_payload(),
    )
    assert create_response.status_code == 201
    job = create_response.json()

    preflight_response = await route_app.client.post(
        f"/api/v1/nodes/provisioning-jobs/{job['id']}/preflight",
        json={"status": "passed", "checks": {"ssh": "ok", "ports": "ok"}},
    )
    assert preflight_response.status_code == 200
    assert preflight_response.json()["status"] == "preflight_passed"

    token_response = await route_app.client.post(
        f"/api/v1/nodes/provisioning-jobs/{job['id']}/install-token",
    )
    assert token_response.status_code == 201
    install_token = token_response.json()["install_token"]
    assert install_token.startswith("lumen_it_")

    exchange_response = await route_app.client.post(
        "/api/v1/nodes/install-token/exchange",
        json={"install_token": install_token},
    )
    assert exchange_response.status_code == 200
    exchanged = exchange_response.json()
    node_token = exchanged["node_token"]
    assert node_token.startswith("lumen_node_")

    reused_response = await route_app.client.post(
        "/api/v1/nodes/install-token/exchange",
        json={"install_token": install_token},
    )
    assert reused_response.status_code == 401
    assert reused_response.json()["error"]["code"] == "invalid_install_token"

    heartbeat_response = await route_app.client.post(
        exchanged["heartbeat_path"],
        headers={"X-Lumen-Node-Token": node_token},
        json={
            "status": "active",
            "capabilities": {"service_manager": "systemd", "tun": "available"},
        },
    )
    assert heartbeat_response.status_code == 200
    assert heartbeat_response.json()["status"] == "active"

    async with route_app.sessionmaker() as session:
        persisted_token = (await session.execute(select(NodeInstallToken))).scalar_one()
        persisted_node = (await session.execute(select(Node))).scalar_one()
        assert persisted_token.token_hash != install_token
        assert persisted_node.agent_token_hash != node_token
        assert persisted_node.last_seen_at is not None


async def test_node_routes_list_get_and_manual_create(
    route_app: RouteTestApp,
) -> None:
    create_response = await route_app.client.post(
        "/api/v1/nodes",
        json={
            "name": "manual-edge-1",
            "region": "eu",
            "public_address": "203.0.113.21",
            "capabilities": {"runtime.xray_core": "true"},
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["status"] == "offline"

    list_response = await route_app.client.get("/api/v1/nodes")
    assert list_response.status_code == 200
    listed = list_response.json()["items"]
    assert [item["id"] for item in listed] == [created["id"]]

    get_response = await route_app.client.get(f"/api/v1/nodes/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "manual-edge-1"


async def test_manual_node_rejects_inline_secret_capability(
    route_app: RouteTestApp,
) -> None:
    response = await route_app.client.post(
        "/api/v1/nodes",
        json={
            "name": "bad-node",
            "region": "eu",
            "public_address": "203.0.113.22",
            "capabilities": {"api_token": "do-not-accept"},
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "inline_secret_rejected"
