import asyncio
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.main import create_app


@contextmanager
def app_client(tmp_path) -> Iterator[TestClient]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        bootstrap_admin_api_key=SecretStr("lumen_sk_test_bootstrap"),
        api_key_hash_pepper=SecretStr("test-api-key-pepper"),
        session_hash_pepper=SecretStr("test-session-pepper"),
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
            yield client
    finally:
        asyncio.run(engine.dispose())


def test_user_login_refresh_me_logout_flow(tmp_path) -> None:
    with app_client(tmp_path) as client:
        created = client.post(
            "/api/v1/users",
            headers={"X-Lumen-Api-Key": "lumen_sk_test_bootstrap"},
            json={
                "email": "Owner@Example.com",
                "password": "correct horse battery staple",
                "role": "owner",
            },
        )
        assert created.status_code == 201
        user_id = created.json()["id"]

        login = client.post(
            "/api/v1/auth/login",
            json={"email": "owner@example.com", "password": "correct horse battery staple"},
        )
        assert login.status_code == 200
        token_pair = login.json()
        assert token_pair["access_token"].startswith("lumen_at_")
        assert token_pair["refresh_token"].startswith("lumen_rt_")

        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token_pair['access_token']}"},
        )
        assert me.status_code == 200
        assert me.json()["subject"] == user_id
        assert "user:manage" in me.json()["permissions"]

        refreshed = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": token_pair["refresh_token"]},
        )
        assert refreshed.status_code == 200
        assert refreshed.json()["access_token"] != token_pair["access_token"]

        logout = client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"},
        )
        assert logout.status_code == 204

        after_logout = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"},
        )
        assert after_logout.status_code == 401
        assert after_logout.json()["error"]["code"] == "invalid_session"


def test_api_key_routes_issue_scope_and_revoke_keys(tmp_path) -> None:
    with app_client(tmp_path) as client:
        created = client.post(
            "/api/v1/users",
            headers={"X-Lumen-Api-Key": "lumen_sk_test_bootstrap"},
            json={
                "email": "owner@example.com",
                "password": "correct horse battery staple",
                "role": "owner",
            },
        )
        assert created.status_code == 201

        login = client.post(
            "/api/v1/auth/login",
            json={"email": "owner@example.com", "password": "correct horse battery staple"},
        )
        access_token = login.json()["access_token"]
        auth_headers = {"Authorization": f"Bearer {access_token}"}

        issued = client.post(
            "/api/v1/api-keys",
            headers=auth_headers,
            json={"name": "telegram bot", "scopes": ["api_key:manage", "node:manage"]},
        )
        assert issued.status_code == 201
        issued_body = issued.json()
        assert issued_body["api_key"].startswith("lumen_sk_")
        assert issued_body["key_prefix"] == issued_body["api_key"][:18]

        listed = client.get("/api/v1/api-keys", headers=auth_headers)
        assert listed.status_code == 200
        assert listed.json()["items"][0]["name"] == "telegram bot"

        via_api_key = client.get(
            "/api/v1/auth/me",
            headers={"X-Lumen-Api-Key": issued_body["api_key"]},
        )
        assert via_api_key.status_code == 200
        assert sorted(via_api_key.json()["permissions"]) == ["api_key:manage", "node:manage"]

        revoked = client.delete(f"/api/v1/api-keys/{issued_body['id']}", headers=auth_headers)
        assert revoked.status_code == 204

        rejected = client.get(
            "/api/v1/auth/me",
            headers={"X-Lumen-Api-Key": issued_body["api_key"]},
        )
        assert rejected.status_code == 401
        assert rejected.json()["error"]["code"] == "invalid_api_key"
