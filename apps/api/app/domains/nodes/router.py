from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, status
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.nodes.models import Node, NodeProvisioningJob
from app.domains.nodes.schemas import (
    InstallTokenExchangeRequest,
    InstallTokenExchangeResponse,
    InstallTokenIssueResponse,
    NodeCreateRequest,
    NodeHeartbeatRequest,
    NodeListResponse,
    NodeResponse,
    PreflightUpdateRequest,
    ProvisioningJobCreateRequest,
    ProvisioningJobResponse,
)
from app.domains.nodes.service import (
    create_manual_node,
    exchange_install_token,
    get_provisioning_job,
    issue_install_token,
    record_node_heartbeat,
    update_preflight_state,
)
from app.domains.nodes.service import (
    create_provisioning_job as create_provisioning_job_record,
)
from app.domains.nodes.service import (
    get_node as get_node_record,
)
from app.domains.nodes.service import (
    list_nodes as list_node_records,
)

router = APIRouter()
NodeManager = Annotated[Principal, Depends(require_permission(Permission.NODE_MANAGE))]
DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]
NodeTokenHeader = Annotated[str, Header(alias="X-Lumen-Node-Token")]


def node_response(node: Node) -> NodeResponse:
    return NodeResponse(
        id=node.id,
        name=node.name,
        region=node.region,
        public_address=node.public_address,
        status=node.status,
        capabilities=node.capabilities,
        last_seen_at=node.last_seen_at,
    )


def provisioning_job_response(job: NodeProvisioningJob) -> ProvisioningJobResponse:
    return ProvisioningJobResponse(
        id=job.id,
        idempotency_key=job.idempotency_key,
        node_id=job.node_id,
        kind=job.kind,
        status=job.status,
        preflight_status=job.preflight_status,
        ssh_host=job.ssh_host,
        ssh_port=job.ssh_port,
        ssh_username=job.ssh_username,
        ssh_credentials_ref=job.ssh_credentials_ref,
        requested_capabilities=job.requested_capabilities,
        preflight_result=job.preflight_result,
        error_code=job.error_code,
        error_message=job.error_message,
        token_issued_at=job.token_issued_at,
        token_exchanged_at=job.token_exchanged_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.post(
    "/provisioning-jobs",
    response_model=ProvisioningJobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_provisioning_job(
    request: ProvisioningJobCreateRequest,
    _: NodeManager,
    session: DatabaseSession,
    settings: AppSettings,
) -> ProvisioningJobResponse:
    job = await create_provisioning_job_record(session, request=request, settings=settings)
    await session.commit()
    return provisioning_job_response(job)


@router.get("/provisioning-jobs/{job_id}", response_model=ProvisioningJobResponse)
async def read_provisioning_job(
    job_id: UUID,
    _: NodeManager,
    session: DatabaseSession,
) -> ProvisioningJobResponse:
    job = await get_provisioning_job(session, job_id=job_id)
    return provisioning_job_response(job)


@router.post("/provisioning-jobs/{job_id}/preflight", response_model=ProvisioningJobResponse)
async def update_provisioning_preflight(
    job_id: UUID,
    request: PreflightUpdateRequest,
    _: NodeManager,
    session: DatabaseSession,
) -> ProvisioningJobResponse:
    job = await update_preflight_state(session, job_id=job_id, request=request)
    await session.commit()
    return provisioning_job_response(job)


@router.post(
    "/provisioning-jobs/{job_id}/install-token",
    response_model=InstallTokenIssueResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_install_token(
    job_id: UUID,
    _: NodeManager,
    session: DatabaseSession,
    settings: AppSettings,
) -> InstallTokenIssueResponse:
    issued = await issue_install_token(session, job_id=job_id, settings=settings)
    await session.commit()
    return InstallTokenIssueResponse(
        provisioning_job_id=issued.token.provisioning_job_id,
        token_prefix=issued.token.token_prefix,
        install_token=issued.plaintext,
        expires_at=issued.token.expires_at,
    )


@router.post("/install-token/exchange", response_model=InstallTokenExchangeResponse)
async def exchange_node_install_token(
    request: InstallTokenExchangeRequest,
    session: DatabaseSession,
    settings: AppSettings,
) -> InstallTokenExchangeResponse:
    exchanged = await exchange_install_token(session, request=request, settings=settings)
    await session.commit()
    return InstallTokenExchangeResponse(
        provisioning_job_id=exchanged.job.id,
        node_id=exchanged.node.id,
        node_token_prefix=exchanged.node.agent_token_prefix or "",
        node_token=exchanged.node_token,
        heartbeat_path=f"/api/v1/nodes/{exchanged.node.id}/heartbeat",
    )


@router.post("/{node_id}/heartbeat", response_model=NodeResponse)
async def create_node_heartbeat(
    node_id: UUID,
    request: NodeHeartbeatRequest,
    node_token: NodeTokenHeader,
    session: DatabaseSession,
    settings: AppSettings,
) -> NodeResponse:
    node = await record_node_heartbeat(
        session,
        node_id=node_id,
        node_token=SecretStr(node_token),
        request=request,
        settings=settings,
    )
    await session.commit()
    return node_response(node)


@router.get("", response_model=NodeListResponse)
async def list_nodes(
    _: NodeManager,
    session: DatabaseSession,
) -> NodeListResponse:
    nodes = await list_node_records(session)
    return NodeListResponse(items=[node_response(node) for node in nodes])


@router.post("", response_model=NodeResponse, status_code=status.HTTP_201_CREATED)
async def create_node(
    request: NodeCreateRequest,
    _: NodeManager,
    session: DatabaseSession,
    settings: AppSettings,
) -> NodeResponse:
    node = await create_manual_node(session, request=request, settings=settings)
    await session.commit()
    return node_response(node)


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(
    node_id: UUID,
    _: NodeManager,
    session: DatabaseSession,
) -> NodeResponse:
    node = await get_node_record(session, node_id=node_id)
    return node_response(node)
