"""Add node-plugins (traffic filtering policies).

Revision ID: 0007_node_plugins
Revises: 0006_ip_control
Create Date: 2026-05-31 00:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_node_plugins"
down_revision: str | None = "0006_ip_control"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "node_plugins",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "node_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("nodes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_node_plugins_node_id", "node_plugins", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_node_plugins_node_id", table_name="node_plugins")
    op.drop_table("node_plugins")
