#!/usr/bin/env bash
set -euo pipefail

# Production live smoke for PR-004.
# Runs on the panel host. It creates temporary real control-plane records,
# applies IKEv2 to the real node-agent, fetches the public raw .sswan renderer,
# imports it into an isolated strongSwan client container, initiates one IKE SA,
# then removes all temporary records. It must not print subscription credentials.

API_CONTAINER="${LUMEN_API_CONTAINER:-lumen-api-1}"
PANEL_PUBLIC_URL="${LUMEN_PANEL_PUBLIC_URL:-https://panel.89-185-85-184.sslip.io}"
NODE_NAME="${LUMEN_LIVE_NODE_NAME:-node-01}"
QA_PREFIX="${LUMEN_QA_PREFIX:-qa_pr004}"
CLIENT_IMAGE="${LUMEN_IKEV2_CLIENT_IMAGE:-ubuntu:24.04}"
WORKDIR="$(mktemp -d /tmp/lumen-ikev2-smoke.XXXXXX)"
STATE_FILE="$WORKDIR/state.json"
SSWAN_FILE="$WORKDIR/profile.sswan.json"
CLIENT_DIR="$WORKDIR/client-swanctl"

cleanup() {
  set +e
  if docker ps --format '{{.Names}}' | grep -qx 'lumen-ikev2-client-smoke'; then
    docker rm -f lumen-ikev2-client-smoke >/dev/null 2>&1 || true
  fi
  if docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
    docker exec -i "$API_CONTAINER" python - "$QA_PREFIX" <<'PY' >/dev/null 2>&1 || true
import asyncio
import sys
from uuid import uuid4

from sqlalchemy import delete, func, select

import app.db.models  # noqa: F401
from app.core.config import get_settings
from app.db.session import create_sessionmaker
from app.domains.licenses.models import License
from app.domains.nodes.models import NodeCommand
from app.domains.protocols.models import ProtocolProfile
from app.domains.subscriptions.models import Subscription
from app.domains.users.models import User

qa = sys.argv[1]

async def stop_qa_ikev2_runtime(session) -> None:
    non_qa_ikev2 = (
        await session.execute(
            select(func.count())
            .select_from(ProtocolProfile)
            .where(ProtocolProfile.adapter.like("ikev2%"))
            .where(ProtocolProfile.status == "active")
            .where(~ProtocolProfile.name.like(f"{qa}-%"))
        )
    ).scalar_one()
    if non_qa_ikev2:
        return
    qa_profile = (
        await session.execute(
            select(ProtocolProfile)
            .where(ProtocolProfile.name.like(f"{qa}-%"))
            .where(ProtocolProfile.adapter.like("ikev2%"))
            .order_by(ProtocolProfile.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if qa_profile is None:
        return
    command = NodeCommand(
        id=uuid4(),
        node_id=qa_profile.node_id,
        command_type="outbound.remove",
        status="queued",
        payload_json={"adapter": "ikev2-eap", "profileId": str(qa_profile.id)},
    )
    session.add(command)
    await session.commit()
    deadline = asyncio.get_running_loop().time() + 90
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(2)
        row = await session.get(NodeCommand, command.id)
        if row is not None and row.status in {"succeeded", "failed"}:
            return

async def main() -> None:
    maker = create_sessionmaker(get_settings())
    async with maker() as session:
        await stop_qa_ikev2_runtime(session)
        qa_user_ids = select(User.id).where(User.email.like(f"{qa}-%@example.test"))
        qa_license_ids = select(License.id).where(License.customer_ref.like(f"{qa}-%"))
        await session.execute(delete(Subscription).where(Subscription.config_hash.like(f"sha256:{qa}%")))
        await session.execute(delete(Subscription).where(Subscription.user_id.in_(qa_user_ids)))
        await session.execute(delete(Subscription).where(Subscription.license_id.in_(qa_license_ids)))
        await session.execute(delete(ProtocolProfile).where(ProtocolProfile.name.like(f"{qa}-%")))
        await session.execute(delete(User).where(User.email.like(f"{qa}-%@example.test")))
        await session.execute(delete(License).where(License.customer_ref.like(f"{qa}-%")))
        await session.commit()
    await maker.kw["bind"].dispose()

asyncio.run(main())
PY
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$CLIENT_DIR/x509ca" "$CLIENT_DIR/private"

docker exec -i "$API_CONTAINER" python - "$QA_PREFIX" "$NODE_NAME" >"$STATE_FILE" <<'PY'
import asyncio
import hashlib
import json
import sys
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

import app.db.models  # noqa: F401
from app.core.config import get_settings
from app.db.session import create_sessionmaker
from app.domains.licenses.models import License
from app.domains.nodes.models import Node, NodeCommand
from app.domains.protocols.models import ProtocolProfile
from app.domains.protocols.schemas import PortReservation, ProtocolProfileCreateRequest
from app.domains.protocols.service import apply_profile_to_node, create_profile
from app.domains.subscriptions.models import Subscription
from app.domains.subscriptions.schemas import SubscriptionCreateRequest
from app.domains.subscriptions.service import create_subscription
from app.domains.users.models import User

qa = sys.argv[1]
node_name = sys.argv[2]
stamp = str(int(time.time() * 1000))

async def delete_old_qa(session) -> None:
    qa_user_ids = select(User.id).where(User.email.like(f"{qa}-%@example.test"))
    qa_license_ids = select(License.id).where(License.customer_ref.like(f"{qa}-%"))
    await session.execute(delete(Subscription).where(Subscription.config_hash.like(f"sha256:{qa}%")))
    await session.execute(delete(Subscription).where(Subscription.user_id.in_(qa_user_ids)))
    await session.execute(delete(Subscription).where(Subscription.license_id.in_(qa_license_ids)))
    await session.execute(delete(ProtocolProfile).where(ProtocolProfile.name.like(f"{qa}-%")))
    await session.execute(delete(User).where(User.email.like(f"{qa}-%@example.test")))
    await session.execute(delete(License).where(License.customer_ref.like(f"{qa}-%")))
    await session.flush()

async def main() -> None:
    maker = create_sessionmaker(get_settings())
    async with maker() as session:
        await delete_old_qa(session)
        node = (
            await session.execute(
                select(Node)
                .where(Node.name == node_name)
                .where(Node.status.in_(["online", "active", "ready"]))
                .limit(1)
            )
        ).scalar_one_or_none()
        if node is None:
            node = (
                await session.execute(
                    select(Node).where(Node.name == node_name).limit(1)
                )
            ).scalar_one_or_none()
        if node is None:
            raise RuntimeError(f"node {node_name!r} was not found")

        user = User(
            email=f"{qa}-{stamp}@example.test",
            role="user",
            status="active",
            username=f"{qa}_{stamp}",
            display_name="QA PR-004 IKEv2",
            device_limit=1,
            tags=[qa],
            metadata_json={"qa": qa, "created_by": "ikev2-client-connect-smoke"},
        )
        license_record = License(
            license_key_hash=hashlib.sha256(f"{qa}:{stamp}".encode()).hexdigest(),
            customer_ref=f"{qa}-{stamp}",
            status="active",
            max_devices=1,
            starts_at=datetime.now(UTC) - timedelta(minutes=5),
            expires_at=datetime.now(UTC) + timedelta(hours=2),
            metadata_json={"qa": qa},
        )
        session.add_all([user, license_record])
        await session.flush()

        profile = await create_profile(
            session,
            request=ProtocolProfileCreateRequest(
                name=f"{qa}-ikev2-{stamp}",
                node_id=node.id,
                adapter="ikev2-eap",
                status="active",
                config_json={
                    "server_id": f"ikev2.{node.public_address}",
                    "pool": "10.92.0.0/24",
                    "dns": ["1.1.1.1"],
                },
                port_reservations=[
                    PortReservation(port=500, protocol="udp", exclusive=True),
                    PortReservation(port=4500, protocol="udp", exclusive=True),
                ],
                credentials_ref=f"vault://qa/{qa}/ikev2",
                metadata_json={"qa": qa, "created_by": "ikev2-client-connect-smoke"},
                allow_port_conflicts=True,
            ),
        )
        subscription = await create_subscription(
            session,
            request=SubscriptionCreateRequest(
                user_id=user.id,
                license_id=license_record.id,
                node_id=node.id,
                delivery_profile={
                    "profile_id": str(profile.id),
                    "protocol": "ikev2",
                    "adapter": "ikev2-eap",
                    "profile_title": "Lumen QA IKEv2",
                    "port": "500",
                },
                config_hash=f"sha256:{qa}:{stamp}",
                expires_at=datetime.now(UTC) + timedelta(hours=2),
            ),
        )
        command = await apply_profile_to_node(session, profile_id=profile.id)
        await session.commit()

        deadline = time.monotonic() + 120
        last_status = None
        last_error = None
        while time.monotonic() < deadline:
            await asyncio.sleep(2)
            command_row = await session.get(NodeCommand, command.id)
            if command_row is None:
                raise RuntimeError("queued command disappeared")
            await session.refresh(command_row)
            last_status = command_row.status
            last_error = command_row.error_message
            if command_row.status in {"succeeded", "failed"}:
                break
        if last_status != "succeeded":
            raise RuntimeError(f"outbound.apply did not succeed: {last_status} {last_error or ''}".strip())

        print(json.dumps({
            "public_id": subscription.public_id,
            "profile_id": str(profile.id),
            "command_id": str(command.id),
            "node_address": node.public_address,
        }))
    await maker.kw["bind"].dispose()

asyncio.run(main())
PY

PUBLIC_ID="$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['public_id'])" "$STATE_FILE")"
curl -fsS --retry 2 --max-time 30 \
  "$PANEL_PUBLIC_URL/api/v1/subscriptions/public/$PUBLIC_ID/render?target=raw-uri" \
  -o "$SSWAN_FILE"

python - "$SSWAN_FILE" "$CLIENT_DIR" <<'PY'
import base64
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
client_dir = pathlib.Path(sys.argv[2])
ca_path = client_dir / "x509ca" / "lumen-ikev2-ca.pem"
ca_path.write_text(base64.b64decode(payload["remote"]["cert"]).decode("utf-8"), encoding="utf-8")

def q(value: object) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'

remote_addr = payload["remote"]["addr"]
remote_id = payload["remote"]["id"]
eap_id = payload["local"]["eap_id"]
secret = payload["local"]["shared_secret"]
conf = f"""connections {{
  lumen-smoke {{
    version = 2
    remote_addrs = {remote_addr}
    proposals = aes256gcm16-prfsha384-ecp384,aes256-sha256-modp2048
    vips = 0.0.0.0
    send_certreq = yes

    local {{
      auth = eap-mschapv2
      eap_id = {q(eap_id)}
    }}
    remote {{
      auth = pubkey
      id = {q(remote_id)}
    }}
    children {{
      lumen-smoke-child {{
        remote_ts = 0.0.0.0/0
        esp_proposals = aes256gcm16-ecp384,aes256-sha256-modp2048
        start_action = none
      }}
    }}
  }}
}}

secrets {{
  eap-lumen-smoke {{
    id = {q(eap_id)}
    secret = {q(secret)}
  }}
}}
"""
(client_dir / "swanctl.conf").write_text(conf, encoding="utf-8")
print(json.dumps({
    "remote": remote_addr,
    "remote_id_present": bool(remote_id),
    "ca_loaded": ca_path.exists(),
    "profile_type": payload.get("type"),
}))
PY

docker run --rm --name lumen-ikev2-client-smoke \
  --cap-add NET_ADMIN --cap-add NET_RAW \
  --device /dev/net/tun:/dev/net/tun \
  -v "$CLIENT_DIR:/etc/swanctl:rw" \
  "$CLIENT_IMAGE" bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update >/dev/null
    apt-get install -y --no-install-recommends strongswan-swanctl strongswan-charon iproute2 ca-certificates >/dev/null
    ipsec start >/dev/null
    timeout 15 bash -lc "until [ -S /var/run/charon.vici ]; do sleep 0.2; done"
    swanctl --load-all >/tmp/lumen-load.log
    swanctl --initiate --child lumen-smoke-child --timeout 30 >/tmp/lumen-initiate.log
    swanctl --list-sas >/tmp/lumen-sas.log
    grep -q "ESTABLISHED" /tmp/lumen-sas.log
    swanctl --terminate --ike lumen-smoke >/dev/null 2>&1 || true
    ipsec stop >/dev/null 2>&1 || true
    printf "%s\n" "ikev2_client_connect=succeeded"
  '

python - "$STATE_FILE" <<'PY'
import json
import sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps({
    "status": "succeeded",
    "command_id": state["command_id"],
    "node_address": state["node_address"],
}, ensure_ascii=False))
PY
