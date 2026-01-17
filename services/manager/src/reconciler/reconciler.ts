import type { Reconciler } from "../types/interfaces.js";

export class StubReconciler implements Reconciler {
  async run(): Promise<void> {
    return;
  }
}
