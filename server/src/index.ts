import { createApp } from './app.ts';
import { createStripeClient, createStripeGateway } from './billing/stripe-gateway.ts';
import { loadConfig } from './config.ts';
import { createJsonLogger } from './logger.ts';
import { Store } from './store.ts';
import { handleEvent } from './webhooks/handlers.ts';
import { WebhookQueue } from './webhooks/queue.ts';
import { createWebhookVerifier } from './webhooks/verify.ts';

const config = loadConfig();
const logger = createJsonLogger();
const now = () => new Date();

const store = new Store(config.dbPath);
const gateway = createStripeGateway(createStripeClient(config.stripeSecretKey));
await gateway.loadCatalog();

const queue = new WebhookQueue({ store, logger, handle: (event) => handleEvent(event, { store, gateway, now }) });
// Events that arrived before a restart and weren't processed yet are picked up here.
queue.kick();

const app = createApp({
  store,
  gateway,
  queue,
  verify: config.stripeWebhookSecret ? createWebhookVerifier(config.stripeWebhookSecret) : null,
  logger,
  now,
  appUrl: config.appUrl,
  demoMode: config.demoMode,
  secureCookies: config.secureCookies,
  rateLimitPerMinute: config.rateLimitPerMinute,
  trustProxy: config.trustProxy,
  webDistDir: config.webDistDir,
});

if (!config.stripeWebhookSecret) {
  logger.warn('webhooks.not_configured', {
    hint: 'Set STRIPE_WEBHOOK_SECRET. Until then webhooks get 503 and Stripe retries them later.',
  });
}

const server = app.listen(config.port, () => {
  logger.info('server.started', {
    url: `http://localhost:${config.port}`,
    appUrl: config.appUrl,
    demoMode: config.demoMode,
    stripeMode: config.stripeSecretKey.includes('_live_') ? 'live' : 'sandbox',
  });
});

// Finish in-flight requests and the current event, then exit. Unprocessed events stay in the database.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('server.stopping', { signal });
    queue.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
