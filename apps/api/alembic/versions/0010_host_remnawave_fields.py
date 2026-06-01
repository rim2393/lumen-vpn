"""Add Remnawave host parity fields.

Revision ID: 0010_host_remnawave_fields
Revises: 0009_node_management_parity
Create Date: 2026-06-01 21:50:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_host_remnawave_fields"
down_revision: str | None = "0009_node_management_parity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("hosts", sa.Column("path", sa.String(length=512), nullable=True))
    op.add_column("hosts", sa.Column("sni", sa.String(length=255), nullable=True))
    op.add_column("hosts", sa.Column("security", sa.String(length=64), nullable=True))
    op.add_column(
        "hosts",
        sa.Column("xray_template_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column("hosts", sa.Column("mux_json", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column(
        "hosts",
        sa.Column("sockopt_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column("hosts", sa.Column("xhttp_json", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column(
        "hosts",
        sa.Column("subscription_excluded", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "hosts",
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "hosts",
        sa.Column("excluded_internal_squad_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "hosts",
        sa.Column("shuffle_host", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("hosts", sa.Column("final_mask", sa.String(length=255), nullable=True))
    op.add_column(
        "hosts",
        sa.Column("mihomo_x25519_public_key", sa.String(length=128), nullable=True),
    )
    for column in (
        "xray_template_json",
        "mux_json",
        "sockopt_json",
        "xhttp_json",
        "subscription_excluded",
        "hidden",
        "excluded_internal_squad_ids",
        "shuffle_host",
    ):
        op.alter_column("hosts", column, server_default=None)


def downgrade() -> None:
    op.drop_column("hosts", "mihomo_x25519_public_key")
    op.drop_column("hosts", "final_mask")
    op.drop_column("hosts", "shuffle_host")
    op.drop_column("hosts", "excluded_internal_squad_ids")
    op.drop_column("hosts", "hidden")
    op.drop_column("hosts", "subscription_excluded")
    op.drop_column("hosts", "xhttp_json")
    op.drop_column("hosts", "sockopt_json")
    op.drop_column("hosts", "mux_json")
    op.drop_column("hosts", "xray_template_json")
    op.drop_column("hosts", "security")
    op.drop_column("hosts", "sni")
    op.drop_column("hosts", "path")
