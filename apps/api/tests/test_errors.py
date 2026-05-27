from fastapi.testclient import TestClient


def test_validation_errors_use_standard_envelope(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={})

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["message"] == "Request validation failed."
    assert body["error"]["details"]


def test_unimplemented_domain_uses_standard_envelope(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "not-a-real-secret"},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "missing_secret"
