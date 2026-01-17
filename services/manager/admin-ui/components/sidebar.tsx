"use client"

import { cn } from "@/lib/utils"
import type { View } from "./admin-shell"
import { LayoutDashboard, Server, Camera, Layers, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

interface SidebarProps {
  currentView: View
  onViewChange: (view: View) => void
}

const navItems = [
  { id: "dashboard" as View, label: "Dashboard", icon: LayoutDashboard },
  { id: "vms" as View, label: "Virtual Machines", icon: Server },
  { id: "snapshots" as View, label: "Snapshots", icon: Camera },
  { id: "templates" as View, label: "Templates", icon: Layers },
  { id: "apiKeys" as View, label: "API Keys", icon: KeyRound },
]

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { user, logout } = useAuth()
  return (
    <div className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="run dat sheesh"
            className="w-9 h-9 rounded-lg object-cover"
          />
          <div>
            <h1 className="font-semibold text-sidebar-foreground text-sm">run dat sheesh</h1>
            <p className="text-xs text-muted-foreground">Admin Console</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onViewChange(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  currentView === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span>API Connected</span>
        </div>
        {user && (
          <div className="mt-3 text-xs text-muted-foreground">
            <div className="truncate">{user.email}</div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={logout}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
