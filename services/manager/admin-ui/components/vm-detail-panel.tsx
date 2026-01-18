"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { apiRequestJson } from "@/lib/api"
import {
  X,
  Terminal,
  FileText,
  Camera,
  Upload,
  Download,
  Cpu,
  MemoryStick,
  Wifi,
  WifiOff,
  Clock,
  Send,
} from "lucide-react"

interface VM {
  id: string
  status: "running" | "stopped" | "creating"
  cpu: number
  memMb: number
  allowInternet: boolean
  createdAt: string
  snapshotId?: string
}

interface VMDetailPanelProps {
  vm: VM
  onClose: () => void
}

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines
}

function formatExecResult(result: ExecResult): string[] {
  const lines: string[] = []
  if (result.stdout) {
    lines.push(...splitLines(result.stdout))
  }
  if (result.stderr) {
    lines.push(...splitLines(result.stderr).map((line) => `[stderr] ${line}`))
  }
  if (!result.stdout && !result.stderr) {
    lines.push("(no output)")
  }
  lines.push(`[exit ${result.exitCode}]`)
  return lines
}

const mockLogs = `[2024-01-15 10:30:15] VM boot started
[2024-01-15 10:30:16] Loading kernel...
[2024-01-15 10:30:17] Kernel loaded successfully
[2024-01-15 10:30:18] Mounting root filesystem...
[2024-01-15 10:30:19] Starting init process...
[2024-01-15 10:30:20] Network configuration applied
[2024-01-15 10:30:21] VM ready for connections
[2024-01-15 10:35:42] User session started
[2024-01-15 10:35:45] Python 3.11 interpreter initialized
[2024-01-15 10:36:01] Running LLM inference task...
[2024-01-15 10:36:15] Task completed successfully`

export function VMDetailPanel({ vm, onClose }: VMDetailPanelProps) {
  const [command, setCommand] = useState("")
  const [commandOutput, setCommandOutput] = useState<string[]>([])
  const [uploadPath, setUploadPath] = useState("/home/user/")
  const [downloadPath, setDownloadPath] = useState("")
  const [isExecuting, setIsExecuting] = useState(false)

  const handleExecuteCommand = async () => {
    const trimmed = command.trim()
    if (!trimmed || isExecuting) return

    setCommand("")
    setIsExecuting(true)
    setCommandOutput((prev) => [...prev, `$ ${trimmed}`])

    try {
      const result = await apiRequestJson<ExecResult>("POST", `/v1/vms/${encodeURIComponent(vm.id)}/exec`, {
        cmd: trimmed,
      })
      setCommandOutput((prev) => [...prev, ...formatExecResult(result), ""])
    } catch (err: any) {
      const message = String(err?.message ?? err)
      setCommandOutput((prev) => [...prev, `Error: ${message}`, ""])
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div className="w-96 bg-card border-l border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-mono text-sm font-medium text-foreground">{vm.id}</h3>
          <Badge
            variant="outline"
            className={`mt-1 ${
              vm.status === "running"
                ? "border-success/50 text-success"
                : vm.status === "stopped"
                  ? "border-muted-foreground/50 text-muted-foreground"
                  : "border-warning/50 text-warning"
            }`}
          >
            {vm.status}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-4 border-b border-border space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Cpu className="w-4 h-4" />
            <span>{vm.cpu} vCPU</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MemoryStick className="w-4 h-4" />
            <span>{vm.memMb} MB</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {vm.allowInternet ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span>{vm.allowInternet ? "Internet" : "Isolated"}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{new Date(vm.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        {vm.snapshotId && (
          <div className="text-xs text-muted-foreground">
            <span className="text-foreground">Snapshot:</span> {vm.snapshotId}
          </div>
        )}
      </div>

      <Tabs defaultValue="terminal" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-secondary">
          <TabsTrigger
            value="terminal"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Terminal className="w-3 h-3 mr-1" />
            Exec
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <FileText className="w-3 h-3 mr-1" />
            Logs
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Upload className="w-3 h-3 mr-1" />
            Files
          </TabsTrigger>
        </TabsList>

        <TabsContent value="terminal" className="flex-1 flex flex-col p-4 pt-2">
          <ScrollArea className="flex-1 bg-background rounded-md p-3 font-mono text-xs mb-3">
            <div className="space-y-1">
              {commandOutput.length === 0 ? (
                <span className="text-muted-foreground">Execute commands in this VM...</span>
              ) : (
                commandOutput.map((line, i) => (
                  <div key={i} className={line.startsWith("$") ? "text-primary" : "text-foreground"}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
          <div className="flex gap-2">
            <Input
              placeholder="Enter command..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExecuteCommand()}
              className="font-mono text-sm bg-input border-border text-foreground placeholder:text-muted-foreground"
            />
            <Button
              size="icon"
              onClick={handleExecuteCommand}
              disabled={isExecuting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="flex-1 p-4 pt-2">
          <ScrollArea className="h-full bg-background rounded-md p-3 font-mono text-xs">
            <pre className="text-muted-foreground whitespace-pre-wrap">{mockLogs}</pre>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="files" className="flex-1 p-4 pt-2 space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground text-sm">Upload File</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Destination path"
                value={uploadPath}
                onChange={(e) => setUploadPath(e.target.value)}
                className="font-mono text-sm bg-input border-border text-foreground placeholder:text-muted-foreground"
              />
              <Button size="icon" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Upload className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-foreground text-sm">Download File</Label>
            <div className="flex gap-2">
              <Input
                placeholder="File path to download"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                className="font-mono text-sm bg-input border-border text-foreground placeholder:text-muted-foreground"
              />
              <Button size="icon" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Button variant="outline" className="w-full border-border text-foreground hover:bg-secondary bg-transparent">
            <Camera className="w-4 h-4 mr-2" />
            Create Snapshot
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  )
}
