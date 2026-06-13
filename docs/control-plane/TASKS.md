# Tasks

Status values: `pending`, `in_progress`, `blocked`, `done`.

| ID | Status | Owner | Task | Completion Signal |
| --- | --- | --- | --- | --- |
| T001 | in_progress | main | Initialize private source repo control docs | README and docs exist |
| T002 | done | devops-agent | Build public installer repo | Scripts, docs, compose templates |
| T003 | done | backend-agent | Build FastAPI backend and security contracts | API package, tests, docs |
| T004 | done | frontend-agent | Build admin UI and Lumen Guard | Vite app, routes, UI contract |
| T005 | done | node-agent | Build node/protocol/subscription packages | Agent, registry, schema, docs |
| T006 | done | license-agent | Build license server repo | API, cabinet, license model |
| T007 | done | client-agent | Build client compatibility repo | Docs and fixtures |
| T008 | done | main | Integrate agent outputs | Local checks pass |
| T009 | pending | main | Commit and push initial repositories | Remotes contain initial commits |
| T010 | pending | main | Prepare encrypted server inventory | No plaintext secrets committed |
| T011 | done | backend-security | Implement API key hash/verify and free node policy slice | API pytest/ruff pass |
| T012 | done | backend-node-provisioning | Implement node provisioning jobs, one-time install token exchange, and heartbeat | API pytest/ruff pass |
