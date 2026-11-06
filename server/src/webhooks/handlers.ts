import type Stripe from 'stripe';
import type { BillingGateway } from '../billing/gateway.ts';
import type { Store, Workspace } from '../store.ts';

/** The events this app subscribes to. Used for the webhook endpoint and `stripe listen`. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'test_helpers.test_clock.advancing',
  'test_helpers.test_clock.ready',
] as const;

export interface HandlerDeps {
  store: Store;
  gateway: BillingGateway;
  now: () => Date;
}

export interface HandlerResult {
  outcome: 'processed' | 'ignored';
  detail: string | null;
}

const processed = (detail: string | null = null): HandlerResult => ({ outcome: 'processed', detail });
const ignored = (detail: string): HandlerResult => ({ outcome: 'ignored', detail });

const idOf = (ref: string | { id: string }) => (typeof ref === 'string' ? ref : ref.id);

/**
 * Applies one Stripe event to our database. Throwing means "try again later": the queue
 * retries with backoff, so a Stripe API hiccup never loses an event.
 *
 * Every handler must be safe to run twice. Subscription state is re-read from the Stripe
 * API instead of copied from the event, because events can arrive late or out of order:
 * whichever event is processed last, the stored state is the current one.
 */
export async function handleEvent(event: Stripe.Event, deps: HandlerDeps): Promise<HandlerResult> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription' || !session.subscription) return ignored('Not a subscription checkout');
      return syncSubscription(idOf(session.subscription), deps);
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return syncSubscription(event.data.object.id, deps);

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subscription = invoice.parent?.subscription_details?.subscription;
      if (!subscription) return ignored('Invoice is not for a subscription');
      const result = await syncSubscription(idOf(subscription), deps);
      if (result.outcome === 'ignored') return result;

      const workspace = invoice.customer ? deps.store.workspaceByCustomer(idOf(invoice.customer)) : null;
      if (!workspace) return result;
      const email =
        event.type === 'invoice.paid' ? receiptEmail(invoice, workspace) : paymentFailedEmail(invoice, workspace);
      // Keyed on the invoice (and attempt), not the event: Stripe can send two different
      // events about the same payment, and the customer must still get one email.
      const sent = deps.store.sendEmail({ ...email, workspaceId: workspace.id, eventId: event.id }, deps.now());
      return processed(
        sent ? `Synced subscription; emailed "${email.subject}"` : 'Synced subscription; email already sent',
      );
    }

    case 'test_helpers.test_clock.advancing':
    case 'test_helpers.test_clock.ready': {
      const clock = event.data.object;
      const workspace = deps.store.workspaceByTestClock(clock.id);
      if (!workspace) return ignored('Test clock not created by this app');
      const ready = event.type === 'test_helpers.test_clock.ready';
      deps.store.setClock(workspace.id, { time: clock.frozen_time, status: ready ? 'ready' : 'advancing' });
      return processed(ready ? 'Test clock reached its target time' : 'Test clock is advancing');
    }

    default:
      return ignored(`No handler for ${event.type}`);
  }
}

async function syncSubscription(subscriptionId: string, deps: HandlerDeps): Promise<HandlerResult> {
  const snapshot = await deps.gateway.retrieveSubscription(subscriptionId);
  const workspace = deps.store.workspaceByCustomer(snapshot.customerId);
  // Events for customers this app didn't create (another integration on the same account,
  // `stripe trigger` fixtures) are recorded and skipped.
  if (!workspace) return ignored('Customer not created by this app');
  deps.store.upsertSubscription({ ...snapshot, workspaceId: workspace.id }, deps.now());
  return processed(`Synced subscription: ${snapshot.status}`);
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

function receiptEmail(invoice: Stripe.Invoice, workspace: Workspace) {
  return {
    dedupeKey: `receipt:${invoice.id}`,
    to: workspace.billingEmail,
    subject: `Receipt for ${money(invoice.amount_paid, invoice.currency)}`,
    body: `Thanks! We received ${money(invoice.amount_paid, invoice.currency)} for ${workspace.name}. The invoice is available under Settings › Billing › Invoices.`,
  };
}

function paymentFailedEmail(invoice: Stripe.Invoice, workspace: Workspace) {
  const next = invoice.next_payment_attempt
    ? `We'll try again on ${new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
    : 'There are no automatic retries left.';
  return {
    dedupeKey: `payment_failed:${invoice.id}:${invoice.attempt_count}`,
    to: workspace.billingEmail,
    subject: `Payment failed (attempt ${invoice.attempt_count})`,
    body: `We couldn't charge ${money(invoice.amount_due, invoice.currency)} for ${workspace.name}. ${next} Update your card under Settings › Billing to keep full access.`,
  };
}
