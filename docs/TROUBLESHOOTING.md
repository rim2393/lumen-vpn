# Troubleshooting

## Compose config fails

Run:

```bash
docker compose --env-file /opt/lumen/.env -f deploy/compose/lumen.yml config
```

Common causes are missing image variables, malformed domains, or placeholder
image digests in production mode.

## TLS issue fails

Check:

- DNS A/AAAA records point to this host
- Ports `80` and `443` are reachable
- Nginx acme challenge config is active
- `ACME_EMAIL` is set

Then rerun:

```bash
sudo ./scripts/install.sh --config /opt/lumen/.env
```

## Private image pull fails

Put the registry token in `REGISTRY_TOKEN_FILE`, set `REGISTRY_USERNAME`, and
rerun the installer. Do not put the token inline in `.env`.

## Health check fails after upgrade

Run:

```bash
sudo ./scripts/doctor.sh --config /opt/lumen/.env
sudo docker compose --env-file /opt/lumen/.env -f deploy/compose/lumen.yml logs --tail=200
```

If migration failed, restore the pre-upgrade backup.

