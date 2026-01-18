"use client"

import { useEffect, useMemo, useRef, useState } from "react"

export type AdminActivityEvent = {
  id: string
  createdAt: string
  type: string
  entityType?: string
  entityId?: string
  message: string
  meta?: unknown
}

type Listener = (ev: AdminActivityEvent) => void

const listeners = new Set<Listener>()

export function subscribeAdminEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAdminEventsConnection(): { connected: boolean; lastEvent: AdminActivityEvent | null } {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<AdminActivityEvent | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource("/v1/admin/events")
    sourceRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    const handler = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(e.data)) as AdminActivityEvent
        setLastEvent(parsed)
        for (const l of listeners) {
          try {
            l(parsed)
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore parse errors
      }
    }
    es.addEventListener("activity", handler as any)

    return () => {
      es.removeEventListener("activity", handler as any)
      es.close()
      sourceRef.current = null
    }
  }, [])

  return useMemo(() => ({ connected, lastEvent }), [connected, lastEvent])
}

