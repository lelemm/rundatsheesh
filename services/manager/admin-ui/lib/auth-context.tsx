"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"

interface User {
  email: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch("/auth/me", { credentials: "same-origin", cache: "no-store" })
        if (!res.ok) throw new Error("unauthorized")
        const data = (await res.json()) as { email: string }
        if (cancelled) return
        setUser({ email: data.email })
      } catch {
        if (cancelled) return
        setUser(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  const login = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || "Invalid credentials")
      }
      const data = (await res.json()) as { email: string }
      setUser({ email: data.email })
      router.push("/console")
    } finally {
      setIsLoading(false)
    }
  }

  const logout = async () => {
    setUser(null)
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined)
    router.push("/")
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
