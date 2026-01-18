import type { ActivityEvent, ActivityService } from "../telemetry/activityService.js";
import type { WebhookService } from "./webhookService.js";

function safeJsonParse(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export class WebhookDispatcher {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly activity: ActivityService,
    private readonly webhooks: WebhookService,
    private readonly options: { timeoutMs?: number } = {}
  ) {
    this.unsubscribe = this.activity.subscribe((ev) => {
      void this.dispatch(ev);
    });
  }

  close() {
    this.unsubscribe();
  }

  private async dispatch(ev: ActivityEvent): Promise<void> {
    const enabled = await this.webhooks.listEnabled().catch(() => []);
    if (!enabled.length) return;

    const targets = enabled.filter((w) => w.eventTypes.includes(ev.type));
    if (!targets.length) return;

    const payload = {
      id: ev.id,
      type: ev.type,
      createdAt: ev.createdAt,
      entityType: ev.entityType,
      entityId: ev.entityId,
      message: ev.message,
      meta: safeJsonParse(ev.metaJson),
      source: { service: "run-dat-sheesh-manager" }
    };

    const timeoutMs = this.options.timeoutMs ?? 5_000;
    await Promise.allSettled(
      targets.map(async (w) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        try {
          await fetch(w.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
        } catch {
          // best-effort
        } finally {
          clearTimeout(t);
        }
      })
    );
  }
}

