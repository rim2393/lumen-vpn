# Manual node install fallback

Manual node install exists only for environments where panel-initiated SSH push
provisioning cannot reach the VPS.

The preferred product flow is:

1. Admin creates a node in the panel.
2. Backend creates a short-lived install token.
3. Panel worker connects to the VPS over SSH.
4. Worker runs preflight and installs the node agent.
5. Node agent exchanges the one-time token for node credentials.
6. Node agent keeps an outbound connection to the panel.
7. Temporary SSH credentials are removed or wiped.

Fallback command:

```bash
sudo ./scripts/install-node.sh --panel-url https://panel.example.com --install-token-stdin
```

The token should be pasted through stdin or read from a root-only file. Avoid
putting one-time tokens in shell history.

The fallback installer creates `/opt/lumen-node`, installs Docker/Compose when
missing, starts the `lumen-node-agent` container, and does not open an inbound
admin port.

