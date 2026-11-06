import { describe, expect, it } from 'vitest';
import { lookupKey, parseLookupKey, seatPriceCents } from '../../shared/billing.ts';
import { accessFor, isLiveSubscription } from '../src/billing/access.ts';

const sub = (status: string, extra: Partial<{ cancelAtPeriodEnd: boolean }> = {}) => ({
  status,
  lookupKey: 'tidyshift_pro_monthly',
  currentPeriodEnd: Date.parse('2026-12-06T12:00:00Z') / 1000,
  cancelAtPeriodEnd: false,
  ...extra,
});

describe('accessFor', () => {
  it('gives full access on Free up to 10 employees', () => {
    expect(accessFor({ employees: 10, subscription: null })).toEqual({ plan: 'free', level: 'full', notice: null });
  });

  it('makes Free read-only above 10 employees', () => {
    const access = accessFor({ employees: 12, subscription: null });
    expect(access).toMatchObject({ plan: 'free', level: 'read_only', notice: { tone: 'danger' } });
  });

  it('gives the paid plan for active and trialing subscriptions', () => {
    expect(accessFor({ employees: 40, subscription: sub('active') })).toEqual({
      plan: 'pro',
      level: 'full',
      notice: null,
    });
    expect(accessFor({ employees: 40, subscription: sub('trialing') }).plan).toBe('pro');
  });

  it('announces a cancellation at the period end', () => {
    const access = accessFor({ employees: 12, subscription: sub('active', { cancelAtPeriodEnd: true }) });
    expect(access.level).toBe('full');
    expect(access.notice?.message).toContain('December 6, 2026');
  });

  it('keeps full access while Stripe retries a failed payment', () => {
    const access = accessFor({ employees: 12, subscription: sub('past_due') });
    expect(access).toMatchObject({ plan: 'pro', level: 'full', notice: { tone: 'warning', title: 'Payment failed' } });
  });

  it('makes the workspace read-only after all retries failed', () => {
    expect(accessFor({ employees: 12, subscription: sub('unpaid') })).toMatchObject({
      plan: 'pro',
      level: 'read_only',
      notice: { tone: 'danger' },
    });
  });

  it('falls back to Free when the subscription ended', () => {
    expect(accessFor({ employees: 8, subscription: sub('canceled') })).toEqual({
      plan: 'free',
      level: 'full',
      notice: null,
    });
    expect(accessFor({ employees: 12, subscription: sub('incomplete_expired') }).level).toBe('read_only');
  });

  it('does not grant the plan before the first payment completes', () => {
    expect(accessFor({ employees: 5, subscription: sub('incomplete') })).toMatchObject({
      plan: 'free',
      notice: { title: 'Payment not completed' },
    });
  });

  it('treats only ended subscriptions as replaceable by a new checkout', () => {
    expect(['active', 'past_due', 'unpaid', 'incomplete'].every(isLiveSubscription)).toBe(true);
    expect(['canceled', 'incomplete_expired', undefined].some(isLiveSubscription)).toBe(false);
  });
});

describe('catalog', () => {
  it('prices match the TidyShift pricing page', () => {
    expect(seatPriceCents('starter', 'month')).toBe(400);
    expect(seatPriceCents('pro', 'month')).toBe(700);
  });

  it('annual billing is 20% off twelve months', () => {
    expect(seatPriceCents('starter', 'year')).toBe(3840);
    expect(seatPriceCents('pro', 'year')).toBe(6720);
  });

  it('round-trips lookup keys', () => {
    expect(lookupKey('pro', 'year')).toBe('tidyshift_pro_yearly');
    expect(parseLookupKey('tidyshift_starter_monthly')).toEqual({ plan: 'starter', interval: 'month' });
    expect(parseLookupKey('something_else')).toBeNull();
  });
});
