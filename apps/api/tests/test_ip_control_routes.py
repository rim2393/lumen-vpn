from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, Role, get_current_principal
from app.db.base import Base
from app.db.session import create_engine, get_db_session
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
            permissions={Permission.USER_MANAGE},
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


async def test_ip_control_rule_crud_and_evaluation(route_app: RouteApp) -> None:
    # No rule yet -> any IP set is allowed.
    decision = await route_app.client.post(
        "/api/v1/ip-control/evaluate",
        json={"user_id": "usr-1", "active_ips": ["1.1.1.1", "2.2.2.2", "3.3.3.3"]},
    )
    assert decision.status_code == 200
    assert decision.json()["allowed"] is True
    assert decision.json()["rule_id"] is None

    # Create a global block rule capping at 2 distinct IPs.
    created = await route_app.client.post(
        "/api/v1/ip-control/rules",
        json={"name": "global-cap", "scope": "global", "max_active_ips": 2, "action": "block"},
    )
    assert created.status_code == 201
    rule_id = created.json()["id"]

    listed = await route_app.client.get("/api/v1/ip-control/rules")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1

    # 3 distinct IPs now exceeds the cap -> blocked and recorded.
    blocked = await route_app.client.post(
        "/api/v1/ip-control/evaluate",
        json={"user_id": "usr-1", "active_ips": ["1.1.1.1", "2.2.2.2"], "candidate_ip": "3.3.3.3"},
    )
    body = blocked.json()
    assert body["allowed"] is False
    assert body["decision"] == "blocked"
    assert body["ip_limit"] == 2
    assert body["active_ip_count"] == 3

    events = await route_app.client.get("/api/v1/ip-control/events")
    assert events.status_code == 200
    assert len(events.json()["items"]) == 1
    assert events.json()["items"][0]["decision"] == "blocked"

    # Within the cap -> allowed, no new event.
    ok = await route_app.client.post(
        "/api/v1/ip-control/evaluate",
        json={"user_id": "usr-1", "active_ips": ["1.1.1.1", "1.1.1.1"]},
    )
    assert ok.json()["allowed"] is True
    events_after = await route_app.client.get("/api/v1/ip-control/events")
    assert len(events_after.json()["items"]) == 1

    # Non-global rule without target -> 422.
    invalid = await route_app.client.post(
        "/api/v1/ip-control/rules",
        json={"name": "bad", "scope": "user", "max_active_ips": 1},
    )
    assert invalid.status_code == 422

    deleted = await route_app.client.delete(f"/api/v1/ip-control/rules/{rule_id}")
    assert deleted.status_code == 204
    final = await route_app.client.get("/api/v1/ip-control/rules")
    assert final.json()["items"] == []
