## Public deployment (P0 baseline)

This repo’s `docker-compose.yml` is set up so that:

- **Only Caddy is internet-facing** (ports **80/443**).
- The **manager API is not published on the host**, and is reachable only from Caddy over an internal Docker network.
- The manager container is **hardened for least privilege** (no `privileged: true`, `no-new-privileges`, read-only rootfs).

### Prerequisites

- **A DNS name** pointing at your host (A/AAAA record), e.g. `api.example.com`.
- Host firewall / security group rules:
  - allow inbound **TCP 80** and **TCP 443**
  - deny inbound **TCP 3000** (should not be needed at all)
- Host has `/dev/kvm` and `/dev/vhost-vsock` available (Firecracker requirements).

### Configure environment

1) Copy the example env file:

```bash
cp env.example .env
```

2) Edit `.env`:

- `RDS_DOMAIN`: your public DNS name (e.g. `api.example.com`)
- `ACME_EMAIL`: email for Let’s Encrypt registration
- `API_KEY`: generate a strong value:

```bash
openssl rand -hex 32
```

### Start

```bash
docker compose up --build
```

### Validate

- From the internet:
  - `https://<RDS_DOMAIN>/openapi.json` loads
  - `https://<RDS_DOMAIN>/v1/vms` returns `401` without `X-API-Key`
- Ensure the manager is not directly exposed:
  - there is **no** host port mapping for the manager service in `docker-compose.yml`
  - port **3000** should not be reachable externally

### Notes

- **Rate limiting**: the `Caddyfile` uses a `rate_limit` block. The compose stack builds a custom Caddy binary (see `services/caddy/Dockerfile`) to ensure the directive is available.
- **Logs**:
  - Caddy access logs are written to `/data/logs/access.log` inside the Caddy container (persisted in the `caddy_data` volume).
  - The access log format is configured to **avoid logging request headers** (so `X-API-Key` is not recorded).

