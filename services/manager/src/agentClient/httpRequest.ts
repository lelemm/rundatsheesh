export function buildJsonRequest(method: string, pathName: string, body?: unknown): Buffer {
  const payload = body ? JSON.stringify(body) : "";
  const requestLines = [
    `${method} ${pathName} HTTP/1.1`,
    "Host: localhost",
    "Content-Type: application/json",
    "Connection: close",
    `Content-Length: ${Buffer.byteLength(payload)}`,
    "",
    payload
  ];
  return Buffer.from(requestLines.join("\r\n"));
}

export function buildBinaryRequest(method: string, pathName: string, body?: Buffer): Buffer {
  const payload = body ?? Buffer.alloc(0);
  const headerLines = [
    `${method} ${pathName} HTTP/1.1`,
    "Host: localhost",
    "Content-Type: application/octet-stream",
    "Connection: close",
    `Content-Length: ${payload.length}`,
    "",
    ""
  ];
  const header = Buffer.from(headerLines.join("\r\n"));
  return Buffer.concat([header, payload]);
}

