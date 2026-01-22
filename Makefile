.PHONY: deps build unit integration integration-bash test verify admin-ui-deps admin-ui-build publish
.PHONY: integration-alpine integration-alpine-bash integration-debian integration-debian-bash integrations integrations-bash

guest-images:
	./scripts/build-guest-images.sh

admin-ui-deps:
	cd services/manager/admin-ui && npm ci

admin-ui-build:
	cd services/manager/admin-ui && npm run build

deps:
	cd services/manager && npm ci
	cd services/manager/admin-ui && npm ci
	cd services/guest-agent && npm ci
	cd tests/integration && npm ci

build:
	cd services/manager && npm run build
	cd services/manager/admin-ui && npm run build
	cd services/guest-agent && npm run build
	./scripts/build-guest-images.sh
	./scripts/build-manager-image.sh

build-image:
	./scripts/build-guest-images.sh
	./scripts/build-manager-image.sh

publish:
	@bash -lc 'set -euo pipefail; \
	IMAGE_REPO="lelemm/rundatsheesh"; \
	GIT_SHA="$$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"; \
	PUSH="$${PUSH:-1}"; \
	echo "[publish] building $$IMAGE_REPO:latest and $$IMAGE_REPO:$$GIT_SHA (no-cache)"; \
	NO_CACHE=1 PULL=1 IMAGE_NAME="$$IMAGE_REPO:latest" ./scripts/build-manager-image.sh; \
	docker tag "$$IMAGE_REPO:latest" "$$IMAGE_REPO:$$GIT_SHA"; \
	if [ "$$PUSH" = "1" ]; then \
	  docker push "$$IMAGE_REPO:latest"; \
	  docker push "$$IMAGE_REPO:$$GIT_SHA"; \
	else \
	  echo "[publish] PUSH=0, skipping docker push"; \
	fi'

unit:
	cd services/manager && npm test
	cd services/guest-agent && npm test

# Default integration (alpine busybox)
integration:
	cd tests/integration && npm test

# Alpine integration targets
integration-alpine:
	cd tests/integration && INTEGRATION_IMAGE=alpine npm test

integration-alpine-bash:
	cd tests/integration && INTEGRATION_IMAGE=alpine-bash npm test

# Debian integration targets
integration-debian:
	cd tests/integration && INTEGRATION_IMAGE=debian npm test

integration-debian-bash:
	cd tests/integration && INTEGRATION_IMAGE=debian-bash npm test

# Legacy alias for alpine-bash
integration-bash:
	cd tests/integration && INTEGRATION_IMAGE=alpine-bash npm test

# Run all busybox flavor integrations
integrations:
	@echo "=== Running integration tests for all busybox flavors ==="
	@echo ""
	@echo "=== Alpine (busybox) ==="
	cd tests/integration && INTEGRATION_IMAGE=alpine npm test
	@echo ""
	@echo "=== Debian (busybox) ==="
	cd tests/integration && INTEGRATION_IMAGE=debian npm test
	@echo ""
	@echo "=== All busybox integrations passed ==="

# Run all bash flavor integrations
integrations-bash:
	@echo "=== Running integration tests for all bash flavors ==="
	@echo ""
	@echo "=== Alpine (bash) ==="
	cd tests/integration && INTEGRATION_IMAGE=alpine-bash npm test
	@echo ""
	@echo "=== Debian (bash) ==="
	cd tests/integration && INTEGRATION_IMAGE=debian-bash npm test
	@echo ""
	@echo "=== All bash integrations passed ==="

# Run ALL integration tests (all distros, all flavors)
integrations-all:
	@echo "=== Running ALL integration tests (all distros, all flavors) ==="
	@echo ""
	@echo "=== Alpine (busybox) ==="
	cd tests/integration && INTEGRATION_IMAGE=alpine npm test
	@echo ""
	@echo "=== Alpine (bash) ==="
	cd tests/integration && INTEGRATION_IMAGE=alpine-bash npm test
	@echo ""
	@echo "=== Debian (busybox) ==="
	cd tests/integration && INTEGRATION_IMAGE=debian npm test
	@echo ""
	@echo "=== Debian (bash) ==="
	cd tests/integration && INTEGRATION_IMAGE=debian-bash npm test
	@echo ""
	@echo "=== ALL integrations passed ==="

test: unit integration

verify: deps build test

verify-integration: build integration
