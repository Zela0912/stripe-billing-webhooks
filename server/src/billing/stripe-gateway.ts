import Stripe from 'stripe';
import { INTERVALS, lookupKey, PAID_PLANS } from '../../../shared/billing.ts';
import { type BillingGateway, PaymentDeclinedError, type SubscriptionSnapshot, type TestCard } from './gateway.ts';

/** Marks the Customer Portal configuration that `npm run stripe:setup` manages. */
export const PORTAL_CONFIG_APP = 'tidyshift-billing';

export const ALL_LOOKUP_KEYS = PAID_PLANS.flatMap((plan) => INTERVALS.map((interval) => lookupKey(plan, interval)));

// Stripe's built-in test PaymentMethods (docs.stripe.com/testing, checked 2026-11-06).
const TEST_PAYMENT_METHODS: Record<TestCard, string> = {
  working: 'pm_card_visa',
  // Attaches to the customer fine, then every charge is declined: a failed renewal.
  failing: 'pm_card_chargeCustomerFail',
};

export function createStripeClient(secretKey: string): Stripe {
  // The SDK retries network errors and adds an idempotency key to each retried POST.
  return new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: 'tidyshift-billing' } });
}

export interface StripeGateway extends BillingGateway {
  /** Resolves price ids and the portal configuration. Fails fast if `npm run stripe:setup` hasn't run. */
  loadCatalog(): Promise<void>;
}

export function createStripeGateway(stripe: Stripe): StripeGateway {
  const priceIds = new Map<string, string>();
  let portalConfigurationId: string | null = null;

  const priceId = (key: string) => {
    const id = priceIds.get(key);
    if (!id) throw new Error(`Unknown price lookup key ${key}. Run \`npm run stripe:setup\`.`);
    return id;
  };

  return {
    async loadCatalog() {
      const prices = await stripe.prices.list({ lookup_keys: ALL_LOOKUP_KEYS, active: true, limit: 10 });
      for (const price of prices.data) {
        if (price.lookup_key) priceIds.set(price.lookup_key, price.id);
      }
      const missing = ALL_LOOKUP_KEYS.filter((key) => !priceIds.has(key));
      if (missing.length > 0) {
        throw new Error(`Stripe prices missing (${missing.join(', ')}). Run \`npm run stripe:setup\` first.`);
      }
      const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
      portalConfigurationId = configs.data.find((c) => c.metadata?.app === PORTAL_CONFIG_APP)?.id ?? null;
      if (!portalConfigurationId) {
        throw new Error('Customer Portal configuration missing. Run `npm run stripe:setup` first.');
      }
    },

    async createTestClock(name, idempotencyKey) {
      const clock = await stripe.testHelpers.testClocks.create(
        { frozen_time: Math.floor(Date.now() / 1000), name },
        { idempotencyKey },
      );
      return { id: clock.id, frozenTime: clock.frozen_time, status: clock.status };
    },

    async advanceTestClock(id, frozenTime) {
      await stripe.testHelpers.testClocks.advance(id, { frozen_time: frozenTime });
    },

    async createCustomer({ workspaceId, name, email, testClockId }, idempotencyKey) {
      const customer = await stripe.customers.create(
        { name, email, metadata: { workspace_id: workspaceId }, ...(testClockId ? { test_clock: testClockId } : {}) },
        { idempotencyKey },
      );
      return { id: customer.id };
    },

    async createCheckoutSession({ customerId, workspaceId, lookupKey: key, quantity, successUrl, cancelUrl }) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        // The app is in English, so Stripe's pages are too (the default follows the browser).
        locale: 'en',
        customer: customerId,
        client_reference_id: workspaceId,
        line_items: [{ price: priceId(key), quantity }],
        subscription_data: { metadata: { workspace_id: workspaceId } },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error('Stripe returned a Checkout Session without a URL');
      return { url: session.url };
    },

    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        locale: 'en',
        return_url: returnUrl,
        ...(portalConfigurationId ? { configuration: portalConfigurationId } : {}),
      });
      return { url: session.url };
    },

    async retrieveSubscription(id) {
      return toSnapshot(await stripe.subscriptions.retrieve(id));
    },

    async updateQuantity({ subscriptionId, itemId, quantity }) {
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, quantity }],
        // Extra employees are charged pro rata on the next invoice.
        proration_behavior: 'create_prorations',
      });
    },

    async payInvoice(invoiceId) {
      try {
        await stripe.invoices.pay(invoiceId);
      } catch (err) {
        if (err instanceof Stripe.errors.StripeCardError) throw new PaymentDeclinedError(err.message);
        throw err;
      }
    },

    async setTestCard({ customerId, subscriptionId, card }) {
      const pm = await stripe.paymentMethods.attach(TEST_PAYMENT_METHODS[card], { customer: customerId });
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
      // Checkout sets the card on the subscription itself, which takes precedence over the customer default.
      if (subscriptionId) await stripe.subscriptions.update(subscriptionId, { default_payment_method: pm.id });
    },
  };
}

function toSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot {
  // Since API version 2025-03-31, billing periods live on subscription items.
  const item = sub.items.data[0];
  return {
    id: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status: sub.status,
    lookupKey: item?.price.lookup_key ?? null,
    itemId: item?.id ?? null,
    quantity: item?.quantity ?? 1,
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
    latestInvoiceId: typeof sub.latest_invoice === 'string' ? sub.latest_invoice : (sub.latest_invoice?.id ?? null),
  };
}
