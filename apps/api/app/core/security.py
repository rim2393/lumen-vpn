import hmac
import secrets
from hashlib import sha256

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from pydantic import SecretStr

from app.core.errors import APIError

_PASSWORD_HASHER = PasswordHasher()


def require_secret(value: SecretStr | None, *, name: str) -> str:
    if value is None or value.get_secret_value() == "":
        raise APIError(code="missing_secret", message=f"Required secret is not configured: {name}.")
    return value.get_secret_value()


def hash_password(password: SecretStr) -> str:
    return _PASSWORD_HASHER.hash(password.get_secret_value())


def verify_password(password: SecretStr, password_hash: str) -> bool:
    try:
        return _PASSWORD_HASHER.verify(password_hash, password.get_secret_value())
    except VerifyMismatchError:
        return False


def generate_opaque_token(*, prefix: str, entropy_bytes: int = 32) -> str:
    return f"{prefix}_{secrets.token_urlsafe(entropy_bytes)}"


def hmac_sha256(value: str, secret: SecretStr) -> str:
    digest = hmac.new(
        secret.get_secret_value().encode("utf-8"),
        value.encode("utf-8"),
        sha256,
    ).hexdigest()
    return digest


def constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)
