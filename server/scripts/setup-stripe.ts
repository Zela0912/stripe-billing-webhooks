/**
 * Creates or updates everything the app needs in Stripe. Safe to run any number of times.
 *
 *   npm run stripe:setup                         products, prices, Customer Portal, and the
 *                                                local webhook secret (written into .env)
 *   npm run stripe:setup -- --webhook-url=URL    also creates a webhook endpoint for a deployment
 *                                                and saves its signing secret to .env.production.local
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type Stripe from 'stripe';
import { INTERVALS, lookupKey, PAID_PLANS, PLANS, seatPriceCents } from '../../shared/billing.ts';
import { createStripeClient, PORTAL_CONFIG_APP } from '../src/billing/stripe-gateway.ts';
import { HANDLED_EVENTS } from '../src/webhooks/handlers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_')) {
  console.error('STRIPE_SECRET_KEY (sk_test_…) is missing in .env.');
  process.exit(1);
}
const stripe = createStripeClient(key);
const webhookUrl = process.argv.find((a) => a.startsWith('--webhook-url='))?.split('=')[1];

// ---- products and prices ------------------------------------------------------------------

const productIds: Record<string, string> = {};
const pricesByProduct: Record<string, string[]> = {};

for (const plan of PAID_PLANS) {
  // A fixed product id makes this idempotent without searching.
  const id = `tidyshift_${plan}`;
  const product = await stripe.products.retrieve(id).catch(() => null);
  const fields = {
    name: `TidyShift ${PLANS[plan].name}`,
    description: `${PLANS[plan].tagline}. Billed per active employee.`,
    unit_label: 'employee',
  };
  if (product) await stripe.products.update(id, { ...fields, active: true });
  else await stripe.products.create({ id, ...fields });
  productIds[plan] = id;
  pricesByProduct[id] = [];

  for (const interval of INTERVALS) {
    const lookup = lookupKey(plan, interval);
    const amount = seatPriceCents(plan, interval);
    const existing = (await stripe.prices.list({ lookup_keys: [lookup], limit: 1 })).data[0];
    let price: Stripe.Price;
    if (existing?.active && existing.unit_amount === amount && existing.recurring?.interval === interval) {
      price = existing;
    } else {
      // Prices are immutable. A changed amount gets a new price that takes over the lookup key,
      // so existing subscribers keep their old price and new ones get the new one.
      price = await stripe.prices.create({
        product: id,
        currency: 'usd',
        unit_amount: amount,
        recurring: { interval },
        lookup_key: lookup,
        transfer_lookup_key: true,
        nickname: `${PLANS[plan].name} ${interval === 'month' ? 'monthly' : 'yearly'}`,
      });
    }
    pricesByProduct[id]?.push(price.id);
    console.log(`price   ${lookup.padEnd(24)} ${price.id}  $${(amount / 100).toFixed(2)} per employee / ${interval}`);
  }
}

// ---- Customer Portal ------------------------------------------------------------------------

const portalFeatures: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address', 'tax_id'] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end' },
  subscription_update: {
    enabled: true,
    // Seat count follows the number of employees in the app, so customers only change the plan.
    default_allowed_updates: ['price'],
    // Upgrades apply now and charge the difference right away; downgrades wait for the period end.
    proration_behavior: 'always_invoice',
    schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },
    products: Object.entries(pricesByProduct).map(([product, prices]) => ({ product, prices })),
  },
};
const businessProfile = { headline: 'TidyShift: manage your plan, card and invoices' };
const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
const current = configs.data.find((c) => c.metadata?.app === PORTAL_CONFIG_APP);
const portal = current
  ? await stripe.billingPortal.configurations.update(current.id, {
      features: portalFeatures,
      business_profile: businessProfile,
    })
  : await stripe.billingPortal.configurations.create({
      features: portalFeatures,
      business_profile: businessProfile,
      metadata: { app: PORTAL_CONFIG_APP },
    });
console.log(`portal  ${portal.id}`);

// ---- webhooks -------------------------------------------------------------------------------

/** Sets KEY=value in an env file, keeping every other line as it is. */
function setEnv(file: string, name: string, value: string) {
  const full = path.join(ROOT, file);
  const lines = existsSync(full) ? readFileSync(full, 'utf8').split('\n') : [];
  const index = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (index >= 0) lines[index] = `${name}=${value}`;
  else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
  writeFileSync(full, `${lines.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
}

if (webhookUrl) {
  const endpoint = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: [...HANDLED_EVENTS],
    description: 'TidyShift billing',
  });
  // Stripe shows the signing secret only once, at creation. It goes to a git-ignored file,
  // never to the terminal, so it doesn't end up in logs or screenshots.
  if (endpoint.secret) setEnv('.env.production.local', 'STRIPE_WEBHOOK_SECRET', endpoint.secret);
  console.log(`webhook ${endpoint.id} → ${webhookUrl}`);
  console.log('        signing secret saved to .env.production.local (copy it into your host’s settings)');
} else {
  // The Stripe CLI's local secret stays the same across `stripe listen` restarts.
  const secret = execFileSync('stripe', ['listen', '--print-secret'], {
    encoding: 'utf8',
    env: { ...process.env, STRIPE_API_KEY: key },
  }).trim();
  if (!secret.startsWith('whsec_')) throw new Error('Could not read the local webhook secret from the Stripe CLI');
  setEnv('.env', 'STRIPE_WEBHOOK_SECRET', secret);
  console.log('webhook local signing secret saved to .env (used by `stripe listen` in `npm run dev`)');
}
console.log('\nStripe is ready.');
