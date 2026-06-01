"""Add infra-billing (CRM cost tracking).

Revision ID: 0008_infra_billing
Revises: 0007_node_plugins
Create Date: 2026-05-31 01:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_infra_billing"
down_revision: str | None = "0007_node_plugins"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "infra_providers",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False, unique=True),
        sa.Column("login_url", sa.String(length=512), nullable=True),
        sa.Column("notes", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "infra_billing_records",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "provider_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("infra_providers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "node_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("nodes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("period", sa.String(length=16), nullable=False),
        sa.Column("note", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_infra_billing_records_provider_id", "infra_billing_records", ["provider_id"]
    )
    op.create_index(
        "ix_infra_billing_records_node_id", "infra_billing_records", ["node_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_infra_billing_records_node_id", table_name="infra_billing_records")
    op.drop_index("ix_infra_billing_records_provider_id", table_name="infra_billing_records")
    op.drop_table("infra_billing_records")
    op.drop_table("infra_providers")
