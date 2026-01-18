"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "./sidebar"
import { Dashboard } from "./dashboard"
import { VMsPanel } from "./vms-panel"
import { SnapshotsPanel } from "./snapshots-panel"
import { TemplatesPanel } from "./templates-panel"
import { ApiKeysPanel } from "./api-keys-panel"
import { ImagesPanel } from "./images-panel"
import { WebhooksPanel } from "./webhooks-panel"
import { toast } from "@/hooks/use-toast"
import { subscribeAdminEvents, useAdminEventsConnection } from "@/lib/admin-events"

export type View = "dashboard" | "vms" | "snapshots" | "templates" | "images" | "apiKeys" | "webhooks"

export function AdminShell() {
  const [currentView, setCurrentView] = useState<View>("dashboard")
  useAdminEventsConnection()

  useEffect(() => {
    return subscribeAdminEvents((ev) => {
      toast({ title: ev.message, description: ev.type })
    })
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="flex-1 overflow-auto">
        {currentView === "dashboard" && <Dashboard onNavigate={setCurrentView} />}
        {currentView === "vms" && <VMsPanel />}
        {currentView === "snapshots" && <SnapshotsPanel />}
        {currentView === "templates" && <TemplatesPanel />}
        {currentView === "images" && <ImagesPanel />}
        {currentView === "apiKeys" && <ApiKeysPanel />}
        {currentView === "webhooks" && <WebhooksPanel />}
      </main>
    </div>
  )
}
