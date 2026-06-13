# Architecture Decisions

## ADR-0001: Repository Split

Decision: use separate repositories for public installer docs, private
self-hosted source, private license server, and private client compatibility.

Consequence: the public repository can be shared without leaking source code.
Build and release pipelines must publish private Docker images.

## ADR-0002: Public Repository Contains No Source

Decision: `rim2393/lumen_vpn` contains installer scripts, deployment templates,
and documentation only.

Consequence: all closed-source runtime behavior ships through signed and pinned
Docker images.

## ADR-0003: Nginx And acme.sh

Decision: production installer uses Nginx by default and automates TLS with
`acme.sh`.

Consequence: installer must validate DNS, ports, ACME email, certificate
renewal, and Nginx reload behavior.

## ADR-0004: Browser Auth Uses Secure Cookies

Decision: browser sessions use HttpOnly Secure cookies, SameSite policy, CSRF
tokens, strict CORS, and Fetch Metadata checks.

Consequence: access tokens are not stored in localStorage. API keys are only for
integrations, bots, and service accounts.

## ADR-0005: Three Free Nodes

Decision: installations can run up to three active nodes without a license.
Nodes above that limit require a valid license.

Consequence: expired licenses pause paid nodes above the three pinned free
slots without deleting data.

## ADR-0006: Node Provisioning Is Push-First

Decision: primary node setup is initiated from the panel over SSH. Manual pull
install remains a fallback.

Consequence: provisioning jobs must securely handle short-lived SSH credentials,
run preflight checks, install node-agent, then remove temporary credentials.

## ADR-0007: Protocols Are Adapter-Based

Decision: protocols are modeled through Protocol, Transport, Security,
Obfuscation, Runtime, and Renderer dimensions.

Consequence: OpenVPN over Cloak and similar combinations are runtime chains, not
hardcoded top-level protocol types.
