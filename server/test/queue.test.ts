import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/logger.ts';
import { Store } from '../src/store.ts';
import { WebhookQueue } from '../src/webhooks/queue.ts';

const event = (id: string) => ({ id, type: 'customer.subscription.updated', workspaceId: null, payload: '{}' });

describe('WebhookQueue', () => {
  it('waits with exponential backoff between attempts', async () => {
    const store = new Store(':memory:');
    let nowMs = 1_000_000;
    const queue = new WebhookQueue({
      store,
      logger: silentLogger,
      now: () => new Date(nowMs),
      baseDelayMs: 1000,
      maxAttempts: 4,
      handle: async () => {
        throw new Error('boom');
      },
    });
    store.recordEvent(event('evt_1'), new Date(nowMs));

    await queue.drain();
    expect(store.event('evt_1')).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: nowMs + 1000 });

    nowMs += 1000;
    await queue.drain();
    expect(store.event('evt_1')).toMatchObject({ attempts: 2, nextAttemptAt: nowMs + 2000 });

    nowMs += 2000;
    await queue.drain();
    expect(store.event('evt_1')).toMatchObject({ attempts: 3, nextAttemptAt: nowMs + 4000 });

    nowMs += 4000;
    await queue.drain();
    expect(store.event('evt_1')).toMatchObject({ status: 'failed', attempts: 4, detail: 'boom' });
    queue.stop();
  });

  it('processes events in arrival order, one at a time', async () => {
    const store = new Store(':memory:');
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const queue = new WebhookQueue({
      store,
      logger: silentLogger,
      handle: async (e) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        order.push(e.id);
        running--;
        return { outcome: 'processed', detail: null };
      },
    });
    const t = Date.now();
    for (const [i, id] of ['evt_a', 'evt_b', 'evt_c'].entries()) {
      store.recordEvent({ ...event(id), payload: JSON.stringify({ id }) }, new Date(t + i));
    }
    queue.kick();
    queue.kick();
    await queue.drain();
    expect(order).toEqual(['evt_a', 'evt_b', 'evt_c']);
    expect(maxRunning).toBe(1);
    queue.stop();
  });

  it('picks up events left unprocessed by a previous process', async () => {
    const store = new Store(':memory:');
    store.recordEvent({ ...event('evt_old'), payload: JSON.stringify({ id: 'evt_old' }) }, new Date());
    // A new queue (as after a restart) finds the pending row in the database.
    const seen: string[] = [];
    const queue = new WebhookQueue({
      store,
      logger: silentLogger,
      handle: async (e) => {
        seen.push(e.id);
        return { outcome: 'processed', detail: null };
      },
    });
    await queue.drain();
    expect(seen).toEqual(['evt_old']);
    queue.stop();
  });
});
