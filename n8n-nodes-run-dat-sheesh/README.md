# n8n-nodes-run-dat-sheesh

n8n community nodes for the **run-dat-sheesh** Manager API.

## Included

- **Credential**: `Run Dat sheesh API` (Base URL + API Key header `x-api-key`)
- **Node**: `Run Dat sheesh` (marked `usableAsTool: true`)

## Supported Manager endpoints

- `GET /v1/images`
- `GET /v1/vms`
- `GET /v1/vms/:id`
- `POST /v1/vms`
- `POST /v1/vms/:id/start`
- `POST /v1/vms/:id/stop`
- `DELETE /v1/vms/:id`
- `POST /v1/vms/:id/exec`
- `POST /v1/vms/:id/run-ts`
- `POST /v1/vms/:id/files/upload?dest=...` (tar.gz binary)
- `GET /v1/vms/:id/files/download?path=...` (tar.gz binary)
- `GET /v1/snapshots`
- `POST /v1/vms/:id/snapshots`

## Build

```bash
cd n8n-nodes-run-dat-sheesh
npm install
npm run build
```

