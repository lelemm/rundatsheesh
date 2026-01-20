"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const { login, isLoading } = useAuth()

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    await login(email, password)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-border/50 backdrop-blur-sm bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <img
                src="/logo.png"
                alt="run dat sheesh"
                className="w-8 h-8 rounded-lg object-cover"
              />
              <span className="font-semibold text-lg">run dat sheesh</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Login Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md bg-card border-border">
          <CardHeader className="text-center">
            <img
              src="/logo.png"
              alt="run dat sheesh"
              className="w-14 h-14 rounded-xl object-cover mx-auto mb-2"
            />
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Sign in to access the admin console</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Email Login Form */}
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 bg-input border-border"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="#" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 bg-input border-border"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                className="w-full h-11"
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="#" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>

          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-6 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-6 text-sm text-muted-foreground">
          <Link href="#" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          <Link href="#" className="hover:text-foreground transition-colors">
            Terms
          </Link>
          <Link href="#" className="hover:text-foreground transition-colors">
            Support
          </Link>
        </div>
      </footer>
    </div>
  )
}
