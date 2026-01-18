"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { apiGetJson, apiRequestJson } from "@/lib/api"
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "@/hooks/use-toast"

type Webhook = {
  id: string
  name: string
  url: string
  enabled: boolean
  eventTypes: string[]
  createdAt: string
}

const EVENT_TYPES = [
  "vm.created",
  "vm.started",
  "vm.stopped",
  "vm.deleted",
  "snapshot.created",
  "image.created",
  "image.default_set",
  "image.kernel_uploaded",
  "image.rootfs_uploaded",
  "image.deleted",
  "apikey.created",
  "apikey.revoked",
] as const

export function WebhooksPanel() {
  const [items, setItems] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newUrl, setNewUrl] = useState("")
  const [newEnabled, setNewEnabled] = useState(true)
  const [newEventTypes, setNewEventTypes] = useState<Record<string, boolean>>(
    () => Object.fromEntries(EVENT_TYPES.map((t) => [t, t.startsWith("vm.")])) as Record<string, boolean>,
  )
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null)

  const selectedEventTypes = useMemo(
    () => Object.entries(newEventTypes).filter(([, v]) => v).map(([k]) => k),
    [newEventTypes],
  )

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<Webhook[]>("/v1/admin/webhooks")
      setItems(data)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    const url = newUrl.trim()
    if (!name || !url) return
    if (!selectedEventTypes.length) return
    setError(null)
    try {
      await apiRequestJson<Webhook>("POST", "/v1/admin/webhooks", {
        name,
        url,
        enabled: newEnabled,
        eventTypes: selectedEventTypes,
      })
      toast({ title: "Webhook created" })
      setCreateOpen(false)
      setNewName("")
      setNewUrl("")
      setNewEnabled(true)
      setNewEventTypes(Object.fromEntries(EVENT_TYPES.map((t) => [t, t.startsWith("vm.")])) as Record<string, boolean>)
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      await apiRequestJson("DELETE", `/v1/admin/webhooks/${encodeURIComponent(id)}`)
      toast({ title: "Webhook deleted" })
      setDeleteTarget(null)
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Webhooks</h2>
          <p className="text-muted-foreground text-sm mt-1">Call external endpoints when selected events happen</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="border-border text-foreground hover:bg-secondary bg-transparent"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                New webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">Create webhook</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Webhooks are delivered best-effort (no retries yet). Choose which event types to receive.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-foreground">Name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="bg-input border-border text-foreground"
                    placeholder="e.g. prod-n8n"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">URL</Label>
                  <Input
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="bg-input border-border text-foreground"
                    placeholder="https://example.com/webhook"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-foreground">Enabled</Label>
                  <Switch checked={newEnabled} onCheckedChange={setNewEnabled} />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Event types</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {EVENT_TYPES.map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(newEventTypes[t])}
                          onChange={(e) => setNewEventTypes((m) => ({ ...m, [t]: e.target.checked }))}
                        />
                        <span className="font-mono text-xs">{t}</span>
                      </label>
                    ))}
                  </div>
                  {!selectedEventTypes.length && (
                    <p className="text-xs text-destructive">Select at least one event type.</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  className="border-border text-foreground hover:bg-secondary"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newName.trim() || !newUrl.trim() || selectedEventTypes.length === 0}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground break-words">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading webhooks…</p>}

      <div className="grid gap-3">
        {items.map((w) => (
          <Card key={w.id} className="bg-card border-border">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-foreground">{w.name}</CardTitle>
                <p className="text-xs text-muted-foreground font-mono mt-2">{w.url}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {w.enabled ? "Enabled" : "Disabled"} • {w.eventTypes.length} event types
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteTarget(w)}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </CardHeader>
          </Card>
        ))}

        {!loading && items.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">No webhooks yet. Create one to start receiving events.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete webhook</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Delete <span className="font-mono text-foreground">{deleteTarget?.name}</span>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-border text-foreground hover:bg-secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

