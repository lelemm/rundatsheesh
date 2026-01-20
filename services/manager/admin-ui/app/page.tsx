import { LandingPage } from "@/components/landing-page"
import { LoginPage } from "@/components/login-page"

export default function Home() {
  // Build-time switch:
  // - default "console": manager root shows login
  // - "marketing": GH Pages build uses the Tailwind/shadcn landing page at "/"
  const mode = process.env.NEXT_PUBLIC_RDS_SITE_MODE ?? "console"
  return mode === "marketing" ? <LandingPage /> : <LoginPage />
}
