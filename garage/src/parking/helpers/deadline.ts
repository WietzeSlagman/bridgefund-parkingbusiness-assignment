import { performance } from "node:perf_hooks";

export const CHECK_IN_BUDGET_MS = 1500;
export const RESIDENT_BUDGET_MS = 1500;

/** Per-attempt monotonic deadline. Cancellation closes an acquired DB connection. */
export class Deadline {
  private readonly end: number;
  private cancelled = false;
  private listeners = new Set<() => void>();

  constructor(readonly budgetMs: number) {
    this.end = performance.now() + budgetMs;
  }

  remaining(): number {
    return Math.max(0, Math.floor(this.end - performance.now()));
  }

  expired(): boolean {
    return this.cancelled || this.remaining() === 0;
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    for (const listener of this.listeners) {
      listener();
    }
    this.listeners.clear();
  }

  onCancel(listener: () => void): () => void {
    if (this.expired()) {
      listener();
      return () => this.listeners.delete(listener);
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
