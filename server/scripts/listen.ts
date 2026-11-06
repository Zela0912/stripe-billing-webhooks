/**
 * Forwards sandbox webhooks to the local server through the Stripe CLI.
 * Uses the key from .env, so no `stripe login` is needed.
 */
import { spawn } from 'node:child_process';
import { HANDLED_EVENTS } from '../src/webhooks/handlers.ts';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is missing in .env.');
  process.exit(1);
}
const port = process.env.PORT || '3002';

const child = spawn(
  'stripe',
  ['listen', '--events', HANDLED_EVENTS.join(','), '--forward-to', `http://localhost:${port}/api/webhooks/stripe`],
  // The key goes in the environment, not the command line, so it doesn't show up in `ps`.
  { stdio: 'inherit', env: { ...process.env, STRIPE_API_KEY: key } },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
