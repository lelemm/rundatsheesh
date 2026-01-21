"use client"

import type React from "react"
import { useEffect, useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { apiGetJson, apiRequestJson } from "@/lib/api"
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
  Loader2,
  Maximize2,
  Minimize2,
  GripVertical,
  Play,
  Code,
  AlertCircle,
  CheckCircle2,
  Server,
} from "lucide-react"
import { CopyId } from "@/components/ui/copy-id"

interface VM {
  id: string
  status: "running" | "stopped" | "creating" | "starting" | "stopping" | "error"
  cpu: number
  memMb: number
  allowInternet: boolean
  createdAt: string
  snapshotId?: string
}

interface VMDetailPanelProps {
  vm: VM
  onClose: () => void
  onCreateSnapshot: (event: React.MouseEvent) => void
  isSnapshotting: boolean
  latestSnapshotId?: string
  canSnapshot: boolean
}

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  result?: unknown
  error?: unknown
}

interface LogsResponse {
  type: string
  lines: string[]
  truncated: boolean
  updatedAt?: string
}

interface TsExecution {
  id: string
  timestamp: Date
  code: string
  result: ExecResult
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

export function VMDetailPanel({
  vm,
  onClose,
  onCreateSnapshot,
  isSnapshotting,
  latestSnapshotId,
  canSnapshot,
}: VMDetailPanelProps) {
  const [command, setCommand] = useState("")
  const [commandOutput, setCommandOutput] = useState<string[]>([])
  const [uploadPath, setUploadPath] = useState("/workspace/")
  const [downloadPath, setDownloadPath] = useState("")
  const [isExecuting, setIsExecuting] = useState(false)
  const [activeTab, setActiveTab] = useState("terminal")
  const [logLines, setLogLines] = useState<string[]>([])
  const [logError, setLogError] = useState<string | null>(null)
  const [logsTruncated, setLogsTruncated] = useState(false)
  const [logsUpdatedAt, setLogsUpdatedAt] = useState<string | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  
  // Panel sizing
  const [isMaximized, setIsMaximized] = useState(false)
  const [panelWidth, setPanelWidth] = useState(420)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  
  // TS Execution
  const [tsCode, setTsCode] = useState("")
  const [tsExecutions, setTsExecutions] = useState<TsExecution[]>([])
  const [isRunningTs, setIsRunningTs] = useState(false)
  const [selectedTsExecution, setSelectedTsExecution] = useState<TsExecution | null>(null)
  
  // Log type tabs
  const [logType, setLogType] = useState<"system" | "exec" | "ts">("system")

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

  const handleRunTs = async () => {
    const trimmed = tsCode.trim()
    if (!trimmed || isRunningTs) return

    setIsRunningTs(true)
    const executionId = `ts-${Date.now()}`

    try {
      const result = await apiRequestJson<ExecResult>("POST", `/v1/vms/${encodeURIComponent(vm.id)}/run-ts`, {
        code: trimmed,
      })
      const execution: TsExecution = {
        id: executionId,
        timestamp: new Date(),
        code: trimmed,
        result,
      }
      setTsExecutions((prev) => [execution, ...prev])
      setSelectedTsExecution(execution)
    } catch (err: any) {
      const message = String(err?.message ?? err)
      const execution: TsExecution = {
        id: executionId,
        timestamp: new Date(),
        code: trimmed,
        result: { exitCode: -1, stdout: "", stderr: message },
      }
      setTsExecutions((prev) => [execution, ...prev])
      setSelectedTsExecution(execution)
    } finally {
      setIsRunningTs(false)
    }
  }

  useEffect(() => {
    if (activeTab !== "logs") return
    let cancelled = false
    const loadLogs = async () => {
      setLogsLoading(true)
      setLogError(null)
      try {
        const data = await apiGetJson<LogsResponse>(`/v1/vms/${encodeURIComponent(vm.id)}/logs`)
        if (cancelled) return
        setLogLines(data.lines ?? [])
        setLogsTruncated(Boolean(data.truncated))
        setLogsUpdatedAt(data.updatedAt ?? null)
      } catch (err: any) {
        if (cancelled) return
        setLogError(String(err?.message ?? err))
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    }
    loadLogs()
    const timer = setInterval(loadLogs, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeTab, vm.id])

  // Resize handling
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      setPanelWidth(Math.max(320, Math.min(newWidth, window.innerWidth - 200)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing])

  const panelStyle = isMaximized
    ? { width: "100%", maxWidth: "100%" }
    : { width: `${panelWidth}px`, minWidth: "320px", maxWidth: "80vw" }

  return (
    <div
      ref={panelRef}
      className={`bg-card border-l border-border flex flex-col h-full overflow-hidden ${isMaximized ? "fixed inset-0 z-50" : "relative"}`}
      style={panelStyle}
    >
      {/* Resize handle */}
      {!isMaximized && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/50 transition-colors group flex items-center"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute left-0 w-4 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2">
            <GripVertical className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <CopyId value={vm.id} className="font-medium text-foreground" />
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
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMaximized(!isMaximized)}
            className="text-muted-foreground hover:text-foreground"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* VM Info */}
      <div className="p-4 border-b border-border space-y-3 shrink-0">
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
        {(vm.snapshotId || latestSnapshotId || isSnapshotting) && (
          <div className="text-xs text-muted-foreground space-y-1">
            {vm.snapshotId && (
              <div className="flex items-center gap-1">
                <span className="text-foreground">Snapshot:</span>
                <CopyId value={vm.snapshotId} className="text-xs" />
              </div>
            )}
            {latestSnapshotId && (
              <div className="flex items-center gap-1">
                <span className="text-foreground">Last snapshot:</span>
                <CopyId value={latestSnapshotId} className="text-xs" />
              </div>
            )}
            {isSnapshotting && (
              <div className="flex items-center gap-2 text-warning">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Creating snapshot…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="terminal" className="flex-1 flex flex-col min-h-0" onValueChange={setActiveTab}>
        <TabsList className="mx-4 mt-4 bg-secondary shrink-0">
          <TabsTrigger
            value="terminal"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Terminal className="w-3 h-3 mr-1" />
            Exec
          </TabsTrigger>
          <TabsTrigger
            value="typescript"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Code className="w-3 h-3 mr-1" />
            TS
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

        {/* Terminal Tab */}
        <TabsContent value="terminal" className="flex-1 flex flex-col p-4 pt-2 min-h-0">
          <div className="flex-1 bg-background rounded-md p-3 font-mono text-xs overflow-auto mb-3">
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
          </div>
          <div className="flex gap-2 shrink-0">
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

        {/* TypeScript Tab */}
        <TabsContent value="typescript" className="flex-1 flex flex-col p-4 pt-2 min-h-0 gap-3">
          {/* Code Editor */}
          <div className="shrink-0">
            <Label className="text-xs text-muted-foreground mb-2 block">TypeScript Code</Label>
            <Textarea
              value={tsCode}
              onChange={(e) => setTsCode(e.target.value)}
              placeholder={`// Your TypeScript code here\nresult.set({ hello: "world" });`}
              className="font-mono text-xs bg-input border-border text-foreground placeholder:text-muted-foreground min-h-[120px] resize-none"
            />
            <Button
              onClick={handleRunTs}
              disabled={isRunningTs || !tsCode.trim()}
              className="mt-2 bg-primary text-primary-foreground hover:bg-primary/90"
              size="sm"
            >
              {isRunningTs ? (
                <>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 mr-2" />
                  Run TypeScript
                </>
              )}
            </Button>
          </div>

          {/* Execution History */}
          <div className="flex-1 flex flex-col min-h-0 border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <Label className="text-xs text-muted-foreground">Execution History</Label>
              {tsExecutions.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTsExecutions([])}
                  className="text-xs text-muted-foreground hover:text-foreground h-6 px-2"
                >
                  Clear
                </Button>
              )}
            </div>

            {tsExecutions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                No executions yet
              </div>
            ) : (
              <div className="flex-1 flex gap-3 min-h-0">
                {/* Execution List */}
                <div className="w-32 shrink-0 overflow-auto border-r border-border pr-2">
                  {tsExecutions.map((exec) => (
                    <div
                      key={exec.id}
                      onClick={() => setSelectedTsExecution(exec)}
                      className={`p-2 rounded cursor-pointer text-xs mb-1 flex items-center gap-2 ${
                        selectedTsExecution?.id === exec.id
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-secondary"
                      }`}
                    >
                      {exec.result.exitCode === 0 ? (
                        <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
                      )}
                      <span className="truncate text-muted-foreground">
                        {exec.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Execution Detail */}
                <div className="flex-1 overflow-auto">
                  {selectedTsExecution ? (
                    <div className="space-y-3 text-xs">
                      {/* Exit Code */}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Exit Code:</span>
                        <Badge
                          variant="outline"
                          className={
                            selectedTsExecution.result.exitCode === 0
                              ? "border-success/50 text-success"
                              : "border-destructive/50 text-destructive"
                          }
                        >
                          {selectedTsExecution.result.exitCode}
                        </Badge>
                      </div>

                      {/* Structured Result */}
                      {selectedTsExecution.result.result !== undefined && (
                        <div>
                          <div className="flex items-center gap-1 text-success mb-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span className="font-medium">Result</span>
                          </div>
                          <pre className="bg-background rounded p-2 overflow-auto max-h-32 text-foreground">
                            {JSON.stringify(selectedTsExecution.result.result, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Structured Error */}
                      {selectedTsExecution.result.error !== undefined && (
                        <div>
                          <div className="flex items-center gap-1 text-destructive mb-1">
                            <AlertCircle className="w-3 h-3" />
                            <span className="font-medium">Error</span>
                          </div>
                          <pre className="bg-destructive/10 rounded p-2 overflow-auto max-h-32 text-destructive">
                            {typeof selectedTsExecution.result.error === "string"
                              ? selectedTsExecution.result.error
                              : JSON.stringify(selectedTsExecution.result.error, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Stdout */}
                      {selectedTsExecution.result.stdout && (
                        <div>
                          <div className="text-muted-foreground mb-1">stdout</div>
                          <pre className="bg-background rounded p-2 overflow-auto max-h-24 text-foreground whitespace-pre-wrap">
                            {selectedTsExecution.result.stdout}
                          </pre>
                        </div>
                      )}

                      {/* Stderr */}
                      {selectedTsExecution.result.stderr && (
                        <div>
                          <div className="text-warning mb-1">stderr</div>
                          <pre className="bg-warning/10 rounded p-2 overflow-auto max-h-24 text-warning whitespace-pre-wrap">
                            {selectedTsExecution.result.stderr}
                          </pre>
                        </div>
                      )}

                      {/* No output indicator */}
                      {!selectedTsExecution.result.stdout &&
                        !selectedTsExecution.result.stderr &&
                        selectedTsExecution.result.result === undefined &&
                        selectedTsExecution.result.error === undefined && (
                          <div className="text-muted-foreground italic">No output captured</div>
                        )}

                      {/* Code Preview */}
                      <div>
                        <div className="text-muted-foreground mb-1">Code</div>
                        <pre className="bg-background rounded p-2 overflow-auto max-h-24 text-foreground/70 whitespace-pre-wrap">
                          {selectedTsExecution.code}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                      Select an execution to view details
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="flex-1 flex flex-col p-4 pt-2 min-h-0">
          {/* Log Type Tabs */}
          <div className="flex items-center gap-1 mb-2 shrink-0">
            <Button
              variant={logType === "system" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLogType("system")}
              className="h-7 text-xs"
            >
              <Server className="w-3 h-3 mr-1" />
              System
            </Button>
            <Button
              variant={logType === "exec" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLogType("exec")}
              className="h-7 text-xs"
            >
              <Terminal className="w-3 h-3 mr-1" />
              Exec
            </Button>
            <Button
              variant={logType === "ts" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLogType("ts")}
              className="h-7 text-xs"
            >
              <Code className="w-3 h-3 mr-1" />
              TypeScript
            </Button>
            <div className="flex-1" />
            {logsUpdatedAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(logsUpdatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Log Content */}
          <div className="flex-1 bg-background rounded-md p-3 font-mono text-xs overflow-auto">
            {logType === "system" && (
              <>
                {logError ? (
                  <div className="text-destructive">{logError}</div>
                ) : logLines.length === 0 ? (
                  <span className="text-muted-foreground">{logsLoading ? "Loading logs..." : "No logs yet."}</span>
                ) : (
                  <pre className="text-muted-foreground whitespace-pre-wrap">{logLines.join("\n")}</pre>
                )}
              </>
            )}

            {logType === "exec" && (
              <>
                {commandOutput.length === 0 ? (
                  <span className="text-muted-foreground">No exec history yet. Run commands in the Exec tab.</span>
                ) : (
                  <div className="space-y-1">
                    {commandOutput.map((line, i) => (
                      <div key={i} className={line.startsWith("$") ? "text-primary" : "text-foreground"}>
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {logType === "ts" && (
              <>
                {tsExecutions.length === 0 ? (
                  <span className="text-muted-foreground">No TS executions yet. Run code in the TS tab.</span>
                ) : (
                  <div className="space-y-4">
                    {tsExecutions.map((exec) => (
                      <div key={exec.id} className="border-b border-border pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-2">
                          {exec.result.exitCode === 0 ? (
                            <CheckCircle2 className="w-3 h-3 text-success" />
                          ) : (
                            <AlertCircle className="w-3 h-3 text-destructive" />
                          )}
                          <span className="text-muted-foreground">{exec.timestamp.toLocaleString()}</span>
                          <Badge variant="outline" className="text-[10px] px-1">
                            exit {exec.result.exitCode}
                          </Badge>
                        </div>
                        {exec.result.result !== undefined && (
                          <div className="mb-1">
                            <span className="text-success">result: </span>
                            <span className="text-foreground">{JSON.stringify(exec.result.result)}</span>
                          </div>
                        )}
                        {exec.result.error !== undefined && (
                          <div className="mb-1">
                            <span className="text-destructive">error: </span>
                            <span className="text-foreground">
                              {typeof exec.result.error === "string"
                                ? exec.result.error
                                : JSON.stringify(exec.result.error)}
                            </span>
                          </div>
                        )}
                        {exec.result.stdout && (
                          <div className="text-foreground whitespace-pre-wrap">{exec.result.stdout}</div>
                        )}
                        {exec.result.stderr && (
                          <div className="text-warning whitespace-pre-wrap">{exec.result.stderr}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {logsTruncated && logType === "system" && (
            <div className="text-xs text-muted-foreground mt-2 shrink-0">Showing latest lines (truncated)</div>
          )}
        </TabsContent>

        {/* Files Tab */}
        <TabsContent value="files" className="flex-1 p-4 pt-2 space-y-4 overflow-auto">
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
          <Button
            variant="outline"
            className="w-full border-border text-foreground hover:bg-secondary bg-transparent"
            onClick={onCreateSnapshot}
            disabled={!canSnapshot || isSnapshotting}
          >
            {isSnapshotting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
            {isSnapshotting ? "Snapshotting…" : "Create Snapshot"}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  )
}
