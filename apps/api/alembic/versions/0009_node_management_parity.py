"""Add node management parity fields.

Revision ID: 0009_node_management_parity
Revises: 0008_infra_billing
Create Date: 2026-06-01 19:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_node_management_parity"
down_revision: str | None = "0008_infra_billing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "nodes",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_nodes_sort_order", "nodes", ["sort_order"])
    op.alter_column("nodes", "sort_order", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_nodes_sort_order", table_name="nodes")
    op.drop_column("nodes", "sort_order")
