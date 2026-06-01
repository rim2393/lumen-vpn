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


async def test_infra_billing_provider_records_and_summary(route_app: RouteApp) -> None:
    provider = await route_app.client.post(
        "/api/v1/infra-billing/providers",
        json={"name": "vdsina", "login_url": "https://vdsina.com"},
    )
    assert provider.status_code == 201
    provider_id = provider.json()["id"]

    # Duplicate provider name -> 409.
    dup = await route_app.client.post(
        "/api/v1/infra-billing/providers",
        json={"name": "vdsina"},
    )
    assert dup.status_code == 409

    rec1 = await route_app.client.post(
        "/api/v1/infra-billing/records",
        json={"provider_id": provider_id, "amount": 12.5, "currency": "usd", "period": "2026-05"},
    )
    assert rec1.status_code == 201
    assert rec1.json()["currency"] == "USD"

    rec2 = await route_app.client.post(
        "/api/v1/infra-billing/records",
        json={"provider_id": provider_id, "amount": 7.5, "currency": "USD", "period": "2026-04"},
    )
    assert rec2.status_code == 201

    summary = await route_app.client.get("/api/v1/infra-billing/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["providers"] == 1
    assert body["records"] == 2
    usd = next(item for item in body["totals_by_currency"] if item["currency"] == "USD")
    assert usd["total"] == 20.0
    assert usd["records"] == 2

    # Record against unknown provider -> 404.
    bad = await route_app.client.post(
        "/api/v1/infra-billing/records",
        json={
            "provider_id": "00000000-0000-0000-0000-000000000000",
            "amount": 1,
            "period": "2026-05",
        },
    )
    assert bad.status_code == 404

    deleted = await route_app.client.delete(f"/api/v1/infra-billing/providers/{provider_id}")
    assert deleted.status_code == 204
