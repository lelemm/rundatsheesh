"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Server, Camera, Layers, Activity, Cpu, HardDrive } from "lucide-react"
import type { View } from "./admin-shell"
import { useEffect, useMemo, useState } from "react"
import { apiGetJson, getStoredApiKey, setStoredApiKey } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface DashboardProps {
  onNavigate: (view: View) => void
}

type Overview = {
  counts: { activeVms: number; snapshots: number; templates: number }
  cpu: { usagePct: number | null; capacityCores: number; usedCores: number }
  memory: { usedBytes: number | null; capacityBytes: number | null }
  storage: { usedBytes: number | null; capacityBytes: number | null }
}

type ActivityEvent = {
  id: string
  createdAt: string
  type: string
  entityType?: string
  entityId?: string
  message: string
}

function formatGb(bytes: number | null): string {
  if (bytes === null) return "—"
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

function formatPct(ratio: number | null): string {
  if (ratio === null) return "—"
  return `${Math.round(ratio * 100)}%`
}

function clampPct(p: number) {
  return Math.max(0, Math.min(100, p))
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [apiKey, setApiKey] = useState<string>("")
  const [storedApiKey, setStoredKey] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const k = getStoredApiKey()
    setStoredKey(k)
    setApiKey(k ?? "")
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        setError(null)
        const [o, a] = await Promise.all([
          apiGetJson<Overview>("/v1/admin/overview", storedApiKey),
          apiGetJson<ActivityEvent[]>(`/v1/admin/activity?limit=5`, storedApiKey),
        ])
        if (cancelled) return
        setOverview(o)
        setActivity(a)
      } catch (e: any) {
        if (cancelled) return
        setError(String(e?.message ?? e))
      }
    }
    run()
    const timer = setInterval(run, 10_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [storedApiKey])

  const stats = useMemo(() => {
    const activeVms = overview?.counts.activeVms ?? null
    const vmSnaps = overview?.counts.snapshots ?? null
    const templates = overview?.counts.templates ?? null
    const totalSnaps = vmSnaps !== null && templates !== null ? vmSnaps + templates : null
    const cpuUsage = overview?.cpu.usagePct ?? null
    return [
      { label: "Active VMs", value: activeVms?.toString() ?? "—", icon: Server, change: "", view: "vms" as View },
      {
        label: "Snapshots",
        value: totalSnaps?.toString() ?? "—",
        icon: Camera,
        change: vmSnaps !== null && templates !== null ? `${vmSnaps} VM, ${templates} template` : "",
        view: "snapshots" as View,
      },
      {
        label: "Templates",
        value: templates?.toString() ?? "—",
        icon: Layers,
        change: templates !== null ? "Stored templates" : "",
        view: "templates" as View,
      },
      { label: "CPU Usage", value: formatPct(cpuUsage), icon: Cpu, change: "Across host", view: undefined },
    ]
  }, [overview])

  const memoryPct =
    overview?.memory.usedBytes !== null && overview?.memory.capacityBytes
      ? clampPct((overview.memory.usedBytes / overview.memory.capacityBytes) * 100)
      : null
  const cpuCoresPct =
    overview?.cpu.capacityCores ? clampPct((overview.cpu.usedCores / overview.cpu.capacityCores) * 100) : null
  const storagePct =
    overview?.storage.usedBytes !== null && overview?.storage.capacityBytes
      ? clampPct((overview.storage.usedBytes / overview.storage.capacityBytes) * 100)
      : null

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground text-sm mt-1">Overview of your microVM infrastructure</p>
      </div>

      {!storedApiKey && !overview && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">API Key required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter your manager API key to load dashboard data. This is stored locally in your browser.
            </p>
            <div className="flex gap-2">
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="X-API-Key" />
              <Button
                onClick={() => {
                  const k = apiKey.trim()
                  if (!k) return
                  setStoredApiKey(k)
                  setStoredKey(k)
                }}
              >
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Failed to load</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground break-words">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className={`bg-card border-border ${stat.view ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
            onClick={() => stat.view && onNavigate(stat.view)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activity.map((ev) => (
                <div key={ev.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        ev.type.includes("deleted") || ev.type.includes("stopped") ? "bg-warning" : "bg-success"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{ev.message}</p>
                      <p className="text-xs text-muted-foreground font-mono">{ev.entityId ?? ev.entityType ?? ""}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{timeAgo(ev.createdAt)}</span>
                </div>
              ))}
              {activity.length === 0 && <p className="text-sm text-muted-foreground">No recent activity</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-primary" />
              Resource Allocation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Memory</span>
                <span className="text-foreground font-medium">
                  {formatGb(overview?.memory.usedBytes ?? null)} / {formatGb(overview?.memory.capacityBytes ?? null)}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${memoryPct ?? 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">vCPUs</span>
                <span className="text-foreground font-medium">
                  {overview?.cpu.usedCores ?? "—"} / {overview?.cpu.capacityCores ?? "—"}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${cpuCoresPct ?? 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Storage</span>
                <span className="text-foreground font-medium">
                  {formatGb(overview?.storage.usedBytes ?? null)} / {formatGb(overview?.storage.capacityBytes ?? null)}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${storagePct ?? 0}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
