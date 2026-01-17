"use client"

import type React from "react"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
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
import { VMDetailPanel } from "./vm-detail-panel"

import {
  Plus,
  MoreVertical,
  Trash2,
  Terminal,
  FileText,
  Camera,
  Upload,
  Download,
  Search,
  RefreshCw,
  Cpu,
  MemoryStick,
  Wifi,
  WifiOff,
  Play,
  Square,
} from "lucide-react"
import { apiGetJson, apiRequestJson, getStoredApiKey } from "@/lib/api"

interface VM {
  id: string
  status: "running" | "stopped" | "creating"
  cpu: number
  memMb: number
  allowInternet: boolean
  createdAt: string
  snapshotId?: string
}

interface ApiVm {
  id: string
  state: string
  cpu: number
  memMb: number
  outboundInternet: boolean
  createdAt: string
}

export function VMsPanel() {
  const [vms, setVMs] = useState<VM[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedVM, setSelectedVM] = useState<VM | null>(null)
  const [newVM, setNewVM] = useState({ cpu: 2, memMb: 2048, allowInternet: false, snapshotId: "" })
  const [vmToDelete, setVmToDelete] = useState<VM | null>(null)

  const apiKey = getStoredApiKey()

  const filteredVMs = useMemo(
    () => vms.filter((vm) => vm.id.toLowerCase().includes(searchQuery.toLowerCase())),
    [vms, searchQuery],
  )

  const toVm = (vm: ApiVm): VM => {
    const state = vm.state.toUpperCase()
    const status: VM["status"] =
      state === "RUNNING" ? "running" : state === "STOPPED" ? "stopped" : "creating"
    return {
      id: vm.id,
      status,
      cpu: vm.cpu,
      memMb: vm.memMb,
      allowInternet: Boolean(vm.outboundInternet),
      createdAt: vm.createdAt,
    }
  }

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<ApiVm[]>("/v1/vms", apiKey)
      setVMs(data.map(toVm))
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [apiKey])

  const handleCreateVM = async () => {
    const allowIps = newVM.allowInternet ? ["0.0.0.0/0"] : []
    const payload: any = {
      cpu: newVM.cpu,
      memMb: newVM.memMb,
      allowIps,
      outboundInternet: newVM.allowInternet,
    }
    if (newVM.snapshotId) payload.snapshotId = newVM.snapshotId
    await apiRequestJson("POST", "/v1/vms", apiKey, payload)
    setCreateDialogOpen(false)
    setNewVM({ cpu: 2, memMb: 2048, allowInternet: false, snapshotId: "" })
    await refresh()
  }

  const handleDeleteVM = async (id: string) => {
    await apiRequestJson("DELETE", `/v1/vms/${id}`, apiKey)
    if (selectedVM?.id === id) setSelectedVM(null)
    setVmToDelete(null)
    await refresh()
  }

  const handleToggleVM = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const vm = vms.find((v) => v.id === id)
    if (!vm) return
    if (vm.status === "running") {
      await apiRequestJson("POST", `/v1/vms/${id}/stop`, apiKey)
    } else {
      await apiRequestJson("POST", `/v1/vms/${id}/start`, apiKey)
    }
    await refresh()
  }

  const getStatusColor = (status: VM["status"]) => {
    switch (status) {
      case "running":
        return "bg-success"
      case "stopped":
        return "bg-muted-foreground"
      case "creating":
        return "bg-warning animate-pulse"
    }
  }

  const getStatusBadge = (status: VM["status"]) => {
    switch (status) {
      case "running":
        return (
          <Badge variant="outline" className="border-success/50 text-success">
            Running
          </Badge>
        )
      case "stopped":
        return (
          <Badge variant="outline" className="border-muted-foreground/50 text-muted-foreground">
            Stopped
          </Badge>
        )
      case "creating":
        return (
          <Badge variant="outline" className="border-warning/50 text-warning">
            Creating
          </Badge>
        )
    }
  }

  return (
    <div className="flex h-full">
      <AlertDialog open={!!vmToDelete} onOpenChange={(open) => !open && setVmToDelete(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Virtual Machine</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete <span className="font-mono text-foreground">{vmToDelete?.id}</span>? This
              action cannot be undone and all data associated with this VM will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary bg-transparent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => vmToDelete && handleDeleteVM(vmToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete VM
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className={`flex-1 p-6 space-y-6 ${selectedVM ? "border-r border-border" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Virtual Machines</h2>
            <p className="text-muted-foreground text-sm mt-1">Manage your Firecracker microVMs</p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Create VM
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">Create Virtual Machine</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Configure and boot a new Firecracker microVM
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cpu" className="text-foreground">
                      vCPUs
                    </Label>
                    <Input
                      id="cpu"
                      type="number"
                      min={1}
                      max={16}
                      value={newVM.cpu}
                      onChange={(e) => setNewVM({ ...newVM, cpu: Number.parseInt(e.target.value) || 1 })}
                      className="bg-input border-border text-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mem" className="text-foreground">
                      Memory (MB)
                    </Label>
                    <Input
                      id="mem"
                      type="number"
                      min={512}
                      step={512}
                      value={newVM.memMb}
                      onChange={(e) => setNewVM({ ...newVM, memMb: Number.parseInt(e.target.value) || 512 })}
                      className="bg-input border-border text-foreground"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="snapshot" className="text-foreground">
                    Snapshot ID (optional)
                  </Label>
                  <Input
                    id="snapshot"
                    placeholder="snap-xxxxx"
                    value={newVM.snapshotId}
                    onChange={(e) => setNewVM({ ...newVM, snapshotId: e.target.value })}
                    className="bg-input border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="internet" className="text-foreground">
                    Allow Internet Access
                  </Label>
                  <Switch
                    id="internet"
                    checked={newVM.allowInternet}
                    onCheckedChange={(checked) => setNewVM({ ...newVM, allowInternet: checked })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                  className="border-border text-foreground hover:bg-secondary"
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateVM} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Create VM
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search VMs..."
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
      {loading && <p className="text-sm text-muted-foreground">Loading VMs…</p>}

        <div className="grid gap-3">
          {filteredVMs.map((vm) => (
            <Card
              key={vm.id}
              className={`bg-card border-border cursor-pointer transition-colors hover:border-primary/50 ${selectedVM?.id === vm.id ? "border-primary" : ""}`}
              onClick={() => setSelectedVM(vm)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(vm.status)}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-foreground">{vm.id}</span>
                        {getStatusBadge(vm.status)}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Cpu className="w-3 h-3" />
                          {vm.cpu} vCPU
                        </span>
                        <span className="flex items-center gap-1">
                          <MemoryStick className="w-3 h-3" />
                          {vm.memMb} MB
                        </span>
                        <span className="flex items-center gap-1">
                          {vm.allowInternet ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                          {vm.allowInternet ? "Internet" : "Isolated"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {vm.status !== "creating" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`${
                          vm.status === "running"
                            ? "text-warning hover:text-warning hover:bg-warning/10"
                            : "text-success hover:text-success hover:bg-success/10"
                        }`}
                        onClick={(e) => handleToggleVM(vm.id, e)}
                        title={vm.status === "running" ? "Stop VM" : "Start VM"}
                      >
                        {vm.status === "running" ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation()
                        setVmToDelete(vm)
                      }}
                      title="Delete VM"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
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
                          <Terminal className="w-4 h-4 mr-2" />
                          Execute Command
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-popover-foreground hover:bg-secondary cursor-pointer">
                          <FileText className="w-4 h-4 mr-2" />
                          View Logs
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-popover-foreground hover:bg-secondary cursor-pointer">
                          <Camera className="w-4 h-4 mr-2" />
                          Create Snapshot
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem className="text-popover-foreground hover:bg-secondary cursor-pointer">
                          <Upload className="w-4 h-4 mr-2" />
                          Upload File
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-popover-foreground hover:bg-secondary cursor-pointer">
                          <Download className="w-4 h-4 mr-2" />
                          Download File
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {selectedVM && <VMDetailPanel vm={selectedVM} onClose={() => setSelectedVM(null)} />}
    </div>
  )
}
