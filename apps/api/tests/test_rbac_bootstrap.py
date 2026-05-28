from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings, get_settings
from app.main import create_app


@contextmanager
def auth_client() -> Iterator[TestClient]:
    settings = Settings(bootstrap_admin_api_key=SecretStr("lumen_sk_test_bootstrap"))
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client


def test_bootstrap_api_key_allows_owner_routes() -> None:
    with auth_client() as client:
        response = client.get(
            "/api/v1/auth/me",
            headers={"X-Lumen-Api-Key": "lumen_sk_test_bootstrap"},
        )

    assert response.status_code == 200
    assert response.json()["subject"] == "bootstrap-admin"


def test_bootstrap_api_key_does_not_create_web_session() -> None:
    with auth_client() as client:
        response = client.get(
            "/api/auth/session",
            headers={"X-Lumen-Api-Key": "lumen_sk_test_bootstrap"},
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "web_session_required"


def test_missing_bootstrap_api_key_is_rejected() -> None:
    with auth_client() as client:
        response = client.get("/api/v1/licenses")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_empty_bootstrap_api_key_keeps_auth_unimplemented() -> None:
    settings = Settings(bootstrap_admin_api_key=SecretStr(""))
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    with TestClient(app) as client:
        response = client.get("/api/v1/licenses")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_invalid_bootstrap_api_key_is_rejected() -> None:
    with auth_client() as client:
        response = client.get(
            "/api/v1/licenses",
            headers={"X-Lumen-Api-Key": "lumen_sk_test_wrong"},
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"
