"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface CopyIdProps {
  value: string
  label?: string
  className?: string
  showIcon?: boolean
  iconOnly?: boolean
}

export function CopyId({ value, label, className, showIcon = true, iconOnly = false }: CopyIdProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast({ title: "Copied to clipboard", description: value })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: "Failed to copy", description: "Could not copy to clipboard" })
    }
  }

  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className={cn("h-6 w-6 text-muted-foreground hover:text-foreground", className)}
        title={`Copy ${label || value}`}
      >
        {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      </Button>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 group cursor-pointer hover:text-primary transition-colors",
        className
      )}
      onClick={handleCopy}
      title={`Click to copy: ${value}`}
    >
      <span className="font-mono text-sm">{label || value}</span>
      {showIcon && (
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          {copied ? (
            <Check className="w-3 h-3 text-success" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground" />
          )}
        </span>
      )}
    </span>
  )
}
