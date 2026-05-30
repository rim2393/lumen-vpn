from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, AnyUrl, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "test", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LUMEN_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "Lumen API"
    app_version: str = "0.1.0"
    environment: Environment = "local"
    api_v1_prefix: str = "/api/v1"
    docs_url: str | None = "/docs"
    redoc_url: str | None = "/redoc"
    openapi_url: str | None = "/openapi.json"

    database_url: str = "sqlite+aiosqlite:///:memory:"
    database_echo: bool = False

    allowed_origins: list[AnyUrl] = []
    trusted_proxy_headers: bool = False

    jwt_issuer: str = "lumen-api"
    jwt_audience: str = "lumen-clients"
    jwt_private_key: SecretStr | None = None
    jwt_public_key: SecretStr | None = None
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 2_592_000
    mfa_challenge_ttl_seconds: int = 300

    # Brute-force protection: lock an account after N consecutive failed
    # password attempts, for the configured window.
    login_max_failed_attempts: int = 5
    login_lockout_seconds: int = 900

    api_key_hash_pepper: SecretStr | None = None
    bootstrap_admin_api_key: SecretStr | None = None
    session_hash_pepper: SecretStr | None = None
    node_token_hash_pepper: SecretStr | None = None
    node_install_token_ttl_seconds: int = 900

    first_admin_email: str | None = Field(
        default=None,
        validation_alias=AliasChoices("FIRST_ADMIN_EMAIL", "LUMEN_FIRST_ADMIN_EMAIL"),
    )
    first_admin_username: str | None = Field(
        default=None,
        validation_alias=AliasChoices("FIRST_ADMIN_USERNAME", "LUMEN_FIRST_ADMIN_USERNAME"),
    )
    first_admin_password: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("FIRST_ADMIN_PASSWORD", "LUMEN_FIRST_ADMIN_PASSWORD"),
    )

    free_license_node_limit: int = 3
    central_license_sync_url: AnyUrl | None = None
    central_license_sync_secret: SecretStr | None = None
    central_license_public_key_b64: str | None = None

    # Public URL of the panel, used to build OAuth redirect URIs and the
    # WebAuthn relying-party origin when those are not configured explicitly.
    panel_public_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("PANEL_PUBLIC_URL", "LUMEN_PANEL_PUBLIC_URL"),
    )

    # OAuth / social login. Auto-provisioning of brand new accounts on first
    # OAuth login is disabled by default; existing users are linked by verified
    # email. Enable explicitly only when self-service signup is intended.
    oauth_allow_signup: bool = False
    oauth_signup_role: str = "user"
    oauth_state_ttl_seconds: int = 600

    google_oauth_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("GOOGLE_OAUTH_ENABLED", "LUMEN_GOOGLE_OAUTH_ENABLED"),
    )
    google_oauth_client_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_OAUTH_CLIENT_ID", "LUMEN_GOOGLE_OAUTH_CLIENT_ID"),
    )
    google_oauth_client_secret: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "GOOGLE_OAUTH_CLIENT_SECRET", "LUMEN_GOOGLE_OAUTH_CLIENT_SECRET"
        ),
    )
    google_oauth_client_secret_file: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "GOOGLE_OAUTH_CLIENT_SECRET_FILE", "LUMEN_GOOGLE_OAUTH_CLIENT_SECRET_FILE"
        ),
    )

    github_oauth_enabled: bool = False
    github_oauth_client_id: str | None = None
    github_oauth_client_secret: SecretStr | None = None
    github_oauth_client_secret_file: str | None = None

    keycloak_oauth_enabled: bool = False
    keycloak_oauth_issuer: str | None = None
    keycloak_oauth_client_id: str | None = None
    keycloak_oauth_client_secret: SecretStr | None = None
    keycloak_oauth_client_secret_file: str | None = None

    pocketid_oauth_enabled: bool = False
    pocketid_oauth_issuer: str | None = None
    pocketid_oauth_client_id: str | None = None
    pocketid_oauth_client_secret: SecretStr | None = None
    pocketid_oauth_client_secret_file: str | None = None

    telegram_login_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("TELEGRAM_ENABLED", "LUMEN_TELEGRAM_LOGIN_ENABLED"),
    )
    telegram_bot_token: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("TELEGRAM_BOT_TOKEN", "LUMEN_TELEGRAM_BOT_TOKEN"),
    )
    telegram_bot_token_file: str | None = Field(
        default=None,
        validation_alias=AliasChoices("TELEGRAM_BOT_TOKEN_FILE", "LUMEN_TELEGRAM_BOT_TOKEN_FILE"),
    )
    telegram_bot_username: str | None = Field(
        default=None,
        validation_alias=AliasChoices("TELEGRAM_BOT_USERNAME", "LUMEN_TELEGRAM_BOT_USERNAME"),
    )
    telegram_auth_ttl_seconds: int = 86_400

    # WebAuthn / passkeys. rp_id and origin are derived from panel_public_url
    # when not set explicitly.
    webauthn_enabled: bool = True
    webauthn_rp_id: str | None = None
    webauthn_rp_name: str | None = None
    webauthn_origin: str | None = None
    webauthn_challenge_ttl_seconds: int = 300

    log_level: str = "INFO"

    @model_validator(mode="after")
    def _load_file_backed_secrets(self) -> "Settings":
        file_backed: tuple[tuple[str, str], ...] = (
            ("google_oauth_client_secret", "google_oauth_client_secret_file"),
            ("github_oauth_client_secret", "github_oauth_client_secret_file"),
            ("keycloak_oauth_client_secret", "keycloak_oauth_client_secret_file"),
            ("pocketid_oauth_client_secret", "pocketid_oauth_client_secret_file"),
            ("telegram_bot_token", "telegram_bot_token_file"),
        )
        for secret_attr, file_attr in file_backed:
            current = getattr(self, secret_attr)
            if current is not None and current.get_secret_value():
                continue
            file_path = getattr(self, file_attr)
            if not file_path:
                continue
            path = Path(file_path)
            if not path.is_file():
                continue
            value = path.read_text(encoding="utf-8").strip()
            if value:
                object.__setattr__(self, secret_attr, SecretStr(value))
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
