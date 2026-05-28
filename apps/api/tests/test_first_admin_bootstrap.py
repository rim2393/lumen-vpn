import asyncio
from collections.abc import AsyncIterator

from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.users.models import User
from app.main import create_app


def test_first_admin_bootstrap_creates_login_owner(tmp_path) -> None:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        api_key_hash_pepper=SecretStr("test-api-key-pepper"),
        session_hash_pepper=SecretStr("test-session-pepper"),
        first_admin_email="Owner@Example.com",
        first_admin_username="owner",
        first_admin_password=SecretStr("correct horse battery staple"),
    )
    engine = create_engine(settings)

    async def setup_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(setup_schema())
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_db_session
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"email": "owner@example.com", "password": "correct horse battery staple"},
            )
            assert login.status_code == 200
            access_token = login.json()["access_token"]

            me = client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert me.status_code == 200
            assert me.json()["email"] == "owner@example.com"
            assert "user:manage" in me.json()["permissions"]

        async def assert_bootstrap_user() -> None:
            async with sessionmaker() as session:
                user = (await session.execute(select(User))).scalar_one()
                assert user.email == "owner@example.com"
                assert user.username == "owner"
                assert user.display_name == "owner"

        asyncio.run(assert_bootstrap_user())
    finally:
        asyncio.run(engine.dispose())
