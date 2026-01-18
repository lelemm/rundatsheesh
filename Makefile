.PHONY: deps build unit integration test verify admin-ui-deps admin-ui-build publish

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
	./scripts/build-guest-image.sh
	./scripts/build-manager-image.sh

build-image:
	./scripts/build-guest-image.sh
	./scripts/build-manager-image.sh

publish:
	IMAGE_NAME=lelemm/rundatsheesh:latest ./scripts/build-manager-image.sh
	docker push lelemm/rundatsheesh:latest

unit:
	cd services/manager && npm test
	cd services/guest-agent && npm test

integration:
	cd tests/integration && npm test

test: unit integration

verify: deps build test

verify-integration: build integration