"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
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
import {
  Plus,
  Search,
  RefreshCw,
  MoreVertical,
  Trash2,
  Play,
  Zap,
  Layers,
  CheckCircle,
  Clock,
  FileCode,
} from "lucide-react"

interface Template {
  id: string
  name: string
  description: string
  status: "ready" | "preparing" | "unprepared"
  baseImage: string
  prepareScript?: string
  createdAt: string
}

const mockTemplates: Template[] = [
  {
    id: "tpl-python-311",
    name: "Python 3.11",
    description: "Python 3.11 with common ML libraries",
    status: "ready",
    baseImage: "ubuntu-22.04",
    prepareScript: "pip install numpy pandas torch transformers",
    createdAt: "2024-01-10T10:00:00Z",
  },
  {
    id: "tpl-node-20",
    name: "Node.js 20",
    description: "Node.js 20 LTS with TypeScript",
    status: "ready",
    baseImage: "ubuntu-22.04",
    prepareScript: "npm install -g typescript ts-node",
    createdAt: "2024-01-09T14:00:00Z",
  },
  {
    id: "tpl-cuda-12",
    name: "CUDA 12",
    description: "CUDA 12.0 development environment",
    status: "preparing",
    baseImage: "ubuntu-22.04-cuda",
    prepareScript: "nvidia-smi",
    createdAt: "2024-01-11T08:00:00Z",
  },
  {
    id: "tpl-minimal",
    name: "Minimal",
    description: "Minimal Alpine-based image",
    status: "ready",
    baseImage: "alpine-3.18",
    createdAt: "2024-01-08T12:00:00Z",
  },
  {
    id: "tpl-rust-nightly",
    name: "Rust Nightly",
    description: "Rust nightly with cargo",
    status: "unprepared",
    baseImage: "ubuntu-22.04",
    prepareScript: "rustup default nightly",
    createdAt: "2024-01-12T16:00:00Z",
  },
]

export function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>(mockTemplates)
  const [searchQuery, setSearchQuery] = useState("")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null)
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    description: "",
    baseImage: "ubuntu-22.04",
    prepareScript: "",
  })

  const filteredTemplates = templates.filter(
    (tpl) =>
      tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleCreate = () => {
    const template: Template = {
      id: `tpl-${newTemplate.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: newTemplate.name,
      description: newTemplate.description,
      status: "unprepared",
      baseImage: newTemplate.baseImage,
      prepareScript: newTemplate.prepareScript || undefined,
      createdAt: new Date().toISOString(),
    }
    setTemplates([template, ...templates])
    setCreateDialogOpen(false)
    setNewTemplate({ name: "", description: "", baseImage: "ubuntu-22.04", prepareScript: "" })
  }

  const handleDelete = (id: string) => {
    setTemplates(templates.filter((t) => t.id !== id))
    setTemplateToDelete(null)
  }

  const handlePrepare = (id: string) => {
    setTemplates(templates.map((t) => (t.id === id ? { ...t, status: "preparing" as const } : t)))
  }

  const getStatusBadge = (status: Template["status"]) => {
    switch (status) {
      case "ready":
        return (
          <Badge variant="outline" className="border-success/50 text-success">
            <CheckCircle className="w-3 h-3 mr-1" />
            Ready
          </Badge>
        )
      case "preparing":
        return (
          <Badge variant="outline" className="border-warning/50 text-warning">
            <Clock className="w-3 h-3 mr-1 animate-spin" />
            Preparing
          </Badge>
        )
      case "unprepared":
        return (
          <Badge variant="outline" className="border-muted-foreground/50 text-muted-foreground">
            Unprepared
          </Badge>
        )
    }
  }

  return (
    <div className="p-6 space-y-6">
      <AlertDialog open={!!templateToDelete} onOpenChange={(open) => !open && setTemplateToDelete(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Template</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete template{" "}
              <span className="font-mono text-foreground">{templateToDelete?.name}</span>? Any VMs using this template
              will not be affected, but you won&apos;t be able to create new VMs from it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary bg-transparent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => templateToDelete && handleDelete(templateToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Templates</h2>
          <p className="text-muted-foreground text-sm mt-1">Pre-configured VM templates for quick deployment</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              Create Template
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">Create Template</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Define a new VM template with optional prepare scripts
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-foreground">
                  Name
                </Label>
                <Input
                  id="name"
                  placeholder="e.g., Python 3.12"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  className="bg-input border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-foreground">
                  Description
                </Label>
                <Input
                  id="description"
                  placeholder="Brief description of the template"
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  className="bg-input border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="baseImage" className="text-foreground">
                  Base Image
                </Label>
                <Input
                  id="baseImage"
                  placeholder="e.g., ubuntu-22.04"
                  value={newTemplate.baseImage}
                  onChange={(e) => setNewTemplate({ ...newTemplate, baseImage: e.target.value })}
                  className="bg-input border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prepareScript" className="text-foreground">
                  Prepare Script (optional)
                </Label>
                <Textarea
                  id="prepareScript"
                  placeholder="Commands to run during preparation..."
                  value={newTemplate.prepareScript}
                  onChange={(e) => setNewTemplate({ ...newTemplate, prepareScript: e.target.value })}
                  className="bg-input border-border text-foreground placeholder:text-muted-foreground font-mono text-sm min-h-[100px]"
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
              <Button
                onClick={handleCreate}
                disabled={!newTemplate.name}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Create Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template) => (
          <Card key={template.id} className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Layers className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-foreground text-base">{template.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">{template.id}</p>
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
                      Create VM from Template
                    </DropdownMenuItem>
                    {template.status === "unprepared" && (
                      <DropdownMenuItem
                        className="text-popover-foreground hover:bg-secondary cursor-pointer"
                        onClick={() => handlePrepare(template.id)}
                      >
                        <Zap className="w-4 h-4 mr-2" />
                        Prepare (Pre-warm)
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      className="text-destructive hover:bg-destructive/10 cursor-pointer"
                      onClick={() => setTemplateToDelete(template)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{template.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Base: <span className="font-mono text-foreground">{template.baseImage}</span>
                </span>
                {getStatusBadge(template.status)}
              </div>
              {template.prepareScript && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileCode className="w-3 h-3" />
                  Has prepare script
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
