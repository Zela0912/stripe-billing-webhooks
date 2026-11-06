import express from 'express';
import type Stripe from 'stripe';
import type { ApiErrorBody } from '../../../shared/billing.ts';
import type { Logger } from '../logger.ts';
import type { Store } from '../store.ts';
import type { WebhookQueue } from '../webhooks/queue.ts';
import { InvalidSignatureError, type WebhookVerifier } from '../webhooks/verify.ts';

export interface WebhookRouteDeps {
  store: Store;
  queue: WebhookQueue;
  verify: WebhookVerifier;
  logger: Logger;
  now: () => Date;
}

export const WEBHOOK_PATH = '/api/webhooks/stripe';

/**
 * Verify, store, acknowledge. Nothing slow happens before the 2xx: the queue does the work.
 * The body parser is express.raw because the signature covers the exact bytes Stripe sent.
 */
export function webhookRouter(deps: WebhookRouteDeps): express.Router {
  const router = express.Router();

  router.post(WEBHOOK_PATH, express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) {
      res.status(400).json({ error: 'Expected a JSON body' } satisfies ApiErrorBody);
      return;
    }

    let event: Stripe.Event;
    try {
      event = deps.verify(body, req.header('stripe-signature'));
    } catch (err) {
      if (!(err instanceof InvalidSignatureError)) throw err;
      deps.logger.warn('webhook.rejected', { reason: err.message });
      res.status(400).json({ error: 'Invalid signature' } satisfies ApiErrorBody);
      return;
    }

    const isNew = deps.store.recordEvent(
      {
        id: event.id,
        type: event.type,
        workspaceId: workspaceIdFor(event, deps.store),
        payload: body.toString('utf8'),
      },
      deps.now(),
    );
    deps.logger.info('webhook.received', { eventId: event.id, type: event.type, duplicate: !isNew });
    res.json({ received: true, duplicate: !isNew });
    if (isNew) deps.queue.kick();
  });

  return router;
}

/** Links an event to a workspace so the dashboard can show each visitor only their own events. */
function workspaceIdFor(event: Stripe.Event, store: Store): string | null {
  const object: unknown = event.data.object;
  if (typeof object !== 'object' || object === null) return null;
  const record = object as Record<string, unknown>;
  if (record.object === 'test_helpers.test_clock' && typeof record.id === 'string') {
    return store.workspaceByTestClock(record.id)?.id ?? null;
  }
  const customer = record.customer;
  const customerId =
    typeof customer === 'string'
      ? customer
      : typeof customer === 'object' && customer !== null && 'id' in customer && typeof customer.id === 'string'
        ? customer.id
        : null;
  return customerId ? (store.workspaceByCustomer(customerId)?.id ?? null) : null;
}
