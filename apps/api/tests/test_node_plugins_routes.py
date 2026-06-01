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


async def test_node_plugin_crud(route_app: RouteApp) -> None:
    created = await route_app.client.post(
        "/api/v1/node-plugins",
        json={
            "kind": "torrent-blocker",
            "name": "Global torrent blocker",
            "config_json": {"mode": "drop", "log": True},
        },
    )
    assert created.status_code == 201
    plugin = created.json()
    assert plugin["node_id"] is None
    assert plugin["config_json"]["mode"] == "drop"
    plugin_id = plugin["id"]

    listed = await route_app.client.get("/api/v1/node-plugins")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1

    updated = await route_app.client.patch(
        f"/api/v1/node-plugins/{plugin_id}",
        json={"enabled": False, "config_json": {"mode": "log-only"}},
    )
    assert updated.status_code == 200
    assert updated.json()["enabled"] is False
    assert updated.json()["config_json"]["mode"] == "log-only"

    deleted = await route_app.client.delete(f"/api/v1/node-plugins/{plugin_id}")
    assert deleted.status_code == 204
    final = await route_app.client.get("/api/v1/node-plugins")
    assert final.json()["items"] == []


async def test_node_plugin_missing_returns_404(route_app: RouteApp) -> None:
    response = await route_app.client.patch(
        "/api/v1/node-plugins/00000000-0000-0000-0000-000000000000",
        json={"enabled": False},
    )
    assert response.status_code == 404
