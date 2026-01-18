"use client"

import { useEffect, useMemo, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import { apiGetJson, apiRequestJson, apiUploadBinary, getStoredApiKey } from "@/lib/api"
import { Plus, RefreshCw, Star, Trash2, Upload } from "lucide-react"

type GuestImage = {
  id: string
  name: string
  description: string
  createdAt: string
  kernelFilename?: string | null
  rootfsFilename?: string | null
  baseRootfsBytes?: number | null
  isDefault?: boolean
  hasKernel?: boolean
  hasRootfs?: boolean
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—"
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

export function ImagesPanel() {
  const apiKey = getStoredApiKey()
  const [items, setItems] = useState<GuestImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<GuestImage | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<GuestImage[]>("/v1/images", apiKey)
      setItems(data)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const defaultId = useMemo(() => items.find((x) => x.isDefault)?.id ?? null, [items])

  const handleCreate = async () => {
    const name = newName.trim()
    const description = newDescription.trim()
    if (!name || !description) return
    setError(null)
    try {
      await apiRequestJson<GuestImage>("POST", "/v1/images", apiKey, { name, description })
      setCreateOpen(false)
      setNewName("")
      setNewDescription("")
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const uploadFile = async (img: GuestImage, kind: "kernel" | "rootfs", file: File) => {
    setError(null)
    try {
      await apiUploadBinary("PUT", `/v1/images/${encodeURIComponent(img.id)}/${kind}`, apiKey, file, "application/octet-stream")
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const setDefault = async (img: GuestImage) => {
    setError(null)
    try {
      await apiRequestJson("POST", `/v1/images/${encodeURIComponent(img.id)}/set-default`, apiKey)
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const deleteImage = async (img: GuestImage) => {
    setError(null)
    try {
      await apiRequestJson("DELETE", `/v1/images/${encodeURIComponent(img.id)}`, apiKey)
      setDeleteTarget(null)
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  return (
    <div className="p-6 space-y-6">
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete image</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Delete <span className="font-mono text-foreground">{deleteTarget?.name}</span>? This removes metadata and
              deletes its files from the images directory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary bg-transparent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteImage(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Images</h2>
          <p className="text-muted-foreground text-sm mt-1">Upload kernels and rootfs disks, and choose the default image</p>
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
                New image
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">Create image</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Create the metadata record, then upload kernel and rootfs.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="img-name" className="text-foreground">
                    Name
                  </Label>
                  <Input
                    id="img-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="bg-input border-border text-foreground"
                    placeholder="e.g. Debian minimal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="img-desc" className="text-foreground">
                    Description
                  </Label>
                  <Input
                    id="img-desc"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="bg-input border-border text-foreground"
                    placeholder="What this image is for"
                  />
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
                <Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!apiKey && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">API key required</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Set an API key on the Dashboard page first (stored locally in your browser).
            </p>
          </CardContent>
        </Card>
      )}

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

      <div className="grid gap-3">
        {items.map((img) => (
          <Card key={img.id} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-foreground flex items-center gap-2">
                  <span>{img.name}</span>
                  {img.isDefault && <Badge variant="outline">Default</Badge>}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{img.description}</p>
                <p className="text-xs text-muted-foreground font-mono mt-2">
                  {img.id} • rootfs {formatBytes(img.baseRootfsBytes)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="border-border text-foreground hover:bg-secondary bg-transparent"
                  disabled={!apiKey || img.id === defaultId}
                  onClick={() => setDefault(img)}
                  title="Set as default"
                >
                  <Star className="w-4 h-4 mr-2" />
                  Default
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={!apiKey}
                  onClick={() => setDeleteTarget(img)}
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground">Kernel (vmlinux)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="*/*"
                    disabled={!apiKey}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadFile(img, "kernel", f)
                      e.currentTarget.value = ""
                    }}
                    className="bg-input border-border text-foreground"
                  />
                  <Badge variant="outline" className={img.hasKernel ? "text-success" : "text-muted-foreground"}>
                    {img.hasKernel ? "Uploaded" : "Missing"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Rootfs (rootfs.ext4)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="*/*"
                    disabled={!apiKey}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadFile(img, "rootfs", f)
                      e.currentTarget.value = ""
                    }}
                    className="bg-input border-border text-foreground"
                  />
                  <Badge variant="outline" className={img.hasRootfs ? "text-success" : "text-muted-foreground"}>
                    {img.hasRootfs ? "Uploaded" : "Missing"}
                  </Badge>
                </div>
              </div>
              {loading && (
                <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
                  <Upload className="w-4 h-4" />
                  Loading…
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {!loading && items.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">No images yet. Create one and upload kernel/rootfs.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

