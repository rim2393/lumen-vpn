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


def _metric_value(body: str, name: str) -> int:
    for line in body.splitlines():
        if line.startswith(f"{name} "):
            return int(line.split(" ", 1)[1])
    raise AssertionError(f"metric {name} not found in body")


async def test_prometheus_metrics_reports_panel_gauges(route_app: RouteApp) -> None:
    async with route_app.sessionmaker() as session:
        session.add(User(email="active@example.com", status="active"))
        session.add(User(email="disabled@example.com", status="disabled"))
        await session.commit()

    response = await route_app.client.get("/api/v1/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    body = response.text
    assert "# HELP lumen_users_total" in body
    assert "# TYPE lumen_users_total gauge" in body
    assert _metric_value(body, "lumen_users_total") == 2
    assert _metric_value(body, "lumen_users_active") == 1
    assert _metric_value(body, "lumen_nodes_total") == 0
    assert _metric_value(body, "lumen_subscriptions_total") == 0
