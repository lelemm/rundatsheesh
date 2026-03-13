# Peer SDK VMs

## What This Ships

The current implementation isolates SDKs into separate provider VMs and lets a consumer or workflow VM call them through manager-routed proxies.

- A provider VM stores one SDK plus only the secrets that SDK needs through `secretEnv`.
- A consumer VM declares `peerLinks` to provider VMs by alias.
- The consumer does not get provider secrets in its own environment.
- Remote calls flow through the manager, not directly between guests:

`consumer VM -> manager internal bridge -> provider VM over vsock`

## What The Consumer VM Actually Sees

After peer sync, the consumer VM gets a generated read-only peer workspace under `/workspace/peers`.

- `/workspace/peers/index.json`
  - Catalog of linked peer aliases.
- `/workspace/peers/<alias>/manifest.json`
  - Structured provider SDK contract.
- `/workspace/peers/<alias>/README.md`
  - Human-readable usage guide generated from the manifest.
- `/workspace/peers/<alias>/proxy/...`
  - Importable proxy modules that call back into the manager bridge.
- `/workspace/peers/<alias>/source/...`
  - Optional source mirror.
  - Hidden by default.
  - Only present when that alias has `sourceMode: "mounted"`.

Bridge runtime files are written into:

- `/workspace/.rds/peer-bridge.json`
- `/workspace/.rds/peer-runtime.ts`
- `/workspace/.rds/peer-runtime.mjs`
- `/workspace/.rds/peer-runtime.cjs`

## Provider SDK Contract

Each provider SDK must include:

- `/workspace/.rds-peer/manifest.json`

That manifest is required. The manager validates it, validates declared modules under `/workspace`, and checks that the declared exports are actually callable.

Minimal shape:

```json
{
  "sdk": {
    "name": "Google Calendar",
    "description": "Calendar access through a peer SDK."
  },
  "modules": [
    {
      "path": "google/mod.ts",
      "description": "Google Calendar entrypoints.",
      "exports": [
        {
          "name": "listEvents",
          "description": "Return events for a prefix.",
          "params": [
            {
              "name": "prefix",
              "description": "Prefix to apply to each returned event summary.",
              "schema": { "type": "string" }
            }
          ],
          "returns": {
            "description": "Array of event objects.",
            "schema": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "summary": { "type": "string" }
                },
                "required": ["id", "summary"]
              }
            }
          },
          "examples": [
            {
              "description": "Fetch events.",
              "code": "import { listEvents } from \"file:///workspace/peers/google/proxy/google/mod.ts\";\nconsole.log(JSON.stringify(await listEvents(\"demo\")));"
            }
          ]
        }
      ]
    }
  ]
}
```

## Prerequisites

Set `VM_SECRET_KEY` before starting the manager. Provider `secretEnv` is encrypted at rest with this key.

```bash
export VM_SECRET_KEY='change-this-to-a-long-random-string'
./scripts/build-guest-images.sh
docker compose up --build
```

## Environment Variables That Matter

Peer SDK VMs and warm pool behavior depend on manager env vars that are easy to miss.

- `VM_SECRET_KEY`
  - Required for peer/provider features.
  - Must exist before using `secretEnv` or `peerLinks`.
  - If it is missing, provider secret encryption cannot work and peer-enabled VM creation will fail.
- `ENABLE_WARM_POOL`
  - Turns the warm pool on or off.
  - Default is `false`.
- `WARM_POOL_TARGET`
  - How many warm VMs the manager tries to keep ready.
- `WARM_POOL_MAX_VMS`
  - Upper bound for warm-pool managed VMs.

Example:

```bash
export VM_SECRET_KEY='change-this-to-a-long-random-string'
export ENABLE_WARM_POOL=false
export WARM_POOL_TARGET=1
export WARM_POOL_MAX_VMS=4
```

Warm pool caveats:

- Warm pool needs a default image.
  - The manager can only pre-provision warm VMs from the current default image.
  - If no default image exists, warm pool cannot prepare anything useful.
- Warm pool does not apply to peer/provider VMs that use `secretEnv` or `peerLinks`.
  - Those VMs boot through the normal path so the manager can materialize peer state and secrets correctly.
- If you enable warm pool in production, set a default image first through the Images API or admin UI.

Relevant endpoints in the current implementation:

- `POST /v1/vms`
- `POST /v1/vms/:id/files/upload`
- `POST /v1/vms/:id/run-ts`
- `POST /v1/vms/:id/peers/sync`
- `PATCH /v1/vms/:id/peers/:alias`
- `POST /v1/vms/:id/snapshots`

## Create A Provider VM

Create a provider VM with only the secret scope that SDK needs.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": [],
    "outboundInternet": false,
    "secretEnv": [
      "GOOGLE_TOKEN=google-secret-token"
    ]
  }' \
  http://127.0.0.1:3000/v1/vms
```

Build a provider bundle locally with both the SDK source and `.rds-peer/manifest.json`.

```bash
mkdir -p /tmp/google-sdk/.rds-peer /tmp/google-sdk/google

cat >/tmp/google-sdk/google/mod.ts <<'TS'
export async function listEvents(prefix: string) {
  const token = Deno.env.get("GOOGLE_TOKEN") ?? "missing";
  return [{ id: "g-1", summary: `${prefix}-${token}` }];
}
TS

cat >/tmp/google-sdk/.rds-peer/manifest.json <<'JSON'
{
  "sdk": {
    "name": "Google Calendar",
    "description": "Calendar access through a peer SDK."
  },
  "modules": [
    {
      "path": "google/mod.ts",
      "description": "Google Calendar entrypoints.",
      "exports": [
        {
          "name": "listEvents",
          "description": "Return events for a prefix.",
          "params": [
            {
              "name": "prefix",
              "description": "Prefix to apply to each returned event summary.",
              "schema": { "type": "string" }
            }
          ],
          "returns": {
            "description": "Array of event objects.",
            "schema": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "summary": { "type": "string" }
                },
                "required": ["id", "summary"]
              }
            }
          },
          "examples": [
            {
              "description": "Fetch events.",
              "code": "import { listEvents } from \"file:///workspace/peers/google/proxy/google/mod.ts\";\nconsole.log(JSON.stringify(await listEvents(\"demo\")));"
            }
          ]
        }
      ]
    }
  ]
}
JSON

tar -czf /tmp/google-sdk.tar.gz -C /tmp/google-sdk .rds-peer google

curl -sS -H "X-API-Key: dev-key" \
  -H "Content-Type: application/gzip" \
  --data-binary @/tmp/google-sdk.tar.gz \
  "http://127.0.0.1:3000/v1/vms/<google-vm-id>/files/upload?dest=/workspace"
```

Sanity check the provider VM directly:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"code":"console.log(Deno.env.get(\"GOOGLE_TOKEN\") ?? \"missing\")"}' \
  "http://127.0.0.1:3000/v1/vms/<google-vm-id>/run-ts"
```

## Snapshot A Provider VM

Once the provider VM already contains the SDK bundle, snapshot it so future provider VMs can start from that state.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -X POST \
  "http://127.0.0.1:3000/v1/vms/<google-vm-id>/snapshots"
```

Create a new provider VM from that snapshot:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": [],
    "outboundInternet": false,
    "userOverlaySnapshotId": "snap-<provider-snapshot-id>",
    "secretEnv": [
      "GOOGLE_TOKEN=rotated-secret"
    ]
  }' \
  http://127.0.0.1:3000/v1/vms
```

The SDK files come from the snapshot. The secret scope still comes from the new VM create request.

## Create A Consumer VM

Create a workflow VM with peer links to the provider VMs.

If you want only manifests, README files, and proxies, keep `sourceMode` hidden.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": [],
    "outboundInternet": false,
    "peerLinks": [
      { "alias": "google", "vmId": "<google-vm-id>" },
      { "alias": "outlook", "vmId": "<outlook-vm-id>" }
    ]
  }' \
  http://127.0.0.1:3000/v1/vms
```

If you want LLM-readable source from the start, set `sourceMode: "mounted"` on that alias:

```json
{
  "alias": "google",
  "vmId": "<google-vm-id>",
  "sourceMode": "mounted"
}
```

Peer sync runs automatically on VM create and VM start. You can also force a resync:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -X POST \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/peers/sync"
```

## Show Or Hide Provider Source

By default, provider source is hidden from the consumer. If you want `cat`, `grep`, `find`, or `sed` over the mirrored SDK source, switch that alias to `mounted`.

Enable source for one alias:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -X PATCH \
  -d '{"sourceMode":"mounted"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/peers/google"
```

Hide it again:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -X PATCH \
  -d '{"sourceMode":"hidden"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/peers/google"
```

Each patch also re-syncs `/workspace/peers`.

## What The Consumer VM Can Inspect

Always available:

```text
/workspace/peers/
  index.json
  google/
    manifest.json
    README.md
    proxy/
      google/
        mod.ts
  outlook/
    manifest.json
    README.md
    proxy/
      outlook/
        mod.ts
```

When `sourceMode: "mounted"` for an alias:

```text
/workspace/peers/
  google/
    source/
      .rds-peer/
        manifest.json
      google/
        mod.ts
```

Discovery examples:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"find /workspace/peers -maxdepth 4 -type f | sort"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/exec"
```

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"cat /workspace/peers/index.json"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/exec"
```

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"sed -n \"1,200p\" /workspace/peers/google/README.md"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/exec"
```

When source is mounted:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"grep -n \"listEvents\" /workspace/peers/google/source/google/mod.ts"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/exec"
```

## How To Call Provider SDKs From Consumer Code

The consumer imports from `proxy`, not from provider source.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "code": "import { listEvents } from \"file:///workspace/peers/google/proxy/google/mod.ts\";\nimport { importEvents } from \"file:///workspace/peers/outlook/proxy/outlook/mod.ts\";\nconst localGoogle = Deno.env.get(\"GOOGLE_TOKEN\") ?? null;\nconst events = await listEvents(\"demo\");\nconst result = await importEvents(events);\nconsole.log(JSON.stringify({ localGoogle, events, result }));"
  }' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/run-ts"
```

Behavior:

- `localGoogle` is `null` in the consumer VM because provider secrets are not injected there.
- `listEvents(...)` executes inside the Google provider VM with that provider's `secretEnv`.
- `importEvents(...)` executes inside the Outlook provider VM with its own `secretEnv`.

## How Communication Works

At runtime:

1. Consumer code imports `file:///workspace/peers/<alias>/proxy/...`.
2. Proxy modules call `/workspace/.rds/peer-runtime.*`.
3. That runtime posts to `POST /internal/v1/peer/invoke` on the manager using the consumer bridge token.
4. The manager verifies:
   - the bridge token belongs to that consumer VM
   - the alias is linked for that consumer
   - the provider VM exists and is running
5. The manager runs generated helper code inside the provider VM with `run-ts` or `run-js`.
6. The provider helper imports the real provider module under `/workspace/...`, calls the declared export, and returns JSON-serializable data.

There is no direct guest-to-guest traffic.

## Snapshotting Consumer VMs

Consumer snapshots can capture:

- generated `/workspace/peers`
- mounted source mirrors if any alias is in `mounted` mode
- generated `/workspace/.rds` bridge runtime

That lets you clone a workflow VM that already has peer discovery material in place.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -X POST \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/snapshots"
```

Create a new workflow VM from that snapshot:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": [],
    "outboundInternet": false,
    "userOverlaySnapshotId": "snap-<consumer-snapshot-id>",
    "peerLinks": [
      { "alias": "google", "vmId": "<google-vm-id>" },
      { "alias": "outlook", "vmId": "<outlook-vm-id>" }
    ]
  }' \
  http://127.0.0.1:3000/v1/vms
```

## Recommended LLM Workflow

For a coding LLM such as Codex:

1. Read `/workspace/peers/index.json`.
2. Pick the relevant alias.
3. Read `/workspace/peers/<alias>/README.md` and `manifest.json`.
4. Import from `/workspace/peers/<alias>/proxy/...`.
5. Only request `sourceMode: "mounted"` when the manifest and README are not enough.
6. If source is mounted, inspect `/workspace/peers/<alias>/source/...` with `find`, `cat`, `grep`, and `sed`.
7. Compose multi-provider workflows in the consumer VM.

The LLM should never assume provider secrets are readable in the consumer VM.

## Current Limits

- Provider bundles must ship `.rds-peer/manifest.json`.
- Only callable exports declared in the manifest are proxied.
- Arguments and results must be JSON-serializable.
- Source mirrors are optional per alias and controlled by `sourceMode`.
- Source mirrors are synced copies, not live mounts.
- If provider code or manifest changes, run `POST /v1/vms/:id/peers/sync` or restart the consumer VM.
