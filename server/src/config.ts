import path from 'node:path';
import { z } from 'zod';

// Project root (stripe-billing/), so relative paths work no matter where a script is started from.
const ROOT = path.resolve(import.meta.dirname, '../..');

const EnvSchema = z.object({
  /** Secret (sk_) or restricted (rk_) key. Restricted keys are recommended for deployments. */
  STRIPE_SECRET_KEY: z
    .string({ error: 'is required. Add your sandbox key to .env (see .env.example).' })
    .regex(/^(sk|rk)_(test|live)_\w+$/, 'must be a Stripe secret (sk_) or restricted (rk_) key'),
  /**
   * Signing secret of the webhook endpoint. `npm run stripe:setup` writes the local one into .env.
   * Optional so a fresh deployment can start before its endpoint exists: until it is set, the
   * webhook route answers 503 and Stripe keeps retrying, so no event is lost.
   */
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_\w+$/, 'must start with whsec_')
    .optional(),
  /** Public URL of the web app. Checkout and the Customer Portal redirect back here. Defaults to Render's URL. */
  APP_URL: z.url().optional(),
  /** Set by Render for web services, e.g. https://myapp.onrender.com. */
  RENDER_EXTERNAL_URL: z.url().optional(),
  /**
   * Demo mode gives every visitor their own workspace on a Stripe test clock and shows the
   * demo controls (advance time, switch to a failing card). Refused with live keys.
   */
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().positive().default(3002),
  /** Requests per minute per IP on the billing endpoints. Webhooks are not limited. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  /** Number of reverse proxies in front of the app (1 on Render), so rate limiting sees client IPs. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DB_PATH: z.string().default('data/billing.db'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // Treat `PORT=` (empty) the same as not set, so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const demoMode = e.DEMO_MODE === 'true';
  const liveKey = /^(sk|rk)_live_/.test(e.STRIPE_SECRET_KEY);
  if (demoMode && liveKey) {
    throw new Error('Invalid configuration: DEMO_MODE=true is only allowed with sandbox (test) keys.');
  }
  const appUrl = (e.APP_URL ?? e.RENDER_EXTERNAL_URL ?? 'http://localhost:5174').replace(/\/+$/, '');

  return {
    stripeSecretKey: e.STRIPE_SECRET_KEY,
    stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET ?? null,
    appUrl,
    demoMode,
    port: e.PORT,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    trustProxy: e.TRUST_PROXY,
    /** Cookies get the Secure flag when the app is served over HTTPS. */
    secureCookies: appUrl.startsWith('https://'),
    dbPath: path.resolve(ROOT, e.DB_PATH),
    webDistDir: path.resolve(ROOT, 'web/dist'),
  };
}
