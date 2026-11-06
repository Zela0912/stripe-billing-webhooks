import {
  type BillingInterval,
  type Dashboard,
  lookupKey,
  type PaidPlanId,
  parseLookupKey,
  type WorkspaceView,
} from '../../../shared/billing.ts';
import type { Store, Workspace } from '../store.ts';
import { accessFor, isLiveSubscription } from './access.ts';
import type { BillingGateway, TestCard } from './gateway.ts';

export class AppError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface BillingDeps {
  store: Store;
  gateway: BillingGateway;
  appUrl: string;
  demoMode: boolean;
  now: () => Date;
}

// No trailing periods: the names appear mid-sentence in emails.
const DEMO_NAMES = ['Harbor Coffee', 'Northside Bakery', 'Green Fork Bistro', 'Lumen Fitness', 'Pine Street Pharmacy'];

/** Creates the workspace a new visitor sees: a small business with 12 employees, on the Free plan. */
export function createDemoWorkspace(deps: BillingDeps, id: string): Workspace {
  const name = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)] ?? 'Demo Workspace';
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
  return deps.store.createWorkspace({ id, name, billingEmail: `billing@${slug}.example`, employees: 12 }, deps.now());
}

/**
 * Creates the Stripe customer on first checkout, not on page load, so bots and quick
 * visitors don't create objects in Stripe. The idempotency key makes a double click (or two
 * tabs) end up with one customer, not two.
 */
async function ensureCustomer(ws: Workspace, deps: BillingDeps): Promise<string> {
  if (ws.stripeCustomerId) return ws.stripeCustomerId;
  const clock = deps.demoMode ? await deps.gateway.createTestClock(ws.name, `clock-${ws.id}`) : null;
  const customer = await deps.gateway.createCustomer(
    { workspaceId: ws.id, name: ws.name, email: ws.billingEmail, testClockId: clock?.id ?? null },
    `customer-${ws.id}`,
  );
  deps.store.setStripeCustomer(ws.id, customer.id, clock ? { id: clock.id, time: clock.frozenTime } : null);
  return customer.id;
}

export async function startCheckout(
  ws: Workspace,
  input: { plan: PaidPlanId; interval: BillingInterval },
  deps: BillingDeps,
): Promise<string> {
  if (isLiveSubscription(deps.store.currentSubscription(ws.id)?.status)) {
    throw new AppError(409, 'This workspace already has a subscription. Use “Manage billing” to change it.');
  }
  const customerId = await ensureCustomer(ws, deps);
  const { url } = await deps.gateway.createCheckoutSession({
    customerId,
    workspaceId: ws.id,
    lookupKey: lookupKey(input.plan, input.interval),
    quantity: ws.employees,
    // The redirect only tells the UI to start waiting. Access is granted by the verified
    // webhook, because anyone can open a success URL.
    successUrl: `${deps.appUrl}/?checkout=success`,
    cancelUrl: `${deps.appUrl}/?checkout=canceled`,
  });
  return url;
}

export async function openPortal(ws: Workspace, deps: BillingDeps): Promise<string> {
  if (!ws.stripeCustomerId) throw new AppError(409, 'Subscribe to a plan first.');
  const { url } = await deps.gateway.createPortalSession({ customerId: ws.stripeCustomerId, returnUrl: deps.appUrl });
  return url;
}

/** "Pay now" for a failed invoice. The resulting invoice.paid webhook restores access. */
export async function retryPayment(ws: Workspace, deps: BillingDeps): Promise<void> {
  const sub = deps.store.currentSubscription(ws.id);
  if (!sub?.latestInvoiceId || !(sub.status === 'past_due' || sub.status === 'unpaid')) {
    throw new AppError(409, 'There is no failed payment to retry.');
  }
  await deps.gateway.payInvoice(sub.latestInvoiceId);
}

export async function setEmployees(ws: Workspace, employees: number, deps: BillingDeps): Promise<void> {
  const sub = deps.store.currentSubscription(ws.id);
  // Seats are billed per employee, so the subscription quantity follows the head count.
  // Stripe confirms the change with customer.subscription.updated, which re-syncs our copy.
  if (sub?.itemId && isLiveSubscription(sub.status) && sub.status !== 'incomplete') {
    await deps.gateway.updateQuantity({ subscriptionId: sub.id, itemId: sub.itemId, quantity: employees });
  }
  deps.store.setEmployees(ws.id, employees);
}

// ---- demo controls ----------------------------------------------------------------------

function requireDemo(ws: Workspace, deps: BillingDeps): { clockId: string; customerId: string } {
  if (!deps.demoMode) throw new AppError(404, 'Not found');
  if (!ws.testClockId || !ws.stripeCustomerId) throw new AppError(409, 'Subscribe to a plan first.');
  return { clockId: ws.testClockId, customerId: ws.stripeCustomerId };
}

/** Moves the workspace's test clock just past the next renewal, so Stripe bills it now. */
export async function advanceToRenewal(ws: Workspace, deps: BillingDeps): Promise<void> {
  const { clockId } = requireDemo(ws, deps);
  if (ws.clockStatus === 'advancing') throw new AppError(409, 'The clock is already advancing.');
  const sub = deps.store.currentSubscription(ws.id);
  const from = sub?.currentPeriodEnd ?? ws.clockTime;
  if (from === null) throw new AppError(409, 'Nothing to renew yet.');
  // One hour past the period end lets Stripe finalize and attempt the renewal invoice.
  const target = Math.max(from, ws.clockTime ?? 0) + 3600;
  await deps.gateway.advanceTestClock(clockId, target);
  deps.store.setClock(ws.id, { status: 'advancing' });
}

export async function useTestCard(ws: Workspace, card: TestCard, deps: BillingDeps): Promise<void> {
  const { customerId } = requireDemo(ws, deps);
  const sub = deps.store.currentSubscription(ws.id);
  await deps.gateway.setTestCard({ customerId, subscriptionId: sub?.id ?? null, card });
  deps.store.setDemoCard(ws.id, card);
}

// ---- views ------------------------------------------------------------------------------

const iso = (unixSeconds: number | null) => (unixSeconds === null ? null : new Date(unixSeconds * 1000).toISOString());

export function workspaceView(ws: Workspace, deps: BillingDeps): WorkspaceView {
  const sub = deps.store.currentSubscription(ws.id);
  const access = accessFor({ employees: ws.employees, subscription: sub });
  const paid = parseLookupKey(sub?.lookupKey ?? null);
  return {
    id: ws.id,
    name: ws.name,
    billingEmail: ws.billingEmail,
    employees: ws.employees,
    plan: access.plan,
    access: access.level,
    notice: access.notice,
    subscription: sub
      ? {
          status: sub.status,
          plan: paid?.plan ?? null,
          interval: paid?.interval ?? null,
          quantity: sub.quantity,
          currentPeriodEnd: iso(sub.currentPeriodEnd),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
    hasActiveSubscription: isLiveSubscription(sub?.status),
    canRetryPayment: Boolean(sub?.latestInvoiceId) && (sub?.status === 'past_due' || sub?.status === 'unpaid'),
    demo: deps.demoMode ? { clockTime: iso(ws.clockTime), clockStatus: ws.clockStatus, card: ws.demoCard } : null,
  };
}

export function dashboard(ws: Workspace, deps: BillingDeps): Dashboard {
  return {
    workspace: workspaceView(ws, deps),
    events: deps.store.eventsForWorkspace(ws.id).map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      attempts: e.attempts,
      deliveries: e.deliveries,
      detail: e.detail,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
    })),
    emails: deps.store
      .emailsForWorkspace(ws.id)
      .map((m) => ({ id: m.id, to: m.to, subject: m.subject, body: m.body, sentAt: m.sentAt })),
  };
}
