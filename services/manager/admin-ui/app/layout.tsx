import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { AuthProvider } from "@/lib/auth-context"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "run dat sheesh | Firecracker Sandbox MicroVMs",
  description:
    "Run LLM-generated code in isolated Firecracker microVMs, keep SDK credentials inside provider VMs, and connect workflow VMs through manager-routed peer proxies.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`font-sans antialiased`}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
