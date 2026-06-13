# Decisions

## Public repo scope

This repo contains installer, deployment templates, release metadata, and public
operator docs only. Private application source remains in private repositories.

## Secrets

Runtime secrets are generated on the target host. Public templates use
placeholders and file paths only.

## Images

All production images are configured through environment variables and must be
pinned by digest from a release manifest.

## License

The public scaffold exposes free mode with `FREE_NODE_LIMIT=3` and file-based
license placeholders. Final enforcement belongs to the private backend/license
service.

