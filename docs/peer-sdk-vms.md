# Peer SDK VMs

## What The Feature Does

This feature lets you split trusted credentials and untrusted orchestration code across separate microVMs without giving the consumer VM direct access to provider source by default.

- A provider VM hosts one SDK and only the secrets that SDK needs.
- A consumer VM links to one or more provider VMs by alias.
- The consumer sees each provider in three LLM-friendly ways:
  - `/workspace/peers/index.json`: catalog of available peer aliases.
  - `/workspace/peers/<alias>/manifest.json`: structured SDK contract.
  - `/workspace/peers/<alias>/README.md`: human-readable usage guide with import examples.
  - `/workspace/peers/<alias>/proxy/...`: importable proxy modules that forward execution to the provider VM through the manager.
- `/workspace/peers/<alias>/source/...` is hidden by default and only appears when that alias is explicitly switched to `sourceMode: "mounted"` for debugging.

The consumer VM never receives the provider VM secrets through its own environment or workspace. Remote execution stays manager-routed:

`consumer VM -> manager internal bridge -> provider VM over vsock`

## Prerequisites

Set `VM_SECRET_KEY` before starting the manager. This is used to encrypt provider `secretEnv` values at rest.

```bash
export VM_SECRET_KEY='change-this-to-a-long-random-string'
./scripts/build-guest-image.sh
docker compose up --build
```

Relevant API endpoints used by this workflow:

- `POST /v1/vms`
- `POST /v1/vms/:id/files/upload`
- `POST /v1/vms/:id/run-ts`
- `POST /v1/vms/:id/peers/sync`
- `PATCH /v1/vms/:id/peers/:alias`
- `POST /v1/vms/:id/snapshots`

## Provider Contract

Every provider SDK must include a manifest at:

`/workspace/.rds-peer/manifest.json`

Required manifest shape:

- `sdk.name`
- `sdk.description`
- `modules[]`
- each module has:
  - `path` relative to `/workspace`
  - optional `description`
  - `exports[]`
- each export has:
  - `name`
  - `description`
  - `params[]`
  - `returns`
  - `examples[]`

Each param entry must contain:

- `name`
- `description`
- `schema`

`returns` must contain:

- `description`
- `schema`

`schema` is treated as a JSON-schema-like object for documentation. In v1 the manager validates shape and declared callability, not full JSON Schema semantics.

## LLM-Generated Provider Manifests

The provider developer does not need to hand-write `manifest.json`. A coding LLM can generate it from the SDK source before the SDK is uploaded to the provider VM.

Recommended provider-side workflow:

1. Keep the SDK source on the host machine, not in the provider VM yet.
2. Give the LLM access to the SDK folder you plan to upload.
3. Ask the LLM to inspect exported callable entrypoints and generate `/workspace/.rds-peer/manifest.json`.
4. Review the generated descriptions and examples once.
5. Package the SDK code together with the generated manifest and upload both into `/workspace`.

Rules the LLM should follow while generating the manifest:

- Only include exports that are intended to be called remotely by consumers.
- Ignore constants, types, internal helpers, and default exports unless the SDK explicitly expects them to be called through the proxy layer.
- Use module paths relative to `/workspace`.
- Infer param names from the function signature.
- Infer param and return schemas conservatively. Prefer broad schemas over incorrect narrow ones.
- Add examples that import from `file:///workspace/peers/<alias>/proxy/...`, not from provider source paths.
- Describe behavior from the code itself. Do not mention provider secrets unless they matter to the contract.
- Keep all params and return values JSON-serializable.

Good inputs for the LLM:

- entrypoint files such as `mod.ts`, `index.ts`, or the public exports barrel
- any types/interfaces used by the public functions
- small helper files only when they clarify shapes or behavior

Suggested prompt for GPT-5.x or Codex:

```text
Read this SDK and generate /workspace/.rds-peer/manifest.json for the peer SDK system.

Requirements:
- Find the public exported functions intended for remote use.
- Output valid JSON only.
- Include sdk.name, sdk.description, modules[].path, optional module descriptions, and exports[].
- For each export include name, description, params[], returns, and examples[].
- Each param needs name, description, and schema.
- Returns needs description and schema.
- Paths must be relative to /workspace.
- Examples must import from file:///workspace/peers/<alias>/proxy/... and call the exported function.
- Exclude internal helpers, constants, and non-callable exports.
- Keep schemas conservative and JSON-serializable.

Before finalizing, check that every declared module exists and every declared export is actually exported by that module.
```

The output should be written into the SDK bundle as `.rds-peer/manifest.json` before creating the tarball for upload.

## Minimal Valid Provider Manifest

```json
{
  "sdk": {
    "name": "Google Calendar",
    "description": "Calendar access through a peer SDK."
  },
  "modules": [
    {
      "path": "google/mod.ts",
      "exports": [
        {
          "name": "listEvents",
          "description": "List calendar events for a prefix.",
          "params": [
            {
              "name": "prefix",
              "description": "Prefix to attach to each event summary.",
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
              "description": "Fetch events and print them as JSON.",
              "code": "import { listEvents } from \"file:///workspace/peers/google/proxy/google/mod.ts\";\nconsole.log(JSON.stringify(await listEvents(\"demo\")));"
            }
          ]
        }
      ]
    }
  ]
}
```

## Rich Provider Example

Create a provider VM that will host one SDK and one secret scope.

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

Upload the SDK files plus the generated provider manifest into `/workspace`.

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
    "description": "Calendar access through a manifest-first peer SDK."
  },
  "modules": [
    {
      "path": "google/mod.ts",
      "description": "Google Calendar entrypoints.",
      "exports": [
        {
          "name": "listEvents",
          "description": "Return calendar events for a prefix.",
          "params": [
            {
              "name": "prefix",
              "description": "Prefix to attach to each event summary.",
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
              "description": "Fetch events and print them as JSON.",
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

Sanity check the provider VM directly.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"code":"console.log(Deno.env.get(\"GOOGLE_TOKEN\") ?? \"missing\")"}' \
  "http://127.0.0.1:3000/v1/vms/<google-vm-id>/run-ts"
```

## Snapshot A Provider VM With The SDK Already Loaded

After the SDK is uploaded, snapshot that VM so later provider VMs do not need the SDK uploaded again.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -X POST \
  "http://127.0.0.1:3000/v1/vms/<google-vm-id>/snapshots"
```

That returns a snapshot id such as `snap-...`. Create future provider VMs from it:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": [],
    "outboundInternet": false,
    "userOverlaySnapshotId": "snap-...",
    "secretEnv": [
      "GOOGLE_TOKEN=google-secret-token"
    ]
  }' \
  http://127.0.0.1:3000/v1/vms
```

The SDK files and manifest come from the snapshot disk layer. The provider secret still comes from `secretEnv` at VM creation time.

## Create A Consumer VM That Can Call Providers

Create a workflow VM and link provider aliases to provider VM ids.

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

`alias` is the local name the consumer VM uses under `/workspace/peers/<alias>`.

Peer metadata and proxies are synced automatically on create and start. You can force a refresh after changing a provider VM:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -X POST \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/peers/sync"
```

## What Appears Inside The Consumer VM

Default layout:

```text
/workspace/peers/
  index.json
  google/
    manifest.json
    README.md
    proxy/
      google/mod.ts
  outlook/
    manifest.json
    README.md
    proxy/
      outlook/mod.ts
```

When one alias is explicitly mounted for source debugging:

```text
/workspace/peers/
  google/
    manifest.json
    README.md
    proxy/
      google/mod.ts
    source/
      .rds-peer/manifest.json
      google/mod.ts
```

- `index.json` is the LLM entrypoint for discovery.
- `manifest.json` is the structured SDK contract.
- `README.md` is the human-readable usage guide.
- `proxy` is the importable remote-execution layer.
- `source` is optional and debug-only.

## LLM-First Workflow Inside The Consumer VM

Recommended workflow for a coding agent inside the consumer VM:

1. Read `/workspace/peers/index.json`.
2. Pick the relevant alias and read `/workspace/peers/<alias>/README.md` or `manifest.json`.
3. Import from `/workspace/peers/<alias>/proxy/...`.
4. Compose the higher-level workflow locally in the consumer VM.
5. Only enable `/source` for a specific alias when explicit human debugging is needed.

Discovery commands from the consumer VM:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"find /workspace/peers -maxdepth 3 -type f | sort"}' \
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

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"cat /workspace/peers/google/manifest.json"}' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/exec"
```

## How To Call A Provider SDK From Consumer Code

The consumer imports from `proxy`.

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{
    "code": "const index = JSON.parse(await Deno.readTextFile(\"/workspace/peers/index.json\"));\nconst googleManifest = JSON.parse(await Deno.readTextFile(\"/workspace/peers/google/manifest.json\"));\nimport { listEvents } from \"file:///workspace/peers/google/proxy/google/mod.ts\";\nimport { importEvents } from \"file:///workspace/peers/outlook/proxy/outlook/mod.ts\";\nconst events = await listEvents(\"demo\");\nconst result = await importEvents(events);\nconsole.log(JSON.stringify({ index, sdk: googleManifest.sdk.name, events, result }));"
  }' \
  "http://127.0.0.1:3000/v1/vms/<consumer-vm-id>/run-ts"
```

The arguments and return values must be JSON-serializable. The provider VM secret env is injected only on the provider side.

## Enable Source For One Alias When Debugging

Source is hidden by default. Mount it for one alias only when explicit debugging is needed.

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

## Limits In V1

- Provider manifests are required.
- Manifest schemas are documentation-only and are not fully JSON Schema validated.
- Proxies support callable exports only.
- Arguments and results must be JSON-serializable.
- No direct guest-to-guest networking is used.
- `source` is hidden by default and only appears per alias when `sourceMode` is set to `"mounted"`.
- If a provider SDK or manifest changes, run `POST /v1/vms/:id/peers/sync` or restart the consumer VM.
