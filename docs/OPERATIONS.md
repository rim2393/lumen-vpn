# Operations guide

## Doctor

`scripts/doctor.sh` checks host requirements, Docker Compose rendering, pinned
image references, local ports, Nginx syntax, certificate files, and application
health endpoints.

```bash
sudo ./scripts/doctor.sh --config /opt/lumen/.env
sudo ./scripts/doctor.sh --config /opt/lumen/.env --json
```

## Backup

Backups include PostgreSQL dump output, runtime state, generated secret files,
Nginx config, and metadata. Because backups contain sensitive material, the
script encrypts by default when `--passphrase-file` is provided.

```bash
sudo ./scripts/backup.sh --config /opt/lumen/.env --passphrase-file /root/lumen-backup.pass
```

Plaintext archives require `--allow-plaintext` and are intended only for
isolated test environments.

## Restore

Restore is intentionally destructive and requires `--force`.

```bash
sudo ./scripts/restore.sh --config /opt/lumen/.env --backup /secure/lumen-backup.tar.gz.enc --passphrase-file /root/lumen-backup.pass --force
```

After restore to a new server, rotate TLS certificates, verify manifest signing
keys, and reconnect nodes from the panel.

## Upgrade

Upgrade consumes a signed release manifest, creates a pre-upgrade backup, pulls
pinned images, applies database migrations, starts the stack, and rolls back
compose image references if health checks fail.

```bash
sudo ./scripts/upgrade.sh --config /opt/lumen/.env --manifest /tmp/lumen-release.json --dry-run
sudo ./scripts/upgrade.sh --config /opt/lumen/.env --manifest /tmp/lumen-release.json --passphrase-file /root/lumen-backup.pass
```

