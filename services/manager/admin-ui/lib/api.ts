export async function apiGetJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
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
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {}
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
  data: Blob | ArrayBuffer,
  contentType = "application/octet-stream",
): Promise<void> {
  const headers: Record<string, string> = {
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

export async function apiUploadBinaryWithProgress(input: {
  method: "PUT" | "POST"
  path: string
  data: Blob | ArrayBuffer
  contentType?: string
  onProgress?: (p: { loaded: number; total: number | null; pct: number | null }) => void
}): Promise<void> {
  const contentType = input.contentType ?? "application/octet-stream"
  const body = input.data instanceof Blob ? input.data : new Blob([input.data], { type: contentType })

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(input.method, input.path)
    xhr.withCredentials = true
    xhr.setRequestHeader("content-type", contentType)

    xhr.upload.onprogress = (e) => {
      const total = typeof e.total === "number" && Number.isFinite(e.total) && e.total > 0 ? e.total : null
      const loaded = typeof e.loaded === "number" && Number.isFinite(e.loaded) ? e.loaded : 0
      const pct = total ? Math.max(0, Math.min(100, (loaded / total) * 100)) : null
      input.onProgress?.({ loaded, total, pct })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      reject(new Error(`HTTP ${xhr.status} ${xhr.statusText}: ${xhr.responseText ?? ""}`))
    }
    xhr.onerror = () => reject(new Error("Network error"))
    xhr.onabort = () => reject(new Error("Upload aborted"))

    xhr.send(body)
  })
}


