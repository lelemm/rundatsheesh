import net from "node:net";

export interface VsockRawResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
}

export interface VsockTransportOptions {
  udsPath: string;
  agentPort: number;
  timeoutMs?: number;
}

export function execVsockUdsRaw(options: VsockTransportOptions, requestPayload: Buffer): Promise<VsockRawResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: options.udsPath });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timeoutMs = options.timeoutMs ?? 15000;
    socket.setTimeout(timeoutMs);

    let sentRequest = false;
    let handshakeBuffer = Buffer.alloc(0);

    socket.on("connect", () => {
      // Firecracker vsock host-side is a Unix socket. It expects a small handshake:
      // "CONNECT <guest_port>\n" and responds with "OK <local_port>\n" (or FAIL...).
      // Only after the OK line is received should we send the HTTP payload.
      socket.write(Buffer.from(`CONNECT ${options.agentPort}\n`));
    });

    socket.on("data", (chunk) => {
      const buf = Buffer.from(chunk);

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
        exitCode: hadError ? 1 : 0
      });
    });
  });
}

