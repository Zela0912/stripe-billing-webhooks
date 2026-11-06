import Stripe from 'stripe';

export type WebhookVerifier = (rawBody: Buffer, signature: string | undefined) => Stripe.Event;

export class InvalidSignatureError extends Error {
  override name = 'InvalidSignatureError';
}

/**
 * Checks the Stripe-Signature header against the raw request body. Without this, anyone who
 * finds the URL could post a fake "invoice.paid" and unlock a paid plan.
 *
 * Verification is local (HMAC-SHA256, no API call). The SDK also rejects signatures older
 * than 5 minutes, which stops an attacker from replaying a captured request later.
 */
export function createWebhookVerifier(secret: string): WebhookVerifier {
  // Only the offline webhook helpers are used, so no API key is needed here.
  const { webhooks } = new Stripe('sk_test_signature_verification_only');
  return (rawBody, signature) => {
    if (!signature) throw new InvalidSignatureError('Missing Stripe-Signature header');
    try {
      return webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new InvalidSignatureError(err instanceof Error ? err.message : 'Invalid signature');
    }
  };
}
