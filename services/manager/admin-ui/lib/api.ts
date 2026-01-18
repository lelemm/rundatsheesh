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

export async function apiRequestJson<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  apiKey: string | null,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json"
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

export async function apiUploadBinary(
  method: "PUT" | "POST",
  path: string,
  apiKey: string | null,
  data: Blob | ArrayBuffer,
  contentType = "application/octet-stream",
): Promise<void> {
  const headers: Record<string, string> = {
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    "content-type": contentType,
  }
  const res = await fetch(path, {
    method,
    headers,
    body: data instanceof Blob ? data : new Blob([data], { type: contentType }),
    credentials: "same-origin",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`)
  }
}


