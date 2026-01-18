"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  RefreshCw,
  Layers,
} from "lucide-react"
import { apiGetJson } from "@/lib/api"

interface Template {
  id: string
  createdAt: string
  cpu?: number
  memMb?: number
}

interface ApiSnapshot {
  id: string
  kind: "template" | "vm"
  createdAt: string
  cpu?: number
  memMb?: number
}

export function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const filteredTemplates = useMemo(
    () => templates.filter((tpl) => tpl.id.toLowerCase().includes(searchQuery.toLowerCase())),
    [templates, searchQuery],
  )

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<ApiSnapshot[]>("/v1/snapshots")
      setTemplates(
        data
          .filter((s) => s.kind === "template")
          .map((s) => ({
            id: s.id,
            createdAt: s.createdAt,
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
          <h2 className="text-2xl font-semibold text-foreground">Templates</h2>
          <p className="text-muted-foreground text-sm mt-1">Pre-configured VM templates for quick deployment</p>
        </div>
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
          onClick={refresh}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading templates…</p>}

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
                    <CardTitle className="text-foreground text-base">{template.id}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">{template.id}</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Created: <span className="font-mono text-foreground">{new Date(template.createdAt).toLocaleString()}</span>
                </span>
                <Badge variant="outline" className="border-success/50 text-success">
                  Ready
                </Badge>
              </div>
              {typeof template.cpu === "number" && typeof template.memMb === "number" && (
                <div className="text-xs text-muted-foreground">
                  {template.cpu} vCPU / {template.memMb} MB
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
