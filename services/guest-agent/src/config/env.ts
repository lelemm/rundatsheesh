export interface EnvConfig {
  port: number;
}

export function loadEnv(): EnvConfig {
  const portRaw = process.env.PORT ?? "8080";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive number");
  }

  return { port };
}
