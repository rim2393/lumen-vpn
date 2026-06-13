# Project Instructions

## Repeated Error Rule

Do not fight the same error blindly. Whenever the same error happens twice in a row, pause and research it on the web. Find 3-5 plausible fixes from relevant sources, compare them, choose the most effective solution for this codebase, and implement it.

## Collaboration Mode

For substantial work in this workspace, use multi-agent execution when independent tasks can run in parallel. Keep the critical build/install/device verification path in the main thread, delegate bounded research or disjoint implementation slices to agents, and report progress clearly so it is visible which task is currently being advanced.

Use `5.3 spark` for simple subagent tasks: repository/file inventory, route/API surface audits, grep-based placeholder scans, log collection, smoke-test evidence gathering, and other low-risk read-only or narrowly scoped checks. Use a stronger model for architecture, security, protocol/runtime implementation, destructive operations, release decisions, and final verification.

Close each subagent immediately after its task is complete and its result has been captured. Do not leave completed agents occupying slots; if the subagent limit is reached, close completed agents before spawning new ones.

## Android Product Rules

The app must stay portrait-only. Do not enable landscape or sensor-based orientation for release screens.

Secrets, passwords, private keys, subscription URLs, access tokens, and generated runtime configs must not be committed, logged, or stored in plain text.
