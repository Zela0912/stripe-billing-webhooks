import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  invoice,
  linkCustomer,
  signedHeader,
  startTestServer,
  stripeEvent,
  subscription,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
let workspaceId: string;

beforeEach(async () => {
  server = await startTestServer();
  workspaceId = await server.visit();
  linkCustomer(server, workspaceId);
});
afterEach(() => server.close());

const subscriptionEvent = (type: string, status = 'active', id?: string) =>
  stripeEvent(type, { id: 'sub_1', object: 'subscription', customer: 'cus_1', status }, id);

describe('signature verification', () => {
  const post = (body: string, signature?: string) =>
    fetch(`${server.url}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) },
      body,
    });

  it('rejects a request without a signature', async () => {
    const res = await post(JSON.stringify(subscriptionEvent('customer.subscription.updated')));
    expect(res.status).toBe(400);
    expect(server.store.eventsForWorkspace(workspaceId)).toHaveLength(0);
  });

  it('rejects a body that was changed after signing', async () => {
    const original = JSON.stringify(subscriptionEvent('customer.subscription.updated'));
    const tampered = original.replace('"active"', '"trialing"');
    const res = await post(tampered, signedHeader(original));
    expect(res.status).toBe(400);
  });

  it('rejects a signature made with a different secret', async () => {
    const body = JSON.stringify(subscriptionEvent('customer.subscription.updated'));
    const res = await post(body, signedHeader(body, 'whsec_attacker'));
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed event and acknowledges before processing', async () => {
    server.gateway.subscriptions.set('sub_1', subscription());
    const res = await server.deliver(subscriptionEvent('customer.subscription.created'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });
    await server.queue.drain();
    expect(server.store.currentSubscription(workspaceId)?.status).toBe('active');
  });
});

describe('processing', () => {
  it('stores state read from the Stripe API, not from the event payload', async () => {
    // The event says "active", but by the time we process it Stripe says "past_due".
    server.gateway.subscriptions.set('sub_1', subscription({ status: 'past_due' }));
    await server.deliver(subscriptionEvent('customer.subscription.updated', 'active'));
    await server.queue.drain();
    expect(server.store.currentSubscription(workspaceId)?.status).toBe('past_due');
  });

  it('ends in the correct state when events arrive out of order', async () => {
    // Stripe canceled the subscription; the older "updated" event is delivered after "deleted".
    server.gateway.subscriptions.set('sub_1', subscription({ status: 'canceled' }));
    await server.deliver(subscriptionEvent('customer.subscription.deleted', 'canceled'));
    await server.deliver(subscriptionEvent('customer.subscription.updated', 'active'));
    await server.queue.drain();
    expect(server.store.currentSubscription(workspaceId)?.status).toBe('canceled');
  });

  it('processes a duplicate delivery only once', async () => {
    server.gateway.subscriptions.set('sub_1', subscription());
    const event = stripeEvent('invoice.paid', invoice(), 'evt_dup');
    await server.deliver(event);
    const second = await server.deliver(event);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    await server.queue.drain();

    const stored = server.store.event('evt_dup');
    expect(stored).toMatchObject({ status: 'processed', attempts: 1, deliveries: 2 });
    expect(server.gateway.callsTo('retrieveSubscription')).toHaveLength(1);
    expect(server.store.emailsForWorkspace(workspaceId)).toHaveLength(1);
  });

  it('sends one email when two different events describe the same failed payment', async () => {
    server.gateway.subscriptions.set('sub_1', subscription({ status: 'past_due' }));
    await server.deliver(stripeEvent('invoice.payment_failed', invoice(), 'evt_a'));
    await server.deliver(stripeEvent('invoice.payment_failed', invoice(), 'evt_b'));
    await server.queue.drain();
    const emails = server.store.emailsForWorkspace(workspaceId);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toBe('Payment failed (attempt 1)');
    expect(server.store.event('evt_b')?.detail).toBe('Synced subscription; email already sent');
  });

  it('emails again for the next retry attempt of the same invoice', async () => {
    server.gateway.subscriptions.set('sub_1', subscription({ status: 'past_due' }));
    await server.deliver(stripeEvent('invoice.payment_failed', invoice({ attempt_count: 1 })));
    await server.deliver(stripeEvent('invoice.payment_failed', invoice({ attempt_count: 2 })));
    await server.queue.drain();
    expect(server.store.emailsForWorkspace(workspaceId).map((e) => e.subject)).toEqual([
      'Payment failed (attempt 2)',
      'Payment failed (attempt 1)',
    ]);
  });

  it('records but ignores events for customers this app did not create', async () => {
    server.gateway.subscriptions.set('sub_other', subscription({ id: 'sub_other', customerId: 'cus_unknown' }));
    await server.deliver(
      stripeEvent('customer.subscription.updated', { id: 'sub_other', customer: 'cus_unknown' }, 'evt_x'),
    );
    await server.queue.drain();
    expect(server.store.event('evt_x')).toMatchObject({
      status: 'ignored',
      detail: 'Customer not created by this app',
    });
  });

  it('ignores event types it has no handler for', async () => {
    await server.deliver(stripeEvent('charge.refunded', { id: 'ch_1', customer: 'cus_1' }, 'evt_r'));
    await server.queue.drain();
    expect(server.store.event('evt_r')).toMatchObject({ status: 'ignored', detail: 'No handler for charge.refunded' });
  });

  it('ignores one-time payment checkouts', async () => {
    await server.deliver(
      stripeEvent('checkout.session.completed', { id: 'cs_1', mode: 'payment', customer: 'cus_1' }, 'evt_p'),
    );
    await server.queue.drain();
    expect(server.store.event('evt_p')?.status).toBe('ignored');
  });

  it('tracks the demo test clock', async () => {
    const clock = (type: string) =>
      stripeEvent(type, { id: 'clock_1', object: 'test_helpers.test_clock', frozen_time: 1_800_000_000 });
    await server.deliver(clock('test_helpers.test_clock.advancing'));
    await server.queue.drain();
    expect(server.store.workspace(workspaceId)?.clockStatus).toBe('advancing');
    await server.deliver(clock('test_helpers.test_clock.ready'));
    await server.queue.drain();
    expect(server.store.workspace(workspaceId)).toMatchObject({ clockStatus: 'ready', clockTime: 1_800_000_000 });
  });
});

describe('failures and retries', () => {
  it('retries when the Stripe API fails, and succeeds on a later attempt', async () => {
    server.gateway.subscriptions.set('sub_1', subscription());
    server.gateway.failRetrieves = 2;
    await server.deliver(subscriptionEvent('customer.subscription.updated', 'active', 'evt_retry'));
    await server.queue.drain();
    expect(server.store.event('evt_retry')).toMatchObject({ status: 'processed', attempts: 3 });
    expect(server.store.currentSubscription(workspaceId)?.status).toBe('active');
  });

  it('marks the event failed after the last attempt, and a replay processes it', async () => {
    server.gateway.subscriptions.set('sub_1', subscription());
    server.gateway.failRetrieves = 3;
    await server.deliver(subscriptionEvent('customer.subscription.updated', 'active', 'evt_dead'));
    await server.queue.drain();
    expect(server.store.event('evt_dead')).toMatchObject({
      status: 'failed',
      attempts: 3,
      detail: 'Stripe API unavailable',
    });

    const res = await server.api('/api/events/evt_dead/replay', { method: 'POST' });
    expect(res.status).toBe(202);
    await server.queue.drain();
    expect(server.store.event('evt_dead')).toMatchObject({ status: 'processed', attempts: 1 });
  });

  it('replaying a processed event does not repeat its side effects', async () => {
    server.gateway.subscriptions.set('sub_1', subscription());
    await server.deliver(stripeEvent('invoice.paid', invoice(), 'evt_paid'));
    await server.queue.drain();
    await server.api('/api/events/evt_paid/replay', { method: 'POST' });
    await server.queue.drain();
    expect(server.store.emailsForWorkspace(workspaceId)).toHaveLength(1);
    expect(server.store.event('evt_paid')?.detail).toBe('Synced subscription; email already sent');
  });

  it('only lets a workspace replay its own events', async () => {
    server.store.recordEvent(
      { id: 'evt_foreign', type: 'invoice.paid', workspaceId: 'someone-else', payload: '{}' },
      new Date(),
    );
    const res = await server.api('/api/events/evt_foreign/replay', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('before the webhook secret is configured', () => {
  it('answers 503 so Stripe retries later, and reports it in the health check', async () => {
    const unconfigured = await startTestServer({ webhooksConfigured: false });
    try {
      const res = await unconfigured.deliver(stripeEvent('invoice.paid', invoice()));
      expect(res.status).toBe(503);
      const health = await (await fetch(`${unconfigured.url}/api/health`)).json();
      expect(health).toMatchObject({ ok: true, webhooks: 'not_configured' });
    } finally {
      await unconfigured.close();
    }
  });
});
