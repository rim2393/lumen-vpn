# API Contract

The backend exposes versioned REST endpoints under `/api/v1`.

## Response Envelope

Successful responses use typed JSON objects per route. Errors always use:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human readable summary.",
    "details": []
  }
}
```

`4xx` responses must include a stable `code`. `5xx` responses must not expose stack traces,
filesystem paths, SQL, tokens, private keys, subscription URLs, or generated runtime configs.

## Initial Routes

| Route | Purpose | Auth |
| --- | --- | --- |
| `GET /health/live` | Process liveness | No |
| `GET /health/ready` | Dependency readiness | No |
| `POST /auth/login` | Credential exchange | No |
| `POST /auth/refresh` | Refresh-token rotation | Refresh token |
| `POST /auth/logout` | Revoke current session | Bearer |
| `GET /auth/me` | Current principal | Bearer |
| `/users` | User lifecycle | `user:manage` |
| `/api-keys` | API key lifecycle | `api_key:manage` |
| `/licenses` | License lifecycle | `license:manage` |
| `/nodes` | Node registry | `node:manage` |
| `POST /nodes/provisioning-jobs` | Create idempotent node provisioning job with SSH credential reference | `node:manage` |
| `GET /nodes/provisioning-jobs/{jobId}` | Read provisioning job state | `node:manage` |
| `POST /nodes/provisioning-jobs/{jobId}/preflight` | Record provisioning preflight state/checks | `node:manage` |
| `POST /nodes/provisioning-jobs/{jobId}/install-token` | Issue one-time install token after preflight pass | `node:manage` |
| `POST /nodes/install-token/exchange` | Exchange one-time install token for node heartbeat token | Install token |
| `POST /nodes/{nodeId}/heartbeat` | Update node liveness/capabilities | `X-Lumen-Node-Token` |
| `/subscriptions` | Subscription lifecycle and delivery metadata | `subscription:*` |

The checked-in OpenAPI seed lives at `packages/shared-openapi/openapi.yaml`.
Runtime OpenAPI is available at `/openapi.json` while enabled by configuration.

Node provisioning stores SSH `credentials_ref` values only. Plaintext SSH passwords,
private keys, access tokens, generated runtime configs, and subscription URLs are
rejected or omitted from persistence. Install tokens and node heartbeat tokens are
returned once and stored only as HMAC hashes.
