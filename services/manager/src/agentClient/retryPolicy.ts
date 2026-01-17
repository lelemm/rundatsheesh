import { hasHttpResponse } from "./httpResponse.js";

export function isVsockHandshakeOnly(response: Buffer): boolean {
  // Firecracker vsock UDS protocol commonly responds with: "OK <port>\n"
  // We treat that as non-fatal and retry until we see an actual HTTP response.
  const text = response.toString("utf-8").trim();
  return /^OK\s+\d+$/.test(text);
}

export function shouldRetryVsock(attempt: number, attempts: number, stdout: Buffer, stderr: Buffer, exitCode: number | null): boolean {
  const stderrText = stderr.toString("utf-8");
  const hasHttp = hasHttpResponse(stdout);
  const handshakeOnly = isVsockHandshakeOnly(stdout);

  const shouldRetry =
    // If the guest-side listener isn't ready yet, we may only get handshake and no HTTP.
    (!hasHttp && handshakeOnly) ||
    (!hasHttp &&
      stdout.length === 0 &&
      /network is unreachable|connection refused|no such device|no such file|does not exist|connection reset|econnreset/i.test(stderrText)) ||
    // socat may exit 0 while the guest isn't ready yet (no bytes returned). Treat as transient.
    (!hasHttp && stdout.length === 0 && exitCode === 0);

  return shouldRetry && attempt < attempts;
}

