import type { Readable } from "node:stream";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

export class BodyTooLargeError extends Error {
  statusCode = 413;
  constructor(message: string) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

export async function readStreamToBuffer(stream: Readable | Buffer | Uint8Array, maxBytes: number): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) {
    if (stream.length > maxBytes) throw new BodyTooLargeError(`Body too large (maxBytes=${maxBytes})`);
    return stream;
  }
  if (stream instanceof Uint8Array) {
    if (stream.byteLength > maxBytes) throw new BodyTooLargeError(`Body too large (maxBytes=${maxBytes})`);
    return Buffer.from(stream);
  }

  const chunks: Buffer[] = [];
  let bufferedTotal = 0;
  let total = 0;
  let tooLargeErr: BodyTooLargeError | null = null;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (!tooLargeErr && total > maxBytes) {
      // Keep consuming the stream to EOF (drain) so the HTTP connection stays healthy,
      // but stop buffering bytes to avoid memory blowups.
      tooLargeErr = new BodyTooLargeError(`Body too large (maxBytes=${maxBytes})`);
      continue;
    }
    if (!tooLargeErr) {
      chunks.push(buf);
      bufferedTotal += buf.length;
    }
  }

  if (tooLargeErr) throw tooLargeErr;
  return Buffer.concat(chunks, bufferedTotal);
}

export async function writeStreamToFile(stream: Readable, destPath: string, maxBytes: number): Promise<{ bytesWritten: number }> {
  let total = 0;
  stream.on("data", (chunk) => {
    total += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    if (total > maxBytes) {
      stream.destroy(new Error(`Body too large (maxBytes=${maxBytes})`));
    }
  });
  await pipeline(stream, fs.createWriteStream(destPath, { mode: 0o644 }));
  return { bytesWritten: total };
}

