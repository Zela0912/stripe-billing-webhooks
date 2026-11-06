/**
 * Checks that a (restricted) API key can do everything this app does, before you deploy it.
 *
 *   npm run stripe:check-key      reads STRIPE_SECRET_KEY from .env.production.local
 *
 * Runs each operation the app uses against the sandbox, on a throwaway test clock that is
 * deleted at the end, and prints which permission is missing if one fails. Sandbox only.
 */
import Stripe from 'stripe';
import { lookupKey } from '../../shared/billing.ts';
import { ALL_LOOKUP_KEYS, createStripeClient } from '../src/billing/stripe-gateway.ts';

const key = process.env.STRIPE_SECRET_KEY;
if (!key || !/^(rk|sk)_test_/.test(key)) {
  console.error('Put the sandbox key to check in .env.production.local as STRIPE_SECRET_KEY=rk_test_…');
  process.exit(1);
}
const stripe = createStripeClient(key);
console.log(`Checking a ${key.startsWith('rk_') ? 'restricted' : 'secret'} key (sandbox)\n`);

let failures = 0;

/** Runs one step. A permission error means the key lacks access; other API errors still prove access. */
async function check<T>(permission: string, what: string, run: () => Promise<T>, okOnApiError = false) {
  try {
    const result = await run();
    console.log(`  ✓ ${what.padEnd(44)} ${permission}`);
    return result;
  } catch (err) {
    if (okOnApiError && err instanceof Stripe.errors.StripeInvalidRequestError) {
      console.log(`  ✓ ${what.padEnd(44)} ${permission}`);
      return null;
    }
    failures++;
    const reason = err instanceof Stripe.errors.StripePermissionError ? 'missing permission' : String(err);
    console.log(`  ✗ ${what.padEnd(44)} ${permission}  ← ${reason}`);
    return null;
  }
}

const prices = await check('Prices: Read', 'Read prices by lookup key', () =>
  stripe.prices.list({ lookup_keys: ALL_LOOKUP_KEYS, active: true, limit: 10 }),
);
const price = prices?.data.find((p) => p.lookup_key === lookupKey('starter', 'month'));
await check('Customer portal: Read', 'Find the portal configuration', () =>
  stripe.billingPortal.configurations.list({ active: true, limit: 10 }),
);
const clock = await check('Test clocks: Write', 'Create a test clock', () =>
  stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: 'key check' }),
);

if (clock && price) {
  const customer = await check('Customers: Write', 'Create a customer on the clock', () =>
    stripe.customers.create({ name: 'Key check', test_clock: clock.id, metadata: { purpose: 'key-check' } }),
  );
  if (customer) {
    await check('Checkout Sessions: Write', 'Create a Checkout Session', () =>
      stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customer.id,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    );
    await check('Customer portal: Write', 'Create a Customer Portal session', () =>
      stripe.billingPortal.sessions.create({ customer: customer.id, return_url: 'https://example.com' }),
    );
    const pm = await check('PaymentMethods: Write', 'Attach a test card', () =>
      stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id }),
    );
    if (pm) {
      await check('Customers: Write', 'Set the default card', () =>
        stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } }),
      );
      const sub = await check('Subscriptions: Write', 'Create a subscription', () =>
        stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id, quantity: 1 }] }),
      );
      if (sub) {
        await check('Subscriptions: Read', 'Retrieve the subscription', () => stripe.subscriptions.retrieve(sub.id));
        const itemId = sub.items.data[0]?.id;
        if (itemId) {
          await check('Subscriptions: Write', 'Change the seat count', () =>
            stripe.subscriptions.update(sub.id, {
              items: [{ id: itemId, quantity: 2 }],
              proration_behavior: 'none',
            }),
          );
        }
        const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
        // Paying an already-paid invoice is rejected as an invalid request, which proves the
        // key may call the endpoint; a missing permission is a different error.
        if (invoiceId) {
          await check('Invoices: Write', 'Pay an invoice ("Pay now")', () => stripe.invoices.pay(invoiceId), true);
        }
      }
    }
  }
  await check('Test clocks: Write', 'Advance the test clock', () =>
    stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: clock.frozen_time + 3600 }),
  );
  // Advancing is asynchronous; a clock can only be deleted once it is ready again.
  for (let i = 0; i < 60; i++) {
    const current = await stripe.testHelpers.testClocks.retrieve(clock.id).catch(() => null);
    if (current?.status !== 'advancing') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Deleting the clock deletes its customer and subscription too.
  await check('Test clocks: Write', 'Clean up (delete the test clock)', () =>
    stripe.testHelpers.testClocks.del(clock.id),
  );
}

console.log(failures === 0 ? '\nThe key has every permission the app needs.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
