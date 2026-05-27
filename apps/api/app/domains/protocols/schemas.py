from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

WILDCARD_BIND_ADDRESS = "0.0.0.0"  # noqa: S104 - data value, not a socket bind.


class ProtocolAdapterResponse(BaseModel):
    protocol: str
    display_name: str
    status: str
    capabilities: list[str]
    required_credential_refs: list[str]


class ProtocolAdapterListResponse(BaseModel):
    items: list[ProtocolAdapterResponse]


class PortReservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address: str = Field(default=WILDCARD_BIND_ADDRESS, min_length=1, max_length=64)
    port: int = Field(ge=1, le=65535)
    protocol: Literal["tcp", "udp"] = "tcp"
    exclusive: bool = True


class PortConflict(BaseModel):
    profile_id: UUID
    profile_name: str
    address: str
    port: int
    protocol: str
    suggested_port: int | None
    message: str


class PortCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: UUID
    reservations: list[PortReservation] = Field(min_length=1)
    exclude_profile_id: UUID | None = None


class PortCheckResponse(BaseModel):
    allowed: bool
    conflicts: list[PortConflict]


class ProtocolProfileCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    node_id: UUID
    squad_id: UUID | None = None
    adapter: str = Field(min_length=1, max_length=64)
    status: str = Field(default="active", max_length=32)
    config_json: dict[str, object] = Field(default_factory=dict)
    port_reservations: list[PortReservation] = Field(default_factory=list)
    credentials_ref: str | None = Field(default=None, max_length=512)
    allow_port_conflicts: bool = False


class ProtocolProfileResponse(BaseModel):
    id: UUID
    name: str
    node_id: UUID
    squad_id: UUID | None
    adapter: str
    status: str
    config_json: dict[str, object]
    port_reservations: list[dict[str, object]]
    credentials_ref: str | None


class ProtocolProfileListResponse(BaseModel):
    items: list[ProtocolProfileResponse]


class SquadCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    kind: Literal["internal", "external"] = "internal"
    status: str = Field(default="active", max_length=32)
    metadata_json: dict[str, str] = Field(default_factory=dict)


class SquadResponse(BaseModel):
    id: UUID
    name: str
    kind: str
    status: str
    metadata_json: dict[str, str]


class SquadListResponse(BaseModel):
    items: list[SquadResponse]


class HostCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    hostname: str = Field(min_length=1, max_length=255)
    node_id: UUID
    protocol_profile_id: UUID | None = None
    squad_id: UUID | None = None
    status: str = Field(default="active", max_length=32)
    tags: list[str] = Field(default_factory=list)


class HostResponse(BaseModel):
    id: UUID
    name: str
    hostname: str
    node_id: UUID
    protocol_profile_id: UUID | None
    squad_id: UUID | None
    status: str
    tags: list[str]


class HostListResponse(BaseModel):
    items: list[HostResponse]
