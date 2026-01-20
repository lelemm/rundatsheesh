"use client"

import { useCallback, useEffect, useState } from "react"
import { Sidebar } from "./sidebar"
import { Dashboard } from "./dashboard"
import { VMsPanel } from "./vms-panel"
import { SnapshotsPanel } from "./snapshots-panel"
import { ApiKeysPanel } from "./api-keys-panel"
import { ImagesPanel } from "./images-panel"
import { WebhooksPanel } from "./webhooks-panel"
import { toast } from "@/hooks/use-toast"
import { subscribeAdminEvents, useAdminEventsConnection } from "@/lib/admin-events"

export type View = "dashboard" | "vms" | "snapshots" | "images" | "apiKeys" | "webhooks"

export function AdminShell() {
  const [currentView, setCurrentView] = useState<View>("dashboard")
  const [imagesUploadBusy, setImagesUploadBusy] = useState(false)
  useAdminEventsConnection()

  useEffect(() => {
    return subscribeAdminEvents((ev) => {
      toast({ title: ev.message, description: ev.type })
    })
  }, [])

  const confirmIfLeavingImages = useCallback((): boolean => {
    if (currentView !== "images") return true
    if (!imagesUploadBusy) return true
    return window.confirm("A file upload is in progress. Leaving this page will interrupt it. Leave anyway?")
  }, [currentView, imagesUploadBusy])

  const navigateToView = useCallback(
    (view: View) => {
      if (view !== "images" && !confirmIfLeavingImages()) return
      setCurrentView(view)
    },
    [confirmIfLeavingImages],
  )

  useEffect(() => {
    if (currentView !== "images") return
    if (!imagesUploadBusy) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Chrome requires returnValue to be set to trigger the native prompt
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [currentView, imagesUploadBusy])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={navigateToView} confirmExternalNavigation={confirmIfLeavingImages} />
      <main className="flex-1 overflow-auto">
        {currentView === "dashboard" && <Dashboard onNavigate={navigateToView} />}
        {currentView === "vms" && <VMsPanel />}
        {currentView === "snapshots" && <SnapshotsPanel />}
        {currentView === "images" && <ImagesPanel onUploadBusyChange={setImagesUploadBusy} />}
        {currentView === "apiKeys" && <ApiKeysPanel />}
        {currentView === "webhooks" && <WebhooksPanel />}
      </main>
    </div>
  )
}
