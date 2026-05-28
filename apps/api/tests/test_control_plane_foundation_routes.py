from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

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
from app.domains.audit.models import AuditEvent
from app.domains.auth.models import UserSession
from app.domains.auth.service import generate_totp_code
from app.domains.licenses.models import License
from app.domains.licenses.service import hash_license_key
from app.domains.nodes.models import Node
from app.domains.nodes.service import hash_node_token
from app.domains.protocols.schemas import WILDCARD_BIND_ADDRESS
from app.domains.subscriptions.models import Subscription
from app.domains.users.models import User
from app.main import create_app

NODE_TOKEN = "lumen_node_test_foundation"  # noqa: S105 - deterministic test token.


@dataclass(frozen=True)
class FoundationRouteApp:
    client: AsyncClient
    principal_ref: dict[str, Principal]
    sessionmaker: async_sessionmaker[AsyncSession]
    settings: Settings


@pytest.fixture
async def foundation_app(tmp_path) -> AsyncIterator[FoundationRouteApp]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}",
        node_token_hash_pepper=SecretStr("test-node-token-pepper"),
        session_hash_pepper=SecretStr("test-session-pepper"),
    )
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessionmaker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    async with sessionmaker() as session:
        user = User(
            email="owner@example.com",
            role=Role.OWNER.value,
            status="active",
        )
        node = Node(
            name="foundation-node",
            region="eu",
            public_address="203.0.113.80",
            status="active",
            capabilities={"runtime.xray": "true"},
            agent_token_prefix=NODE_TOKEN[:18],
            agent_token_hash=hash_node_token(NODE_TOKEN, settings),
        )
        session.add_all([user, node])
        await session.commit()
        principal = Principal(
            subject=str(user.id),
            email=user.email,
            roles={Role.OWNER},
            permissions=set(Permission),
        )

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    principal_ref = {"principal": principal}

    async def override_principal() -> Principal:
        return principal_ref["principal"]

    app = create_app(settings)
    app.dependency_overrides[get_db_session] = override_db_session
    app.dependency_overrides[get_current_principal] = override_principal
    app.dependency_overrides[get_settings] = lambda: settings

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield FoundationRouteApp(
            client=client,
            principal_ref=principal_ref,
            sessionmaker=sessionmaker,
            settings=settings,
        )

    app.dependency_overrides.clear()
    await engine.dispose()


async def seeded_node_id(foundation_app: FoundationRouteApp) -> str:
    async with foundation_app.sessionmaker() as session:
        node = (await session.execute(select(Node))).scalar_one()
        return str(node.id)


async def test_totp_mfa_setup_verify_and_list(foundation_app: FoundationRouteApp) -> None:
    setup_response = await foundation_app.client.post(
        "/api/v1/auth/mfa/totp/setup",
        json={"label": "Owner phone"},
    )
    assert setup_response.status_code == 201
    setup_body = setup_response.json()
    assert setup_body["status"] == "pending"
    assert setup_body["otpauth_url"].startswith("otpauth://totp/")

    verify_response = await foundation_app.client.post(
        "/api/v1/auth/mfa/totp/verify",
        json={
            "method_id": setup_body["method_id"],
            "code": generate_totp_code(setup_body["secret"]),
        },
    )
    assert verify_response.status_code == 200
    method = verify_response.json()["items"][0]
    assert method["kind"] == "totp"
    assert method["status"] == "active"
    assert method["confirmed_at"] is not None

    list_response = await foundation_app.client.get("/api/v1/auth/mfa/methods")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["label"] == "Owner phone"


async def test_settings_update_records_audit_event(foundation_app: FoundationRouteApp) -> None:
    update_response = await foundation_app.client.put(
        "/api/v1/settings/subscription.display",
        json={"value_json": {"title": "Lumen", "support_url": "https://support.example.test"}},
    )
    assert update_response.status_code == 200
    assert update_response.json()["value_json"]["title"] == "Lumen"

    list_response = await foundation_app.client.get("/api/v1/settings")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["key"] == "subscription.display"

    audit_response = await foundation_app.client.get("/api/v1/audit/events")
    assert audit_response.status_code == 200
    event = audit_response.json()["items"][0]
    assert event["action"] == "setting.updated"
    assert event["resource_id"] == "subscription.display"

    async with foundation_app.sessionmaker() as session:
        persisted_event = (await session.execute(select(AuditEvent))).scalar_one()
        assert persisted_event.actor_email == "owner@example.com"


async def test_auth_provider_settings_are_typed_and_audited(
    foundation_app: FoundationRouteApp,
) -> None:
    providers_response = await foundation_app.client.get("/api/v1/settings/auth/providers")
    assert providers_response.status_code == 200
    providers = providers_response.json()["items"]
    assert {item["provider"] for item in providers} >= {
        "password",
        "telegram",
        "github",
        "google",
        "keycloak",
        "generic_oauth2",
    }
    password_provider = next(item for item in providers if item["provider"] == "password")
    assert password_provider["enabled"] is True
    assert password_provider["metadata_json"]["mfa_required"] is True

    patch_response = await foundation_app.client.patch(
        "/api/v1/settings/auth/providers/google",
        json={
            "enabled": True,
            "status": "active",
            "metadata_json": {"issuer": "https://accounts.google.com"},
        },
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["enabled"] is True

    reject_secret_response = await foundation_app.client.patch(
        "/api/v1/settings/auth/providers/github",
        json={"metadata_json": {"client_secret": "inline-secret"}},
    )
    assert reject_secret_response.status_code == 422

    settings_response = await foundation_app.client.get("/api/v1/settings/auth.providers")
    assert settings_response.status_code == 200
    saved_google = next(
        item
        for item in settings_response.json()["value_json"]["items"]
        if item["provider"] == "google"
    )
    assert saved_google["status"] == "active"

    audit_response = await foundation_app.client.get("/api/v1/audit/events")
    assert audit_response.status_code == 200
    assert any(
        event["action"] == "auth_provider.updated"
        and event["resource_id"] == "google"
        for event in audit_response.json()["items"]
    )


async def test_subscription_templates_and_response_rules_are_persisted(
    foundation_app: FoundationRouteApp,
) -> None:
    first_template = await foundation_app.client.post(
        "/api/v1/subscription-templates",
        json={
            "name": "Happ default",
            "format": "mihomo",
            "content_json": {"profile_title": "Lumen"},
        },
    )
    second_template = await foundation_app.client.post(
        "/api/v1/subscription-templates",
        json={"name": "Xray JSON", "format": "xray_json", "content_json": {"dns": {}}},
    )
    assert first_template.status_code == 201
    assert second_template.status_code == 201
    first_template_id = first_template.json()["id"]
    second_template_id = second_template.json()["id"]

    patch_template = await foundation_app.client.patch(
        f"/api/v1/subscription-templates/{first_template_id}",
        json={"status": "disabled", "content_json": {"profile_title": "Lumen Guard"}},
    )
    assert patch_template.status_code == 200
    assert patch_template.json()["content_json"]["profile_title"] == "Lumen Guard"

    reorder_templates = await foundation_app.client.post(
        "/api/v1/subscription-templates/actions/reorder",
        json={"ids": [second_template_id, first_template_id]},
    )
    assert reorder_templates.status_code == 200
    list_templates = await foundation_app.client.get("/api/v1/subscription-templates")
    assert [item["id"] for item in list_templates.json()["items"]] == [
        second_template_id,
        first_template_id,
    ]

    rule_response = await foundation_app.client.post(
        "/api/v1/response-rules",
        json={
            "name": "Expired subscription",
            "trigger_status": "expired",
            "status_code": 403,
            "body": "Subscription expired",
            "headers": {"X-Lumen-Reason": "expired"},
        },
    )
    assert rule_response.status_code == 201
    rule_id = rule_response.json()["id"]

    test_rule = await foundation_app.client.post(
        "/api/v1/response-rules/test",
        json={"subscription_status": "expired"},
    )
    assert test_rule.status_code == 200
    assert test_rule.json()["matched"] is True
    assert test_rule.json()["status_code"] == 403
    assert test_rule.json()["headers"]["X-Lumen-Reason"] == "expired"

    delete_rule = await foundation_app.client.delete(f"/api/v1/response-rules/{rule_id}")
    assert delete_rule.status_code == 204
    test_rule_after_delete = await foundation_app.client.post(
        "/api/v1/response-rules/test",
        json={"subscription_status": "expired"},
    )
    assert test_rule_after_delete.status_code == 200
    assert test_rule_after_delete.json()["matched"] is False


async def test_protocol_profile_port_conflict_and_host_flow(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    squad_response = await foundation_app.client.post(
        "/api/v1/squads",
        json={"name": "Default squad", "kind": "internal"},
    )
    assert squad_response.status_code == 201
    squad_id = squad_response.json()["id"]

    profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Reality EU",
            "node_id": node_id,
            "squad_id": squad_id,
            "adapter": "vless-reality",
            "credentials_ref": "vault://protocols/reality-eu",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 443, "protocol": "tcp"}
            ],
        },
    )
    assert profile_response.status_code == 201
    profile_id = profile_response.json()["id"]

    conflict_response = await foundation_app.client.post(
        "/api/v1/protocols/port-check",
        json={
            "node_id": node_id,
            "reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 443, "protocol": "tcp"}
            ],
        },
    )
    assert conflict_response.status_code == 200
    conflict_body = conflict_response.json()
    assert conflict_body["allowed"] is False
    assert conflict_body["conflicts"][0]["suggested_port"] == 444

    blocked_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Duplicate bind",
            "node_id": node_id,
            "adapter": "vless-tcp-tls",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 443, "protocol": "tcp"}
            ],
        },
    )
    assert blocked_response.status_code == 409
    assert blocked_response.json()["error"]["code"] == "protocol_port_conflict"

    host_response = await foundation_app.client.post(
        "/api/v1/hosts",
        json={
            "name": "Auto WiFi",
            "hostname": "auto.example.test",
            "node_id": node_id,
            "protocol_profile_id": profile_id,
            "squad_id": squad_id,
            "tags": ["auto-wifi"],
        },
    )
    assert host_response.status_code == 201
    assert host_response.json()["hostname"] == "auto.example.test"

    diagnostic_profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Diagnostic TLS",
            "node_id": node_id,
            "squad_id": squad_id,
            "adapter": "vless-tcp-tls",
            "credentials_ref": "vault://protocols/vless-tcp-tls/diagnostic",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 18081, "protocol": "tcp"}
            ],
        },
    )
    assert diagnostic_profile_response.status_code == 201
    assert diagnostic_profile_response.json()["adapter"] == "vless-tcp-tls"


async def test_remna_parity_crud_and_bulk_actions(foundation_app: FoundationRouteApp) -> None:
    node_id = await seeded_node_id(foundation_app)

    user_response = await foundation_app.client.post(
        "/api/v1/users",
        json={
            "email": "vpn-user@example.com",
            "username": "vpn-user",
            "display_name": "VPN User",
            "traffic_limit_gb": 300,
            "traffic_used_gb": 12.5,
            "device_limit": 5,
            "tags": ["default"],
        },
    )
    assert user_response.status_code == 201
    user_id = user_response.json()["id"]

    update_user_response = await foundation_app.client.patch(
        f"/api/v1/users/{user_id}",
        json={"status": "limited", "telegram_id": "100500", "traffic_used_gb": 15.25},
    )
    assert update_user_response.status_code == 200
    assert update_user_response.json()["status"] == "limited"
    assert update_user_response.json()["telegram_id"] == "100500"

    bulk_user_response = await foundation_app.client.post(
        "/api/v1/users/bulk/reset-traffic",
        json={"user_ids": [user_id]},
    )
    assert bulk_user_response.status_code == 200
    assert bulk_user_response.json()["updated"] == 1
    assert bulk_user_response.json()["items"][0]["traffic_used_gb"] == 0

    squad_response = await foundation_app.client.post(
        "/api/v1/squads",
        json={"name": "Parity squad", "kind": "internal"},
    )
    assert squad_response.status_code == 201
    squad_id = squad_response.json()["id"]

    profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Parity Reality",
            "node_id": node_id,
            "squad_id": squad_id,
            "adapter": "vless-reality",
            "credentials_ref": "vault://protocols/parity-reality",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 8443, "protocol": "tcp"}
            ],
            "metadata_json": {"xray_template": "reality-default"},
        },
    )
    assert profile_response.status_code == 201
    profile_id = profile_response.json()["id"]

    patch_profile_response = await foundation_app.client.patch(
        f"/api/v1/profiles/{profile_id}",
        json={
            "status": "disabled",
            "config_json": {"routing": {"domainStrategy": "AsIs"}},
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 9443, "protocol": "tcp"}
            ],
        },
    )
    assert patch_profile_response.status_code == 200
    assert patch_profile_response.json()["status"] == "disabled"
    assert patch_profile_response.json()["port_reservations"][0]["port"] == 9443

    host_response = await foundation_app.client.post(
        "/api/v1/hosts",
        json={
            "name": "Parity Host",
            "hostname": "parity.example.test",
            "node_id": node_id,
            "protocol_profile_id": profile_id,
            "squad_id": squad_id,
            "address": "203.0.113.99",
            "port": 9443,
            "inbound_tag": "VLESS_REALITY",
            "remark": "Visible in subscription",
            "tags": ["reality"],
        },
    )
    assert host_response.status_code == 201
    host_id = host_response.json()["id"]

    patch_host_response = await foundation_app.client.patch(
        f"/api/v1/hosts/{host_id}",
        json={"status": "disabled", "remark": "Temporarily hidden"},
    )
    assert patch_host_response.status_code == 200
    assert patch_host_response.json()["status"] == "disabled"
    assert patch_host_response.json()["remark"] == "Temporarily hidden"

    compat_hosts_response = await foundation_app.client.get("/api/hosts")
    assert compat_hosts_response.status_code == 200
    assert compat_hosts_response.json()["items"][0]["name"] == "Parity Host"


async def test_profile_computed_config_and_inbounds_are_derived_from_bindings(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Computed Reality",
            "node_id": node_id,
            "adapter": "vless-reality",
            "credentials_ref": "vault://protocols/computed-reality",
            "config_json": {
                "routing": {"domainStrategy": "AsIs"},
                "security": {"type": "reality", "serverName": "www.example.com"},
            },
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 2443, "protocol": "tcp"}
            ],
        },
    )
    assert profile_response.status_code == 201
    profile_id = profile_response.json()["id"]

    host_response = await foundation_app.client.post(
        "/api/v1/hosts",
        json={
            "name": "Computed Host",
            "hostname": "computed.example.test",
            "node_id": node_id,
            "protocol_profile_id": profile_id,
            "address": "203.0.113.77",
            "port": 2443,
            "inbound_tag": "COMPUTED_REALITY",
            "remark": "Bound to computed profile",
            "tags": ["computed"],
        },
    )
    assert host_response.status_code == 201

    profile_detail_response = await foundation_app.client.get(f"/api/v1/profiles/{profile_id}")
    assert profile_detail_response.status_code == 200
    assert profile_detail_response.json()["id"] == profile_id

    inbounds_response = await foundation_app.client.get(f"/api/v1/profiles/{profile_id}/inbounds")
    assert inbounds_response.status_code == 200
    inbound = inbounds_response.json()["items"][0]
    assert inbound["profile_id"] == profile_id
    assert inbound["node_id"] == node_id
    assert inbound["tag"] == "COMPUTED_REALITY"
    assert inbound["protocol"] == "vless"
    assert inbound["listen"] == WILDCARD_BIND_ADDRESS
    assert inbound["port"] == 2443
    assert inbound["transport"] == "tcp"
    assert inbound["security"] == "reality"
    assert inbound["credentials_ref"] == "vault://protocols/computed-reality"
    assert inbound["hosts"][0]["hostname"] == "computed.example.test"
    assert inbound["hosts"][0]["address"] == "203.0.113.77"

    global_inbounds_response = await foundation_app.client.get("/api/v1/profiles/inbounds")
    assert global_inbounds_response.status_code == 200
    assert [item["profile_id"] for item in global_inbounds_response.json()["items"]] == [
        profile_id
    ]

    computed_response = await foundation_app.client.get(
        f"/api/v1/profiles/{profile_id}/computed-config",
    )
    assert computed_response.status_code == 200
    computed = computed_response.json()
    assert computed["profile"]["id"] == profile_id
    assert computed["node"]["id"] == node_id
    assert computed["node"]["public_address"] == "203.0.113.80"
    assert computed["inbounds"][0]["tag"] == "COMPUTED_REALITY"
    computed_config = computed["computed_config"]
    assert computed_config["routing"] == {"domainStrategy": "AsIs"}
    assert computed_config["inbounds"][0]["tag"] == "COMPUTED_REALITY"
    assert computed_config["inbounds"][0]["settings"]["clientsRef"] == (
        "vault://protocols/computed-reality"
    )
    assert computed_config["inbounds"][0]["streamSettings"] == {
        "network": "tcp",
        "security": "reality",
    }


async def test_host_bulk_actions_and_reorder_are_persisted(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)
    host_ids: list[str] = []
    for index in range(2):
        response = await foundation_app.client.post(
            "/api/v1/hosts",
            json={
                "name": f"Bulk Host {index}",
                "hostname": f"bulk-{index}.example.test",
                "node_id": node_id,
                "tags": ["bulk"],
            },
        )
        assert response.status_code == 201
        host_ids.append(response.json()["id"])

    inbound_response = await foundation_app.client.post(
        "/api/v1/hosts/bulk/set-inbound",
        json={"ids": host_ids, "inbound_tag": "BULK_INBOUND"},
    )
    assert inbound_response.status_code == 200
    assert inbound_response.json()["updated"] == 2

    port_response = await foundation_app.client.post(
        "/api/v1/hosts/bulk/set-port",
        json={"ids": host_ids, "port": 9443},
    )
    assert port_response.status_code == 200

    disable_response = await foundation_app.client.post(
        "/api/v1/hosts/bulk/disable",
        json={"ids": [host_ids[0]]},
    )
    assert disable_response.status_code == 200

    reorder_response = await foundation_app.client.post(
        "/api/v1/hosts/actions/reorder",
        json={"ids": [host_ids[1], host_ids[0]]},
    )
    assert reorder_response.status_code == 200

    list_response = await foundation_app.client.get("/api/v1/hosts")
    assert list_response.status_code == 200
    hosts = list_response.json()["items"]
    assert [host["id"] for host in hosts[:2]] == [host_ids[1], host_ids[0]]
    assert hosts[0]["metadata_json"]["order"] == 0
    assert hosts[0]["inbound_tag"] == "BULK_INBOUND"
    assert hosts[0]["port"] == 9443
    assert hosts[1]["status"] == "disabled"

    delete_response = await foundation_app.client.post(
        "/api/v1/hosts/bulk/delete",
        json={"ids": host_ids},
    )
    assert delete_response.status_code == 200
    final_response = await foundation_app.client.get("/api/v1/hosts")
    assert final_response.status_code == 200
    assert final_response.json()["items"] == []


async def test_squad_detail_membership_and_reorder_are_persisted(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    user_response = await foundation_app.client.post(
        "/api/v1/users",
        json={"email": "squad-user@example.com", "username": "squad-user", "tags": ["vip"]},
    )
    assert user_response.status_code == 201
    user_id = user_response.json()["id"]

    first_squad = await foundation_app.client.post(
        "/api/v1/squads",
        json={"name": "Squad Detail A", "kind": "internal"},
    )
    second_squad = await foundation_app.client.post(
        "/api/v1/squads",
        json={"name": "Squad Detail B", "kind": "external"},
    )
    assert first_squad.status_code == 201
    assert second_squad.status_code == 201
    first_squad_id = first_squad.json()["id"]
    second_squad_id = second_squad.json()["id"]

    add_user_response = await foundation_app.client.post(
        f"/api/v1/squads/{first_squad_id}/users",
        json={"user_ids": [user_id]},
    )
    assert add_user_response.status_code == 200
    assert add_user_response.json()["metadata_json"]["user_ids"] == [user_id]

    profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Squad Detail Profile",
            "node_id": node_id,
            "squad_id": first_squad_id,
            "adapter": "vless-reality",
            "credentials_ref": "vault://protocols/squad-detail",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 30443, "protocol": "tcp"}
            ],
        },
    )
    assert profile_response.status_code == 201
    profile_id = profile_response.json()["id"]

    host_response = await foundation_app.client.post(
        "/api/v1/hosts",
        json={
            "name": "Squad Detail Host",
            "hostname": "squad-detail.example.test",
            "node_id": node_id,
            "protocol_profile_id": profile_id,
            "squad_id": first_squad_id,
            "inbound_tag": "SQUAD_DETAIL_INBOUND",
            "port": 30443,
        },
    )
    assert host_response.status_code == 201

    detail_response = await foundation_app.client.get(f"/api/v1/squads/{first_squad_id}/detail")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["users"][0]["email"] == "squad-user@example.com"
    assert detail["profiles"][0]["name"] == "Squad Detail Profile"
    assert detail["hosts"][0]["hostname"] == "squad-detail.example.test"
    assert detail["nodes"][0]["id"] == node_id
    assert detail["inbound_matrix"][0]["tag"] == "SQUAD_DETAIL_INBOUND"

    reorder_response = await foundation_app.client.post(
        "/api/v1/squads/actions/reorder",
        json={"ids": [second_squad_id, first_squad_id]},
    )
    assert reorder_response.status_code == 200
    assert reorder_response.json()["updated"] == 2
    list_response = await foundation_app.client.get("/api/v1/squads")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"][:2]] == [
        second_squad_id,
        first_squad_id,
    ]

    remove_user_response = await foundation_app.client.post(
        f"/api/v1/squads/{first_squad_id}/users/remove",
        json={"user_ids": [user_id]},
    )
    assert remove_user_response.status_code == 200
    assert remove_user_response.json()["metadata_json"]["user_ids"] == []


async def test_user_detail_returns_subscriptions_devices_nodes_and_history(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    create_user_response = await foundation_app.client.post(
        "/api/v1/users",
        json={
            "email": "detail-user@example.com",
            "username": "detail-user",
            "display_name": "Detail User",
            "device_limit": 2,
            "metadata_json": {
                "devices": [
                    {
                        "id": "hwid-1",
                        "hwid": "AABBCC",
                        "platform": "android",
                        "status": "active",
                    }
                ]
            },
        },
    )
    assert create_user_response.status_code == 201
    user_id = create_user_response.json()["id"]

    async with foundation_app.sessionmaker() as session:
        license_record = License(
            license_key_hash=hash_license_key("detail-user-license"),
            customer_ref="detail-user",
            status="active",
            max_devices=2,
            starts_at=datetime.now(UTC),
            metadata_json={},
        )
        session.add(license_record)
        await session.commit()
        license_id = str(license_record.id)

    subscription_response = await foundation_app.client.post(
        "/api/v1/subscriptions",
        json={
            "user_id": user_id,
            "license_id": license_id,
            "node_id": node_id,
            "delivery_profile": {
                "format": "happ",
                "profile_title": "Detail profile",
                "protocol": "vless",
            },
        },
    )
    assert subscription_response.status_code == 201

    detail_response = await foundation_app.client.get(f"/api/v1/users/{user_id}/detail")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["user"]["email"] == "detail-user@example.com"
    assert detail["subscriptions"][0]["public_id"].startswith("lumen_sub")
    assert detail["devices"][0]["hwid"] == "AABBCC"
    assert detail["accessible_nodes"][0]["id"] == node_id
    assert [event["action"] for event in detail["request_history"]] == ["user.created"]


async def test_tools_reports_are_real_database_views(foundation_app: FoundationRouteApp) -> None:
    node_id = await seeded_node_id(foundation_app)

    async with foundation_app.sessionmaker() as session:
        user = User(
            email="tools-user@example.com",
            username="tools-user",
            role=Role.USER.value,
            status="active",
            device_limit=1,
            metadata_json={
                "devices": [
                    {"id": "phone", "hwid": "HWID-1"},
                    {"id": "tablet", "hwid": "HWID-2"},
                ]
            },
        )
        license_record = License(
            license_key_hash=hash_license_key("tools-license"),
            customer_ref="tools",
            status="active",
            max_devices=1,
            starts_at=datetime.now(UTC),
            metadata_json={},
        )
        session.add_all([user, license_record])
        await session.flush()
        subscription = Subscription(
            public_id="lumen_sub_tools",
            user_id=user.id,
            license_id=license_record.id,
            node_id=UUID(node_id),
            status="active",
            delivery_profile={"client": "happ", "update_interval": "12"},
            config_hash="abc123",
        )
        user_session = UserSession(
            user_id=user.id,
            token_hash="tools-session-token",  # noqa: S106 - deterministic test hash.
            ip_hash="ip-hash-abcdef",
            user_agent_hash="ua-hash-abcdef",
            expires_at=datetime(2026, 6, 1, tzinfo=UTC),
        )
        torrent_event = AuditEvent(
            actor_subject=str(user.id),
            actor_email=user.email,
            action="torrent.blocked",
            resource_type="torrent",
            resource_id=str(user.id),
            metadata_json={"host": "example.test"},
        )
        session.add_all([subscription, user_session, torrent_event])
        await session.commit()

    hwid_response = await foundation_app.client.get("/api/v1/tools/hwid-inspector")
    assert hwid_response.status_code == 200
    hwid_row = next(
        item
        for item in hwid_response.json()["items"]
        if item["email"] == "tools-user@example.com"
    )
    assert hwid_row["status"] == "over_limit"
    assert hwid_row["device_count"] == 2

    srh_response = await foundation_app.client.get("/api/v1/tools/srh-inspector")
    assert srh_response.status_code == 200
    srh_row = next(
        item
        for item in srh_response.json()["items"]
        if item["public_id"] == "lumen_sub_tools"
    )
    assert srh_row["parser"] == "happ"
    assert srh_row["response_headers"]["Profile-Update-Interval"] == "12"

    sessions_response = await foundation_app.client.get("/api/v1/tools/sessions")
    assert sessions_response.status_code == 200
    assert any(
        item["email"] == "tools-user@example.com"
        for item in sessions_response.json()["items"]
    )

    torrent_response = await foundation_app.client.get("/api/v1/tools/torrent-blocker-reports")
    assert torrent_response.status_code == 200
    assert torrent_response.json()["items"][0]["action"] == "torrent.blocked"

    routing_response = await foundation_app.client.get("/api/v1/tools/happ-routing")
    assert routing_response.status_code == 200
    routing_row = next(
        item
        for item in routing_response.json()["items"]
        if item["public_id"] == "lumen_sub_tools"
    )
    assert routing_row["route_status"] == "happ"


async def test_protocol_profile_rejects_plaintext_credentials_ref(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Plain credentials",
            "node_id": node_id,
            "adapter": "vless-tcp-tls",
            "credentials_ref": "plain-password-token",
        },
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert "credentials_ref" in body["error"]["details"][0]


async def test_active_profile_rejects_catalog_only_adapter(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    active_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "WireGuard catalog only",
            "node_id": node_id,
            "adapter": "wireguard-native",
            "credentials_ref": "vault://protocols/wireguard/catalog-only",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 51820, "protocol": "udp"}
            ],
        },
    )
    assert active_response.status_code == 422
    assert active_response.json()["error"]["code"] == "protocol_adapter_not_live"

    disabled_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "WireGuard catalog draft",
            "node_id": node_id,
            "adapter": "wireguard-native",
            "status": "disabled",
            "credentials_ref": "vault://protocols/wireguard/catalog-draft",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 51821, "protocol": "udp"}
            ],
        },
    )
    assert disabled_response.status_code == 201
    assert disabled_response.json()["status"] == "disabled"


async def test_node_command_queue_and_metrics(foundation_app: FoundationRouteApp) -> None:
    node_id = await seeded_node_id(foundation_app)
    profile_response = await foundation_app.client.post(
        "/api/v1/profiles",
        json={
            "name": "Command Queue Reality",
            "node_id": node_id,
            "adapter": "vless-reality",
            "credentials_ref": "vault://protocols/command-queue-reality",
            "port_reservations": [
                {"address": WILDCARD_BIND_ADDRESS, "port": 41443, "protocol": "tcp"}
            ],
        },
    )
    assert profile_response.status_code == 201
    profile_id = profile_response.json()["id"]

    command_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands",
        json={"command_type": "protocol.apply", "payload_json": {"profile_id": profile_id}},
    )
    assert command_response.status_code == 201
    command_id = command_response.json()["id"]

    claim_response = await foundation_app.client.get(
        f"/api/v1/nodes/{node_id}/commands/next",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
    )
    assert claim_response.status_code == 200
    assert claim_response.json()["status"] == "claimed"

    complete_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands/{command_id}/result",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={"status": "succeeded", "result_json": {"applied_at": "now"}},
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["completed_at"] is not None

    skipped_command_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands",
        json={
            "command_type": "outbound.apply",
            "payload_json": {"profile_id": profile_id, "node_id": node_id},
        },
    )
    assert skipped_command_response.status_code == 201
    skipped_command_id = skipped_command_response.json()["id"]

    skipped_claim_response = await foundation_app.client.get(
        f"/api/v1/nodes/{node_id}/commands/next",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
    )
    assert skipped_claim_response.status_code == 200

    skipped_complete_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands/{skipped_command_id}/result",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={
            "status": "skipped",
            "result_json": {"reason": "node is paused"},
            "error_code": "command_not_allowed",
        },
    )
    assert skipped_complete_response.status_code == 200
    assert skipped_complete_response.json()["status"] == "skipped"

    empty_claim_response = await foundation_app.client.get(
        f"/api/v1/nodes/{node_id}/commands/next",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
    )
    assert empty_claim_response.status_code == 204

    metric_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/metrics",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={
            "metric_kind": "runtime",
            "values_json": {"ram_mib": 256.0, "event_loop_ms": 20.1},
            "observed_at": datetime(2026, 5, 27, tzinfo=UTC).isoformat(),
        },
    )
    assert metric_response.status_code == 201

    list_metrics_response = await foundation_app.client.get(f"/api/v1/nodes/{node_id}/metrics")
    assert list_metrics_response.status_code == 200
    assert list_metrics_response.json()["items"][0]["values_json"]["ram_mib"] == 256.0


async def test_node_pause_resume_and_quarantine_enqueue_commands(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    pause_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/pause",
        json={"reason": "license expired", "license_enforced": True},
    )
    assert pause_response.status_code == 200
    assert pause_response.json()["status"] == "license_paused"

    resume_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/resume",
        json={"target_status": "offline"},
    )
    assert resume_response.status_code == 200
    assert resume_response.json()["status"] == "offline"

    quarantine_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/quarantine",
        json={"reason": "unexpected config drift"},
    )
    assert quarantine_response.status_code == 200
    assert quarantine_response.json()["status"] == "quarantined"

    commands_response = await foundation_app.client.get(f"/api/v1/nodes/{node_id}/commands")
    assert commands_response.status_code == 200
    command_types = [item["command_type"] for item in commands_response.json()["items"]]
    assert command_types == ["node.quarantine", "node.resume", "node.pause"]


async def test_node_command_result_requires_claimed_command(
    foundation_app: FoundationRouteApp,
) -> None:
    node_id = await seeded_node_id(foundation_app)

    command_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands",
        json={"command_type": "node.pause", "payload_json": {"reason": "maintenance"}},
    )
    assert command_response.status_code == 201

    complete_response = await foundation_app.client.post(
        f"/api/v1/nodes/{node_id}/commands/{command_response.json()['id']}/result",
        headers={"X-Lumen-Node-Token": NODE_TOKEN},
        json={"status": "succeeded", "result_json": {"mode": "paused"}},
    )

    assert complete_response.status_code == 409
    assert complete_response.json()["error"]["code"] == "node_command_not_claimed"
