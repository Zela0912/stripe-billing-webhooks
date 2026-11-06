import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { ApiErrorBody } from '../../shared/billing.ts';
import type { Logger } from './logger.ts';
import { serializeError } from './logger.ts';
import { type BillingRouteDeps, billingRouter } from './routes/billing.ts';
import { webhookRouter } from './routes/webhooks.ts';
import type { WebhookVerifier } from './webhooks/verify.ts';

export interface AppOptions extends BillingRouteDeps {
  /** Null until STRIPE_WEBHOOK_SECRET is set. */
  verify: WebhookVerifier | null;
  logger: Logger;
  rateLimitPerMinute: number;
  trustProxy: number;
  /** Built web client (web/dist). Served when present, so production is a single process. */
  webDistDir?: string;
}

export function createApp(options: AppOptions): express.Express {
  const { logger } = options;
  const app = express();

  app.disable('x-powered-by');
  if (options.trustProxy > 0) app.set('trust proxy', options.trustProxy);
  app.use(helmet());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, demoMode: options.demoMode, webhooks: options.verify ? 'configured' : 'not_configured' });
  });

  // Mounted before express.json(): signature verification needs the untouched raw body.
  // Not rate limited, because Stripe may legitimately send bursts.
  app.use(webhookRouter(options));

  app.use(express.json({ limit: '10kb' }));
  // Each action calls the Stripe API, so cap it per IP. A public demo link will get poked at.
  app.use(
    ['/api/billing', '/api/workspace', '/api/demo', '/api/events'],
    rateLimit({
      windowMs: 60_000,
      limit: options.rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a minute and try again.' } satisfies ApiErrorBody,
    }),
  );
  app.use(billingRouter(options));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' } satisfies ApiErrorBody);
  });

  const webDist = options.webDistDir;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // Express 5 forwards errors from async handlers here. Never leak internals to the client.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error('http.unhandled', { error: serializeError(err) });
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
    res.status(status).json({
      error: status === 500 ? 'Something went wrong. Please try again.' : 'Bad request',
    } satisfies ApiErrorBody);
  };
  app.use(errorHandler);

  return app;
}
