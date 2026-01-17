import { HTTPParser } from "http-parser-js";

export interface ParsedHttpResponse {
  statusCode?: number;
  headers: Record<string, string>;
  body: Buffer;
}

export function hasHttpResponse(response: Buffer): boolean {
  return response.includes(Buffer.from("HTTP/"));
}

export function parseHttpResponse(response: Buffer): ParsedHttpResponse {
  const httpMarker = Buffer.from("HTTP/");
  const startIndex = response.indexOf(httpMarker);
  const payload = startIndex === -1 ? response : response.subarray(startIndex);
  const headers: Record<string, string> = {};
  const bodyChunks: Buffer[] = [];
  let statusCode: number | undefined;

  const parser = new HTTPParser(HTTPParser.RESPONSE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (parser as any)[HTTPParser.kOnHeadersComplete] = (info: any) => {
    statusCode = typeof info.statusCode === "number" ? info.statusCode : undefined;
    if (Array.isArray(info.headers)) {
      for (let i = 0; i < info.headers.length; i += 2) {
        const key = String(info.headers[i]).toLowerCase();
        const value = String(info.headers[i + 1] ?? "");
        headers[key] = value;
      }
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (parser as any)[HTTPParser.kOnBody] = (chunk: any, offset: number, length: number) => {
    bodyChunks.push(Buffer.from(chunk.slice(offset, offset + length)));
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (parser as any)[HTTPParser.kOnMessageComplete] = () => undefined;

  // If the response doesn't contain an HTTP marker, treat as empty/unparseable.
  if (startIndex !== -1) {
    parser.execute(payload);
    parser.finish();
  }

  return { statusCode, headers, body: Buffer.concat(bodyChunks) };
}

