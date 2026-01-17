import type { IExecuteFunctions, ILoadOptionsFunctions } from "n8n-workflow";

type RunDatsheeshCreds = {
  baseUrl: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function runDatsheeshApiRequest(
  this: IExecuteFunctions | ILoadOptionsFunctions,
  method: string,
  endpoint: string,
  {
    qs,
    body,
    headers,
    json = true,
    encoding,
    returnFullResponse
  }: {
    qs?: Record<string, any>;
    body?: any;
    headers?: Record<string, string>;
    json?: boolean;
    encoding?: string | null;
    returnFullResponse?: boolean;
  } = {}
): Promise<any> {
  const credentials = (await this.getCredentials("runDatsheeshApi")) as unknown as RunDatsheeshCreds;
  const uri = `${normalizeBaseUrl(credentials.baseUrl)}${endpoint}`;

  const options: any = {
    method,
    uri,
    qs,
    headers,
    body,
    json
  };

  if (encoding !== undefined) options.encoding = encoding;
  if (returnFullResponse !== undefined) options.resolveWithFullResponse = returnFullResponse;

  return await this.helpers.requestWithAuthentication.call(this, "runDatsheeshApi", options);
}

