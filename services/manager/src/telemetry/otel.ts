import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";

let sdk: NodeSDK | null = null;

export async function initOtel(env: { otlpEndpoint?: string; serviceName: string }) {
  const endpoint = env.otlpEndpoint?.trim();
  if (!endpoint) return;

  // Keep diagnostics quiet by default; enable via OTEL_DIAGNOSTIC_LOG_LEVEL if needed.
  const diagLevelRaw = (process.env.OTEL_DIAGNOSTIC_LOG_LEVEL ?? "").toUpperCase();
  const diagLevel = (DiagLogLevel as any)[diagLevelRaw];
  if (typeof diagLevel === "number") {
    diag.setLogger(new DiagConsoleLogger(), diagLevel);
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": env.serviceName
    }),
    traceExporter: new OTLPTraceExporter({
      url: endpoint
    }),
    instrumentations: [getNodeAutoInstrumentations()]
  });

  await sdk.start();
}

export async function shutdownOtel() {
  const s = sdk;
  sdk = null;
  await s?.shutdown().catch(() => undefined);
}

