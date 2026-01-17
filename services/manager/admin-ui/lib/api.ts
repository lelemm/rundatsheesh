export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("rds_api_key")
}

export function setStoredApiKey(key: string) {
  if (typeof window === "undefined") return
  localStorage.setItem("rds_api_key", key)
}

export async function apiGetJson<T>(path: string, apiKey: string | null): Promise<T> {
  const res = await fetch(path, {
    headers: apiKey ? { "X-API-Key": apiKey } : undefined,
    cache: "no-store",
    credentials: "same-origin",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`)
  }
  return (await res.json()) as T
}

