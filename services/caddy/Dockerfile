# syntax=docker/dockerfile:1
#
# Custom Caddy build to ensure `rate_limit` is available in the Caddyfile.
# This keeps the P0 edge rate limiting implementation self-contained.

FROM caddy:2-builder AS builder

# caddy-ratelimit module
RUN xcaddy build \
  --with github.com/mholt/caddy-ratelimit

FROM caddy:2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

