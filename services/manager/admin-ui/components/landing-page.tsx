"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Shield,
  Box,
  Copy,
  ArrowRight,
  Clock,
  Layers,
  Code2,
  FileJson,
  Server,
  Github,
  Terminal,
} from "lucide-react"
import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function LandingPage({ latestGitHubTag }: { latestGitHubTag?: string | null }) {
  const [copied, setCopied] = useState<string | null>(null)

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const codeExamples = {
    createVm: `# Consumer/workflow VM linked to isolated provider SDK VMs
curl -X POST http://localhost:3000/v1/vms \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "cpu": 1,
    "memMb": 256,
    "allowIps": [],
    "outboundInternet": false,
    "peerLinks": [
      { "alias": "google", "vmId": "vm-google", "sourceMode": "hidden" },
      { "alias": "outlook", "vmId": "vm-outlook" }
    ]
  }'`,
    execCommand: `curl -X POST http://localhost:3000/v1/vms/{vm_id}/exec \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "cmd": "echo hello && id -u"
  }'`,
    createSnapshot: `curl -X POST http://localhost:3000/v1/vms/{vm_id}/snapshots \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}'`,
    dockerInstall: `# Install via Docker Compose (recommended)

# 1) Create .env
# - API_KEY: required for all /v1/* requests (send as X-API-Key header)
# - ADMIN_EMAIL / ADMIN_PASSWORD: Admin UI login credentials
# - RUN_DAT_SHEESH_DATA_DIR: host directory to persist manager state (DB, VM storage)
# - RUN_DAT_SHEESH_IMAGES_DIR: host directory to store uploaded guest images (vmlinux + rootfs.ext4)
# - ROOTFS_CLONE_MODE: "auto" is fine for most setups (advanced)
# - SNAPSHOT_TEMPLATE_*: size legacy template snapshot VMs (optional)
cat > .env <<'ENV'
API_KEY=dev-key
VM_SECRET_KEY=change-me
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin
RUN_DAT_SHEESH_DATA_DIR=./data
RUN_DAT_SHEESH_IMAGES_DIR=./images
ROOTFS_CLONE_MODE=auto
# Warm pool is optional and needs a default image.
# Warm pool is skipped for VMs created with secretEnv or peerLinks.
ENABLE_WARM_POOL=false
WARM_POOL_TARGET=1
WARM_POOL_MAX_VMS=4
SNAPSHOT_TEMPLATE_CPU=1
SNAPSHOT_TEMPLATE_MEM_MB=256
ENV

# 2) Create host directories
mkdir -p ./data ./images

# 3) Create docker-compose.yml (published image)
cat > docker-compose.yml <<'YAML'
version: "3.9"

# Runs the manager API directly on http://127.0.0.1:3000 (no proxy/TLS).
services:
  manager:
    image: lelemm/rundatsheesh:latest

    # Keep dev aligned with integration + prod compose hardening.
    read_only: true
    security_opt:
      - no-new-privileges:true
      - seccomp=unconfined
      - apparmor=unconfined
    cap_drop:
      - ALL
    cap_add:
      - NET_ADMIN
      # Required by Firecracker jailer (mount namespace + chroot + privilege drop + dev setup).
      - SYS_ADMIN
      - SYS_CHROOT
      - SETUID
      - SETGID
      - MKNOD
      - CHOWN
      - DAC_OVERRIDE
      - DAC_READ_SEARCH
    tmpfs:
      - /tmp
      - /run
    sysctls:
      net.ipv4.ip_forward: "1"
      net.ipv4.conf.all.forwarding: "1"
      net.ipv4.conf.default.forwarding: "1"

    environment:
      API_KEY: \${API_KEY:-dev-key}
      VM_SECRET_KEY: \${VM_SECRET_KEY}
      ADMIN_EMAIL: \${ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD:-admin}
      PORT: 3000
      STORAGE_ROOT: /var/lib/run-dat-sheesh
      IMAGES_DIR: /var/lib/run-dat-sheesh/images
      AGENT_VSOCK_PORT: 8080
      ROOTFS_CLONE_MODE: \${ROOTFS_CLONE_MODE:-auto}
      ENABLE_WARM_POOL: \${ENABLE_WARM_POOL:-false}
      WARM_POOL_TARGET: \${WARM_POOL_TARGET:-1}
      WARM_POOL_MAX_VMS: \${WARM_POOL_MAX_VMS:-4}
      SNAPSHOT_TEMPLATE_CPU: \${SNAPSHOT_TEMPLATE_CPU:-1}
      SNAPSHOT_TEMPLATE_MEM_MB: \${SNAPSHOT_TEMPLATE_MEM_MB:-256}
    ports:
      - "3000:3000"
    volumes:
      - \${RUN_DAT_SHEESH_IMAGES_DIR:-./images}:/var/lib/run-dat-sheesh/images
      - \${RUN_DAT_SHEESH_DATA_DIR:-./data}:/var/lib/run-dat-sheesh
    devices:
      - /dev/kvm:/dev/kvm
      - /dev/vhost-vsock:/dev/vhost-vsock
      - /dev/net/tun:/dev/net/tun
      # Optional (some hosts expose this; integration script mounts it when present)
      # - /dev/vsock:/dev/vsock
YAML

# 4) Download guest images from GitHub releases OR build them yourself
# Option A: Download from releases (recommended)
# Visit https://github.com/lelemm/rundatsheesh/releases
# Download the guest image zip (e.g. alpine.zip) and extract to ./images/

# Option B: Build from source (requires Docker)
# git clone https://github.com/lelemm/rundatsheesh.git
# cd rundatsheesh && ./scripts/build-guest-images.sh
# cp -r dist/images/* ./images/

# 5) Start
docker compose up -d

# 6) Open:
# - Admin UI: http://localhost:3000/login/
# - Docs: http://localhost:3000/docs/
# - Swagger: http://localhost:3000/swagger`,
  }

  const latestTagLabel = latestGitHubTag ? `GitHub tag ${latestGitHubTag}` : "GitHub releases"

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/50 backdrop-blur-sm fixed top-0 w-full z-50 bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <img
                src="/logo.png"
                alt="run dat sheesh"
                className="w-8 h-8 rounded-lg object-cover"
              />
              <span className="font-semibold text-lg">run dat sheesh</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </Link>
              <Link href="#install" className="text-muted-foreground hover:text-foreground transition-colors">
                Install
              </Link>
              <Link href="#api" className="text-muted-foreground hover:text-foreground transition-colors">
                API
              </Link>
              <Link href="/docs/" className="text-muted-foreground hover:text-foreground transition-colors">
                Docs
              </Link>
              <Link
                href="https://github.com/lelemm/rundatsheesh"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Github className="w-4 h-4" /> GitHub
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <Link href="https://github.com/lelemm/rundatsheesh">
                <Button className="gap-2">
                  <Github className="w-4 h-4" /> Star on GitHub
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            <img
              src="/logo.png"
              alt="run dat sheesh"
              width={300}
              height={300}
              className="mx-auto mb-6 rounded-2xl object-cover"
            />
            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm">
                <Server className="w-4 h-4" />
                <span>Self-hosted • Open Source</span>
              </div>
              <Link
                href="https://github.com/lelemm/rundatsheesh/releases"
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-sm text-foreground hover:border-primary/40 transition-colors"
              >
                <Github className="w-4 h-4" />
                <span>{latestTagLabel}</span>
              </Link>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-balance mb-6">
              Isolate <span className="text-primary">SDK Credentials and LLM Code</span> in Separate Firecracker VMs
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-6 text-pretty">
              Run provider SDKs in dedicated microVMs, keep their secrets scoped with `secretEnv`, and let workflow VMs
              call them through manager-routed proxies instead of sharing credentials across the whole runtime.
            </p>
            <div className="max-w-2xl mx-auto mb-8 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              <span className="font-semibold">Alpha warning:</span> This app is in an early alpha state and may be very
              unstable. Use with caution.
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <Link href="https://github.com/lelemm/rundatsheesh">
                <Button size="lg" className="gap-2 h-12 px-6">
                  <Github className="w-4 h-4" /> View on GitHub
                </Button>
              </Link>
              <Link href="#install">
                <Button variant="outline" size="lg" className="gap-2 h-12 px-6 bg-transparent">
                  <Terminal className="w-4 h-4" /> Quick Install
                </Button>
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3 text-left max-w-5xl mx-auto mb-10">
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Provider VMs</p>
                <p className="font-semibold mb-2">One SDK, one secret scope</p>
                <p className="text-sm text-muted-foreground">
                  Keep Google, Graph, or any other SDK in its own VM and inject only the env vars that provider needs.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Manager Bridge</p>
                <p className="font-semibold mb-2">No direct guest-to-guest trust</p>
                <p className="text-sm text-muted-foreground">
                  Consumer proxies call the manager bridge, which validates the alias and then invokes the provider VM over vsock.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Workflow VMs</p>
                <p className="font-semibold mb-2">Discover, compose, and sync</p>
                <p className="text-sm text-muted-foreground">
                  Read peer manifests and README files, optionally mount mirrored source, and compose multi-SDK workflows locally.
                </p>
              </div>
            </div>
          </div>

          {/* API Preview */}
          <div className="max-w-4xl mx-auto mt-16">
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-2xl shadow-primary/5">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-destructive/60" />
                    <div className="w-3 h-3 rounded-full bg-warning/60" />
                    <div className="w-3 h-3 rounded-full bg-success/60" />
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">POST /v1/vms</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => copyCode(codeExamples.createVm, "hero")}
                >
                  <Copy className={`w-3 h-3 mr-1 ${copied === "hero" ? "text-success" : ""}`} />
                  {copied === "hero" ? "Copied!" : "Copy"}
                </Button>
              </div>
              <div className="p-6 font-mono text-sm overflow-x-auto">
                <pre className="text-muted-foreground">
                  <code>{codeExamples.createVm}</code>
                </pre>
              </div>
              <div className="border-t border-border px-4 py-3 bg-muted/10">
                <p className="text-xs text-muted-foreground font-mono">
                  <span className="text-success">200 OK</span> • VM ready to execute
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* <section className="py-16 border-y border-border/50 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <p className="text-3xl sm:text-4xl font-bold text-primary">&lt;100ms</p>
              <p className="text-muted-foreground mt-1">VM Boot Time</p>
            </div>
            <div className="text-center">
              <p className="text-3xl sm:text-4xl font-bold text-foreground">~5MB</p>
              <p className="text-muted-foreground mt-1">Memory per VM</p>
            </div>
            <div className="text-center">
              <p className="text-3xl sm:text-4xl font-bold text-foreground">12</p>
              <p className="text-muted-foreground mt-1">API Endpoints</p>
            </div>
            <div className="text-center">
              <p className="text-3xl sm:text-4xl font-bold text-foreground">Apache 2.0</p>
              <p className="text-muted-foreground mt-1">License</p>
            </div>
          </div>
        </div>
      </section> */}

      {/* Features Section */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Sandboxing For Untrusted Code And Untrusted SDKs</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              The current platform is built around provider VMs, consumer VMs, proxy generation, and manager-routed calls.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Peer SDK Isolation</h3>
              <p className="text-muted-foreground text-sm">
                Provider SDKs live in separate microVMs with their own `secretEnv`, so workflow code never gets those credentials locally.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Code2 className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Manifest-First Discovery</h3>
              <p className="text-muted-foreground text-sm">
                Consumer VMs get `/workspace/peers/index.json`, per-alias manifests, generated README files, and importable proxy modules.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Layers className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Manager-Routed Communication</h3>
              <p className="text-muted-foreground text-sm">
                Consumer proxies call the manager bridge, which validates the peer link and executes the real SDK code inside the provider VM.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Snapshots And Warm Starts</h3>
              <p className="text-muted-foreground text-sm">
                Snapshot provider VMs after SDK upload and snapshot consumer VMs after peer sync to cut repeated setup and boot time.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="install" className="py-24 px-4 sm:px-6 lg:px-8 bg-muted/20 border-y border-border/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Get Started in Minutes</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Deploy on any Linux server with KVM support
            </p>
          </div>

          <Tabs defaultValue="docker" className="max-w-4xl mx-auto">
            <TabsList className="grid w-full grid-cols-1 mb-6">
              <TabsTrigger value="docker" className="gap-2">
                <Box className="w-4 h-4" /> Docker
              </TabsTrigger>
            </TabsList>

            <TabsContent value="docker">
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                  <span className="text-sm font-medium">Docker Installation</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copyCode(codeExamples.dockerInstall, "docker")}
                  >
                    <Copy className={`w-3 h-3 mr-1 ${copied === "docker" ? "text-success" : ""}`} />
                    {copied === "docker" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <pre className="p-4 font-mono text-sm overflow-x-auto text-muted-foreground">
                  <code>{codeExamples.dockerInstall}</code>
                </pre>
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-8 text-center">
            <p className="text-muted-foreground text-sm">
              Requires Linux with KVM enabled. See{" "}
              <Link href="/docs/requirements" className="text-primary hover:underline">
                system requirements
              </Link>{" "}
              for details. Peer SDK VMs require `VM_SECRET_KEY`, and warm pool only works when a default image is configured.
            </p>
          </div>
        </div>
      </section>

      {/* API Examples Section */}
      <section id="api" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Simple, Powerful API</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              RESTful endpoints with SDKs for Python, Node.js, Go, and more
            </p>
          </div>

            <Tabs defaultValue="curl" className="max-w-4xl mx-auto">
            <TabsList className="grid w-full grid-cols-1 mb-6">
              <TabsTrigger value="curl" className="gap-2">
                <Code2 className="w-4 h-4" /> cURL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="curl" className="space-y-4">
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                  <span className="text-sm font-medium">Create VM</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copyCode(codeExamples.createVm, "curl-create")}
                  >
                    <Copy className={`w-3 h-3 mr-1 ${copied === "curl-create" ? "text-success" : ""}`} />
                    {copied === "curl-create" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <pre className="p-4 font-mono text-sm overflow-x-auto text-muted-foreground">
                  <code>{codeExamples.createVm}</code>
                </pre>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                  <span className="text-sm font-medium">Execute Command</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copyCode(codeExamples.execCommand, "curl-exec")}
                  >
                    <Copy className={`w-3 h-3 mr-1 ${copied === "curl-exec" ? "text-success" : ""}`} />
                    {copied === "curl-exec" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <pre className="p-4 font-mono text-sm overflow-x-auto text-muted-foreground">
                  <code>{codeExamples.execCommand}</code>
                </pre>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                  <span className="text-sm font-medium">Create Snapshot</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copyCode(codeExamples.createSnapshot, "curl-snap")}
                  >
                    <Copy className={`w-3 h-3 mr-1 ${copied === "curl-snap" ? "text-success" : ""}`} />
                    {copied === "curl-snap" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <pre className="p-4 font-mono text-sm overflow-x-auto text-muted-foreground">
                  <code>{codeExamples.createSnapshot}</code>
                </pre>
              </div>
            </TabsContent>
          </Tabs>

          {/* API Endpoints Quick Reference */}
          <div className="mt-16 max-w-4xl mx-auto">
            <h3 className="text-xl font-semibold mb-6 text-center">API Endpoints</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-border bg-card">
                <p className="font-mono text-sm mb-2">
                  <span className="text-success font-semibold">POST</span>{" "}
                  <span className="text-muted-foreground">/v1/vms</span>
                </p>
                <p className="text-sm text-muted-foreground">Create a new VM</p>
              </div>
              <div className="p-4 rounded-lg border border-border bg-card">
                <p className="font-mono text-sm mb-2">
                  <span className="text-blue-400 font-semibold">GET</span>{" "}
                  <span className="text-muted-foreground">/v1/vms</span>
                </p>
                <p className="text-sm text-muted-foreground">List all VMs</p>
              </div>
              <div className="p-4 rounded-lg border border-border bg-card">
                <p className="font-mono text-sm mb-2">
                  <span className="text-success font-semibold">POST</span>{" "}
                  <span className="text-muted-foreground">/v1/vms/:id/exec</span>
                </p>
                <p className="text-sm text-muted-foreground">Execute command in VM</p>
              </div>
              <div className="p-4 rounded-lg border border-border bg-card">
                <p className="font-mono text-sm mb-2">
                  <span className="text-success font-semibold">POST</span>{" "}
                  <span className="text-muted-foreground">/v1/vms/:id/snapshots</span>
                </p>
                <p className="text-sm text-muted-foreground">Create VM snapshot</p>
              </div>
              <div className="p-4 rounded-lg border border-border bg-card">
                <p className="font-mono text-sm mb-2">
                  <span className="text-success font-semibold">POST</span>{" "}
                  <span className="text-muted-foreground">/v1/vms/:id/files/upload</span>
                </p>
                <p className="text-sm text-muted-foreground">Upload file to VM</p>
              </div>
              <div className="p-4 rounded-lg border border-border bg-card">
                <p className="font-mono text-sm mb-2">
                  <span className="text-success font-semibold">POST</span>{" "}
                  <span className="text-muted-foreground">/v1/vms/:id/peers/sync</span>
                </p>
                <p className="text-sm text-muted-foreground">Rebuild peer manifests, README files, proxies, and optional source mounts</p>
              </div>
            </div>
            <div className="text-center mt-8">
              <Link href="/docs/api/">
                <Button variant="outline" className="gap-2 bg-transparent">
                  <FileJson className="w-4 h-4" /> View Full API Reference
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-muted/20 border-t border-border/50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Deploy on Your Infrastructure</h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-2xl mx-auto">
            Open source, self-hosted, and fully under your control. Run untrusted code without trusting third parties.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="https://github.com/lelemm/rundatsheesh">
              <Button size="lg" className="gap-2 h-12 px-8">
                <Github className="w-5 h-5" /> Get Started
              </Button>
            </Link>
            <Link href="/docs/">
              <Button variant="outline" size="lg" className="gap-2 h-12 px-8 bg-transparent">
                Read the Docs <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img
                src="/logo.png"
                alt="run dat sheesh"
                className="w-6 h-6 rounded object-cover"
              />
              <span className="font-semibold">run dat sheesh</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link
                href="https://github.com/lelemm/rundatsheesh"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </Link>
              <Link href="/docs/" className="hover:text-foreground transition-colors">
                Documentation
              </Link>
              <Link
                href="https://github.com/lelemm/rundatsheesh/blob/main/LICENSE"
                className="hover:text-foreground transition-colors"
              >
                Apache 2.0 License
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
