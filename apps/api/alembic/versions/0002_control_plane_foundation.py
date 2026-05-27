"""Add control-plane foundation tables.

Revision ID: 0002_control_plane_foundation
Revises: 0001_initial_schema
Create Date: 2026-05-27 11:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_control_plane_foundation"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("actor_subject", sa.String(length=128), nullable=False),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=128), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
    )
    op.create_index("ix_audit_events_action", "audit_events", ["action"], unique=False)
    op.create_index(
        "ix_audit_events_actor_subject",
        "audit_events",
        ["actor_subject"],
        unique=False,
    )
    op.create_index("ix_audit_events_resource_id", "audit_events", ["resource_id"], unique=False)
    op.create_index(
        "ix_audit_events_resource_type",
        "audit_events",
        ["resource_type"],
        unique=False,
    )

    op.create_table(
        "panel_settings",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value_json", sa.JSON(), nullable=False),
        sa.Column("updated_by", sa.String(length=128), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_panel_settings"),
        sa.UniqueConstraint("key", name="uq_panel_settings_key"),
    )
    op.create_index("ix_panel_settings_key", "panel_settings", ["key"], unique=False)

    op.create_table(
        "squads",
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_squads"),
        sa.UniqueConstraint("name", name="uq_squads_name"),
    )
    op.create_index("ix_squads_kind", "squads", ["kind"], unique=False)
    op.create_index("ix_squads_name", "squads", ["name"], unique=False)
    op.create_index("ix_squads_status", "squads", ["status"], unique=False)

    op.create_table(
        "user_mfa_methods",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("secret_ciphertext", sa.String(length=2048), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_mfa_methods_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_mfa_methods"),
    )
    op.create_index("ix_user_mfa_methods_kind", "user_mfa_methods", ["kind"], unique=False)
    op.create_index("ix_user_mfa_methods_user_id", "user_mfa_methods", ["user_id"], unique=False)

    op.create_table(
        "node_commands",
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("command_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=512), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["node_id"],
            ["nodes.id"],
            name="fk_node_commands_node_id_nodes",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_node_commands"),
    )
    op.create_index(
        "ix_node_commands_command_type",
        "node_commands",
        ["command_type"],
        unique=False,
    )
    op.create_index("ix_node_commands_node_id", "node_commands", ["node_id"], unique=False)
    op.create_index("ix_node_commands_status", "node_commands", ["status"], unique=False)

    op.create_table(
        "node_metrics",
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("metric_kind", sa.String(length=64), nullable=False),
        sa.Column("values_json", sa.JSON(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["node_id"],
            ["nodes.id"],
            name="fk_node_metrics_node_id_nodes",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_node_metrics"),
    )
    op.create_index("ix_node_metrics_metric_kind", "node_metrics", ["metric_kind"], unique=False)
    op.create_index("ix_node_metrics_node_id", "node_metrics", ["node_id"], unique=False)

    op.create_table(
        "protocol_profiles",
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("squad_id", sa.Uuid(), nullable=True),
        sa.Column("adapter", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("port_reservations", sa.JSON(), nullable=False),
        sa.Column("credentials_ref", sa.String(length=512), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["node_id"],
            ["nodes.id"],
            name="fk_protocol_profiles_node_id_nodes",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["squad_id"],
            ["squads.id"],
            name="fk_protocol_profiles_squad_id_squads",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_protocol_profiles"),
        sa.UniqueConstraint("name", name="uq_protocol_profiles_name"),
    )
    op.create_index("ix_protocol_profiles_adapter", "protocol_profiles", ["adapter"], unique=False)
    op.create_index("ix_protocol_profiles_name", "protocol_profiles", ["name"], unique=False)
    op.create_index("ix_protocol_profiles_node_id", "protocol_profiles", ["node_id"], unique=False)
    op.create_index(
        "ix_protocol_profiles_squad_id",
        "protocol_profiles",
        ["squad_id"],
        unique=False,
    )
    op.create_index("ix_protocol_profiles_status", "protocol_profiles", ["status"], unique=False)

    op.create_table(
        "hosts",
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("protocol_profile_id", sa.Uuid(), nullable=True),
        sa.Column("squad_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["node_id"],
            ["nodes.id"],
            name="fk_hosts_node_id_nodes",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["protocol_profile_id"],
            ["protocol_profiles.id"],
            name="fk_hosts_protocol_profile_id_protocol_profiles",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["squad_id"],
            ["squads.id"],
            name="fk_hosts_squad_id_squads",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_hosts"),
        sa.UniqueConstraint("name", name="uq_hosts_name"),
    )
    op.create_index("ix_hosts_hostname", "hosts", ["hostname"], unique=False)
    op.create_index("ix_hosts_name", "hosts", ["name"], unique=False)
    op.create_index("ix_hosts_node_id", "hosts", ["node_id"], unique=False)
    op.create_index(
        "ix_hosts_protocol_profile_id",
        "hosts",
        ["protocol_profile_id"],
        unique=False,
    )
    op.create_index("ix_hosts_squad_id", "hosts", ["squad_id"], unique=False)
    op.create_index("ix_hosts_status", "hosts", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_hosts_status", table_name="hosts")
    op.drop_index("ix_hosts_squad_id", table_name="hosts")
    op.drop_index("ix_hosts_protocol_profile_id", table_name="hosts")
    op.drop_index("ix_hosts_node_id", table_name="hosts")
    op.drop_index("ix_hosts_name", table_name="hosts")
    op.drop_index("ix_hosts_hostname", table_name="hosts")
    op.drop_table("hosts")

    op.drop_index("ix_protocol_profiles_status", table_name="protocol_profiles")
    op.drop_index("ix_protocol_profiles_squad_id", table_name="protocol_profiles")
    op.drop_index("ix_protocol_profiles_node_id", table_name="protocol_profiles")
    op.drop_index("ix_protocol_profiles_name", table_name="protocol_profiles")
    op.drop_index("ix_protocol_profiles_adapter", table_name="protocol_profiles")
    op.drop_table("protocol_profiles")

    op.drop_index("ix_node_metrics_node_id", table_name="node_metrics")
    op.drop_index("ix_node_metrics_metric_kind", table_name="node_metrics")
    op.drop_table("node_metrics")

    op.drop_index("ix_node_commands_status", table_name="node_commands")
    op.drop_index("ix_node_commands_node_id", table_name="node_commands")
    op.drop_index("ix_node_commands_command_type", table_name="node_commands")
    op.drop_table("node_commands")

    op.drop_index("ix_user_mfa_methods_user_id", table_name="user_mfa_methods")
    op.drop_index("ix_user_mfa_methods_kind", table_name="user_mfa_methods")
    op.drop_table("user_mfa_methods")

    op.drop_index("ix_squads_status", table_name="squads")
    op.drop_index("ix_squads_name", table_name="squads")
    op.drop_index("ix_squads_kind", table_name="squads")
    op.drop_table("squads")

    op.drop_index("ix_panel_settings_key", table_name="panel_settings")
    op.drop_table("panel_settings")

    op.drop_index("ix_audit_events_resource_type", table_name="audit_events")
    op.drop_index("ix_audit_events_resource_id", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_subject", table_name="audit_events")
    op.drop_index("ix_audit_events_action", table_name="audit_events")
    op.drop_table("audit_events")
