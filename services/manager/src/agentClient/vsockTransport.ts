import net from "node:net";
import { HTTPParser } from "http-parser-js";

export interface VsockRawResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
}

export interface VsockTransportOptions {
  udsPath: string;
  agentPort: number;
  timeoutMs?: number;
  /**
   * Hard cap on total bytes read from the vsock stream (handshake + HTTP).
   * Prevents unbounded memory growth if the guest misbehaves or an attacker
   * can influence response size.
   */
  maxResponseBytes?: number;
}

export function execVsockUdsRaw(options: VsockTransportOptions, requestPayload: Buffer): Promise<VsockRawResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: options.udsPath });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timeoutMs = options.timeoutMs ?? 15000;
    const maxResponseBytes = options.maxResponseBytes ?? 2_000_000;
    socket.setTimeout(timeoutMs);

    let sentRequest = false;
    let handshakeBuffer = Buffer.alloc(0);
    let forcedError: string | null = null;

    // Once the HTTP response is complete, proactively close the socket instead of waiting
    // for the server side to close it. This avoids cases where we read a partial response
    // and hang/timeout waiting for close.
    let parserStarted = false;
    let messageComplete = false;
    let httpSearchBuf = Buffer.alloc(0);
    const httpMarker = Buffer.from("HTTP/");
    const parser = new HTTPParser(HTTPParser.RESPONSE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parser as any)[HTTPParser.kOnMessageComplete] = () => {
      messageComplete = true;
      // Destroy immediately; response framing tells us we've got the full message.
      socket.destroy();
    };

    let totalBytes = 0;

    socket.on("connect", () => {
      // Firecracker vsock host-side is a Unix socket. It expects a small handshake:
      // "CONNECT <guest_port>\n" and responds with "OK <local_port>\n" (or FAIL...).
      // Only after the OK line is received should we send the HTTP payload.
      socket.write(Buffer.from(`CONNECT ${options.agentPort}\n`));
    });

    socket.on("data", (chunk) => {
      const buf = Buffer.from(chunk);
      totalBytes += buf.length;
      if (!forcedError && totalBytes > maxResponseBytes) {
        forcedError = `vsock response exceeded maxResponseBytes=${maxResponseBytes}`;
        stderrChunks.push(Buffer.from(forcedError));
        socket.destroy();
        return;
      }

      // If we haven't sent the HTTP request yet, treat the first line as the handshake.
      if (!sentRequest) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, buf]);
        const nl = handshakeBuffer.indexOf(0x0a); // '\n'
        if (nl !== -1) {
          const lineBuf = handshakeBuffer.subarray(0, nl + 1);
          const rest = handshakeBuffer.subarray(nl + 1);
          stdoutChunks.push(lineBuf);

          const line = lineBuf.toString("utf-8").trim();
          if (!/^OK\s+\d+$/.test(line)) {
            // Keep whatever we saw for debugging, but don't attempt the HTTP request.
            stderrChunks.push(Buffer.from(`vsock handshake failed: ${line}`));
            if (rest.length > 0) stdoutChunks.push(rest);
            // Close write side; we'll drain any remaining bytes then close.
            socket.end();
            sentRequest = true;
            return;
          }

          // Handshake OK; now send the HTTP request.
          sentRequest = true;
          if (rest.length > 0) stdoutChunks.push(rest);
          socket.write(requestPayload);
          // Do NOT half-close here: some Firecracker/vsock paths will close the
          // stream early if the client half-closes immediately after CONNECT.
          // We rely on "Connection: close" from the HTTP server to close the
          // proxied stream after the response is sent.
        }
        return;
      }

      stdoutChunks.push(buf);

      // Start parsing once we see the beginning of an HTTP response. We can't assume
      // the response begins at the first post-handshake byte (socat/bridge quirks),
      // so scan for the marker across chunk boundaries.
      if (!parserStarted) {
        httpSearchBuf = Buffer.concat([httpSearchBuf, buf]);
        const idx = httpSearchBuf.indexOf(httpMarker);
        if (idx === -1) {
          // Keep a small tail so the marker can match across boundaries.
          if (httpSearchBuf.length > httpMarker.length) {
            httpSearchBuf = httpSearchBuf.subarray(httpSearchBuf.length - (httpMarker.length - 1));
          }
          return;
        }
        parserStarted = true;
        const httpPart = httpSearchBuf.subarray(idx);
        httpSearchBuf = Buffer.alloc(0);
        try {
          parser.execute(httpPart);
        } catch (err) {
          forcedError = `http parse error: ${String((err as any)?.message ?? err)}`;
          stderrChunks.push(Buffer.from(forcedError));
          socket.destroy();
        }
        return;
      }

      if (!messageComplete) {
        try {
          parser.execute(buf);
        } catch (err) {
          forcedError = `http parse error: ${String((err as any)?.message ?? err)}`;
          stderrChunks.push(Buffer.from(forcedError));
          socket.destroy();
        }
      }
    });

    socket.on("timeout", () => {
      stderrChunks.push(Buffer.from(`timeout after ${timeoutMs}ms`));
      socket.destroy();
    });

    // Treat socket errors as part of the transport result; we often still have
    // useful bytes in stdout (e.g. handshake + partial HTTP) even when the peer
    // resets/half-closes.
    socket.on("error", (err) => {
      stderrChunks.push(Buffer.from(String(err?.message ?? err)));
    });

    socket.on("close", (hadError) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode: hadError || forcedError ? 1 : 0
      });
    });
  });
}

