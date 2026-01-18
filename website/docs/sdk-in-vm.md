---
title: Run “SDK code” inside the VM (upload + import)
---

You can upload a small “SDK” module into `/home/user` and then `run-ts` an entrypoint that imports it.

This pattern is validated by integration tests: upload an archive containing `sdk/` and `app/`, then run `/home/user/app/main.ts`.

## 1) Create your SDK + app entrypoint

Example layout:

```
sdk/index.ts
app/main.ts
```

`sdk/index.ts`:

```ts
export function greet(name: string) {
  return `hello ${name}`;
}
```

`app/main.ts`:

```ts
import { greet } from "../sdk/index.ts";

console.log(greet("world"));
```

## 2) Tar + upload to `/home/user`

```bash
mkdir -p /tmp/rds-sdk/sdk /tmp/rds-sdk/app
cat >/tmp/rds-sdk/sdk/index.ts <<'EOF'
export function greet(name: string) {
  return `hello ${name}`;
}
EOF
cat >/tmp/rds-sdk/app/main.ts <<'EOF'
import { greet } from "../sdk/index.ts";
console.log(greet("world"));
EOF
tar -czf /tmp/sdk.tar.gz -C /tmp/rds-sdk .

VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/gzip" \\
  --data-binary @/tmp/sdk.tar.gz \\
  "http://localhost:3000/v1/vms/${VM_ID}/files/upload?dest=%2Fhome%2Fuser"
```

## 3) Execute it with `run-ts` by path

```bash
VM_ID="<put-id-here>"
curl -sS \\
  -H "X-API-Key: dev-key" \\
  -H "content-type: application/json" \\
  -d '{"path":"/home/user/app/main.ts"}' \\
  "http://localhost:3000/v1/vms/${VM_ID}/run-ts"
```

Expected:
- `exitCode: 0`
- `stdout: "hello world\n"`

