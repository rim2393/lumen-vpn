import asyncio
import hashlib
import hmac
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.db.models  # noqa: F401
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import create_engine, get_db_session
from app.domains.auth import oauth as oauth_flow
from app.main import create_app

BOOTSTRAP_KEY = "lumen_sk_test_bootstrap"  # test fixture value, not a real secret.


@contextmanager
def app_client(tmp_path) -> Iterator[TestClient]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        bootstrap_admin_api_key=SecretStr(BOOTSTRAP_KEY),
        api_key_hash_pepper=SecretStr("test-api-key-pepper"),
        session_hash_pepper=SecretStr("test-session-pepper"),
        panel_public_url="https://panel.test",
        google_oauth_enabled=True,
        google_oauth_client_id="google-client-id",
        google_oauth_client_secret=SecretStr("google-client-secret"),
        telegram_login_enabled=True,
        telegram_bot_token=SecretStr("telegram-bot-token"),
        webauthn_enabled=True,
        webauthn_rp_id="panel.test",
        webauthn_origin="https://panel.test",
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


def _create_user(client: TestClient, **body) -> dict:
    response = client.post(
        "/api/v1/users",
        headers={"X-Lumen-Api-Key": BOOTSTRAP_KEY},
        json=body,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_provider_list_reflects_enabled_flags(tmp_path) -> None:
    with app_client(tmp_path) as client:
        response = client.get("/api/v1/auth/providers")
        assert response.status_code == 200
        providers = {item["provider"]: item for item in response.json()["items"]}
        assert providers["google"]["enabled"] is True
        assert providers["github"]["enabled"] is False
        assert providers["telegram"]["enabled"] is True


def test_oauth_start_persists_state_and_builds_url(tmp_path) -> None:
    with app_client(tmp_path) as client:
        response = client.get("/api/v1/auth/oauth/google/start", params={"redirect": "/dashboard"})
        assert response.status_code == 200
        body = response.json()
        assert body["provider"] == "google"
        assert body["state"].startswith("lumen_os_")
        assert "client_id=google-client-id" in body["authorization_url"]
        assert "code_challenge=" in body["authorization_url"]
        assert f"state={body['state']}" in body["authorization_url"]


def test_oauth_callback_links_existing_user_by_verified_email(tmp_path, monkeypatch) -> None:
    with app_client(tmp_path) as client:
        _create_user(
            client,
            email="owner@example.com",
            password="correct horse battery staple",  # noqa: S106 - test fixture password.
            role="owner",
        )
        start = client.get("/api/v1/auth/oauth/google/start").json()

        async def fake_exchange(*_args, **_kwargs) -> str:
            return "fake-access-token"

        async def fake_profile(*_args, **_kwargs) -> oauth_flow.OAuthProfile:
            return oauth_flow.OAuthProfile(
                subject="google:1234567890",
                email="owner@example.com",
                email_verified=True,
                display_name="Owner",
                raw={"sub": "1234567890", "email": "owner@example.com"},
            )

        monkeypatch.setattr(oauth_flow, "_exchange_code", fake_exchange)
        monkeypatch.setattr(oauth_flow, "_fetch_profile", fake_profile)

        callback = client.get(
            "/api/v1/auth/oauth/google/callback",
            params={"code": "auth-code", "state": start["state"]},
        )
        assert callback.status_code == 200, callback.text
        body = callback.json()
        assert body["mfa_required"] is False
        assert body["access_token"].startswith("lumen_at_")

        # State is single-use.
        replay = client.get(
            "/api/v1/auth/oauth/google/callback",
            params={"code": "auth-code", "state": start["state"]},
        )
        assert replay.status_code == 400
        assert replay.json()["error"]["code"] == "oauth_state_invalid"


def test_oauth_callback_rejects_unlinked_account(tmp_path, monkeypatch) -> None:
    with app_client(tmp_path) as client:
        start = client.get("/api/v1/auth/oauth/google/start").json()

        async def fake_exchange(*_args, **_kwargs) -> str:
            return "fake-access-token"

        async def fake_profile(*_args, **_kwargs) -> oauth_flow.OAuthProfile:
            return oauth_flow.OAuthProfile(
                subject="google:unknown",
                email="stranger@example.com",
                email_verified=True,
                display_name="Stranger",
                raw={},
            )

        monkeypatch.setattr(oauth_flow, "_exchange_code", fake_exchange)
        monkeypatch.setattr(oauth_flow, "_fetch_profile", fake_profile)

        callback = client.get(
            "/api/v1/auth/oauth/google/callback",
            params={"code": "auth-code", "state": start["state"]},
        )
        assert callback.status_code == 403
        assert callback.json()["error"]["code"] == "oauth_account_not_linked"


def _telegram_payload(bot_token: str, telegram_id: int) -> dict:
    fields = {
        "id": telegram_id,
        "auth_date": int(datetime.now(UTC).timestamp()),
        "first_name": "Tg",
        "username": "tg_user",
    }
    data_check_string = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret_key = hashlib.sha256(bot_token.encode("utf-8")).digest()
    signature = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return {**fields, "hash": signature}


def test_telegram_login_with_valid_signature(tmp_path) -> None:
    with app_client(tmp_path) as client:
        _create_user(
            client,
            email="tg-owner@example.com",
            password="correct horse battery staple",  # noqa: S106 - test fixture password.
            role="owner",
            telegram_id="777001",
        )
        payload = _telegram_payload("telegram-bot-token", 777001)
        response = client.post("/api/v1/auth/oauth/telegram/callback", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["access_token"].startswith("lumen_at_")


def test_telegram_login_rejects_tampered_hash(tmp_path) -> None:
    with app_client(tmp_path) as client:
        _create_user(
            client,
            email="tg-owner2@example.com",
            password="correct horse battery staple",  # noqa: S106 - test fixture password.
            role="owner",
            telegram_id="777002",
        )
        payload = _telegram_payload("telegram-bot-token", 777002)
        payload["hash"] = "0" * 64
        response = client.post("/api/v1/auth/oauth/telegram/callback", json=payload)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "telegram_hash_invalid"


def test_telegram_login_unlinked_is_rejected(tmp_path) -> None:
    with app_client(tmp_path) as client:
        payload = _telegram_payload("telegram-bot-token", 999999)
        response = client.post("/api/v1/auth/oauth/telegram/callback", json=payload)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "telegram_not_linked"


def _login(client: TestClient, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_webauthn_register_options_requires_auth(tmp_path) -> None:
    with app_client(tmp_path) as client:
        response = client.post("/api/v1/auth/webauthn/register/options")
        assert response.status_code == 401


def test_webauthn_register_options_and_reject_bad_credential(tmp_path) -> None:
    pytest.importorskip("webauthn")
    with app_client(tmp_path) as client:
        _create_user(
            client,
            email="passkey@example.com",
            password="correct horse battery staple",  # noqa: S106 - test fixture password.
            role="owner",
        )
        token = _login(client, "passkey@example.com", "correct horse battery staple")
        headers = {"Authorization": f"Bearer {token}"}

        options = client.post("/api/v1/auth/webauthn/register/options", headers=headers)
        assert options.status_code == 200, options.text
        body = options.json()
        assert "challenge" in body["options"]
        assert body["options"]["rp"]["id"] == "panel.test"

        verify = client.post(
            "/api/v1/auth/webauthn/register/verify",
            headers=headers,
            json={
                "challenge_id": body["challenge_id"],
                "credential": {"id": "bogus", "response": {}},
            },
        )
        assert verify.status_code == 400
        assert verify.json()["error"]["code"] == "webauthn_registration_failed"


def test_login_locks_account_after_repeated_failures(tmp_path) -> None:
    with app_client(tmp_path) as client:
        _create_user(
            client,
            email="lockme@example.com",
            password="correct horse battery staple",  # noqa: S106 - test fixture password.
            role="user",
        )
        for _ in range(5):
            failed = client.post(
                "/api/v1/auth/login",
                json={"email": "lockme@example.com", "password": "wrong-password"},
            )
            assert failed.status_code == 401
            assert failed.json()["error"]["code"] == "invalid_credentials"

        # Even the correct password is now rejected while the lockout window is active.
        locked = client.post(
            "/api/v1/auth/login",
            json={"email": "lockme@example.com", "password": "correct horse battery staple"},
        )
        assert locked.status_code == 429
        assert locked.json()["error"]["code"] == "account_locked"


def test_webauthn_authentication_options_are_public(tmp_path) -> None:
    pytest.importorskip("webauthn")
    with app_client(tmp_path) as client:
        response = client.post(
            "/api/v1/auth/webauthn/authenticate/options",
            json={"email": "nobody@example.com"},
        )
        assert response.status_code == 200
        assert "challenge" in response.json()["options"]
