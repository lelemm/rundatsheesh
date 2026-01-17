"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { Dashboard } from "./dashboard"
import { VMsPanel } from "./vms-panel"
import { SnapshotsPanel } from "./snapshots-panel"
import { TemplatesPanel } from "./templates-panel"

export type View = "dashboard" | "vms" | "snapshots" | "templates"

export function AdminShell() {
  const [currentView, setCurrentView] = useState<View>("dashboard")

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="flex-1 overflow-auto">
        {currentView === "dashboard" && <Dashboard onNavigate={setCurrentView} />}
        {currentView === "vms" && <VMsPanel />}
        {currentView === "snapshots" && <SnapshotsPanel />}
        {currentView === "templates" && <TemplatesPanel />}
      </main>
    </div>
  )
}
