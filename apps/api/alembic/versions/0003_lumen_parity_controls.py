"""Add admin parity control fields.

Revision ID: 0003_lumen_parity_controls
Revises: 0002_control_plane_foundation
Create Date: 2026-05-28 19:10:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_lumen_parity_controls"
down_revision: str | None = "0002_control_plane_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("display_name", sa.String(length=160), nullable=True))
    op.add_column("users", sa.Column("telegram_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("traffic_limit_gb", sa.Float(), nullable=True))
    op.add_column(
        "users",
        sa.Column("traffic_used_gb", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column("users", sa.Column("device_limit", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column(
        "users",
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_telegram_id", "users", ["telegram_id"], unique=False)

    op.add_column(
        "protocol_profiles",
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
    )

    op.add_column("hosts", sa.Column("address", sa.String(length=255), nullable=True))
    op.add_column("hosts", sa.Column("port", sa.Integer(), nullable=True))
    op.add_column("hosts", sa.Column("inbound_tag", sa.String(length=128), nullable=True))
    op.add_column("hosts", sa.Column("remark", sa.String(length=255), nullable=True))
    op.add_column(
        "hosts",
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_hosts_inbound_tag", "hosts", ["inbound_tag"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_hosts_inbound_tag", table_name="hosts")
    op.drop_column("hosts", "metadata_json")
    op.drop_column("hosts", "remark")
    op.drop_column("hosts", "inbound_tag")
    op.drop_column("hosts", "port")
    op.drop_column("hosts", "address")

    op.drop_column("protocol_profiles", "metadata_json")

    op.drop_index("ix_users_telegram_id", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "metadata_json")
    op.drop_column("users", "tags")
    op.drop_column("users", "expires_at")
    op.drop_column("users", "device_limit")
    op.drop_column("users", "traffic_used_gb")
    op.drop_column("users", "traffic_limit_gb")
    op.drop_column("users", "telegram_id")
    op.drop_column("users", "display_name")
    op.drop_column("users", "username")
