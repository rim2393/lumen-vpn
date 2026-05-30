"""Add OAuth identities, OAuth login state, and WebAuthn passkey tables.

Revision ID: 0004_auth_extensions
Revises: 0003_remna_parity_controls
Create Date: 2026-05-29 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_auth_extensions"
down_revision: str | None = "0003_remna_parity_controls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=160), nullable=True),
        sa.Column("profile_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "subject", name="uq_user_identity_provider_sub"),
    )
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])
    op.create_index("ix_user_identities_provider", "user_identities", ["provider"])
    op.create_index("ix_user_identities_subject", "user_identities", ["subject"])

    op.create_table(
        "oauth_login_states",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("code_verifier", sa.String(length=255), nullable=True),
        sa.Column("nonce", sa.String(length=128), nullable=True),
        sa.Column("redirect_uri", sa.String(length=1024), nullable=False),
        sa.Column("client_redirect", sa.String(length=1024), nullable=True),
        sa.Column("link_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_oauth_login_states_state", "oauth_login_states", ["state"], unique=True
    )

    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.String(length=512), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transports", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("aaguid", sa.String(length=64), nullable=True),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webauthn_credentials_user_id", "webauthn_credentials", ["user_id"])
    op.create_index(
        "ix_webauthn_credentials_credential_id",
        "webauthn_credentials",
        ["credential_id"],
        unique=True,
    )

    op.create_table(
        "webauthn_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("challenge", sa.String(length=512), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webauthn_challenges_user_id", "webauthn_challenges", ["user_id"])
    op.create_index("ix_webauthn_challenges_challenge", "webauthn_challenges", ["challenge"])


def downgrade() -> None:
    op.drop_index("ix_webauthn_challenges_challenge", table_name="webauthn_challenges")
    op.drop_index("ix_webauthn_challenges_user_id", table_name="webauthn_challenges")
    op.drop_table("webauthn_challenges")

    op.drop_index("ix_webauthn_credentials_credential_id", table_name="webauthn_credentials")
    op.drop_index("ix_webauthn_credentials_user_id", table_name="webauthn_credentials")
    op.drop_table("webauthn_credentials")

    op.drop_index("ix_oauth_login_states_state", table_name="oauth_login_states")
    op.drop_table("oauth_login_states")

    op.drop_index("ix_user_identities_subject", table_name="user_identities")
    op.drop_index("ix_user_identities_provider", table_name="user_identities")
    op.drop_index("ix_user_identities_user_id", table_name="user_identities")
    op.drop_table("user_identities")
