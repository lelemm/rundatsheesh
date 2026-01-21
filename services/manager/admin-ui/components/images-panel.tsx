"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { apiGetJson, apiRequestJson, apiUploadBinaryWithProgress } from "@/lib/api"
import { Plus, RefreshCw, Star, Trash2, Upload, Loader2 } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { CopyId } from "@/components/ui/copy-id"

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

type UploadProgress = { loaded: number; total: number | null; pct: number | null }

function formatProgress(p: UploadProgress | null): string {
  if (!p) return ""
  const pct = Math.round(p.pct ?? 0)
  if (!p.total) return `${formatBytes(p.loaded)} • ${pct}%`
  return `${formatBytes(p.loaded)} / ${formatBytes(p.total)} • ${pct}%`
}

function FilePickButton(props: {
  disabled?: boolean
  buttonText: string
  accept?: string
  onFile: (file: File) => void
  selectedName?: string | null
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept={props.accept ?? "*/*"}
        className="hidden"
        disabled={props.disabled}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) props.onFile(f)
          e.currentTarget.value = ""
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="border-border text-foreground hover:bg-secondary bg-transparent"
        disabled={props.disabled}
        onClick={() => ref.current?.click()}
      >
        <Upload className="w-4 h-4 mr-2" />
        {props.buttonText}
      </Button>
      <span className="text-xs text-muted-foreground truncate">{props.selectedName ?? ""}</span>
    </div>
  )
}

export function ImagesPanel(props: { onUploadBusyChange?: (busy: boolean) => void }) {
  const [items, setItems] = useState<GuestImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newKernelFile, setNewKernelFile] = useState<File | null>(null)
  const [newRootfsFile, setNewRootfsFile] = useState<File | null>(null)
  const [createKernelProgress, setCreateKernelProgress] = useState<UploadProgress | null>(null)
  const [createRootfsProgress, setCreateRootfsProgress] = useState<UploadProgress | null>(null)
  const [uploadPctByKey, setUploadPctByKey] = useState<Record<string, number | null>>({})
  const [deleteTarget, setDeleteTarget] = useState<GuestImage | null>(null)

  const isUploading = useMemo(() => {
    if (isCreating) return true
    if (createKernelProgress !== null) return true
    if (createRootfsProgress !== null) return true
    return Object.values(uploadPctByKey).some((v) => v !== null && v !== undefined)
  }, [createKernelProgress, createRootfsProgress, isCreating, uploadPctByKey])

  // Notify parent shell so it can block navigation during uploads.
  // (Also ensures the flag is reset on unmount.)
  useEffect(() => {
    props.onUploadBusyChange?.(isUploading)
    return () => props.onUploadBusyChange?.(false)
  }, [isUploading, props.onUploadBusyChange])

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<GuestImage[]>("/v1/images")
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
    if (isCreating) return
    const name = newName.trim()
    const description = newDescription.trim()
    if (!name || !description) return
    setCreateError(null)
    setIsCreating(true)
    try {
      const created = await apiRequestJson<GuestImage>("POST", "/v1/images", { name, description })
      if (newKernelFile) {
        setCreateKernelProgress({ loaded: 0, total: newKernelFile.size ?? null, pct: 0 })
        await apiUploadBinaryWithProgress({
          method: "PUT",
          path: `/v1/images/${encodeURIComponent(created.id)}/kernel`,
          data: newKernelFile,
          contentType: "application/octet-stream",
          onProgress: (p) => setCreateKernelProgress(p),
        })
      }
      if (newRootfsFile) {
        setCreateRootfsProgress({ loaded: 0, total: newRootfsFile.size ?? null, pct: 0 })
        await apiUploadBinaryWithProgress({
          method: "PUT",
          path: `/v1/images/${encodeURIComponent(created.id)}/rootfs`,
          data: newRootfsFile,
          contentType: "application/octet-stream",
          onProgress: (p) => setCreateRootfsProgress(p),
        })
      }
      toast({ title: "Image created" })
      setCreateOpen(false)
      setNewName("")
      setNewDescription("")
      setNewKernelFile(null)
      setNewRootfsFile(null)
      setCreateKernelProgress(null)
      setCreateRootfsProgress(null)
      await refresh()
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setCreateError(msg)
      toast({ title: "Failed to create image", description: msg })
      setCreateKernelProgress(null)
      setCreateRootfsProgress(null)
    } finally {
      setIsCreating(false)
    }
  }

  const uploadFile = async (img: GuestImage, kind: "kernel" | "rootfs", file: File) => {
    setError(null)
    try {
      const key = `${img.id}:${kind}`
      setUploadPctByKey((m) => ({ ...m, [key]: 0 }))
      await apiUploadBinaryWithProgress({
        method: "PUT",
        path: `/v1/images/${encodeURIComponent(img.id)}/${kind}`,
        data: file,
        contentType: "application/octet-stream",
        onProgress: (p) => setUploadPctByKey((m) => ({ ...m, [key]: p.pct })),
      })
      setUploadPctByKey((m) => ({ ...m, [key]: null }))
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const setDefault = async (img: GuestImage) => {
    setError(null)
    try {
      await apiRequestJson("POST", `/v1/images/${encodeURIComponent(img.id)}/set-default`)
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const deleteImage = async (img: GuestImage) => {
    setError(null)
    try {
      await apiRequestJson("DELETE", `/v1/images/${encodeURIComponent(img.id)}`)
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
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              if (isCreating) return
              setCreateOpen(open)
              if (open) setCreateError(null)
            }}
          >
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                New image
              </Button>
            </DialogTrigger>
            <DialogContent
              className="bg-card border-border"
              onEscapeKeyDown={(e) => {
                if (!isCreating) return
                e.preventDefault()
              }}
              onInteractOutside={(e) => {
                if (!isCreating) return
                e.preventDefault()
              }}
            >
              <DialogHeader>
                <DialogTitle className="text-foreground">Create image</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Create the metadata record. You can optionally upload kernel and rootfs right away.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {createError && <p className="text-sm text-destructive break-words">{createError}</p>}
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
                    disabled={isCreating}
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
                    disabled={isCreating}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Kernel (vmlinux)</Label>
                  <FilePickButton
                    disabled={isCreating}
                    buttonText="Choose kernel file"
                    onFile={setNewKernelFile}
                    selectedName={newKernelFile?.name ?? null}
                  />
                  {createKernelProgress !== null && (
                    <div className="w-full">
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${createKernelProgress.pct ?? 0}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Uploading kernel… {formatProgress(createKernelProgress)}</div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Rootfs (rootfs.ext4)</Label>
                  <FilePickButton
                    disabled={isCreating}
                    buttonText="Choose rootfs file"
                    onFile={setNewRootfsFile}
                    selectedName={newRootfsFile?.name ?? null}
                  />
                  {createRootfsProgress !== null && (
                    <div className="w-full">
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${createRootfsProgress.pct ?? 0}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Uploading rootfs… {formatProgress(createRootfsProgress)}</div>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  className="border-border text-foreground hover:bg-secondary"
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={isCreating || !newName.trim() || !newDescription.trim()}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>Create{newKernelFile || newRootfsFile ? " & upload" : ""}</>
                  )}
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                  <CopyId value={img.id} className="text-xs" />
                  <span>• rootfs {formatBytes(img.baseRootfsBytes)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="border-border text-foreground hover:bg-secondary bg-transparent"
                  disabled={img.id === defaultId}
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
                  disabled={false}
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
                <div className="flex items-center gap-2 justify-between">
                  <FilePickButton
                    disabled={uploadPctByKey[`${img.id}:kernel`] !== undefined && uploadPctByKey[`${img.id}:kernel`] !== null}
                    buttonText={img.hasKernel ? "Replace kernel" : "Upload kernel"}
                    onFile={(f) => uploadFile(img, "kernel", f)}
                  />
                  <Badge variant="outline" className={img.hasKernel ? "text-success" : "text-muted-foreground"}>
                    {img.hasKernel ? "Uploaded" : "Missing"}
                  </Badge>
                </div>
                {uploadPctByKey[`${img.id}:kernel`] !== undefined && uploadPctByKey[`${img.id}:kernel`] !== null && (
                  <div className="w-full">
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${uploadPctByKey[`${img.id}:kernel`] ?? 0}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Uploading… {Math.round(uploadPctByKey[`${img.id}:kernel`] ?? 0)}%
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Rootfs (rootfs.ext4)</Label>
                <div className="flex items-center gap-2 justify-between">
                  <FilePickButton
                    disabled={uploadPctByKey[`${img.id}:rootfs`] !== undefined && uploadPctByKey[`${img.id}:rootfs`] !== null}
                    buttonText={img.hasRootfs ? "Replace rootfs" : "Upload rootfs"}
                    onFile={(f) => uploadFile(img, "rootfs", f)}
                  />
                  <Badge variant="outline" className={img.hasRootfs ? "text-success" : "text-muted-foreground"}>
                    {img.hasRootfs ? "Uploaded" : "Missing"}
                  </Badge>
                </div>
                {uploadPctByKey[`${img.id}:rootfs`] !== undefined && uploadPctByKey[`${img.id}:rootfs`] !== null && (
                  <div className="w-full">
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${uploadPctByKey[`${img.id}:rootfs`] ?? 0}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Uploading… {Math.round(uploadPctByKey[`${img.id}:rootfs`] ?? 0)}%
                    </div>
                  </div>
                )}
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

