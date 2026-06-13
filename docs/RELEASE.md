# Release process

Release manifests are public metadata. They reference private images by digest
but never include registry tokens or source archives.

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

Private product gates are tracked in the private repositories.

