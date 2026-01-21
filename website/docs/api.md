---
title: API Reference
---

# API Reference

Complete reference for the run dat sheesh REST API.

## Authentication

All `/v1/*` endpoints require authentication via one of:

| Method | Header/Cookie | Description |
|--------|--------------|-------------|
| API Key | `X-API-Key: <your-key>` | Recommended for programmatic access |
| Session Cookie | `rds_session` | Set via `POST /auth/login` (Admin UI) |

**Public endpoints** (no auth required):
- `/docs/*` - Documentation
- `/swagger` - Interactive API explorer (when running manager)
- `/openapi.json` - OpenAPI 3.0 spec

---

## VMs

### Create a VM

Creates and boots a new Firecracker microVM.

```
POST /v1/vms
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cpu` | number | Yes | vCPU count (1-8) |
| `memMb` | number | Yes | Memory in MiB (128-8192) |
| `allowIps` | string[] | Yes | Outbound IP allowlist (CIDR notation) |
| `outboundInternet` | boolean | No | Enable outbound internet (default: false) |
| `imageId` | string | No | Guest image ID (uses default if omitted) |
| `snapshotId` | string | No | Restore from snapshot instead of fresh boot |
| `diskSizeMb` | number | No | Disk size in MiB (must be >= base rootfs) |

**Example:**

```bash
curl -X POST http://localhost:3000/v1/vms \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": ["172.16.0.1/32"],
    "outboundInternet": true,
    "diskSizeMb": 512
  }'
```

**Response (201 Created):**

```json
{
  "id": "vm-abc123",
  "state": "RUNNING",
  "cpu": 1,
  "memMb": 256,
  "guestIp": "172.16.0.2",
  "createdAt": "2025-01-21T10:30:00.000Z",
  "provisionMode": "boot"
}
```

### List VMs

```
GET /v1/vms
```

Returns all VMs known to the manager.

```bash
curl -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/vms
```

### Get VM

```
GET /v1/vms/:id
```

```bash
curl -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/vms/vm-abc123
```

### Start VM

Starts a stopped VM.

```
POST /v1/vms/:id/start
```

```bash
curl -X POST -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/vms/vm-abc123/start
```

**Response:** `204 No Content`

### Stop VM

Sends ACPI shutdown to the VM.

```
POST /v1/vms/:id/stop
```

```bash
curl -X POST -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/vms/vm-abc123/stop
```

**Response:** `204 No Content`

### Destroy VM

Stops the VM, tears down networking, and removes storage.

```
DELETE /v1/vms/:id
```

```bash
curl -X DELETE -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/vms/vm-abc123
```

**Response:** `204 No Content`

### Get VM Logs

Returns tail of VM log files.

```
GET /v1/vms/:id/logs
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Log file: `firecracker.log`, `firecracker.stdout.log`, or `firecracker.stderr.log` |
| `tail` | number | Number of lines (max 1000) |

```bash
curl -H "X-API-Key: \$API_KEY" \
  "http://localhost:3000/v1/vms/vm-abc123/logs?type=firecracker.log&tail=100"
```

---

## Command Execution

### Execute Shell Command

Runs a shell command inside the VM as uid/gid 1000.

```
POST /v1/vms/:id/exec
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cmd` | string | Yes | Shell command (executed via `bash -lc`) |
| `cwd` | string | No | Working directory (default: `/workspace`) |
| `env` | object | No | Environment variables `{ "KEY": "value" }` |
| `timeoutMs` | number | No | Timeout in milliseconds |

**Example:**

```bash
curl -X POST http://localhost:3000/v1/vms/vm-abc123/exec \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "echo hello && id -u",
    "timeoutMs": 30000
  }'
```

**Response:**

```json
{
  "exitCode": 0,
  "stdout": "hello\n1000\n",
  "stderr": ""
}
```

### Run TypeScript (Deno)

Executes TypeScript using Deno with sandboxed permissions.

```
POST /v1/vms/:id/run-ts
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | * | Inline TypeScript code |
| `path` | string | * | Path to `.ts` file in `/workspace` |
| `args` | string[] | No | Arguments passed to the program |
| `env` | string[] | No | Environment variables as `["KEY=value"]` |
| `denoFlags` | string[] | No | Additional Deno flags (advanced) |
| `timeoutMs` | number | No | Timeout in milliseconds |

*Either `code` or `path` is required.*

**Example - Inline Code:**

```bash
curl -X POST http://localhost:3000/v1/vms/vm-abc123/run-ts \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "console.log(2 + 2)"
  }'
```

**Example - With Environment Variables:**

Deno requires explicit permission for env vars. The `env` array automatically grants access to only those keys:

```bash
curl -X POST http://localhost:3000/v1/vms/vm-abc123/run-ts \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "env": ["API_TOKEN=secret123", "BASE_URL=https://api.example.com"],
    "code": "console.log(Deno.env.get(\"BASE_URL\"))"
  }'
```

**Example - Structured Results:**

Use built-in `result.set()` and `result.error()` helpers to return structured JSON:

```bash
curl -X POST http://localhost:3000/v1/vms/vm-abc123/run-ts \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "result.set({ ok: true, answer: 42 })"
  }'
```

**Response:**

```json
{
  "exitCode": 0,
  "stdout": "",
  "stderr": "",
  "result": { "ok": true, "answer": 42 }
}
```

---

## File Operations

Files are transferred as **tar.gz** archives. All paths must be within `/workspace`.

### Upload Files

Uploads a tar.gz archive to the VM.

```
POST /v1/vms/:id/files/upload?dest=/workspace/project
```

**Headers:**
- `Content-Type: application/gzip`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dest` | string | Yes | Destination directory (URL-encoded, must be under `/workspace`) |

**Example:**

```bash
# Create archive
mkdir -p /tmp/upload
echo "hello world" > /tmp/upload/hello.txt
tar -czf /tmp/upload.tar.gz -C /tmp/upload .

# Upload
curl -X POST "http://localhost:3000/v1/vms/vm-abc123/files/upload?dest=%2Fworkspace%2Fproject" \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/gzip" \
  --data-binary @/tmp/upload.tar.gz
```

**Response:** `204 No Content`

**Limits:**
- Max upload size: 10 MiB (compressed)
- Symlinks and path traversal are rejected

### Download Files

Downloads a directory as a tar.gz archive.

```
GET /v1/vms/:id/files/download?path=/workspace/project
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Directory to download (URL-encoded) |

**Example:**

```bash
curl -H "X-API-Key: \$API_KEY" \
  -o download.tar.gz \
  "http://localhost:3000/v1/vms/vm-abc123/files/download?path=%2Fworkspace%2Fproject"

# Extract
mkdir -p out && tar -xzf download.tar.gz -C out
```

---

## Snapshots

Snapshots capture VM memory, CPU state, and disk contents for fast restore.

### List Snapshots

```
GET /v1/snapshots
```

```bash
curl -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/snapshots
```

### Create Snapshot

Creates a snapshot from a running VM.

```
POST /v1/vms/:id/snapshots
```

```bash
curl -X POST -H "X-API-Key: \$API_KEY" \
  http://localhost:3000/v1/vms/vm-abc123/snapshots
```

**Response (201 Created):**

```json
{
  "id": "snap-xyz789",
  "vmId": "vm-abc123",
  "createdAt": "2025-01-21T11:00:00.000Z"
}
```

### Restore from Snapshot

Pass `snapshotId` when creating a VM:

```bash
curl -X POST http://localhost:3000/v1/vms \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": ["172.16.0.1/32"],
    "snapshotId": "snap-xyz789"
  }'
```

---

## Images

Guest images contain a Linux kernel (`vmlinux`) and root filesystem (`rootfs.ext4`).

### List Images

```
GET /v1/images
```

```bash
curl -H "X-API-Key: \$API_KEY" http://localhost:3000/v1/images
```

### Create Image Metadata

```
POST /v1/images
```

```bash
curl -X POST http://localhost:3000/v1/images \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-custom-image",
    "description": "Alpine with Python 3.12"
  }'
```

### Upload Kernel

```
PUT /v1/images/:id/kernel
```

```bash
curl -X PUT http://localhost:3000/v1/images/img-abc123/kernel \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @vmlinux
```

### Upload Rootfs

```
PUT /v1/images/:id/rootfs
```

```bash
curl -X PUT http://localhost:3000/v1/images/img-abc123/rootfs \
  -H "X-API-Key: \$API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @rootfs.ext4
```

### Set Default Image

```
POST /v1/images/:id/set-default
```

```bash
curl -X POST -H "X-API-Key: \$API_KEY" \
  http://localhost:3000/v1/images/img-abc123/set-default
```

### Delete Image

```
DELETE /v1/images/:id
```

```bash
curl -X DELETE -H "X-API-Key: \$API_KEY" \
  http://localhost:3000/v1/images/img-abc123
```

---

## Error Responses

All errors return JSON with a `message` field:

```json
{
  "message": "VM not found"
}
```

**Common Status Codes:**

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid API key |
| 404 | Not Found - Resource does not exist |
| 409 | Conflict - Operation conflicts with current state |
| 413 | Payload Too Large - Upload exceeds limit |
| 429 | Too Many Requests - Rate limit exceeded |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /v1/vms` | 30/min |
| `POST /v1/vms/:id/exec` | 60/min |
| `POST /v1/vms/:id/run-ts` | 60/min |
| `POST /v1/vms/:id/files/upload` | 30/min |
| `GET /v1/vms/:id/files/download` | 60/min |

---

## Interactive API Explorer

An interactive Swagger UI is available on your running instance at:

```
https://your-instance/swagger
```

For local development:

```
http://localhost:3000/swagger
```

The OpenAPI 3.0 specification can be downloaded from:```
https://your-instance/openapi.json
```
