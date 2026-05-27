CODE REVIEW REPORT
==================

Scope: G013 final live-stage changes across the self-hosted control plane,
public installer repository, license server repository, and client
compatibility repository.

Reviewed areas:
- API subscription manifest service and public route.
- Lumen edge public subscription manifest proxy.
- Node-agent gated tcp-smoke live listener path.
- Public installer digest pinning, signed manifest validation, and source
  boundary controls.
- Client subscription manifest validator and tcp-smoke acceptance fixture.

Issues:
- CRITICAL: none.
- HIGH: none.
- MEDIUM: none.
- LOW: none.

Architecture status: CLEAR.

Synthesis:
- codeReviewerRecommendation: APPROVE.
- architectStatus: CLEAR.
- finalRecommendation: APPROVE.

Evidence:
- Public manifest route is unauthenticated by design but addressed by opaque
  public ids, active/revoked/expiry checks, no inline credentials, and
  cache-control no-store at the edge.
- Edge proxy forwards only an accept header to the API and does not propagate
  admin/API authorization material.
- Node live listener execution requires both dryRun=false and
  LUMEN_ENABLE_LIVE_SMOKE=true.
- Public installer repository contains delivery assets only and validates
  digest-pinned signed releases.
- Client validator accepts the same lumen.subscription-manifest.v1 tcp-smoke
  manifest fetched from the deployed subscription domain.
