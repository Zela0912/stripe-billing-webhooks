/**
 * Everything the app needs from Stripe, as a small interface. The real implementation is in
 * stripe-gateway.ts; tests use an in-memory fake, so the whole flow runs offline.
 */

export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  status: string;
  lookupKey: string | null;
  itemId: string | null;
  quantity: number;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  latestInvoiceId: string | null;
}

export interface TestClockSnapshot {
  id: string;
  /** Unix seconds. */
  frozenTime: number;
  status: string;
}

export type TestCard = 'working' | 'failing';

export interface BillingGateway {
  createTestClock(name: string, idempotencyKey: string): Promise<TestClockSnapshot>;
  advanceTestClock(id: string, frozenTime: number): Promise<void>;
  createCustomer(
    input: { workspaceId: string; name: string; email: string; testClockId: string | null },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  createCheckoutSession(input: {
    customerId: string;
    workspaceId: string;
    lookupKey: string;
    quantity: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  retrieveSubscription(id: string): Promise<SubscriptionSnapshot>;
  updateQuantity(input: { subscriptionId: string; itemId: string; quantity: number }): Promise<void>;
  /** Charges an open invoice now. Throws PaymentDeclinedError when the card is declined. */
  payInvoice(invoiceId: string): Promise<void>;
  /** Demo only: makes one of Stripe's test cards the default for future charges. */
  setTestCard(input: { customerId: string; subscriptionId: string | null; card: TestCard }): Promise<void>;
}

export class PaymentDeclinedError extends Error {
  override name = 'PaymentDeclinedError';
}
