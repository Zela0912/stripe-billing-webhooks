import type Stripe from 'stripe';
import type { Logger } from '../logger.ts';
import { serializeError } from '../logger.ts';
import type { Store, StoredEvent } from '../store.ts';
import type { HandlerResult } from './handlers.ts';

export interface QueueOptions {
  store: Store;
  handle: (event: Stripe.Event) => Promise<HandlerResult>;
  logger: Logger;
  now?: () => Date;
  /** Attempts before an event is marked failed and waits for a manual replay. */
  maxAttempts?: number;
  /** First retry delay. Each further retry waits twice as long. */
  baseDelayMs?: number;
}

/**
 * A durable work queue on top of the webhook_events table.
 *
 * The webhook endpoint only verifies, stores and acknowledges an event; this queue does the
 * work afterwards. Stripe gets its 2xx in milliseconds, a slow or failing handler never
 * causes a redelivery storm, and events survive a restart because they are in the database.
 *
 * Events are processed one at a time, in arrival order. One process with a serial queue has
 * no races between handlers; running several instances would need a row lock or a real queue.
 */
export class WebhookQueue {
  private readonly store: Store;
  private readonly handle: QueueOptions['handle'];
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private draining: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options: QueueOptions) {
    this.store = options.store;
    this.handle = options.handle;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
  }

  /** Starts processing whatever is due. Safe to call any number of times. */
  kick(): void {
    if (this.stopped || this.draining) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.draining = this.drainLoop().finally(() => {
      this.draining = null;
      this.scheduleNext();
    });
  }

  /** Processes everything that is due and resolves when the queue is idle. Used by tests and shutdown. */
  async drain(): Promise<void> {
    for (;;) {
      this.kick();
      while (this.draining) await this.draining;
      if (this.stopped || !this.store.nextDueEvent(this.now().getTime())) return;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async drainLoop(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const event = this.store.nextDueEvent(this.now().getTime());
      if (!event) return;
      await this.process(event);
    }
  }

  private async process(stored: StoredEvent): Promise<void> {
    const attempt = this.store.beginAttempt(stored.id);
    const started = performance.now();
    const fields = { eventId: stored.id, type: stored.type, attempt };
    try {
      const result = await this.handle(JSON.parse(stored.payload) as Stripe.Event);
      this.store.finishEvent(stored.id, result.outcome, result.detail, this.now());
      this.logger.info('webhook.processed', { ...fields, outcome: result.outcome, ms: elapsed(started) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= this.maxAttempts) {
        this.store.failEvent(stored.id, message, this.now());
        this.logger.error('webhook.failed', { ...fields, ms: elapsed(started), error: serializeError(err) });
        return;
      }
      const delay = this.baseDelayMs * 2 ** (attempt - 1);
      this.store.scheduleRetry(stored.id, message, this.now().getTime() + delay);
      this.logger.warn('webhook.retry_scheduled', { ...fields, delayMs: delay, error: serializeError(err) });
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const at = this.store.nextAttemptAt();
    if (at === null) return;
    const delay = Math.max(0, at - this.now().getTime());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, delay);
    this.timer.unref();
  }
}

const elapsed = (started: number) => Math.round(performance.now() - started);
