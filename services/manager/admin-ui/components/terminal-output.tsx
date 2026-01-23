"use client"

import * as React from "react"
import Anser from "anser"

function styleForDecorations(decorations: string[] | undefined): React.CSSProperties {
  const d = decorations ?? []
  return {
    fontWeight: d.includes("bold") ? 700 : undefined,
    fontStyle: d.includes("italic") ? "italic" : undefined,
    textDecoration: d.includes("underline") ? "underline" : d.includes("strikethrough") ? "line-through" : undefined,
    opacity: d.includes("dim") ? 0.7 : undefined,
  }
}

export function TerminalOutput({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const normalized = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const parts = React.useMemo(() => Anser.ansiToJson(normalized, { json: true, remove_empty: false }), [normalized])

  return (
    <pre
      className={[
        "text-xs leading-relaxed overflow-auto rounded-md border border-border bg-background font-mono whitespace-pre-wrap break-words",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ margin: 0, padding: 12 }}
    >
      {parts.map((p, idx) => {
        const fg = p.fg_truecolor || p.fg
        const bg = p.bg_truecolor || p.bg
        const style: React.CSSProperties = {
          color: fg && fg !== "unknown" ? fg : undefined,
          backgroundColor: bg && bg !== "unknown" ? bg : undefined,
          ...styleForDecorations(p.decorations as any),
        }
        return (
          <span key={idx} style={style}>
            {p.content}
          </span>
        )
      })}
    </pre>
  )
}

