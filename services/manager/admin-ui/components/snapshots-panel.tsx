"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
import { Search, RefreshCw, MoreVertical, Trash2, Play, Camera, Server, Layers, HardDrive } from "lucide-react"

interface Snapshot {
  id: string
  type: "vm" | "template"
  sourceId: string
  createdAt: string
  size: string
}

const mockSnapshots: Snapshot[] = [
  { id: "snap-llm-base", type: "vm", sourceId: "vm-a8f3c2d1", createdAt: "2024-01-15T08:00:00Z", size: "2.4 GB" },
  {
    id: "snap-python311",
    type: "template",
    sourceId: "tpl-python-311",
    createdAt: "2024-01-14T12:00:00Z",
    size: "1.8 GB",
  },
  { id: "snap-node20", type: "template", sourceId: "tpl-node-20", createdAt: "2024-01-14T10:00:00Z", size: "1.5 GB" },
  { id: "snap-cuda-dev", type: "vm", sourceId: "vm-cuda-test", createdAt: "2024-01-13T16:00:00Z", size: "4.2 GB" },
  { id: "snap-minimal", type: "template", sourceId: "tpl-minimal", createdAt: "2024-01-12T09:00:00Z", size: "512 MB" },
]

export function SnapshotsPanel() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(mockSnapshots)
  const [searchQuery, setSearchQuery] = useState("")
  const [snapshotToDelete, setSnapshotToDelete] = useState<Snapshot | null>(null)

  const filteredSnapshots = snapshots.filter(
    (snap) =>
      snap.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      snap.sourceId.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const vmSnapshots = filteredSnapshots.filter((s) => s.type === "vm")
  const templateSnapshots = filteredSnapshots.filter((s) => s.type === "template")

  const handleDelete = (id: string) => {
    setSnapshots(snapshots.filter((s) => s.id !== id))
    setSnapshotToDelete(null)
  }

  return (
    <div className="p-6 space-y-6">
      <AlertDialog open={!!snapshotToDelete} onOpenChange={(open) => !open && setSnapshotToDelete(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Snapshot</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete snapshot{" "}
              <span className="font-mono text-foreground">{snapshotToDelete?.id}</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary bg-transparent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => snapshotToDelete && handleDelete(snapshotToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

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
                      <span className="font-mono text-sm text-foreground">{snapshot.id}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>Source: {snapshot.sourceId}</span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {snapshot.size}
                      </span>
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
                      <DropdownMenuItem
                        className="text-destructive hover:bg-destructive/10 cursor-pointer"
                        onClick={() => setSnapshotToDelete(snapshot)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
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
                      <span className="font-mono text-sm text-foreground">{snapshot.id}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>Source: {snapshot.sourceId}</span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {snapshot.size}
                      </span>
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
                      <DropdownMenuItem
                        className="text-destructive hover:bg-destructive/10 cursor-pointer"
                        onClick={() => setSnapshotToDelete(snapshot)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
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
