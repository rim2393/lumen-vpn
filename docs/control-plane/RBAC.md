# RBAC

RBAC is permission-oriented. Roles are convenience bundles, not hard-coded authorization checks.

## Roles

| Role | Intended use |
| --- | --- |
| `owner` | Full tenant/system control. |
| `admin` | Operational administration without ownership transfer semantics. |
| `support` | Limited support workflows for users and subscription lookup. |
| `node` | Service principal for node-side read workflows. |
| `user` | End-user subscription access. |

## Permissions

| Permission | Purpose |
| --- | --- |
| `api_key:manage` | Create, list, and revoke API keys. |
| `license:manage` | Create and manage licenses. |
| `node:manage` | Register and manage VPN nodes. |
| `subscription:read` | Read subscription metadata. |
| `subscription:manage` | Create, revoke, and reassign subscriptions. |
| `user:manage` | Create, disable, and inspect users. |

## Matrix

| Role | api_key:manage | license:manage | node:manage | subscription:read | subscription:manage | user:manage |
| --- | --- | --- | --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | Yes | Yes | Yes |
| `support` | No | No | No | Yes | No | Yes |
| `node` | No | No | No | Yes | No | No |
| `user` | No | No | No | Yes | No | No |

