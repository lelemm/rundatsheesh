"use client"

import * as React from "react"
import { Highlight, themes } from "prism-react-renderer"

export type CodeLanguage = "js" | "ts" | "tsx" | "json" | "bash" | "sh" | "text"

export function CodeBlock({
  code,
  language,
  className,
  showLineNumbers = true,
}: {
  code: string
  language: CodeLanguage
  className?: string
  showLineNumbers?: boolean
}) {
  const normalized = (code ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lang = language === "sh" ? "bash" : language

  return (
    <Highlight theme={themes.vsDark} code={normalized} language={lang}>
      {({ className: hlClassName, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={[
            "text-xs leading-relaxed overflow-auto rounded-md border border-border bg-background font-mono",
            hlClassName,
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ ...style, margin: 0, padding: 12 }}
        >
          {tokens.map((line, i) => {
            const lineProps = getLineProps({ line })
            return (
              <div key={i} {...lineProps} style={{ ...lineProps.style, display: "table-row" }}>
                {showLineNumbers && (
                  <span
                    style={{
                      display: "table-cell",
                      paddingRight: 12,
                      userSelect: "none",
                      textAlign: "right",
                      opacity: 0.5,
                      width: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {i + 1}
                  </span>
                )}
                <span style={{ display: "table-cell" }}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            )
          })}
        </pre>
      )}
    </Highlight>
  )
}

