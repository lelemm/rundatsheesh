"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"

interface User {
  id: string
  email: string
  name: string
  avatar?: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithOpenId: () => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // Check for existing session (mocked)
    const storedUser = localStorage.getItem("rds_user")
    if (storedUser) {
      setUser(JSON.parse(storedUser))
    }
    setIsLoading(false)
  }, [])

  const login = async (email: string, password: string) => {
    // Mock login - in production this would call your OpenID provider
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const mockUser: User = {
      id: "user_1",
      email,
      name: email.split("@")[0],
      avatar: undefined,
    }

    setUser(mockUser)
    localStorage.setItem("rds_user", JSON.stringify(mockUser))
    setIsLoading(false)
    router.push("/console")
  }

  const loginWithOpenId = async () => {
    // Mock OpenID login - in production this would redirect to your OpenID provider
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const mockUser: User = {
      id: "user_oidc_1",
      email: "developer@company.com",
      name: "Developer",
      avatar: undefined,
    }

    setUser(mockUser)
    localStorage.setItem("rds_user", JSON.stringify(mockUser))
    setIsLoading(false)
    router.push("/console")
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem("rds_user")
    router.push("/")
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginWithOpenId, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
