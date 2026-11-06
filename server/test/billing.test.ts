import { afterEach, describe, expect, it } from 'vitest';
import type { Dashboard } from '../../shared/billing.ts';
import { linkCustomer, NOW, startTestServer, subscription, type TestServer } from './helpers.ts';

let server: TestServer;
afterEach(() => server?.close());

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });

describe('session', () => {
  it('creates a workspace on the first visit and keeps it in an HttpOnly cookie', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.url}/api/dashboard`);
    expect(res.headers.get('set-cookie')).toMatch(/^tidyshift_ws=[0-9a-f-]{36}; Path=\/; HttpOnly; SameSite=Lax/);
    const body = (await res.json()) as Dashboard;
    expect(body.workspace).toMatchObject({ employees: 12, plan: 'free', access: 'read_only' });

    const first = await server.visit();
    expect(await server.visit()).toBe(first);
  });

  it('refuses actions without a session', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.url}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', interval: 'month' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('checkout', () => {
  it('creates one customer on a test clock and bills one seat per employee', async () => {
    server = await startTestServer();
    await server.visit();
    const res = await server.api('/api/billing/checkout', json({ plan: 'pro', interval: 'year' }));
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/tidyshift_pro_yearly' });
    expect(server.gateway.callsTo('createTestClock')).toHaveLength(1);
    expect(server.gateway.callsTo('createCheckoutSession')[0]?.args).toMatchObject({
      quantity: 12,
      lookupKey: 'tidyshift_pro_yearly',
    });

    // A second click reuses the customer instead of creating another one.
    await server.api('/api/billing/checkout', json({ plan: 'pro', interval: 'year' }));
    expect(server.gateway.callsTo('createCustomer')).toHaveLength(1);
  });

  it('passes an idempotency key, so concurrent first clicks create one customer', async () => {
    server = await startTestServer();
    const id = await server.visit();
    await Promise.all([
      server.api('/api/billing/checkout', json({ plan: 'starter', interval: 'month' })),
      server.api('/api/billing/checkout', json({ plan: 'starter', interval: 'month' })),
    ]);
    const keys = server.gateway
      .callsTo('createCustomer')
      .map((c) => (c.args as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys)).toEqual(new Set([`customer-${id}`]));
  });

  it('does not create test clocks outside demo mode', async () => {
    server = await startTestServer({ demoMode: false });
    await server.visit();
    await server.api('/api/billing/checkout', json({ plan: 'pro', interval: 'month' }));
    expect(server.gateway.callsTo('createTestClock')).toHaveLength(0);
    expect(server.gateway.callsTo('createCustomer')[0]?.args).toMatchObject({ testClockId: null });
  });

  it('refuses a second subscription for the same workspace', async () => {
    server = await startTestServer();
    const id = await server.visit();
    linkCustomer(server, id);
    server.store.upsertSubscription({ ...subscription({ status: 'past_due' }), workspaceId: id }, NOW);
    const res = await server.api('/api/billing/checkout', json({ plan: 'starter', interval: 'month' }));
    expect(res.status).toBe(409);
  });

  it('validates the plan and interval', async () => {
    server = await startTestServer();
    await server.visit();
    const res = await server.api('/api/billing/checkout', json({ plan: 'enterprise', interval: 'month' }));
    expect(res.status).toBe(400);
  });
});

describe('subscription management', () => {
  async function subscribed(status = 'active') {
    server = await startTestServer();
    const id = await server.visit();
    linkCustomer(server, id);
    server.store.upsertSubscription({ ...subscription({ status }), workspaceId: id }, NOW);
    return id;
  }

  it('opens the Customer Portal for the workspace customer', async () => {
    await subscribed();
    const res = await server.api('/api/billing/portal', { method: 'POST' });
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.test/portal' });
    expect(server.gateway.callsTo('createPortalSession')[0]?.args).toMatchObject({ customerId: 'cus_1' });
  });

  it('pays the open invoice on "Pay now", and reports a decline', async () => {
    await subscribed('past_due');
    server.gateway.declineNextPayment = true;
    const declined = await server.api('/api/billing/retry-payment', { method: 'POST' });
    expect(declined.status).toBe(402);
    const ok = await server.api('/api/billing/retry-payment', { method: 'POST' });
    expect(ok.status).toBe(202);
    expect(server.gateway.callsTo('payInvoice').at(-1)?.args).toEqual({ invoiceId: 'in_1' });
  });

  it('refuses "Pay now" when nothing failed', async () => {
    await subscribed('active');
    const res = await server.api('/api/billing/retry-payment', { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('updates the seat count in Stripe when employees change', async () => {
    const id = await subscribed();
    await server.api('/api/workspace/employees', put({ employees: 15 }));
    expect(server.gateway.callsTo('updateQuantity')[0]?.args).toMatchObject({ subscriptionId: 'sub_1', quantity: 15 });
    expect(server.store.workspace(id)?.employees).toBe(15);
    expect((await server.api('/api/workspace/employees', put({ employees: 0 }))).status).toBe(400);
  });

  it('changes employees without Stripe when there is no subscription', async () => {
    server = await startTestServer();
    const id = await server.visit();
    await server.api('/api/workspace/employees', put({ employees: 9 }));
    expect(server.gateway.callsTo('updateQuantity')).toHaveLength(0);
    const body = (await (await server.api('/api/dashboard')).json()) as Dashboard;
    expect(body.workspace).toMatchObject({ id, employees: 9, access: 'full' });
  });
});

describe('demo controls', () => {
  it('advances the test clock just past the renewal date', async () => {
    server = await startTestServer();
    const id = await server.visit();
    linkCustomer(server, id);
    server.store.upsertSubscription({ ...subscription(), workspaceId: id }, NOW);
    const res = await server.api('/api/demo/advance-to-renewal', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(server.gateway.callsTo('advanceTestClock')[0]?.args).toEqual({
      id: 'clock_1',
      frozenTime: Date.parse('2026-12-06T12:00:00Z') / 1000 + 3600,
    });
    expect(server.store.workspace(id)?.clockStatus).toBe('advancing');
    expect((await server.api('/api/demo/advance-to-renewal', { method: 'POST' })).status).toBe(409);
  });

  it('switches the test card', async () => {
    server = await startTestServer();
    const id = await server.visit();
    linkCustomer(server, id);
    await server.api('/api/demo/card', put({ card: 'failing' }));
    expect(server.store.workspace(id)?.demoCard).toBe('failing');
  });

  it('is not available outside demo mode', async () => {
    server = await startTestServer({ demoMode: false });
    const id = await server.visit();
    linkCustomer(server, id);
    expect((await server.api('/api/demo/advance-to-renewal', { method: 'POST' })).status).toBe(404);
    const body = (await (await server.api('/api/dashboard')).json()) as Dashboard;
    expect(body.workspace.demo).toBeNull();
  });
});
