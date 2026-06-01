"""Add IP-control anti-abuse rules and events.

Revision ID: 0006_ip_control
Revises: 0005_login_lockout
Create Date: 2026-05-31 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_ip_control"
down_revision: str | None = "0005_login_lockout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ip_control_rules",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False, server_default="global"),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("max_active_ips", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("action", sa.String(length=16), nullable=False, server_default="block"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ip_control_rules_target_id", "ip_control_rules", ["target_id"]
    )

    op.create_table(
        "ip_control_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=False),
        sa.Column("active_ip_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ip_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("decision", sa.String(length=16), nullable=False, server_default="allowed"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ip_control_events_user_id", "ip_control_events", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_ip_control_events_user_id", table_name="ip_control_events")
    op.drop_table("ip_control_events")
    op.drop_index("ix_ip_control_rules_target_id", table_name="ip_control_rules")
    op.drop_table("ip_control_rules")
