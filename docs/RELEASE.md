# Release process

Release manifests are public metadata. They reference runtime images by digest
and never include registry tokens, credentials, or generated source archives.

Minimum release artifacts:

- `release/manifest.<version>.json`
- `release/checksums.<version>.txt`
- Signed image digests for every runtime image
- Compatibility notes for migrations and installer version

Release gates for this public repo:

- Shell scripts pass ShellCheck
- Compose templates render with `.env.example`
- Secret scan passes
- Release manifest validates as JSON
- Docs describe unsupported or remaining work honestly

Any release blocker must be tracked in public issues or public release notes
without exposing secrets or infrastructure credentials.
