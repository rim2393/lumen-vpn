from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.rbac import Permission, Principal, require_permission
from app.db.session import get_db_session
from app.domains.nodes.models import Node, NodeCommand, NodeMetric, NodeProvisioningJob
from app.domains.nodes.schemas import (
    InstallTokenExchangeRequest,
    InstallTokenExchangeResponse,
    InstallTokenIssueResponse,
    NodeCommandCreateRequest,
    NodeCommandListResponse,
    NodeCommandResponse,
    NodeCommandResultRequest,
    NodeCreateRequest,
    NodeHeartbeatRequest,
    NodeListResponse,
    NodeMetricCreateRequest,
    NodeMetricListResponse,
    NodeMetricResponse,
    NodePauseRequest,
    NodeQuarantineRequest,
    NodeResponse,
    NodeResumeRequest,
    PreflightUpdateRequest,
    ProvisioningJobCreateRequest,
    ProvisioningJobResponse,
)
from app.domains.nodes.service import (
    claim_next_node_command,
    complete_node_command,
    create_manual_node,
    enqueue_node_command,
    exchange_install_token,
    get_provisioning_job,
    issue_install_token,
    list_node_commands,
    list_node_metrics,
    pause_node,
    quarantine_node,
    record_node_heartbeat,
    record_node_metric,
    resume_node,
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


def node_command_response(command: NodeCommand) -> NodeCommandResponse:
    return NodeCommandResponse(
        id=command.id,
        node_id=command.node_id,
        command_type=command.command_type,
        status=command.status,
        payload_json=command.payload_json,
        result_json=command.result_json,
        error_code=command.error_code,
        error_message=command.error_message,
        claimed_at=command.claimed_at,
        completed_at=command.completed_at,
        created_at=command.created_at,
        updated_at=command.updated_at,
    )


def node_metric_response(metric: NodeMetric) -> NodeMetricResponse:
    return NodeMetricResponse(
        id=metric.id,
        node_id=metric.node_id,
        metric_kind=metric.metric_kind,
        values_json=metric.values_json,
        observed_at=metric.observed_at,
        created_at=metric.created_at,
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


@router.get("/{node_id}/commands", response_model=NodeCommandListResponse)
async def list_commands(
    node_id: UUID,
    _: NodeManager,
    session: DatabaseSession,
) -> NodeCommandListResponse:
    commands = await list_node_commands(session, node_id=node_id)
    return NodeCommandListResponse(items=[node_command_response(command) for command in commands])


@router.post(
    "/{node_id}/commands",
    response_model=NodeCommandResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_command(
    node_id: UUID,
    request: NodeCommandCreateRequest,
    _: NodeManager,
    session: DatabaseSession,
) -> NodeCommandResponse:
    command = await enqueue_node_command(session, node_id=node_id, request=request)
    await session.commit()
    return node_command_response(command)


@router.get("/{node_id}/commands/next", response_model=NodeCommandResponse | None)
async def claim_next_command(
    node_id: UUID,
    node_token: NodeTokenHeader,
    session: DatabaseSession,
    settings: AppSettings,
) -> NodeCommandResponse | Response:
    command = await claim_next_node_command(
        session,
        node_id=node_id,
        node_token=SecretStr(node_token),
        settings=settings,
    )
    await session.commit()
    if command is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return node_command_response(command)


@router.post("/{node_id}/commands/{command_id}/result", response_model=NodeCommandResponse)
async def complete_command(
    node_id: UUID,
    command_id: UUID,
    request: NodeCommandResultRequest,
    node_token: NodeTokenHeader,
    session: DatabaseSession,
    settings: AppSettings,
) -> NodeCommandResponse:
    command = await complete_node_command(
        session,
        node_id=node_id,
        command_id=command_id,
        node_token=SecretStr(node_token),
        request=request,
        settings=settings,
    )
    await session.commit()
    return node_command_response(command)


@router.get("/{node_id}/metrics", response_model=NodeMetricListResponse)
async def list_metrics(
    node_id: UUID,
    _: NodeManager,
    session: DatabaseSession,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> NodeMetricListResponse:
    metrics = await list_node_metrics(session, node_id=node_id, limit=limit)
    return NodeMetricListResponse(items=[node_metric_response(metric) for metric in metrics])


@router.post(
    "/{node_id}/metrics",
    response_model=NodeMetricResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_metric(
    node_id: UUID,
    request: NodeMetricCreateRequest,
    node_token: NodeTokenHeader,
    session: DatabaseSession,
    settings: AppSettings,
) -> NodeMetricResponse:
    metric = await record_node_metric(
        session,
        node_id=node_id,
        node_token=SecretStr(node_token),
        request=request,
        settings=settings,
    )
    await session.commit()
    return node_metric_response(metric)


@router.post("/{node_id}/pause", response_model=NodeResponse)
async def pause_existing_node(
    node_id: UUID,
    request: NodePauseRequest,
    _: NodeManager,
    session: DatabaseSession,
) -> NodeResponse:
    node = await pause_node(session, node_id=node_id, request=request)
    await session.commit()
    return node_response(node)


@router.post("/{node_id}/resume", response_model=NodeResponse)
async def resume_existing_node(
    node_id: UUID,
    request: NodeResumeRequest,
    _: NodeManager,
    session: DatabaseSession,
) -> NodeResponse:
    node = await resume_node(session, node_id=node_id, request=request)
    await session.commit()
    return node_response(node)


@router.post("/{node_id}/quarantine", response_model=NodeResponse)
async def quarantine_existing_node(
    node_id: UUID,
    request: NodeQuarantineRequest,
    _: NodeManager,
    session: DatabaseSession,
) -> NodeResponse:
    node = await quarantine_node(session, node_id=node_id, request=request)
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
