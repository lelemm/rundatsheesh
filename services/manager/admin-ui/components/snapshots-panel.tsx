"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Search, RefreshCw, MoreVertical, Play, Camera, Server, Layers, HardDrive } from "lucide-react"
import { apiGetJson } from "@/lib/api"
import { CopyId } from "@/components/ui/copy-id"

interface Snapshot {
  id: string
  type: "vm" | "template"
  createdAt: string
  sourceId?: string
  cpu?: number
  memMb?: number
}

interface ApiSnapshot {
  id: string
  kind: "vm" | "template"
  createdAt: string
  sourceVmId?: string
  cpu?: number
  memMb?: number
}

export function SnapshotsPanel() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const filteredSnapshots = useMemo(
    () =>
      snapshots.filter(
        (snap) =>
          snap.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (snap.sourceId ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [snapshots, searchQuery],
  )

  const vmSnapshots = filteredSnapshots.filter((s) => s.type === "vm")
  const templateSnapshots = filteredSnapshots.filter((s) => s.type === "template")

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<ApiSnapshot[]>("/v1/snapshots")
      setSnapshots(
        data.map((s) => ({
          id: s.id,
          type: s.kind,
          createdAt: s.createdAt,
          sourceId: s.sourceVmId,
          cpu: s.cpu,
          memMb: s.memMb,
        })),
      )
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Snapshots</h2>
          <p className="text-muted-foreground text-sm mt-1">VM and template snapshots for quick restoration</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search snapshots..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-input border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="border-border text-foreground hover:bg-secondary bg-transparent"
          onClick={refresh}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading snapshots…</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              VM Snapshots
              <Badge variant="secondary" className="ml-auto">
                {vmSnapshots.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vmSnapshots.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No VM snapshots found</p>
            ) : (
              vmSnapshots.map((snapshot) => (
                <div key={snapshot.id} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <Camera className="w-4 h-4 text-primary" />
                      <CopyId value={snapshot.id} className="text-foreground" />
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      {snapshot.sourceId && (
                        <span className="flex items-center gap-1">
                          Source: <CopyId value={snapshot.sourceId} className="text-xs" />
                        </span>
                      )}
                      {typeof snapshot.cpu === "number" && typeof snapshot.memMb === "number" && (
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          {snapshot.cpu} vCPU / {snapshot.memMb} MB
                        </span>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground hover:bg-secondary"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover border-border">
                      <DropdownMenuItem className="text-popover-foreground hover:bg-secondary cursor-pointer">
                        <Play className="w-4 h-4 mr-2" />
                        Restore to New VM
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Template Snapshots
              <Badge variant="secondary" className="ml-auto">
                {templateSnapshots.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {templateSnapshots.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No template snapshots found</p>
            ) : (
              templateSnapshots.map((snapshot) => (
                <div key={snapshot.id} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-primary" />
                      <CopyId value={snapshot.id} className="text-foreground" />
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      {snapshot.sourceId && (
                        <span className="flex items-center gap-1">
                          Source: <CopyId value={snapshot.sourceId} className="text-xs" />
                        </span>
                      )}
                      {typeof snapshot.cpu === "number" && typeof snapshot.memMb === "number" && (
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          {snapshot.cpu} vCPU / {snapshot.memMb} MB
                        </span>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground hover:bg-secondary"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover border-border">
                      <DropdownMenuItem className="text-popover-foreground hover:bg-secondary cursor-pointer">
                        <Play className="w-4 h-4 mr-2" />
                        Use for New VM
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
