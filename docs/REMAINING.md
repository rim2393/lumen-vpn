# Remaining work

- Private images must provide the CLI entrypoints used by the installer:
  `lumen-api migrate`, `lumen-api bootstrap-admin`, `lumen-api healthcheck`,
  and node-agent registration commands.
- Release manifests must be generated and signed by the private build pipeline.
- End-to-end install validation on fresh Debian/Ubuntu VPS images is still
  required.
- The typed `lumenctl` command is not included in this public Bash scaffold.
- Push node provisioning is implemented by the private panel/backend; this repo
  only contains the fallback node bootstrap script.

