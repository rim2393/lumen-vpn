# Security Model

## Secrets

Secrets are provided through environment variables or an external secrets manager.
The source tree must not contain generated API keys, private keys, database passwords,
session tokens, license keys, subscription URLs, node credentials, or runtime config dumps.

Config fields that may contain secrets use `SecretStr`. Token and key material is stored only
as HMAC/cryptographic hashes with an environment-provided pepper. Public prefixes may be stored
only for lookup and operator display.

## Authentication

The product separates:

- Short-lived access tokens for API authorization.
- Rotating refresh tokens for session continuity.
- Server-side session records for idle/absolute expiry and revocation.
- API keys for automation and node/service integration.

Refresh tokens and API keys must be generated from cryptographic randomness, returned only at
creation/rotation time, and stored hashed. Reuse of a rotated refresh token should revoke the
session family.

## Authorization

RBAC is deny-by-default. Route handlers should depend on `require_permission(...)` and never
check role strings inline. Ownership checks for user-scoped data must be added in service-layer
queries before returning rows.

## Data Handling

Subscription delivery records store `public_id`, delivery metadata, and `config_hash`; they do
not store generated subscription URLs in plaintext. IP addresses and user agents should be hashed
or minimized unless a retention policy explicitly requires raw values.

## Logging

Logs are structured JSON. Do not log request bodies for auth, license, API key, node credential,
or subscription delivery endpoints. Exceptions returned to clients use standard error envelopes
without internal paths or tracebacks.
