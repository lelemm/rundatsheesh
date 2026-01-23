import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import { runDatsheeshApiRequest } from "./GenericFunctions";

export class RunDatSeesh implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Run Dat sheesh",
    name: "runDatsheesh",
    icon: "file:logo.png",
    group: ["transform"],
    version: 1,
    subtitle: "={{$parameter.resource + ': ' + $parameter.operation}}",
    description: "Interact with the run-dat-sheesh Manager API",
    defaults: {
      name: "Run Dat sheesh"
    },
    inputs: ["main"],
    outputs: ["main"],
    usableAsTool: true,
    credentials: [
      {
        name: "runDatsheeshApi",
        required: true
      }
    ],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "Images", value: "images" },
          { name: "Files", value: "files" },
          { name: "Snapshots", value: "snapshots" },
          { name: "VMs", value: "vms" }
        ],
        default: "vms"
      },

      // Images
      {
        displayName: "Operation",
        name: "operationImages",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["images"] } },
        options: [
          { name: "List Images", value: "list", action: "List images" }
        ],
        default: "list"
      },

      // Snapshots
      {
        displayName: "Operation",
        name: "operationSnapshots",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["snapshots"] } },
        options: [
          {
            name: "List Snapshots",
            value: "list",
            action: "List snapshots"
          },
          {
            name: "Create Snapshot From VM",
            value: "createFromVm",
            action: "Create snapshot from a VM"
          }
        ],
        default: "list"
      },
      {
        displayName: "VM ID",
        name: "vmIdSnapshot",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["snapshots"], operationSnapshots: ["createFromVm"] } }
      },

      // VMs
      {
        displayName: "Operation",
        name: "operationVms",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["vms"] } },
        options: [
          { name: "List VMs", value: "list", action: "List VMs" },
          { name: "Get VM", value: "get", action: "Get a VM" },
          { name: "Create VM", value: "create", action: "Create a VM" },
          { name: "Start VM", value: "start", action: "Start a VM" },
          { name: "Stop VM", value: "stop", action: "Stop a VM" },
          { name: "Destroy VM", value: "destroy", action: "Destroy a VM" },
          { name: "Execute Command", value: "exec", action: "Execute a command in a VM" },
          { name: "Run TypeScript (Deno)", value: "runTs", action: "Run TypeScript in a VM" },
          { name: "Run JavaScript (Node.js)", value: "runJs", action: "Run JavaScript in a VM" }
        ],
        default: "list"
      },
      {
        displayName: "VM ID",
        name: "vmIdVms",
        type: "string",
        required: true,
        default: "",
        displayOptions: {
          show: {
            resource: ["vms"],
            operationVms: ["get", "start", "stop", "destroy", "exec", "runTs", "runJs"]
          }
        }
      },
      {
        displayName: "CPU",
        name: "cpu",
        type: "number",
        required: true,
        default: 1,
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },
      {
        displayName: "Memory (MiB)",
        name: "memMb",
        type: "number",
        required: true,
        default: 256,
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },
      {
        displayName: "Allowed IPs (CIDR)",
        name: "allowIps",
        type: "string",
        required: true,
        default: "",
        placeholder: "172.16.0.1/32,10.0.0.0/8",
        description: "Comma-separated IPv4/CIDR allowlist.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },
      {
        displayName: "Outbound Internet",
        name: "outboundInternet",
        type: "boolean",
        default: true,
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },
      {
        displayName: "Snapshot ID",
        name: "snapshotId",
        type: "string",
        default: "",
        description: "Optional snapshot id to restore from.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },
      {
        displayName: "Image ID",
        name: "imageId",
        type: "string",
        default: "",
        description: "Optional guest image id (defaults to the configured default image).",
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },
      {
        displayName: "Disk Size (MiB)",
        name: "diskSizeMb",
        type: "number",
        default: 0,
        description: "Optional disk size in MiB. Must be >= base rootfs size. Set 0 to omit.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["create"] } }
      },

      // VM exec params
      {
        displayName: "Command",
        name: "cmd",
        type: "string",
        required: true,
        default: "echo hello",
        displayOptions: { show: { resource: ["vms"], operationVms: ["exec"] } }
      },
      {
        displayName: "Working Directory",
        name: "cwd",
        type: "string",
        default: "",
        placeholder: "/workspace",
        displayOptions: { show: { resource: ["vms"], operationVms: ["exec"] } }
      },
      {
        displayName: "Timeout (ms)",
        name: "timeoutMs",
        type: "number",
        default: 0,
        displayOptions: { show: { resource: ["vms"], operationVms: ["exec", "runTs", "runJs"] } }
      },
      {
        displayName: "Environment",
        name: "env",
        type: "fixedCollection",
        default: {},
        placeholder: "Add Variable",
        typeOptions: { multipleValues: true },
        options: [
          {
            name: "values",
            displayName: "Variables",
            values: [
              { displayName: "Name", name: "name", type: "string", default: "" },
              { displayName: "Value", name: "value", type: "string", default: "" }
            ]
          }
        ],
        displayOptions: { show: { resource: ["vms"], operationVms: ["exec", "runTs", "runJs"] } }
      },
      {
        displayName: "TypeScript Code",
        name: "code",
        type: "string",
        default: "",
        typeOptions: { rows: 8 },
        description: "Inline TypeScript code to run. Provide either Code or Path.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runTs"] } }
      },
      {
        displayName: "TypeScript File Path",
        name: "tsPath",
        type: "string",
        default: "",
        description: "Path to a .ts file inside the VM under /workspace. Provide either Code or Path.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runTs"] } }
      },
      {
        displayName: "Arguments",
        name: "args",
        type: "string",
        default: "",
        placeholder: "arg1,arg2",
        description: "Comma-separated arguments passed to the program.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runTs"] } }
      },
      {
        displayName: "Deno Flags",
        name: "denoFlags",
        type: "string",
        default: "",
        placeholder: "--no-check,--quiet",
        description: "Comma-separated extra Deno flags (advanced).",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runTs"] } }
      },

      // VM run-js params
      {
        displayName: "JavaScript Code",
        name: "jsCode",
        type: "string",
        default: "",
        typeOptions: { rows: 8 },
        description: "Inline JavaScript code to run. Provide either Code or Path.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runJs"] } }
      },
      {
        displayName: "JavaScript File Path",
        name: "jsPath",
        type: "string",
        default: "",
        description: "Path to a .js file inside the VM under /workspace. Provide either Code or Path.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runJs"] } }
      },
      {
        displayName: "Arguments",
        name: "jsArgs",
        type: "string",
        default: "",
        placeholder: "arg1,arg2",
        description: "Comma-separated arguments passed to the program.",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runJs"] } }
      },
      {
        displayName: "Node Flags",
        name: "nodeFlags",
        type: "string",
        default: "",
        placeholder: "--max-old-space-size=512",
        description: "Comma-separated extra Node.js flags (advanced).",
        displayOptions: { show: { resource: ["vms"], operationVms: ["runJs"] } }
      },

      // Files
      {
        displayName: "Operation",
        name: "operationFiles",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["files"] } },
        options: [
          { name: "Upload tar.gz", value: "upload", action: "Upload files to a VM" },
          { name: "Download tar.gz", value: "download", action: "Download files from a VM" }
        ],
        default: "upload"
      },
      {
        displayName: "VM ID",
        name: "vmIdFiles",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["files"], operationFiles: ["upload", "download"] } }
      },
      {
        displayName: "Destination Directory",
        name: "dest",
        type: "string",
        required: true,
        default: "/workspace",
        description: "Destination directory inside the VM (must be under /workspace).",
        displayOptions: { show: { resource: ["files"], operationFiles: ["upload"] } }
      },
      {
        displayName: "Binary Property",
        name: "binaryPropertyName",
        type: "string",
        required: true,
        default: "data",
        description: "Binary property containing the tar.gz archive.",
        displayOptions: { show: { resource: ["files"], operationFiles: ["upload"] } }
      },
      {
        displayName: "Path",
        name: "path",
        type: "string",
        required: true,
        default: "/workspace",
        description: "Path inside the VM to download (must be under /workspace).",
        displayOptions: { show: { resource: ["files"], operationFiles: ["download"] } }
      },
      {
        displayName: "Output Binary Property",
        name: "outputBinaryPropertyName",
        type: "string",
        required: true,
        default: "data",
        description: "Binary property to write the tar.gz into.",
        displayOptions: { show: { resource: ["files"], operationFiles: ["download"] } }
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const resource = this.getNodeParameter("resource", i) as string;

      if (resource === "images") {
        const operation = this.getNodeParameter("operationImages", i) as string;

        if (operation === "list") {
          const data = await runDatsheeshApiRequest.call(this, "GET", "/v1/images");
          returnData.push(...this.helpers.returnJsonArray(data));
          continue;
        }

        throw new NodeOperationError(this.getNode(), `Unsupported images operation: ${operation}`, { itemIndex: i });
      }

      if (resource === "snapshots") {
        const operation = this.getNodeParameter("operationSnapshots", i) as string;

        if (operation === "list") {
          const data = await runDatsheeshApiRequest.call(this, "GET", "/v1/snapshots");
          returnData.push(...this.helpers.returnJsonArray(data));
          continue;
        }

        if (operation === "createFromVm") {
          const vmId = this.getNodeParameter("vmIdSnapshot", i) as string;
          const data = await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/snapshots`);
          returnData.push({ json: data });
          continue;
        }

        throw new NodeOperationError(this.getNode(), `Unsupported snapshots operation: ${operation}`, { itemIndex: i });
      }

      if (resource === "files") {
        const operation = this.getNodeParameter("operationFiles", i) as string;
        const vmId = this.getNodeParameter("vmIdFiles", i) as string;

        if (operation === "upload") {
          const dest = this.getNodeParameter("dest", i) as string;
          const binaryPropertyName = this.getNodeParameter("binaryPropertyName", i) as string;

          const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
          await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/files/upload`, {
            qs: { dest },
            body: buffer,
            headers: { "content-type": "application/gzip" },
            json: false
          });

          returnData.push({ json: { success: true, vmId, dest } });
          continue;
        }

        if (operation === "download") {
          const path = this.getNodeParameter("path", i) as string;
          const outputBinaryPropertyName = this.getNodeParameter("outputBinaryPropertyName", i) as string;

          const data: Buffer = await runDatsheeshApiRequest.call(this, "GET", `/v1/vms/${encodeURIComponent(vmId)}/files/download`, {
            qs: { path },
            json: false,
            encoding: null
          });

          const binary = await this.helpers.prepareBinaryData(data, `vm-${vmId}.tar.gz`, "application/gzip");
          returnData.push({
            json: { vmId, path },
            binary: { [outputBinaryPropertyName]: binary }
          });
          continue;
        }

        throw new NodeOperationError(this.getNode(), `Unsupported files operation: ${operation}`, { itemIndex: i });
      }

      // resource === "vms"
      const operation = this.getNodeParameter("operationVms", i) as string;

      if (operation === "list") {
        const data = await runDatsheeshApiRequest.call(this, "GET", "/v1/vms");
        returnData.push(...this.helpers.returnJsonArray(data));
        continue;
      }

      if (operation === "get") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        const data = await runDatsheeshApiRequest.call(this, "GET", `/v1/vms/${encodeURIComponent(vmId)}`);
        returnData.push({ json: data });
        continue;
      }

      if (operation === "create") {
        const cpu = this.getNodeParameter("cpu", i) as number;
        const memMb = this.getNodeParameter("memMb", i) as number;
        const allowIpsRaw = this.getNodeParameter("allowIps", i) as string;
        const outboundInternet = this.getNodeParameter("outboundInternet", i) as boolean;
        const snapshotId = (this.getNodeParameter("snapshotId", i) as string).trim();
        const imageId = (this.getNodeParameter("imageId", i) as string).trim();
        const diskSizeMbRaw = this.getNodeParameter("diskSizeMb", i) as number;
        const diskSizeMb = diskSizeMbRaw && diskSizeMbRaw > 0 ? diskSizeMbRaw : undefined;

        const allowIps = allowIpsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (!allowIps.length) {
          throw new NodeOperationError(this.getNode(), "Allowed IPs (CIDR) must contain at least one entry", {
            itemIndex: i
          });
        }

        const body: any = { cpu, memMb, allowIps, outboundInternet };
        if (snapshotId) body.snapshotId = snapshotId;
        if (imageId) body.imageId = imageId;
        if (diskSizeMb !== undefined) body.diskSizeMb = diskSizeMb;

        const data = await runDatsheeshApiRequest.call(this, "POST", "/v1/vms", { body });
        returnData.push({ json: data });
        continue;
      }

      if (operation === "start") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/start`, { json: false });
        returnData.push({ json: { success: true, vmId } });
        continue;
      }

      if (operation === "stop") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/stop`, { json: false });
        returnData.push({ json: { success: true, vmId } });
        continue;
      }

      if (operation === "destroy") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        await runDatsheeshApiRequest.call(this, "DELETE", `/v1/vms/${encodeURIComponent(vmId)}`, { json: false });
        returnData.push({ json: { success: true, vmId } });
        continue;
      }

      if (operation === "exec") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        const timeoutMsRaw = this.getNodeParameter("timeoutMs", i) as number;
        const timeoutMs = timeoutMsRaw && timeoutMsRaw > 0 ? timeoutMsRaw : undefined;

        const cmd = this.getNodeParameter("cmd", i) as string;
        const cwd = this.getNodeParameter("cwd", i) as string;
        const envFc = this.getNodeParameter("env", i, {}) as any;

        const env: Record<string, string> | undefined = Array.isArray(envFc?.values)
          ? envFc.values.reduce((acc: Record<string, string>, v: any) => {
              if (v?.name) acc[String(v.name)] = String(v.value ?? "");
              return acc;
            }, {})
          : undefined;

        const body: any = { cmd };
        if (cwd) body.cwd = cwd;
        if (env && Object.keys(env).length) body.env = env;
        if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;

        const data = await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/exec`, { body });
        returnData.push({ json: data });
        continue;
      }

      if (operation === "runTs") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        const timeoutMsRaw = this.getNodeParameter("timeoutMs", i) as number;
        const timeoutMs = timeoutMsRaw && timeoutMsRaw > 0 ? timeoutMsRaw : undefined;

        const code = (this.getNodeParameter("code", i) as string).trim();
        const tsPath = (this.getNodeParameter("tsPath", i) as string).trim();
        const argsRaw = (this.getNodeParameter("args", i) as string).trim();
        const denoFlagsRaw = (this.getNodeParameter("denoFlags", i) as string).trim();
        const envFc = this.getNodeParameter("env", i, {}) as any;

        const envPairs: Array<{ name?: string; value?: string }> = Array.isArray(envFc?.values) ? envFc.values : [];
        const envArray = envPairs
          .filter((v) => v?.name)
          .map((v) => `${String(v.name)}=${String(v.value ?? "")}`);

        if (!code && !tsPath) {
          throw new NodeOperationError(this.getNode(), "Provide either TypeScript Code or TypeScript File Path", {
            itemIndex: i
          });
        }

        const body: any = {};
        if (code) body.code = code;
        if (tsPath) body.path = tsPath;
        if (argsRaw) body.args = argsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        if (denoFlagsRaw) body.denoFlags = denoFlagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;
        if (envArray.length) body.env = envArray;

        const data = await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/run-ts`, { body });
        returnData.push({ json: data });
        continue;
      }

      if (operation === "runJs") {
        const vmId = this.getNodeParameter("vmIdVms", i) as string;
        const timeoutMsRaw = this.getNodeParameter("timeoutMs", i) as number;
        const timeoutMs = timeoutMsRaw && timeoutMsRaw > 0 ? timeoutMsRaw : undefined;

        const jsCode = (this.getNodeParameter("jsCode", i) as string).trim();
        const jsPath = (this.getNodeParameter("jsPath", i) as string).trim();
        const jsArgsRaw = (this.getNodeParameter("jsArgs", i) as string).trim();
        const nodeFlagsRaw = (this.getNodeParameter("nodeFlags", i) as string).trim();
        const envFc = this.getNodeParameter("env", i, {}) as any;

        const envPairs: Array<{ name?: string; value?: string }> = Array.isArray(envFc?.values) ? envFc.values : [];
        const envArray = envPairs
          .filter((v) => v?.name)
          .map((v) => `${String(v.name)}=${String(v.value ?? "")}`);

        if (!jsCode && !jsPath) {
          throw new NodeOperationError(this.getNode(), "Provide either JavaScript Code or JavaScript File Path", {
            itemIndex: i
          });
        }

        const body: any = {};
        if (jsCode) body.code = jsCode;
        if (jsPath) body.path = jsPath;
        if (jsArgsRaw) body.args = jsArgsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        if (nodeFlagsRaw) body.nodeFlags = nodeFlagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;
        if (envArray.length) body.env = envArray;

        const data = await runDatsheeshApiRequest.call(this, "POST", `/v1/vms/${encodeURIComponent(vmId)}/run-js`, { body });
        returnData.push({ json: data });
        continue;
      }

      throw new NodeOperationError(this.getNode(), `Unsupported VMs operation: ${operation}`, { itemIndex: i });
    }

    return [returnData];
  }
}

