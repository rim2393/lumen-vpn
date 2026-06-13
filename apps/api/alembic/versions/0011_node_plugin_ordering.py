"""Add node plugin ordering.

Revision ID: 0011_node_plugin_ordering
Revises: 0010_host_lumen_fields
Create Date: 2026-06-02 02:05:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_node_plugin_ordering"
down_revision: str | None = "0010_host_lumen_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "node_plugins",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_node_plugins_sort_order", "node_plugins", ["sort_order"])
    op.alter_column("node_plugins", "sort_order", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_node_plugins_sort_order", table_name="node_plugins")
    op.drop_column("node_plugins", "sort_order")
