"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react"
import { apiGetJson, apiRequestJson, getStoredApiKey } from "@/lib/api"

interface ApiKeyRecord {
  id: string
  name: string
  prefix: string
  createdAt: string
  expiresAt?: string | null
  revokedAt?: string | null
  lastUsedAt?: string | null
  apiKey?: string
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newExpiresAt, setNewExpiresAt] = useState("")
  const [justCreatedKey, setJustCreatedKey] = useState<ApiKeyRecord | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null)
  const apiKey = getStoredApiKey()

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<ApiKeyRecord[]>("/v1/admin/api-keys", apiKey)
      setKeys(data)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [apiKey])

  const handleCreate = async () => {
    const payload = {
      name: newName.trim(),
      expiresAt: newExpiresAt ? new Date(newExpiresAt).toISOString() : null,
    }
    const created = await apiRequestJson<ApiKeyRecord>("POST", "/v1/admin/api-keys", apiKey, payload)
    setJustCreatedKey(created)
    setCreateOpen(false)
    setNewName("")
    setNewExpiresAt("")
    await refresh()
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    await apiRequestJson<ApiKeyRecord>("POST", `/v1/admin/api-keys/${revokeTarget.id}/revoke`, apiKey)
    setRevokeTarget(null)
    await refresh()
  }

  return (
    <div className="p-6 space-y-6">
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Revoke API key</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Revoke key <span className="font-mono text-foreground">{revokeTarget?.name}</span>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary bg-transparent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-destructive text-destructive-foreground">
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Create API Key
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create API Key</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              The full key will be shown once after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground">
                Name
              </Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiresAt" className="text-foreground">
                Expiration (optional)
              </Label>
              <Input
                id="expiresAt"
                type="datetime-local"
                value={newExpiresAt}
                onChange={(e) => setNewExpiresAt(e.target.value)}
                className="bg-input border-border text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {justCreatedKey?.apiKey && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">New API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={justCreatedKey.apiKey} className="bg-input border-border text-foreground" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigator.clipboard.writeText(justCreatedKey.apiKey!)}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Save this key now. It won’t be shown again.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">API Keys</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage programmatic access keys</p>
        </div>
        <Button variant="outline" size="icon" className="bg-transparent" onClick={refresh}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading keys…</p>}

      <div className="grid gap-3">
        {keys.map((key) => (
          <Card key={key.id} className="bg-card border-border">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">{key.name}</div>
                <div className="text-xs text-muted-foreground font-mono">rds_{key.prefix}_••••</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Created {new Date(key.createdAt).toLocaleString()}
                  {key.expiresAt ? ` • Expires ${new Date(key.expiresAt).toLocaleString()}` : " • No expiry"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {key.revokedAt ? (
                  <span className="text-xs text-muted-foreground">Revoked</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRevokeTarget(key)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && keys.length === 0 && <p className="text-sm text-muted-foreground">No keys created yet.</p>}
      </div>
    </div>
  )
}
