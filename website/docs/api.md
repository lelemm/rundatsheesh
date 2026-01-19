---
title: API (how to call code)
---

## Authentication

All `/v1/*` endpoints require either:
- `X-API-Key: <API_KEY>`, or
- an admin session cookie set by `POST /auth/login`

Documentation endpoints are public:
- `/docs/*` (this site)
- `/swagger`
- `/openapi.json`

## Create a VM

```bash
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/json" \\
  -d '{"cpu":1,"memMb":256,"allowIps":["172.16.0.1/32"],"outboundInternet":true}' \\
  http://localhost:3000/v1/vms
```

## Exec a shell command

Runs as uid/gid **1000** inside the VM, confined to `/workspace`.

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/json" \\
  -d '{"cmd":"id && echo hello","timeoutMs":30000}' \\
  "http://localhost:3000/v1/vms/${VM_ID}/exec"
```

## Run TypeScript (Deno)

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/json" \\
  -d '{"code":"console.log(2 + 2)"}' \\
  "http://localhost:3000/v1/vms/${VM_ID}/run-ts"
```

### Env vars in `run-ts` (Deno)

Deno is permissioned by default: reading env vars requires `--allow-env`.

For convenience, `run-ts` accepts an `env` array and will:
- set those variables for the process
- automatically allow access to **only those keys** (so `Deno.env.get("KEY")` works)

Example:

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/json" \\
  -d '{
    "env": ["CLICKUP_TOKEN=...","CLICKUP_BASE_URL=https://api.clickup.com/api/v2"],
    "code": "console.log(Deno.env.get(\\"CLICKUP_BASE_URL\\"))"
  }' \\
  "http://localhost:3000/v1/vms/${VM_ID}/run-ts"
```

### Returning a structured value from `run-ts`

`run-ts` also provides a built-in global helper:
- `result.set(value)` to return a structured JSON value
- `result.error(err)` to return a structured JSON error (and exit non-zero)

Example:

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/json" \\
  -d '{
    "code": "result.set({ ok: true, answer: 42 }); console.log(\\"done\\")"
  }' \\
  "http://localhost:3000/v1/vms/${VM_ID}/run-ts"
```

## Upload files (tar.gz)

Uploads must be a **tar.gz** stream and are restricted to **`/workspace`**.

Create an archive:

```bash
mkdir -p /tmp/rds-upload
echo "hello run-dat-sheesh" >/tmp/rds-upload/hello.txt
tar -czf /tmp/upload.tar.gz -C /tmp/rds-upload .
```

Upload:

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/gzip" \\
  --data-binary @/tmp/upload.tar.gz \\
  "http://localhost:3000/v1/vms/${VM_ID}/files/upload?dest=%2Fhome%2Fuser%2Fproject"
```

## Download files (tar.gz)

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -o download.tar.gz \\
  "http://localhost:3000/v1/vms/${VM_ID}/files/download?path=%2Fhome%2Fuser%2Fproject"
```

Then extract:

```bash
mkdir -p out
tar -xzf download.tar.gz -C out
```

## Full reference

Use Swagger UI:
- [Swagger](../swagger)

