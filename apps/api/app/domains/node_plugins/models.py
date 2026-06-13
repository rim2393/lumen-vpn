from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

# Built-in plugin kinds the node-agent knows how to apply. Free-form strings are
# accepted too, so new filters can ship without a schema change.
KIND_TORRENT_BLOCKER = "torrent-blocker"
KIND_GEOIP_FILTER = "geoip-filter"
KIND_DOMAIN_FILTER = "domain-filter"
KNOWN_KINDS = (KIND_TORRENT_BLOCKER, KIND_GEOIP_FILTER, KIND_DOMAIN_FILTER)


class NodePlugin(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Traffic-filtering / policy plugin applied on a node (or all nodes).

    ``node_id`` is nullable: a null binding means the plugin applies globally to
    every node. Functional equivalent of Lumen's node-plugins module.
    """

    __tablename__ = "node_plugins"

    node_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    config_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
