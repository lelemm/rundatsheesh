import { LandingPage } from "@/components/landing-page"
import { LoginPage } from "@/components/login-page"

const GITHUB_TAGS_URL = "https://api.github.com/repos/lelemm/rundatsheesh/tags?per_page=20"
const FALLBACK_TAG = "0.1.0"

type GitHubTag = { name?: string | null }

function parseSemverParts(tag: string): number[] | null {
  const normalized = tag.trim().replace(/^v/i, "")
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    return null
  }
  return normalized.split(".").map((part) => Number(part))
}

function compareSemverDesc(left: string, right: string): number {
  const leftParts = parseSemverParts(left)
  const rightParts = parseSemverParts(right)
  if (!leftParts || !rightParts) return 0
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const delta = (rightParts[i] ?? 0) - (leftParts[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

async function getLatestGitHubTag(): Promise<string> {
  try {
    const response = await fetch(GITHUB_TAGS_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "run-dat-sheesh-admin-ui"
      },
      next: { revalidate: 3600 }
    })
    if (!response.ok) {
      return FALLBACK_TAG
    }
    const tags = (await response.json()) as GitHubTag[]
    const names = tags
      .map((tag) => String(tag?.name ?? "").trim())
      .filter(Boolean)
    if (names.length === 0) {
      return FALLBACK_TAG
    }
    const semverTags = names.filter((tag) => parseSemverParts(tag))
    if (semverTags.length > 0) {
      return [...semverTags].sort(compareSemverDesc)[0]
    }
    return names[0]
  } catch {
    return FALLBACK_TAG
  }
}

export default async function Home() {
  // Build-time switch:
  // - default "console": manager root shows login
  // - "marketing": GH Pages build uses the Tailwind/shadcn landing page at "/"
  const mode = process.env.NEXT_PUBLIC_RDS_SITE_MODE ?? "console"
  const latestGitHubTag = mode === "marketing" ? await getLatestGitHubTag() : null
  return mode === "marketing" ? <LandingPage latestGitHubTag={latestGitHubTag} /> : <LoginPage />
}
