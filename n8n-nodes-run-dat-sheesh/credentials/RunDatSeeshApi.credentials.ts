import type { IAuthenticateGeneric, ICredentialType, INodeProperties } from "n8n-workflow";

export class RunDatSeeshApi implements ICredentialType {
  name = "runDatsheeshApi";
  displayName = "Run Dat sheesh API";
  documentationUrl = "https://github.com/your-org/run-dat-sheesh";

  properties: INodeProperties[] = [
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "http://localhost:3000",
      placeholder: "http://localhost:3000",
      description: "Manager API base URL (no trailing slash required).",
      required: true
    },
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      default: "",
      typeOptions: { password: true },
      required: true,
      description: "Value for the `x-api-key` header."
    }
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        "x-api-key": "={{ $credentials.apiKey }}"
      }
    }
  };
}

