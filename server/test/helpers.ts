import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';
import { createApp } from '../src/app.ts';
import type { BillingGateway, SubscriptionSnapshot, TestCard } from '../src/billing/gateway.ts';
import { PaymentDeclinedError } from '../src/billing/gateway.ts';
import { silentLogger } from '../src/logger.ts';
import { Store } from '../src/store.ts';
import { handleEvent } from '../src/webhooks/handlers.ts';
import { WebhookQueue } from '../src/webhooks/queue.ts';
import { createWebhookVerifier } from '../src/webhooks/verify.ts';

export const WEBHOOK_SECRET = 'whsec_test_secret';
export const NOW = new Date('2026-11-06T12:00:00Z');

/** In-memory Stripe. Tests set the "current" state in `subscriptions` and inspect `calls`. */
export class FakeGateway implements BillingGateway {
  subscriptions = new Map<string, SubscriptionSnapshot>();
  calls: { method: string; args: unknown }[] = [];
  /** Next N retrieveSubscription calls throw, to simulate a Stripe outage. */
  failRetrieves = 0;
  declineNextPayment = false;
  private customers = new Map<string, string>(); // idempotency key -> customer id
  private clocks = new Map<string, string>();

  private record(method: string, args: unknown) {
    this.calls.push({ method, args });
  }

  callsTo(method: string) {
    return this.calls.filter((c) => c.method === method);
  }

  async createTestClock(name: string, idempotencyKey: string) {
    this.record('createTestClock', { name, idempotencyKey });
    const id = this.clocks.get(idempotencyKey) ?? `clock_${this.clocks.size + 1}`;
    this.clocks.set(idempotencyKey, id);
    return { id, frozenTime: NOW.getTime() / 1000, status: 'ready' };
  }

  async advanceTestClock(id: string, frozenTime: number) {
    this.record('advanceTestClock', { id, frozenTime });
  }

  async createCustomer(input: { workspaceId: string }, idempotencyKey: string) {
    this.record('createCustomer', { ...input, idempotencyKey });
    const id = this.customers.get(idempotencyKey) ?? `cus_${this.customers.size + 1}`;
    this.customers.set(idempotencyKey, id);
    return { id };
  }

  async createCheckoutSession(input: { lookupKey: string; quantity: number; customerId: string }) {
    this.record('createCheckoutSession', input);
    return { url: `https://checkout.stripe.test/${input.lookupKey}` };
  }

  async createPortalSession(input: { customerId: string }) {
    this.record('createPortalSession', input);
    return { url: 'https://billing.stripe.test/portal' };
  }

  async retrieveSubscription(id: string) {
    this.record('retrieveSubscription', { id });
    if (this.failRetrieves > 0) {
      this.failRetrieves--;
      throw new Error('Stripe API unavailable');
    }
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`No such subscription: ${id}`);
    return sub;
  }

  async updateQuantity(input: { subscriptionId: string; quantity: number }) {
    this.record('updateQuantity', input);
  }

  async payInvoice(invoiceId: string) {
    this.record('payInvoice', { invoiceId });
    if (this.declineNextPayment) {
      this.declineNextPayment = false;
      throw new PaymentDeclinedError('Your card was declined.');
    }
  }

  async setTestCard(input: { customerId: string; subscriptionId: string | null; card: TestCard }) {
    this.record('setTestCard', input);
  }
}

export function subscription(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    id: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    lookupKey: 'tidyshift_pro_monthly',
    itemId: 'si_1',
    quantity: 12,
    currentPeriodEnd: Date.parse('2026-12-06T12:00:00Z') / 1000,
    cancelAtPeriodEnd: false,
    latestInvoiceId: 'in_1',
    ...overrides,
  };
}

let eventCounter = 0;

/** A minimal Stripe event. Handlers only read the fields set here. */
export function stripeEvent(type: string, object: Record<string, unknown>, id = `evt_${++eventCounter}`) {
  return { id, object: 'event', type, created: NOW.getTime() / 1000, data: { object } };
}

export const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'in_1',
  object: 'invoice',
  customer: 'cus_1',
  currency: 'usd',
  amount_paid: 8400,
  amount_due: 8400,
  attempt_count: 1,
  next_payment_attempt: Date.parse('2026-11-08T12:00:00Z') / 1000,
  parent: { subscription_details: { subscription: 'sub_1' } },
  ...overrides,
});

const signer = new Stripe('sk_test_signing_only').webhooks;

export function signedHeader(payload: string, secret = WEBHOOK_SECRET) {
  return signer.generateTestHeaderString({ payload, secret });
}

export interface TestServer {
  url: string;
  store: Store;
  gateway: FakeGateway;
  queue: WebhookQueue;
  /** Posts a correctly signed webhook, exactly as Stripe would. */
  deliver(event: object): Promise<Response>;
  /** fetch with this test client's session cookie. */
  api(path: string, init?: RequestInit): Promise<Response>;
  /** Creates the visitor's workspace (as the first page load does) and returns its id. */
  visit(): Promise<string>;
  close(): Promise<void>;
}

export async function startTestServer(
  options: { demoMode?: boolean; maxAttempts?: number; webhooksConfigured?: boolean } = {},
): Promise<TestServer> {
  const store = new Store(':memory:');
  const gateway = new FakeGateway();
  const now = () => NOW;
  const queue = new WebhookQueue({
    store,
    logger: silentLogger,
    now,
    baseDelayMs: 0,
    maxAttempts: options.maxAttempts ?? 3,
    handle: (event) => handleEvent(event, { store, gateway, now }),
  });
  const app = createApp({
    store,
    gateway,
    queue,
    verify: options.webhooksConfigured === false ? null : createWebhookVerifier(WEBHOOK_SECRET),
    logger: silentLogger,
    now,
    appUrl: 'http://app.test',
    demoMode: options.demoMode ?? true,
    secureCookies: false,
    rateLimitPerMinute: 1000,
    trustProxy: 0,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';

  const api = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const res = await fetch(url + path, { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0] ?? '';
    return res;
  };

  return {
    url,
    store,
    gateway,
    queue,
    api,
    async visit() {
      const res = await api('/api/dashboard');
      const body = (await res.json()) as { workspace: { id: string } };
      return body.workspace.id;
    },
    async deliver(event) {
      const payload = JSON.stringify(event);
      return fetch(`${url}/api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signedHeader(payload) },
        body: payload,
      });
    },
    async close() {
      queue.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

/** Links the visitor's workspace to cus_1 / clock_1, as the first checkout would. */
export function linkCustomer(server: TestServer, workspaceId: string) {
  server.store.setStripeCustomer(workspaceId, 'cus_1', { id: 'clock_1', time: NOW.getTime() / 1000 });
}
